import { Command } from 'commander'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { LRUCache } from 'lru-cache'
import packageJson from '../package.json' assert { type: 'json' }
import { cleanContent, matchesPattern } from './matcher.js'

const TMUX_SOCKET_PATH = path.join(os.tmpdir(), 'control-app-tmux')
const POLL_INTERVAL = 500
const WEBSOCKET_PORT = 8080
const MAX_CHECKSUM_CACHE_SIZE = 1000

interface Matcher {
  name: string
  trigger: string[]
  response: string
  runOnce: boolean
  windowName: string
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
  private websocketEnabled: boolean
  private socketExistenceLogged = false
  private lastSocketState = false
  private executedMatchers = new Set<string>()

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

      ws.on('close', () => {
        console.log(
          `[${new Date().toISOString()}] WebSocket client disconnected`,
        )
        this.clients.delete(ws)
        this.clientSentWindows.delete(ws)
      })

      ws.on('error', error => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error)
        this.clients.delete(ws)
        this.clientSentWindows.delete(ws)
      })

      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
        }),
      )

      for (const [sessionName, isHumanControlled] of this.controlStateCache) {
        ws.send(
          JSON.stringify({
            type: 'control-state',
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

  private broadcast(message: any) {
    if (!this.websocketEnabled) return

    const messageStr = JSON.stringify(message)
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr)

        if (
          message.type === 'update' &&
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
          console.log(
            `[${new Date().toISOString()}] Control state changed for ${sessionName}: ${isHumanControlled ? 'Human' : 'Agent'}`,
          )

          this.broadcast({
            type: 'control-state',
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

        for (const windowName of windows) {
          await this.captureWindow(sessionName, windowName)
        }
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
      const rawContent = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} capture-pane -p -t ${sessionName}:${windowName}`,
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      )

      const checksum = this.calculateChecksum(rawContent)
      const previousChecksum = this.checksumCache.get(cacheKey)
      const windowKey = `${sessionName}:${windowName}`

      let needsBroadcast = false
      if (checksum !== previousChecksum) {
        needsBroadcast = true
        this.checksumCache.set(cacheKey, checksum)
        console.log(
          `[${new Date().toISOString()}] Updated: ${sessionName}:${windowName} (checksum: ${checksum})`,
        )
      } else {
        for (const client of this.clients) {
          const sentWindows = this.clientSentWindows.get(client)
          if (sentWindows && !sentWindows.has(windowKey)) {
            needsBroadcast = true
            console.log(
              `[${new Date().toISOString()}] Sending initial content for ${sessionName}:${windowName} to new client`,
            )
            break
          }
        }
      }

      if (needsBroadcast) {
        this.broadcast({
          type: 'update',
          sessionName,
          windowName,
          content: rawContent,
          timestamp: new Date().toISOString(),
        })
      }

      if (checksum !== previousChecksum && windowName === 'work') {
        const cleanedContent = cleanContent(rawContent)

        console.log(
          `[${new Date().toISOString()}] Captured content from ${sessionName}:${windowName}:\n---\n${cleanedContent}\n---`,
        )

        const cleanedLines = cleanedContent.split('\n')

        for (const matcher of MATCHERS) {
          if (matcher.name === 'ensure-plan-mode') {
            console.log(
              `[${new Date().toISOString()}] Checking ensure-plan-mode matcher for ${sessionName}:${windowName}`,
            )
            console.log(`  Pattern: ${JSON.stringify(matcher.trigger)}`)
            console.log(
              `  Last 3 lines of content: ${JSON.stringify(cleanedLines.slice(-3))}`,
            )
          }

          const patternMatches = matchesPattern(cleanedLines, matcher.trigger)

          if (matcher.name === 'ensure-plan-mode') {
            console.log(`  Pattern matches: ${patternMatches}`)
          }

          if (windowName === matcher.windowName && patternMatches) {
            const matcherKey = `${sessionName}:${windowName}:${matcher.name}`

            if (matcher.runOnce && this.executedMatchers.has(matcherKey)) {
              if (matcher.name === 'ensure-plan-mode') {
                console.log(`  Skipping (already executed)`)
              }
              continue
            }

            this.parseAndSendKeys(sessionName, windowName, matcher.response)

            if (matcher.runOnce) {
              this.executedMatchers.add(matcherKey)
            }

            this.broadcast({
              type: 'matcher-executed',
              sessionName,
              windowName,
              matcherName: matcher.name,
              timestamp: new Date().toISOString(),
            })

            console.log(
              `[${new Date().toISOString()}] Executed matcher '${matcher.name}' for ${sessionName}:${windowName}`,
            )

            if (matcher.name === 'ensure-plan-mode') {
              console.log('ENSURE-PLAN-MODE MATCHED AND EXECUTED!')
            }
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
          console.log(
            `[${new Date().toISOString()}] Sending special key: ${part.value} -> ${tmuxKey}`,
          )
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
          console.log(
            `[${new Date().toISOString()}] Executing tmux command: ${part.value}`,
          )
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

    console.log(
      `[${new Date().toISOString()}] Sent response '${response}' to ${sessionName}:${windowName}`,
    )
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

  private resizeSessionWindows(sessionName: string) {
    try {
      const windows = this.listWindows(sessionName)

      for (const windowName of windows) {
        try {
          execSync(
            `tmux -S ${TMUX_SOCKET_PATH} resize-window -t ${sessionName}:${windowName} -x 80 -y 24`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          )
          console.log(
            `[${new Date().toISOString()}] Resized window ${sessionName}:${windowName} to 80x24`,
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
