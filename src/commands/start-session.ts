import { execSync, spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  isGitRepositoryClean,
  getNextWorktreeNumber,
  createWorktree,
  installDependencies,
  WORKTREES_PATH,
} from '../core/git-utils.js'
import { socketExists, listWindows } from '../core/tmux-utils.js'
import { TERMINAL_SIZES } from '../core/constants.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { loadConfig } from '../core/config.js'
import type {
  TmuxEventWithOptionalData,
  EventName,
  EventDataMap,
  CreateTmuxWindowEndData,
} from '../core/events.js'

interface CreateSessionOptions extends TmuxSocketOptions {
  terminalWidth?: number
  terminalHeight?: number
  attach?: boolean
  worktree?: boolean
  zmq?: boolean
  zmqSocket?: string
  zmqSocketPath?: string
}

export class SessionCreator extends EventEmitter {
  protected socketOptions: TmuxSocketOptions
  private readonly sessionId = randomUUID()

  constructor(options: CreateSessionOptions = {}) {
    super()
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }

    this.on('event', (event: TmuxEventWithOptionalData) => {
      console.log(JSON.stringify(event))
    })
  }

  protected emitEvent<T extends EventName>(
    eventName: T,
    ...args: T extends keyof EventDataMap
      ? EventDataMap[T] extends undefined
        ? []
        : [data: EventDataMap[T]]
      : []
  ): void {
    const event = {
      event: eventName,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...(args.length > 0 ? { data: args[0] } : {}),
    } as TmuxEventWithOptionalData<T>
    this.emit('event', event)
  }

  async create(projectPath: string, options: CreateSessionOptions = {}) {
    if (options.zmq === false && (options.zmqSocket || options.zmqSocketPath)) {
      console.error(
        'Error: Cannot use --no-zmq with --zmq-socket or --zmq-socket-path',
      )
      process.exit(1)
    }

    const startTime = Date.now()

    const socketPath = getTmuxSocketPath(this.socketOptions)

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'start-session',
        socketPath,
      },
    })

    const config = loadConfig(projectPath)

    this.emitEvent('initialize-session-creation:start', {
      projectPath,
      options: {
        socketName: options.socketName,
        socketPath: options.socketPath,
        terminalWidth: options.terminalWidth,
        terminalHeight: options.terminalHeight,
        attach: options.attach,
        worktreeMode: options.worktree !== false,
      },
    })

    this.emitEvent('initialize-session-creation:end', {
      duration: Date.now() - startTime,
    })

    const metadataStartTime = Date.now()
    this.emitEvent('analyze-project-metadata:start')
    const projectName = path.basename(projectPath)

    const isWorktreeMode = options.worktree ?? config.worktree ?? true
    let worktreeNum: string | undefined
    let sessionName: string

    if (isWorktreeMode) {
      worktreeNum = getNextWorktreeNumber(projectPath)
      sessionName = `${projectName}-worktree-${worktreeNum}`
    } else {
      sessionName = projectName

      try {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        const sessions = execSync(
          `tmux ${socketArgs} list-sessions -F '#{session_name}'`,
          {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          },
        )
          .trim()
          .split('\n')

        if (sessions.includes(sessionName)) {
          this.emitEvent('analyze-project-metadata:fail', {
            error: `Session '${sessionName}' already exists`,
            errorCode: 'SESSION_EXISTS',
            duration: Date.now() - metadataStartTime,
          })
          throw new Error(`Session '${sessionName}' already exists`)
        }
      } catch (error) {
        if (
          error instanceof Error &&
          !error.message.includes('already exists')
        ) {
        } else {
          throw error
        }
      }
    }

    this.emitEvent('analyze-project-metadata:end', {
      projectPath,
      projectName,
      worktreeNumber: worktreeNum,
      sessionName,
      worktreeMode: isWorktreeMode,
      duration: Date.now() - metadataStartTime,
    })

    const sessionStartTime = Date.now()
    this.emitEvent('create-worktree-session:start')

    try {
      const repoCheckStart = Date.now()
      this.emitEvent('ensure-clean-repository:start')
      const isClean = isGitRepositoryClean(projectPath)

      if (!isClean) {
        this.emitEvent('ensure-clean-repository:fail', {
          isClean: false,
          error: 'Repository has uncommitted changes',
          errorCode: 'DIRTY_REPOSITORY',
          duration: Date.now() - repoCheckStart,
        })
        this.emitEvent('create-worktree-session:fail', {
          error:
            'Repository has uncommitted changes. Please commit or stash them first.',
          errorCode: 'DIRTY_REPOSITORY',
          duration: Date.now() - sessionStartTime,
        })
        throw new Error(
          'Repository has uncommitted changes. Please commit or stash them first.',
        )
      }

      const branch = execSync('git branch --show-current', {
        cwd: projectPath,
        encoding: 'utf-8',
      }).trim()
      const commitHash = execSync('git rev-parse HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
      }).trim()

      this.emitEvent('ensure-clean-repository:end', {
        isClean: true,
        branch,
        commitHash,
        uncommittedFiles: [],
        stagedFiles: [],
        duration: Date.now() - repoCheckStart,
      })

      let worktreePath: string

      if (isWorktreeMode) {
        await fs.promises.mkdir(WORKTREES_PATH, { recursive: true })

        const worktreeStart = Date.now()
        this.emitEvent('create-project-worktree:start')
        try {
          worktreePath = createWorktree(projectPath, projectName, worktreeNum!)
          this.emitEvent('create-project-worktree:end', {
            sourcePath: projectPath,
            worktreePath,
            branch,
            worktreeNumber: worktreeNum,
            duration: Date.now() - worktreeStart,
          })
        } catch (error) {
          this.emitEvent('create-project-worktree:fail', {
            error: error instanceof Error ? error.message : String(error),
            sourcePath: projectPath,
            worktreeNumber: worktreeNum,
            duration: Date.now() - worktreeStart,
          })
          this.emitEvent('create-worktree-session:fail', {
            error: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
            duration: Date.now() - sessionStartTime,
          })
          throw error
        }

        const depsStart = Date.now()
        this.emitEvent('install-project-dependencies:start')
        try {
          installDependencies(worktreePath)
          this.emitEvent('install-project-dependencies:end', {
            packageManager: 'pnpm',
            worktreePath,
            hasPackageJson: fs.existsSync(
              path.join(worktreePath, 'package.json'),
            ),
            hasLockfile: fs.existsSync(
              path.join(worktreePath, 'pnpm-lock.yaml'),
            ),
            duration: Date.now() - depsStart,
          })
        } catch (error) {
          this.emitEvent('install-project-dependencies:fail', {
            error: error instanceof Error ? error.message : String(error),
            packageManager: 'pnpm',
            worktreePath,
            duration: Date.now() - depsStart,
          })
          this.emitEvent('create-worktree-session:fail', {
            error: `Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`,
            duration: Date.now() - sessionStartTime,
          })
          throw error
        }
      } else {
        worktreePath = projectPath
        this.emitEvent('skip-worktree-creation', {
          reason: 'Non-worktree mode',
          currentPath: projectPath,
          duration: 0,
        })
      }

      const structureStart = Date.now()
      this.emitEvent('analyze-project-structure:start')
      const hasPackageJson = fs.existsSync(
        path.join(worktreePath, 'package.json'),
      )
      this.emitEvent('analyze-project-structure:end', {
        hasPackageJson,
        packageJsonPath: hasPackageJson
          ? path.join(worktreePath, 'package.json')
          : null,
        worktreeMode: isWorktreeMode,
        duration: Date.now() - structureStart,
      })

      let expectedWindows: string[]
      try {
        expectedWindows = await this.getExpectedWindows(worktreePath, config)
      } catch (error) {
        this.emitEvent('analyze-project-scripts:fail', {
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
        })
        this.emitEvent('create-worktree-session:fail', {
          error: `Failed to analyze project: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - sessionStartTime,
        })
        throw error
      }

      let windows: string[]
      try {
        windows = await this.createTmuxSession(
          sessionName,
          worktreePath,
          expectedWindows,
          options.terminalWidth,
          options.terminalHeight,
          options,
          config,
        )
      } catch (error) {
        this.emitEvent('create-worktree-session:fail', {
          error: `Failed to create tmux session: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - sessionStartTime,
        })
        throw error
      }

      const socketArgsArr = getTmuxSocketArgs(this.socketOptions)
      const socketArgs = socketArgsArr.join(' ')

      const finalizeStart = Date.now()
      this.emitEvent('finalize-tmux-session:start')
      this.emitEvent('finalize-tmux-session:end', {
        sessionName,
        selectedWindow:
          windows.find(w => w !== 'control') || windows[0] || 'none',
        totalWindows: windows.length,
        worktreePath,
        worktreeMode: isWorktreeMode,
        duration: Date.now() - finalizeStart,
        totalDuration: Date.now() - startTime,
      })

      this.emitEvent('create-worktree-session:end', {
        sessionName,
        worktreePath,
        windows,
        worktreeMode: isWorktreeMode,
        duration: Date.now() - sessionStartTime,
        totalDuration: Date.now() - startTime,
      })

      try {
        const firstNonControlWindow =
          windows.find(w => w !== 'control') || windows[0]
        if (firstNonControlWindow) {
          execSync(
            `tmux ${socketArgs} select-window -t ${sessionName}:${firstNonControlWindow}`,
          )
        }
      } catch (error) {
        this.emitEvent('select-window:fail', {
          sessionName,
          window: windows.find(w => w !== 'control') || windows[0] || 'none',
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (options.attach) {
        const attachStart = Date.now()
        this.emitEvent('attach-tmux-session:start')

        await this.waitForWindows(sessionName, windows)

        const insideTmux = !!process.env.TMUX

        try {
          let result
          let command: string

          if (insideTmux) {
            command = 'switch-client'
            this.emitEvent('switch-tmux-session:start', {
              sessionName,
              fromInsideTmux: true,
            })

            result = spawnSync(
              'tmux',
              [...socketArgsArr, 'switch-client', '-t', sessionName],
              {
                stdio: 'inherit',
              },
            )
          } else {
            command = 'attach'
            result = spawnSync(
              'tmux',
              [...socketArgsArr, 'attach', '-t', sessionName],
              {
                stdio: 'inherit',
              },
            )
          }

          if (result.error) {
            throw result.error
          }

          if (result.status !== 0) {
            throw new Error(
              `tmux ${command} exited with status ${result.status}`,
            )
          }

          this.emitEvent('attach-tmux-session:end', {
            sessionName,
            windowsReady: true,
            waitDuration: Date.now() - attachStart,
            attachMethod: insideTmux ? 'switch-client' : 'attach',
            duration: Date.now() - attachStart,
          })
        } catch (error) {
          const attachCommand = insideTmux
            ? `tmux ${socketArgs} switch-client -t ${sessionName}`
            : `tmux ${socketArgs} attach -t ${sessionName}`

          this.emitEvent('attach-tmux-session:fail', {
            sessionName,
            error: error instanceof Error ? error.message : String(error),
            attachCommand,
            insideTmux,
            duration: Date.now() - attachStart,
          })
          console.error(
            `\nFailed to ${insideTmux ? 'switch to' : 'attach to'} session: ${error instanceof Error ? error.message : String(error)}`,
          )
          console.error(`Session created: ${sessionName}`)
          console.error(
            `To ${insideTmux ? 'switch' : 'attach'} manually, use: ${attachCommand}`,
          )
        }
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('Repository has uncommitted changes')
      ) {
        this.emitEvent('create-worktree-session:fail', {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - sessionStartTime,
        })
      }
      throw error
    }
  }

  protected async getExpectedWindows(
    worktreePath: string,
    config: ReturnType<typeof loadConfig>,
  ): Promise<string[]> {
    const scriptsStart = Date.now()
    this.emitEvent('analyze-project-scripts:start')
    const windows: string[] = []
    const availableScripts: string[] = []

    try {
      const packageJsonPath = path.join(worktreePath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return windows
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      if (scripts) {
        availableScripts.push(...Object.keys(scripts))
      }

      if (config.commands?.['run-agent']) {
        windows.push('agent')
      }

      if (scripts.dev) {
        windows.push('server')
      }

      Object.keys(scripts).forEach(scriptName => {
        if (scriptName.endsWith(':watch')) {
          const windowName = scriptName.slice(0, -6)
          windows.push(windowName)
        }
      })

      windows.push('control')

      this.emitEvent('analyze-project-scripts:end', {
        availableScripts,
        plannedWindows: windows,
        duration: Date.now() - scriptsStart,
      })

      return windows
    } catch {
      this.emitEvent('analyze-project-scripts:end', {
        availableScripts,
        plannedWindows: windows,
        error: 'Failed to analyze project scripts',
        duration: Date.now() - scriptsStart,
      })
      return windows
    }
  }

  protected async createTmuxSession(
    sessionName: string,
    worktreePath: string,
    expectedWindows: string[],
    terminalWidth?: number,
    terminalHeight?: number,
    options: CreateSessionOptions = {},
    config: ReturnType<typeof loadConfig> = {},
  ): Promise<string[]> {
    const sessionStart = Date.now()
    this.emitEvent('create-tmux-session:start')
    const packageJsonPath = path.join(worktreePath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      this.emitEvent('create-tmux-session:fail', {
        error: 'package.json not found in worktree',
        errorCode: 'MISSING_PACKAGE_JSON',
        duration: Date.now() - sessionStart,
      })
      throw new Error('package.json not found in worktree')
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const scripts = packageJson.scripts || {}

    let firstWindowCreated = false
    let windowIndex = 0
    const createdWindows: string[] = []
    const windowOrder: string[] = []

    const createSession = async (windowName: string, command: string) => {
      const windowStart = Date.now()
      this.emitEvent(`create-tmux-window:${windowName}:start` as EventName)

      const socketArgs = getTmuxSocketArgs(this.socketOptions)
      const tmuxProcess = spawn(
        'tmux',
        [
          ...socketArgs,
          'new-session',
          '-d',
          '-s',
          sessionName,
          '-n',
          windowName,
          '-c',
          worktreePath,
          '-x',
          String(terminalWidth || TERMINAL_SIZES.big.width),
          '-y',
          String(terminalHeight || TERMINAL_SIZES.big.height),
        ],
        {
          detached: true,
          stdio: 'ignore',
        },
      )
      tmuxProcess.unref()

      createdWindows.push(windowName)
      windowOrder.push(windowName)

      let attempts = 0
      while (!socketExists(this.socketOptions) && attempts < 50) {
        execSync('sleep 0.1')
        attempts++
      }

      if (!socketExists(this.socketOptions)) {
        this.emitEvent(`create-tmux-window:${windowName}:fail` as EventName, {
          windowName,
          error: 'Tmux server failed to start',
          errorCode: 'TMUX_SERVER_FAILED',
          duration: Date.now() - windowStart,
        })
        throw new Error('Tmux server failed to start')
      }

      const sessionId = execSync(
        `tmux ${socketArgs.join(' ')} display-message -t ${sessionName} -p '#{session_id}'`,
        { encoding: 'utf-8' },
      ).trim()

      const mode = options.worktree === false ? 'project' : 'worktree'
      execSync(
        `tmux ${socketArgs.join(' ')} set-environment -t ${sessionName} TMUX_COMPOSER_MODE ${mode}`,
      )

      if (windowName === 'control') {
        this.emitEvent('create-tmux-session:end', {
          sessionName,
          sessionId,
          socketPath: this.socketOptions.socketPath || '/tmp/tmux-1000/default',
          firstWindow: windowName,
          terminalSize: {
            width: terminalWidth || TERMINAL_SIZES.big.width,
            height: terminalHeight || TERMINAL_SIZES.big.height,
          },
          duration: Date.now() - sessionStart,
        })
      }

      const paneReady = await this.waitForPaneReady(sessionName, windowName)

      if (!paneReady) {
        this.emitEvent(`create-tmux-window:${windowName}:fail` as EventName, {
          windowName,
          error: 'Pane did not become ready within timeout',
          errorCode: 'PANE_NOT_READY',
          duration: Date.now() - windowStart,
        })
        throw new Error(
          `Pane for window '${windowName}' did not become ready within timeout`,
        )
      }

      const socketArgsStr = getTmuxSocketArgs(this.socketOptions).join(' ')
      execSync(
        `tmux ${socketArgsStr} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
      )

      firstWindowCreated = true
    }

    const createWindow = async (
      windowName: string,
      command: string,
      windowIndex: number,
      port?: number,
      script?: string,
    ) => {
      const windowStart = Date.now()
      this.emitEvent(`create-tmux-window:${windowName}:start` as EventName)

      const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
      execSync(
        `tmux ${socketArgs} new-window -t ${sessionName} -n '${windowName}' -c ${worktreePath}`,
      )

      const paneReady = await this.waitForPaneReady(sessionName, windowName)

      if (!paneReady) {
        this.emitEvent(`create-tmux-window:${windowName}:fail` as EventName, {
          windowName,
          error: 'Pane did not become ready within timeout',
          errorCode: 'PANE_NOT_READY',
          duration: Date.now() - windowStart,
        })
        throw new Error(
          `Pane for window '${windowName}' did not become ready within timeout`,
        )
      }

      execSync(
        `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
      )

      createdWindows.push(windowName)
      windowOrder.push(windowName)

      const windowId = execSync(
        `tmux ${socketArgs} display-message -t ${sessionName}:${windowName} -p '#{window_id}'`,
        { encoding: 'utf-8' },
      ).trim()

      const eventData: CreateTmuxWindowEndData = {
        windowName,
        windowIndex,
        windowId,
        command,
        duration: Date.now() - windowStart,
      }

      if (port) eventData.port = port
      if (script) eventData.script = script

      this.emitEvent(
        `create-tmux-window:${windowName}:end` as EventName,
        eventData,
      )
    }

    if (config.commands?.['run-agent'] && expectedWindows.includes('agent')) {
      const agentCommand = config.commands['run-agent']

      if (!firstWindowCreated) {
        await createSession('agent', agentCommand)
      } else {
        await createWindow('agent', agentCommand, windowIndex)
      }

      windowIndex++
    }

    if (scripts.dev && expectedWindows.includes('server')) {
      const portStart = Date.now()
      this.emitEvent('find-open-port:start')
      const port = this.findAvailablePort()
      this.emitEvent('find-open-port:end', {
        port,
        windowName: 'server',
        duration: Date.now() - portStart,
      })

      const command = `PORT=${port} pnpm run dev`

      if (!firstWindowCreated) {
        await createSession('server', command)
      } else {
        await createWindow('server', command, windowIndex, port, 'dev')
      }

      windowIndex++
    }

    for (const scriptName of Object.keys(scripts)) {
      if (scriptName.endsWith(':watch')) {
        const windowName = scriptName.slice(0, -6)

        if (expectedWindows.includes(windowName)) {
          const command = `pnpm run ${scriptName}`

          if (!firstWindowCreated) {
            await createSession(windowName, command)
          } else {
            await createWindow(
              windowName,
              command,
              windowIndex,
              undefined,
              scriptName,
            )
          }

          windowIndex++
        }
      }
    }

    if (expectedWindows.includes('control')) {
      const controlStart = Date.now()
      this.emitEvent('create-tmux-window:control:start')

      try {
        const zmqSocketArgs = options.zmqSocket
          ? ` --zmq-socket ${options.zmqSocket}`
          : options.zmqSocketPath
            ? ` --zmq-socket-path ${options.zmqSocketPath}`
            : ''

        if (!firstWindowCreated) {
          await createSession('control', 'echo "Starting control window..."')
        } else {
          await createWindow(
            'control',
            'echo "Starting control window..."',
            windowIndex,
          )
        }

        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:control 'tmux-composer observe-session${zmqSocketArgs} | jq .' Enter`,
        )
        execSync(
          `tmux ${socketArgs} split-window -t ${sessionName}:control -h -c ${worktreePath}`,
        )
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:control 'tmux-composer observe-panes${zmqSocketArgs} | jq .' Enter`,
        )
        execSync(
          `tmux ${socketArgs} split-window -t ${sessionName}:control -h -c ${worktreePath}`,
        )
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:control 'claude-code-chat-stream ~/.claude/chats.db | jq .' Enter`,
        )
        execSync(
          `tmux ${socketArgs} select-layout -t ${sessionName}:control even-horizontal`,
        )

        const windowId = execSync(
          `tmux ${socketArgs} display-message -t ${sessionName}:control -p '#{window_id}'`,
          { encoding: 'utf-8' },
        ).trim()

        this.emitEvent('create-tmux-window:control:end', {
          windowName: 'control',
          windowIndex: windowIndex,
          windowId,
          command: `tmux-composer observe-session${zmqSocketArgs} | jq .`,
          commands: [
            `tmux-composer observe-session${zmqSocketArgs} | jq .`,
            `tmux-composer observe-panes${zmqSocketArgs} | jq .`,
            `claude-code-chat-stream ~/.claude/chats.db && jq .`,
          ],
          duration: Date.now() - controlStart,
        })

        windowIndex++
      } catch (error) {
        this.emitEvent('create-tmux-window:control:fail', {
          windowName: 'control',
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - controlStart,
        })
        throw error
      }
    }

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    if (expectedWindows.includes('control') && windowOrder.length > 1) {
      const controlIndex = windowOrder.indexOf('control')
      if (controlIndex !== -1 && controlIndex !== windowOrder.length - 1) {
        const lastWindow = windowOrder[windowOrder.length - 1]
        execSync(
          `tmux ${socketArgs} swap-window -s ${sessionName}:control -t ${sessionName}:${lastWindow}`,
        )

        windowOrder.splice(controlIndex, 1)
        windowOrder.push('control')
      }
    }

    return windowOrder
  }

  protected findAvailablePort(): number {
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
      this.emitEvent('find-open-port:fail', {
        attemptedPorts: 100,
        error: 'Could not find an available port',
        duration: 0,
      })
      throw new Error('Could not find an available port')
    }
    return port
  }

  protected async waitForWindows(
    sessionName: string,
    expectedWindows: string[],
  ) {
    const maxAttempts = 30
    let attempts = 0

    while (attempts < maxAttempts) {
      const actualWindows = await listWindows(sessionName, this.socketOptions)

      const allWindowsCreated = expectedWindows.every(window =>
        actualWindows.includes(window),
      )

      if (allWindowsCreated) {
        await new Promise(resolve => setTimeout(resolve, 50))
        return
      }

      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }

    this.emitEvent('attach-tmux-session:end', {
      sessionName,
      windowsReady: false,
      warning: 'Not all expected windows were created within 3 seconds',
      duration: maxAttempts * 100,
    })
  }

  protected async waitForPaneReady(
    sessionName: string,
    windowName: string,
    maxWaitMs: number = 5000,
  ): Promise<boolean> {
    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
    const startTime = Date.now()
    const checkInterval = 100

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const paneInfo = execSync(
          `tmux ${socketArgs} list-panes -t ${sessionName}:${windowName} -F '#{pane_pid} #{pane_current_command}'`,
          { encoding: 'utf-8' },
        ).trim()

        if (paneInfo) {
          const [pid, currentCommand] = paneInfo.split(' ')

          const shellCommands = [
            'bash',
            'zsh',
            'sh',
            'fish',
            'ksh',
            'tcsh',
            'csh',
          ]
          const isShellReady = shellCommands.some(shell =>
            currentCommand.includes(shell),
          )

          if (pid && isShellReady) {
            await new Promise(resolve => setTimeout(resolve, 50))
            return true
          }
        }
      } catch (error) {}

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    return false
  }
}
