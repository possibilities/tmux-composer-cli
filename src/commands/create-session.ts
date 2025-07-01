import { execSync, spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { EventEmitter } from 'events'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  isGitRepositoryClean,
  getNextWorktreeNumber,
  createWorktree,
  installDependencies,
  CODE_PATH,
  WORKTREES_PATH,
} from '../core/git-utils.js'
import { socketExists, listWindows } from '../core/tmux-utils.js'
import { TERMINAL_SIZES } from '../core/constants.js'
import {
  parseTmuxComposerConfig,
  type TmuxComposerConfig,
} from '../schemas/config-schema.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'

interface CreateSessionOptions extends TmuxSocketOptions {
  mode?: 'act' | 'plan'
  terminalWidth?: number
  terminalHeight?: number
  attach?: boolean
  zeromq?: boolean
}

interface TmuxEvent {
  event: string
  data?: any
  timestamp: string
}

export class SessionCreator extends EventEmitter {
  private socketOptions: TmuxSocketOptions
  private lastEvent: TmuxEvent | null = null

  constructor(options: CreateSessionOptions = {}) {
    super()
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }

    this.on('event', (event: TmuxEvent) => {
      console.log(JSON.stringify(event))
      this.lastEvent = event
    })
  }

  private emitEvent(eventName: string, data?: any): void {
    const event: TmuxEvent = {
      event: eventName,
      timestamp: new Date().toISOString(),
    }
    if (data !== undefined) {
      event.data = data
    }
    this.emit('event', event)
  }

  async create(projectPath: string, options: CreateSessionOptions = {}) {
    const startTime = Date.now()

    const socketPath = getTmuxSocketPath(this.socketOptions)

    // We don't have session info yet, so we'll update it later
    await enableZmqPublishing(this, {
      zeromq: options.zeromq,
      source: {
        script: 'create-session',
        socketPath,
      },
    })

    // Emit initial event with all options
    this.emitEvent('initialize-session-creation:start', {
      projectPath,
      options: {
        mode: options.mode || 'act',
        socketName: options.socketName,
        socketPath: options.socketPath,
        terminalWidth: options.terminalWidth,
        terminalHeight: options.terminalHeight,
        attach: options.attach,
      },
    })

    this.emitEvent('initialize-session-creation:end', {
      duration: Date.now() - startTime,
    })

    const metadataStartTime = Date.now()
    this.emitEvent('analyze-project-metadata:start')
    const projectName = path.basename(projectPath)
    const worktreeNum = getNextWorktreeNumber(projectName)
    const sessionName = `${projectName}-worktree-${worktreeNum}`
    this.emitEvent('analyze-project-metadata:end', {
      projectPath,
      projectName,
      worktreeNumber: worktreeNum,
      sessionName,
      duration: Date.now() - metadataStartTime,
    })

    const mode = options.mode || 'act'
    if (mode !== 'act' && mode !== 'plan') {
      this.emitEvent('create-worktree-session:fail', {
        error: 'Invalid mode. Must be either "act" or "plan".',
        errorCode: 'INVALID_MODE',
        duration: Date.now() - startTime,
      })
      throw new Error('Invalid mode. Must be either "act" or "plan".')
    }

    // Start the main session creation process
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

      // Get additional repo info for the event
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

      await fs.promises.mkdir(WORKTREES_PATH, { recursive: true })

      const worktreeStart = Date.now()
      this.emitEvent('create-project-worktree:start')
      let worktreePath: string
      try {
        worktreePath = createWorktree(projectPath, projectName, worktreeNum)
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
          hasLockfile: fs.existsSync(path.join(worktreePath, 'pnpm-lock.yaml')),
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

      const structureStart = Date.now()
      this.emitEvent('analyze-project-structure:start')
      const hasPackageJson = fs.existsSync(
        path.join(worktreePath, 'package.json'),
      )
      const hasTmuxComposerConfig = fs.existsSync(
        path.join(worktreePath, 'tmux-composer.yaml'),
      )
      this.emitEvent('analyze-project-structure:end', {
        hasPackageJson,
        hasTmuxComposerConfig,
        configPath: hasTmuxComposerConfig
          ? path.join(worktreePath, 'tmux-composer.yaml')
          : null,
        packageJsonPath: hasPackageJson
          ? path.join(worktreePath, 'package.json')
          : null,
        duration: Date.now() - structureStart,
      })

      let expectedWindows: string[]
      try {
        expectedWindows = await this.getExpectedWindows(worktreePath)
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
          mode,
          options.terminalWidth,
          options.terminalHeight,
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
        selectedWindow: 'work',
        totalWindows: windows.length,
        worktreePath,
        duration: Date.now() - finalizeStart,
        totalDuration: Date.now() - startTime,
      })

      // Emit the overall success event
      this.emitEvent('create-worktree-session:end', {
        sessionName,
        worktreePath,
        windows,
        duration: Date.now() - sessionStartTime,
        totalDuration: Date.now() - startTime,
      })

      // Wait for all windows to be created before attaching
      if (options.attach) {
        const attachStart = Date.now()
        this.emitEvent('attach-tmux-session:start')

        await this.waitForWindows(sessionName, windows)

        // Ensure the work window is selected before attaching
        try {
          execSync(`tmux ${socketArgs} select-window -t ${sessionName}:work`)
        } catch (error) {
          // Window might not exist or tmux might have issues, but we'll continue
          this.emitEvent('select-window:fail', {
            sessionName,
            window: 'work',
            error: error instanceof Error ? error.message : String(error),
          })
        }

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
      if (!error?.message?.includes('Repository has uncommitted changes')) {
        this.emitEvent('create-worktree-session:fail', {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - sessionStartTime,
        })
      }
      throw error
    }
  }

  private async getExpectedWindows(worktreePath: string): Promise<string[]> {
    const scriptsStart = Date.now()
    this.emitEvent('analyze-project-scripts:start')
    const windows: string[] = []
    const availableScripts: string[] = []
    let agentCommand: any = { act: 'claude', plan: 'claude' }
    let contextCommand: any = {}

    try {
      const packageJsonPath = path.join(worktreePath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return windows
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      // Collect available scripts
      if (scripts) {
        availableScripts.push(...Object.keys(scripts))
      }

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

      let tmuxComposerConfig: TmuxComposerConfig | null = null
      try {
        const tmuxComposerYamlPath = path.join(
          worktreePath,
          'tmux-composer.yaml',
        )
        const tmuxComposerYamlContent = fs.readFileSync(
          tmuxComposerYamlPath,
          'utf-8',
        )
        const yamlData = yaml.load(tmuxComposerYamlContent)
        tmuxComposerConfig = parseTmuxComposerConfig(yamlData)

        // Extract agent and context commands
        if (tmuxComposerConfig?.agents) {
          if (typeof tmuxComposerConfig.agents === 'string') {
            agentCommand = {
              act: tmuxComposerConfig.agents,
              plan: tmuxComposerConfig.agents,
            }
          } else {
            agentCommand = tmuxComposerConfig.agents
          }
        }

        if (tmuxComposerConfig?.context) {
          if (typeof tmuxComposerConfig.context === 'string') {
            contextCommand = {
              act: tmuxComposerConfig.context,
              plan: tmuxComposerConfig.context,
            }
          } else {
            contextCommand = tmuxComposerConfig.context
          }
        }
      } catch {}

      windows.push('work')
      windows.push('control') // Control window is always created

      this.emitEvent('analyze-project-scripts:end', {
        availableScripts,
        plannedWindows: windows,
        agentCommand,
        contextCommand,
        duration: Date.now() - scriptsStart,
      })

      return windows
    } catch {
      this.emitEvent('analyze-project-scripts:end', {
        availableScripts,
        plannedWindows: windows,
        agentCommand,
        contextCommand,
        error: 'Failed to analyze project scripts',
        duration: Date.now() - scriptsStart,
      })
      return windows
    }
  }

  private async createTmuxSession(
    sessionName: string,
    worktreePath: string,
    expectedWindows: string[],
    mode: 'act' | 'plan',
    terminalWidth?: number,
    terminalHeight?: number,
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

    let tmuxComposerConfig: TmuxComposerConfig | null = null
    try {
      const tmuxComposerYamlPath = path.join(worktreePath, 'tmux-composer.yaml')
      const tmuxComposerYamlContent = fs.readFileSync(
        tmuxComposerYamlPath,
        'utf-8',
      )
      const yamlData = yaml.load(tmuxComposerYamlContent)
      tmuxComposerConfig = parseTmuxComposerConfig(yamlData)
    } catch {}

    let firstWindowCreated = false
    let windowIndex = 0
    const createdWindows: string[] = []

    const createSession = async (windowName: string, command: string) => {
      const windowStart = Date.now()
      this.emitEvent(`create-tmux-window:${windowName}:start`)

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

      let attempts = 0
      while (!socketExists(this.socketOptions) && attempts < 50) {
        execSync('sleep 0.1')
        attempts++
      }

      if (!socketExists(this.socketOptions)) {
        this.emitEvent(`create-tmux-window:${windowName}:fail`, {
          windowName,
          error: 'Tmux server failed to start',
          errorCode: 'TMUX_SERVER_FAILED',
          duration: Date.now() - windowStart,
        })
        throw new Error('Tmux server failed to start')
      }

      // Get session ID after creation
      const sessionId = execSync(
        `tmux ${socketArgs.join(' ')} display-message -t ${sessionName} -p '#{session_id}'`,
        { encoding: 'utf-8' },
      ).trim()

      if (windowName === 'work') {
        // Emit the session created event after first window
        this.emitEvent('create-tmux-session:end', {
          sessionName,
          sessionId,
          socketPath: this.socketOptions.socketPath || '/tmp/tmux-1000/default',
          firstWindow: windowName,
          terminalSize: {
            width: terminalWidth || TERMINAL_SIZES.big.width,
            height: terminalHeight || TERMINAL_SIZES.big.height,
          },
          mode,
          duration: Date.now() - sessionStart,
        })
      }

      // Wait for the pane to be ready before sending commands
      const paneReady = await this.waitForPaneReady(sessionName, windowName)

      if (!paneReady) {
        this.emitEvent(`create-tmux-window:${windowName}:fail`, {
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
        `tmux ${socketArgsStr} setenv -t ${sessionName} TMUX_COMPOSER_MODE ${mode}`,
      )

      execSync(
        `tmux ${socketArgsStr} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
      )

      firstWindowCreated = true

      // Don't emit the end event yet for work window - it will be emitted after context loading
    }

    const createWindow = async (
      windowName: string,
      command: string,
      windowIndex: number,
      port?: number,
      script?: string,
    ) => {
      const windowStart = Date.now()
      this.emitEvent(`create-tmux-window:${windowName}:start`)

      const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
      execSync(
        `tmux ${socketArgs} new-window -t ${sessionName} -n '${windowName}' -c ${worktreePath}`,
      )

      // Wait for the pane to be ready before sending commands
      const paneReady = await this.waitForPaneReady(sessionName, windowName)

      if (!paneReady) {
        this.emitEvent(`create-tmux-window:${windowName}:fail`, {
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

      // Get window ID
      const windowId = execSync(
        `tmux ${socketArgs} display-message -t ${sessionName}:${windowName} -p '#{window_id}'`,
        { encoding: 'utf-8' },
      ).trim()

      // Emit success event
      const eventData: any = {
        windowName,
        windowIndex,
        windowId,
        command,
        duration: Date.now() - windowStart,
      }

      if (port) eventData.port = port
      if (script) eventData.script = script

      this.emitEvent(`create-tmux-window:${windowName}:end`, eventData)
    }

    if (expectedWindows.includes('work')) {
      const workWindowStart = Date.now()
      let command = 'claude'

      if (tmuxComposerConfig?.agents) {
        if (typeof tmuxComposerConfig.agents === 'string') {
          command = tmuxComposerConfig.agents
        } else if (tmuxComposerConfig.agents[mode]) {
          command = tmuxComposerConfig.agents[mode]
        }
      }

      if (!firstWindowCreated) {
        await createSession('work', command)
      } else {
        await createWindow('work', command, windowIndex)
      }

      windowIndex++

      let contextCommand: string | undefined
      let contextLoaded = false
      let contextSize = 0

      if (tmuxComposerConfig?.context) {
        if (typeof tmuxComposerConfig.context === 'string') {
          contextCommand = tmuxComposerConfig.context
        } else if (tmuxComposerConfig.context[mode]) {
          contextCommand = tmuxComposerConfig.context[mode]
        }
      }

      if (contextCommand) {
        const contextStart = Date.now()
        this.emitEvent('invoking-context-command:start')

        let contextOutput: string
        try {
          contextOutput = execSync(contextCommand, {
            encoding: 'utf-8',
            cwd: worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
          contextSize = contextOutput.length
        } catch (error) {
          this.emitEvent('invoking-context-command:fail', {
            error: error instanceof Error ? error.message : String(error),
            command: contextCommand,
            duration: Date.now() - contextStart,
          })
          throw new Error(
            `Failed to execute context command: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        const tempFile = `/tmp/tmux-composer-context-${Date.now()}.txt`
        fs.writeFileSync(tempFile, contextOutput)
        try {
          execSync(`tmux ${socketArgs} load-buffer ${tempFile}`)
          contextLoaded = true

          // Emit success event after buffer is loaded
          this.emitEvent('invoking-context-command:end', {
            command: contextCommand,
            mode,
            workingDirectory: worktreePath,
            outputSize: contextSize,
            contextLength: contextOutput.split('\n').length,
            bufferSize: contextSize,
            truncated: false,
            duration: Date.now() - contextStart,
          })
        } catch (error) {
          this.emitEvent('invoking-context-command:fail', {
            error: error instanceof Error ? error.message : String(error),
            command: contextCommand,
            phase: 'buffer-load',
            duration: Date.now() - contextStart,
          })
          throw error
        } finally {
          try {
            fs.unlinkSync(tempFile)
          } catch {}
        }
      }

      // Now emit the work window end event with context info
      if (!firstWindowCreated) {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        const windowId = execSync(
          `tmux ${socketArgs} display-message -t ${sessionName}:work -p '#{window_id}'`,
          { encoding: 'utf-8' },
        ).trim()

        this.emitEvent('create-tmux-window:work:end', {
          windowName: 'work',
          windowIndex: 0,
          windowId,
          command,
          isFirstWindow: true,
          contextLoaded,
          contextSize,
          duration: Date.now() - workWindowStart,
        })
      }
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

    if (scripts['lint:watch'] && expectedWindows.includes('lint')) {
      const command = 'pnpm run lint:watch'

      if (!firstWindowCreated) {
        await createSession('lint', command)
      } else {
        await createWindow(
          'lint',
          command,
          windowIndex,
          undefined,
          'lint:watch',
        )
      }

      windowIndex++
    }

    if (scripts['types:watch'] && expectedWindows.includes('types')) {
      const command = 'pnpm run types:watch'

      if (!firstWindowCreated) {
        await createSession('types', command)
      } else {
        await createWindow(
          'types',
          command,
          windowIndex,
          undefined,
          'types:watch',
        )
      }

      windowIndex++
    }

    if (scripts['test:watch'] && expectedWindows.includes('test')) {
      const command = 'pnpm run test:watch'

      if (!firstWindowCreated) {
        await createSession('test', command)
      } else {
        await createWindow(
          'test',
          command,
          windowIndex,
          undefined,
          'test:watch',
        )
      }

      windowIndex++
    }

    // Create control window
    if (expectedWindows.includes('control')) {
      const controlStart = Date.now()
      this.emitEvent('create-tmux-window:control:start')

      try {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        execSync(
          `tmux ${socketArgs} new-window -t ${sessionName} -n 'control' -c ${worktreePath}`,
        )

        // Wait for control window to be created
        let controlWindowCreated = false
        let attempts = 0
        const maxAttempts = 30

        while (!controlWindowCreated && attempts < maxAttempts) {
          try {
            const windows = execSync(
              `tmux ${socketArgs} list-windows -t ${sessionName} -F '#{window_name}'`,
              { encoding: 'utf-8' },
            )
              .trim()
              .split('\n')

            if (windows.includes('control')) {
              controlWindowCreated = true
              break
            }
          } catch {
            // Window might not exist yet
          }

          execSync('sleep 0.1')
          attempts++
        }

        if (!controlWindowCreated) {
          throw new Error('Control window failed to create within timeout')
        }

        // Now send commands to the control window
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:control 'tmux-composer watch-session | jq .' Enter`,
        )
        execSync(
          `tmux ${socketArgs} split-window -t ${sessionName}:control -h -c ${worktreePath}`,
        )
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:control 'tmux-composer watch-panes | jq .' Enter`,
        )

        // Get window ID
        const windowId = execSync(
          `tmux ${socketArgs} display-message -t ${sessionName}:control -p '#{window_id}'`,
          { encoding: 'utf-8' },
        ).trim()

        this.emitEvent('create-tmux-window:control:end', {
          windowName: 'control',
          windowIndex,
          windowId,
          commands: [
            'tmux-composer watch-session | jq .',
            'tmux-composer watch-panes | jq .',
          ],
          duration: Date.now() - controlStart,
        })

        createdWindows.push('control')
      } catch (error) {
        this.emitEvent('create-tmux-window:control:fail', {
          windowName: 'control',
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - controlStart,
        })
        throw error
      }
    }

    return createdWindows
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
      this.emitEvent('find-open-port:fail', {
        attemptedPorts: 100,
        error: 'Could not find an available port',
        duration: 0,
      })
      throw new Error('Could not find an available port')
    }
    return port
  }

  private async waitForWindows(sessionName: string, expectedWindows: string[]) {
    const maxAttempts = 30
    let attempts = 0

    while (attempts < maxAttempts) {
      const actualWindows = await listWindows(sessionName, this.socketOptions)

      // Check if all expected windows exist
      const allWindowsCreated = expectedWindows.every(window =>
        actualWindows.includes(window),
      )

      if (allWindowsCreated) {
        // Give a tiny bit more time for windows to fully initialize
        await new Promise(resolve => setTimeout(resolve, 50))
        return
      }

      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }

    // If we get here, not all windows were created in time
    this.emitEvent('attach-tmux-session:end', {
      sessionName,
      windowsReady: false,
      warning: 'Not all expected windows were created within 3 seconds',
      duration: maxAttempts * 100,
    })
  }

  private async waitForPaneReady(
    sessionName: string,
    windowName: string,
    maxWaitMs: number = 5000,
  ): Promise<boolean> {
    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
    const startTime = Date.now()
    const checkInterval = 100 // Check every 100ms

    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Check if the pane exists and get its current command
        const paneInfo = execSync(
          `tmux ${socketArgs} list-panes -t ${sessionName}:${windowName} -F '#{pane_pid} #{pane_current_command}'`,
          { encoding: 'utf-8' },
        ).trim()

        if (paneInfo) {
          const [pid, currentCommand] = paneInfo.split(' ')

          // Check if the pane has a shell ready (bash, zsh, sh, etc.)
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
            // Additional small delay to ensure shell is fully initialized
            await new Promise(resolve => setTimeout(resolve, 50))
            return true
          }
        }
      } catch (error) {
        // Pane might not exist yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    return false
  }
}
