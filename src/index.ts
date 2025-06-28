import { Command } from 'commander'
import { execSync, exec, spawn } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { LRUCache } from 'lru-cache'
import yaml from 'js-yaml'
import packageJson from '../package.json' assert { type: 'json' }
import { cleanContent, matchesPattern } from './matcher.js'
import {
  runMigrations,
  saveSession,
  saveWindow,
  getSession,
  getAllSessions,
  getSessionWithWindows,
} from './db/index.js'
import type { NewSession, NewWindow } from './db/schema.js'

const execAsync = promisify(exec)
const TMUX_SOCKET_PATH = path.join(os.tmpdir(), 'control-app-tmux')
const POLL_INTERVAL = 500
const WEBSOCKET_PORT = 8080
const MAX_CHECKSUM_CACHE_SIZE = 1000
const CODE_PATH = path.join(os.homedir(), 'code')
const WORKTREES_PATH = path.join(os.homedir(), 'code', 'worktrees')

interface Matcher {
  name: string
  trigger: string[]
  response: string
  runOnce: boolean
  windowName: string
}

interface ControlConfig {
  name?: string
  prompts?: {
    plan?: string
  }
}

type ClientMode = 'list-sessions' | 'start-session' | 'show-session'

interface ClientModeInfo {
  mode: ClientMode
  sessionName?: string
}

interface ClientMessage {
  type: 'list-sessions' | 'start-session' | 'show-session'
  projectPath?: string
  projectName?: string
  sessionName?: string
  requestId?: string
}

export const MATCHERS: Matcher[] = [
  {
    name: 'do-you-trust-this-folder',
    trigger: [
      'Do you trust the files in this folder?',
      ' Enter to confirm · Esc to exit',
    ],
    response: '<Enter>',
    runOnce: true,
    windowName: 'work',
  },
  {
    name: 'ensure-plan-mode',
    trigger: [' ? for shortcuts'],
    response: '<S-Tab><S-Tab>',
    runOnce: true,
    windowName: 'work',
  },
  {
    name: 'plan-mode-on',
    trigger: [' ⏸ plan mode on (shift+tab to cycle)'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
    windowName: 'work',
  },
]

class TmuxMonitor {
  private checksumCache = new LRUCache<string, string>({
    max: MAX_CHECKSUM_CACHE_SIZE,
  })
  private controlStateCache = new Map<string, boolean>()
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  private clientSentWindows = new WeakMap<WebSocket, Set<string>>()
  private clientModes = new WeakMap<WebSocket, ClientModeInfo>()
  private websocketEnabled: boolean
  private socketExistenceLogged = false
  private lastSocketState = false
  private executedMatchers = new Set<string>()
  private knownWindows = new Set<string>()

  constructor(websocketEnabled: boolean) {
    this.websocketEnabled = websocketEnabled
    if (websocketEnabled) {
      this.wss = new WebSocketServer({ port: WEBSOCKET_PORT })
      this.setupWebSocketServer()
    }
  }

  private setupWebSocketServer() {
    if (!this.wss) return

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[${new Date().toISOString()}] WebSocket client connected`)
      this.clients.add(ws)
      this.clientSentWindows.set(ws, new Set<string>())
      this.clientModes.set(ws, { mode: 'list-sessions' })

      ws.on('close', () => {
        console.log(
          `[${new Date().toISOString()}] WebSocket client disconnected`,
        )
        this.clients.delete(ws)
        this.clientSentWindows.delete(ws)
        this.clientModes.delete(ws)
      })

      ws.on('error', error => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error)
        this.clients.delete(ws)
        this.clientSentWindows.delete(ws)
        this.clientModes.delete(ws)
      })

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage

          switch (message.type) {
            case 'list-sessions':
              this.clientModes.set(ws, { mode: 'list-sessions' })

              // Send list of all sessions
              const sessions = await getAllSessions()
              this.sendMessage(
                ws,
                {
                  type: 'sessions-list',
                  sessions: sessions.map(session => ({
                    sessionName: session.sessionName,
                    projectName: session.projectName,
                    createdAt: session.createdAt,
                    isActive: this.isSessionActive(session.sessionName),
                  })),
                  timestamp: new Date().toISOString(),
                },
                message.requestId,
              )
              break

            case 'start-session':
              if (!message.projectPath || !message.projectName) {
                this.sendError(ws, 'Missing projectPath or projectName')
                break
              }
              this.clientModes.set(ws, { mode: 'start-session' })
              await this.handleStartSession(
                ws,
                message.projectPath,
                message.projectName,
              )
              break

            case 'show-session':
              if (!message.sessionName) {
                this.sendError(ws, 'Missing sessionName')
                break
              }
              this.clientModes.set(ws, {
                mode: 'show-session',
                sessionName: message.sessionName,
              })

              // Send session info immediately
              const sessionInfo = await getSessionWithWindows(
                message.sessionName,
              )
              if (sessionInfo) {
                this.sendMessage(
                  ws,
                  {
                    type: 'session-info',
                    sessionName: sessionInfo.sessionName,
                    projectName: sessionInfo.projectName,
                    worktreePath: sessionInfo.worktreePath,
                    hostname: os.hostname(),
                    windows: sessionInfo.windows.map(window => ({
                      name: window.name,
                      command: window.command,
                      description: window.description,
                      port: window.port,
                    })),
                    timestamp: new Date().toISOString(),
                  },
                  message.requestId,
                )
              } else {
                this.sendError(ws, `Session ${message.sessionName} not found`)
              }
              break
          }
        } catch (error) {
          this.sendError(
            ws,
            error instanceof Error ? error.message : 'Invalid message',
          )
        }
      })

      ws.send(
        JSON.stringify({
          type: 'client-connected',
          timestamp: new Date().toISOString(),
        }),
      )

      for (const [sessionName, isHumanControlled] of this.controlStateCache) {
        ws.send(
          JSON.stringify({
            type: 'session-control',
            sessionName,
            isHumanControlled,
            timestamp: new Date().toISOString(),
          }),
        )
      }
    })

    console.log(
      `[${new Date().toISOString()}] WebSocket server listening on port ${WEBSOCKET_PORT}`,
    )
  }

  private sendError(ws: WebSocket, message: string) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message,
        timestamp: new Date().toISOString(),
      }),
    )
  }

  private sendMessage(ws: WebSocket, message: any, requestId?: string) {
    if (requestId) {
      message.requestId = requestId
    }
    ws.send(JSON.stringify(message))
  }

  private isSessionActive(sessionName: string): boolean {
    const activeSessions = this.listSessions()
    return activeSessions.includes(sessionName)
  }

  private broadcast(message: any) {
    if (!this.websocketEnabled) return

    if (message.type === 'window-content') {
      console.log(
        `[${new Date().toISOString()}] Broadcasting window-content: ${message.sessionName}:${message.windowName}`,
      )
    } else if (message.type === 'session-control') {
      console.log(
        `[${new Date().toISOString()}] Broadcasting session-control: ${message.sessionName} (${message.isHumanControlled ? 'Human' : 'Agent'})`,
      )
    } else if (message.type === 'window-automation') {
      console.log(
        `[${new Date().toISOString()}] Broadcasting window-automation: ${message.matcherName} for ${message.sessionName}:${message.windowName}`,
      )
    }

    const messageStr = JSON.stringify(message)
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        const mode = this.clientModes.get(client)

        // Only send session events if client is in start/show mode for this session
        if (mode && message.sessionName) {
          if (mode.mode === 'list-sessions') {
            // Don't send session-specific events in list mode
            return
          }
          if (
            mode.mode === 'start-session' &&
            mode.sessionName !== message.sessionName
          ) {
            // Only send events for the session being created
            return
          }
          if (
            mode.mode === 'show-session' &&
            mode.sessionName !== message.sessionName
          ) {
            // Only send events for the specified session
            return
          }
        }

        client.send(messageStr)

        if (
          message.type === 'window-content' &&
          message.sessionName &&
          message.windowName
        ) {
          const sentWindows = this.clientSentWindows.get(client)
          if (sentWindows) {
            sentWindows.add(`${message.sessionName}:${message.windowName}`)
          }
        }
      }
    })
  }

  async start() {
    console.log(`[${new Date().toISOString()}] Starting tmux window monitor...`)
    console.log(
      `[${new Date().toISOString()}] Monitoring socket: ${TMUX_SOCKET_PATH}`,
    )
    if (!this.websocketEnabled) {
      console.log(`[${new Date().toISOString()}] WebSocket server disabled`)
    }

    setInterval(() => {
      this.pollAllWindows().catch(error => {
        console.error(
          `[${new Date().toISOString()}] Error during polling:`,
          error instanceof Error ? error.message : String(error),
        )
      })
    }, POLL_INTERVAL)

    this.pollAllWindows().catch(error => {
      console.error(
        `[${new Date().toISOString()}] Error during initial polling:`,
        error instanceof Error ? error.message : String(error),
      )
    })
  }

  private socketExists(): boolean {
    try {
      return fs.existsSync(TMUX_SOCKET_PATH)
    } catch {
      return false
    }
  }

  private async pollAllWindows() {
    const socketExists = this.socketExists()

    if (socketExists !== this.lastSocketState) {
      this.lastSocketState = socketExists
      if (!socketExists) {
        if (!this.socketExistenceLogged) {
          console.log(
            `[${new Date().toISOString()}] Waiting for tmux socket at ${TMUX_SOCKET_PATH}...`,
          )
          this.socketExistenceLogged = true
        }
      } else {
        console.log(
          `[${new Date().toISOString()}] Tmux socket detected at ${TMUX_SOCKET_PATH}`,
        )
        this.socketExistenceLogged = false
      }
    }

    if (!socketExists) {
      return
    }

    try {
      const sessions = this.listSessions()

      for (const sessionName of sessions) {
        const isHumanControlled = this.checkHumanControl(sessionName)
        const wasHumanControlled =
          this.controlStateCache.get(sessionName) || false

        if (isHumanControlled !== wasHumanControlled) {
          this.controlStateCache.set(sessionName, isHumanControlled)

          this.broadcast({
            type: 'session-control',
            sessionName,
            isHumanControlled,
            timestamp: new Date().toISOString(),
          })

          if (!isHumanControlled && wasHumanControlled) {
            this.resizeSessionWindows(sessionName)
          }
        }

        if (isHumanControlled) {
          continue
        }

        const windows = this.listWindows(sessionName)

        await Promise.all(
          windows.map(windowName =>
            this.captureWindow(sessionName, windowName),
          ),
        )
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error listing sessions:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private listSessions(): string[] {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-sessions -F "#{session_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }

  private listWindows(sessionName: string): string[] {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-windows -t ${sessionName} -F "#{window_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }

  private async captureWindow(sessionName: string, windowName: string) {
    const cacheKey = `${sessionName}:${windowName}`
    const initialModeCacheKey = `${sessionName}:${windowName}:initial-mode-configured`

    try {
      const startTime = Date.now()
      const { stdout: rawContent } = await execAsync(
        `tmux -S ${TMUX_SOCKET_PATH} capture-pane -p -t ${sessionName}:${windowName}`,
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        },
      )
      const captureTime = Date.now() - startTime
      if (captureTime > 100) {
        console.log(
          `[${new Date().toISOString()}] Slow capture for ${sessionName}:${windowName}: ${captureTime}ms`,
        )
      }

      const checksum = this.calculateChecksum(rawContent)
      const previousChecksum = this.checksumCache.get(cacheKey)
      const windowKey = `${sessionName}:${windowName}`

      const isNewWindow = !this.knownWindows.has(windowKey)
      if (isNewWindow) {
        this.knownWindows.add(windowKey)
      }

      let needsBroadcast = false
      if (checksum !== previousChecksum || isNewWindow) {
        needsBroadcast = true
        this.checksumCache.set(cacheKey, checksum)
        if (isNewWindow) {
          console.log(
            `[${new Date().toISOString()}] New window detected: ${sessionName}:${windowName}`,
          )
        } else {
          console.log(
            `[${new Date().toISOString()}] Window content changed: ${sessionName}:${windowName}`,
          )
        }
      } else {
        for (const client of this.clients) {
          const sentWindows = this.clientSentWindows.get(client)
          if (sentWindows && !sentWindows.has(windowKey)) {
            needsBroadcast = true
            break
          }
        }
      }

      if (needsBroadcast) {
        this.broadcast({
          type: 'window-content',
          sessionName,
          windowName,
          content: rawContent,
          timestamp: new Date().toISOString(),
        })
      }

      if (checksum !== previousChecksum && windowName === 'work') {
        const cleanedContent = cleanContent(rawContent)

        const cleanedLines = cleanedContent.split('\n')

        for (const matcher of MATCHERS) {
          const patternMatches = matchesPattern(cleanedLines, matcher.trigger)

          if (windowName === matcher.windowName && patternMatches) {
            const matcherKey = `${sessionName}:${windowName}:${matcher.name}`

            if (matcher.runOnce && this.executedMatchers.has(matcherKey)) {
              continue
            }

            this.parseAndSendKeys(sessionName, windowName, matcher.response)

            if (matcher.runOnce) {
              this.executedMatchers.add(matcherKey)
            }

            this.broadcast({
              type: 'window-automation',
              sessionName,
              windowName,
              matcherName: matcher.name,
              timestamp: new Date().toISOString(),
            })
          }
        }
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error capturing ${sessionName}:${windowName}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex')
  }

  private parseAndSendKeys(
    sessionName: string,
    windowName: string,
    response: string,
  ) {
    const parts: Array<{ type: 'text' | 'key' | 'command'; value: string }> = []
    let currentText = ''
    let i = 0

    while (i < response.length) {
      if (response[i] === '<') {
        // Save any accumulated text
        if (currentText) {
          parts.push({ type: 'text', value: currentText })
          currentText = ''
        }

        // Find the closing bracket
        const closeIndex = response.indexOf('>', i)
        if (closeIndex === -1) {
          // No closing bracket, treat as text
          currentText += response[i]
          i++
        } else {
          // Extract the key name
          const keyName = response.substring(i + 1, closeIndex)
          parts.push({ type: 'key', value: keyName })
          i = closeIndex + 1
        }
      } else if (response[i] === '{') {
        if (currentText) {
          parts.push({ type: 'text', value: currentText })
          currentText = ''
        }

        const closeIndex = response.indexOf('}', i)
        if (closeIndex === -1) {
          currentText += response[i]
          i++
        } else {
          const commandName = response.substring(i + 1, closeIndex)
          parts.push({ type: 'command', value: commandName })
          i = closeIndex + 1
        }
      } else {
        currentText += response[i]
        i++
      }
    }

    if (currentText) {
      parts.push({ type: 'text', value: currentText })
    }

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      try {
        if (part.type === 'text') {
          const escapedText = part.value.replace(/'/g, "'\"'\"'")
          execSync(
            `tmux -S ${TMUX_SOCKET_PATH} send-keys -t ${sessionName}:${windowName} -l '${escapedText}'`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          )
        } else if (part.type === 'key') {
          const tmuxKey = this.convertToTmuxKey(part.value)
          execSync(
            `tmux -S ${TMUX_SOCKET_PATH} send-keys -t ${sessionName}:${windowName} ${tmuxKey}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          )

          if (index < parts.length - 1) {
            execSync('sleep 0.1', {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
          }
        } else if (part.type === 'command') {
          if (part.value === 'paste-buffer') {
            execSync(
              `tmux -S ${TMUX_SOCKET_PATH} paste-buffer -t ${sessionName}:${windowName}`,
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
            )
          }
          if (index < parts.length - 1) {
            execSync('sleep 0.1', {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
          }
        }
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Failed to send keys to ${sessionName}:${windowName}:`,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  private convertToTmuxKey(keyName: string): string {
    const keyMap: Record<string, string> = {
      Enter: 'Enter',
      Return: 'Enter',
      Tab: 'Tab',
      'S-Tab': 'BTab',
      Space: 'Space',
      Escape: 'Escape',
      Esc: 'Escape',
      Up: 'Up',
      Down: 'Down',
      Left: 'Left',
      Right: 'Right',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Delete: 'Delete',
      Backspace: 'BSpace',
      Insert: 'Insert',
    }

    if (keyMap[keyName]) {
      return keyMap[keyName]
    }

    if (keyName.match(/^[CMS]-./)) {
      return keyName
    }

    if (keyName.match(/^F\d{1,2}$/)) {
      return keyName
    }

    return keyName
  }

  private checkHumanControl(sessionName: string): boolean {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-clients -t ${sessionName} -F "#{client_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      const clientCount = output ? output.split('\n').length : 0
      return clientCount > 0
    } catch {
      return false
    }
  }

  private isGitRepositoryClean(projectPath: string): boolean {
    try {
      execSync('git diff --quiet && git diff --cached --quiet', {
        cwd: projectPath,
        encoding: 'utf-8',
      })
      return true
    } catch {
      return false
    }
  }

  private getNextWorktreeNumber(projectName: string): string {
    let i = 1
    while (i < 1000) {
      const num = i.toString().padStart(3, '0')
      const worktreePath = path.join(
        WORKTREES_PATH,
        `${projectName}-worktree-${num}`,
      )

      try {
        const branchExists = execSync(`git branch --list "worktree-${num}"`, {
          cwd: path.join(CODE_PATH, projectName),
          encoding: 'utf-8',
        }).trim()

        if (!branchExists && !fs.existsSync(worktreePath)) {
          return num
        }
      } catch {
        if (!fs.existsSync(worktreePath)) {
          return num
        }
      }

      i++
    }
    throw new Error('No available worktree numbers')
  }

  private findAvailablePort(): number {
    const getRandomPort = () =>
      Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152
    const isPortAvailable = (port: number): boolean => {
      try {
        execSync(`lsof -ti:${port}`, { encoding: 'utf-8' })
        return false
      } catch {
        return true
      }
    }

    let port = getRandomPort()
    let attempts = 0
    while (!isPortAvailable(port) && attempts < 100) {
      port = getRandomPort()
      attempts++
    }
    if (attempts >= 100) {
      throw new Error('Could not find an available port')
    }
    return port
  }

  private async handleStartSession(
    ws: WebSocket,
    projectPath: string,
    projectName: string,
  ) {
    const sessionName = `${projectName}-worktree-${this.getNextWorktreeNumber(projectName)}`

    // Send creating event
    this.sendMessage(ws, {
      type: 'session-creating',
      sessionName,
      timestamp: new Date().toISOString(),
    })

    try {
      // 1. Check git status
      if (!this.isGitRepositoryClean(projectPath)) {
        throw new Error(
          'Repository has uncommitted changes. Please commit or stash them first.',
        )
      }

      // 2. Create worktree
      await fs.promises.mkdir(WORKTREES_PATH, { recursive: true })
      const worktreeNum = this.getNextWorktreeNumber(projectName)
      const worktreePath = path.join(
        WORKTREES_PATH,
        `${projectName}-worktree-${worktreeNum}`,
      )
      const branchName = `worktree-${worktreeNum}`

      execSync(`git worktree add -q "${worktreePath}" -b "${branchName}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
      })

      // Install dependencies if lock file exists
      const lockFilePath = path.join(worktreePath, 'pnpm-lock.yaml')
      if (fs.existsSync(lockFilePath)) {
        execSync('pnpm install', {
          cwd: worktreePath,
          encoding: 'utf-8',
        })
      }

      // 3. Determine expected windows
      const expectedWindows = await this.getExpectedWindows(worktreePath)

      // Send worktree created event
      this.sendMessage(ws, {
        type: 'worktree-created',
        worktreeNumber: parseInt(worktreeNum),
        expectedWindows,
        timestamp: new Date().toISOString(),
      })

      // Save session to database
      const newSession: NewSession = {
        sessionName,
        projectName,
        worktreePath,
      }
      await saveSession(newSession)

      // 4. Create tmux session and windows
      await this.createTmuxSession(
        sessionName,
        worktreePath,
        expectedWindows,
        ws,
      )

      // 5. Track session for this client
      this.clientModes.set(ws, {
        mode: 'start-session',
        sessionName,
      })

      // Send session ready
      this.sendMessage(ws, {
        type: 'session-ready',
        sessionName,
        worktreeNumber: parseInt(worktreeNum),
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      this.sendError(
        ws,
        error instanceof Error ? error.message : 'Failed to create session',
      )
    }
  }

  private async createTmuxSession(
    sessionName: string,
    worktreePath: string,
    expectedWindows: string[],
    ws: WebSocket,
  ) {
    const packageJsonPath = path.join(worktreePath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found in worktree')
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const scripts = packageJson.scripts || {}

    let controlConfig: ControlConfig | null = null
    try {
      const controlYamlPath = path.join(worktreePath, 'control.yaml')
      const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
      controlConfig = yaml.load(controlYamlContent) as ControlConfig
    } catch {}

    let firstWindowCreated = false
    let windowIndex = 0

    const createSession = (windowName: string, command: string) => {
      this.sendMessage(ws, {
        type: 'window-starting',
        windowName,
        command,
        timestamp: new Date().toISOString(),
      })

      const tmuxProcess = spawn(
        'tmux',
        [
          '-S',
          TMUX_SOCKET_PATH,
          'new-session',
          '-d',
          '-s',
          sessionName,
          '-n',
          windowName,
          '-c',
          worktreePath,
          '-x',
          '80',
          '-y',
          '24',
        ],
        {
          detached: true,
          stdio: 'ignore',
        },
      )
      tmuxProcess.unref()

      setTimeout(() => {
        execSync(
          `tmux -S ${TMUX_SOCKET_PATH} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
        )
      }, 50)

      firstWindowCreated = true
    }

    const createWindow = (windowName: string, command: string) => {
      this.sendMessage(ws, {
        type: 'window-starting',
        windowName,
        command,
        timestamp: new Date().toISOString(),
      })

      execSync(
        `tmux -S ${TMUX_SOCKET_PATH} new-window -t ${sessionName} -n '${windowName}' -c ${worktreePath}`,
      )
      execSync(
        `tmux -S ${TMUX_SOCKET_PATH} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
      )
    }

    // Create server window
    if (scripts.dev && expectedWindows.includes('server')) {
      const port = this.findAvailablePort()
      const command = `PORT=${port} pnpm run dev`

      if (!firstWindowCreated) {
        createSession('server', command)
      } else {
        createWindow('server', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'server',
        command: 'pnpm run dev',
        description: 'Development server',
        port,
      }
      await saveWindow(window)

      this.sendMessage(ws, {
        type: 'window-ready',
        windowName: 'server',
        port,
        timestamp: new Date().toISOString(),
      })
    }

    // Create lint window
    if (scripts['lint:watch'] && expectedWindows.includes('lint')) {
      const command = 'pnpm run lint:watch'

      if (!firstWindowCreated) {
        createSession('lint', command)
      } else {
        createWindow('lint', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'lint',
        command: 'pnpm run lint:watch',
        description: 'Linting watcher',
      }
      await saveWindow(window)

      this.sendMessage(ws, {
        type: 'window-ready',
        windowName: 'lint',
        timestamp: new Date().toISOString(),
      })
    }

    // Create types window
    if (scripts['types:watch'] && expectedWindows.includes('types')) {
      const command = 'pnpm run types:watch'

      if (!firstWindowCreated) {
        createSession('types', command)
      } else {
        createWindow('types', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'types',
        command: 'pnpm run types:watch',
        description: 'TypeScript type checker',
      }
      await saveWindow(window)

      this.sendMessage(ws, {
        type: 'window-ready',
        windowName: 'types',
        timestamp: new Date().toISOString(),
      })
    }

    // Create test window
    if (scripts['test:watch'] && expectedWindows.includes('test')) {
      const command = 'pnpm run test:watch'

      if (!firstWindowCreated) {
        createSession('test', command)
      } else {
        createWindow('test', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'test',
        command: 'pnpm run test:watch',
        description: 'Test runner',
      }
      await saveWindow(window)

      this.sendMessage(ws, {
        type: 'window-ready',
        windowName: 'test',
        timestamp: new Date().toISOString(),
      })
    }

    // Create work window
    if (controlConfig?.prompts?.plan && expectedWindows.includes('work')) {
      try {
        const planOutput = execSync(controlConfig.prompts.plan, {
          cwd: worktreePath,
          encoding: 'utf-8',
        })
        execSync(
          `tmux -S ${TMUX_SOCKET_PATH} set-buffer "${planOutput.replace(/"/g, '\\"')}"`,
        )
      } catch (error) {
        console.error('Failed to execute plan prompt:', error)
      }

      const command = 'claude'

      if (!firstWindowCreated) {
        createSession('work', command)
      } else {
        createWindow('work', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'work',
        command: 'claude',
        description: 'AI agent workspace',
      }
      await saveWindow(window)

      this.sendMessage(ws, {
        type: 'window-ready',
        windowName: 'work',
        timestamp: new Date().toISOString(),
      })
    }

    // Select work window if it exists
    setTimeout(() => {
      try {
        execSync(
          `tmux -S ${TMUX_SOCKET_PATH} select-window -t ${sessionName}:work`,
        )
      } catch {}
    }, 200)
  }

  private async getExpectedWindows(worktreePath: string): Promise<string[]> {
    const windows: string[] = []

    try {
      const packageJsonPath = path.join(worktreePath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return windows
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      if (scripts.dev) {
        windows.push('server')
      }

      if (scripts['lint:watch']) {
        windows.push('lint')
      }

      if (scripts['types:watch']) {
        windows.push('types')
      }

      if (scripts['test:watch']) {
        windows.push('test')
      }

      let controlConfig: ControlConfig | null = null
      try {
        const controlYamlPath = path.join(worktreePath, 'control.yaml')
        const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
        controlConfig = yaml.load(controlYamlContent) as ControlConfig
      } catch {}

      if (controlConfig?.prompts?.plan) {
        windows.push('work')
      }

      return windows
    } catch {
      return windows
    }
  }

  private resizeSessionWindows(sessionName: string) {
    try {
      const windows = this.listWindows(sessionName)

      for (const windowName of windows) {
        try {
          execSync(
            `tmux -S ${TMUX_SOCKET_PATH} resize-window -t ${sessionName}:${windowName} -x 80 -y 24`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          )
        } catch (error) {
          console.error(
            `[${new Date().toISOString()}] Failed to resize ${sessionName}:${windowName}:`,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error resizing windows for ${sessionName}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

async function main() {
  // Run database migrations on startup
  try {
    runMigrations()
    console.log(`[${new Date().toISOString()}] Database migrations completed`)
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Failed to run migrations:`,
      error,
    )
  }

  const program = new Command()

  program
    .name('control')
    .description('Control CLI')
    .version(packageJson.version)
    .option('--websocket', 'Enable WebSocket server', false)
    .option('--no-websocket', 'Disable WebSocket server')
    .action(options => {
      const websocketEnabled = options.websocket

      const monitor = new TmuxMonitor(websocketEnabled)
      monitor.start()

      process.on('SIGINT', () => {
        console.log(
          `\n[${new Date().toISOString()}] Shutting down tmux monitor...`,
        )
        process.exit(0)
      })

      process.on('SIGTERM', () => {
        console.log(
          `\n[${new Date().toISOString()}] Shutting down tmux monitor...`,
        )
        process.exit(0)
      })
    })

  try {
    program.exitOverride()
    program.configureOutput({
      writeErr: str => process.stderr.write(str),
    })

    await program.parseAsync(process.argv)
  } catch (error: any) {
    if (
      error.code === 'commander.help' ||
      error.code === 'commander.helpDisplayed'
    ) {
      process.exit(0)
    }
    console.error('Error:', error.message || error)
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
