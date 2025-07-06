import { execSync, spawnSync } from 'child_process'
import path from 'path'
import { SessionCreator } from './start-session.js'
import { getAllProjectWorktrees, isInProjectsDir } from '../core/git-utils.js'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { loadConfig } from '../core/config.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

interface ContinueSessionOptions extends TmuxSocketOptions {
  terminalWidth?: number
  terminalHeight?: number
  attach?: boolean
  zmq?: boolean
  zmqSocket?: string
  zmqSocketPath?: string
}

export class SessionContinuer extends SessionCreator {
  constructor(options: ContinueSessionOptions = {}) {
    super(options)
  }

  async continue(projectPath: string, options: ContinueSessionOptions = {}) {
    if (options.zmq === false && (options.zmqSocket || options.zmqSocketPath)) {
      console.error(
        'Error: Cannot use --no-zmq with --zmq-socket or --zmq-socket-path',
      )
      process.exit(1)
    }

    const startTime = Date.now()

    this.emitEvent('initialize-continue-session:start')

    this.emitEvent('continue-session:start', {
      projectPath,
      options: {
        socketName: options.socketName,
        socketPath: options.socketPath,
        terminalWidth: options.terminalWidth,
        terminalHeight: options.terminalHeight,
        attach: options.attach,
      },
    })

    this.emitEvent('initialize-continue-session:end', {
      duration: Date.now() - startTime,
    })

    const socketPath = getTmuxSocketPath(this.socketOptions)

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'continue-session',
        socketPath,
      },
    })

    const config = loadConfig(projectPath)
    const inProjectsDir = isInProjectsDir(projectPath)

    if (config.worktree === false && !inProjectsDir) {
      this.emitEvent('continue-session:fail', {
        error:
          'Continue session is not available when worktree is disabled. Use create-session instead.',
        errorCode: 'NO_WORKTREE_MODE',
        duration: Date.now() - startTime,
      })
      throw new Error(
        'Continue session is not available when worktree is disabled. Use create-session instead.',
      )
    }

    const findWorktreeStart = Date.now()
    this.emitEvent('find-highest-worktree:start')

    if (inProjectsDir) {
      const projectName = path.basename(projectPath)
      const sessionName = projectName

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

        const sessionExists = sessions.includes(sessionName)
        if (sessionExists) {
          this.emitEvent('find-highest-worktree:fail', {
            error: `Session '${sessionName}' already exists`,
            errorCode: 'SESSION_EXISTS',
            duration: Date.now() - findWorktreeStart,
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

      let expectedWindows: string[]
      try {
        expectedWindows = await this.getExpectedWindows(projectPath, config)
      } catch (error) {
        this.emitEvent('analyze-project-scripts:fail', {
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
        })
        this.emitEvent('continue-session:fail', {
          error: `Failed to analyze project: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
        })
        throw error
      }

      let windows: string[]
      try {
        windows = await this.createTmuxSession(
          sessionName,
          projectPath,
          expectedWindows,
          options.terminalWidth,
          options.terminalHeight,
          { ...options, worktree: false },
          config,
          inProjectsDir,
        )
      } catch (error) {
        this.emitEvent('continue-session:fail', {
          error: `Failed to create tmux session: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
        })
        throw error
      }

      const socketArgsArr = getTmuxSocketArgs(this.socketOptions)
      const socketArgs = socketArgsArr.join(' ')

      try {
        execSync(
          `tmux ${socketArgs} set-environment -t ${sessionName} TMUX_COMPOSER_MODE project`,
        )
      } catch (error) {
        this.emitEvent('set-tmux-composer-mode:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'SET_MODE_FAILED',
          sessionName,
        })
      }

      this.emitEvent('continue-session:end', {
        sessionName,
        worktreePath: projectPath,
        windows,
        worktreeNumber: 'none',
        branch: 'none',
        duration: Date.now() - startTime,
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

      return
    }

    const allWorktrees = getAllProjectWorktrees(projectPath)

    if (allWorktrees.length === 0) {
      this.emitEvent('find-highest-worktree:fail', {
        error: 'No worktrees found for this repository',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - findWorktreeStart,
      })
      this.emitEvent('continue-session:fail', {
        error:
          'No worktrees found for this repository. Use create-session to create one.',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - startTime,
      })
      throw new Error(
        'No worktrees found for this repository. Use create-session to create one.',
      )
    }

    const highestWorktree = allWorktrees[0]

    const worktreePath = highestWorktree.path
    const worktreeBasename = path.basename(worktreePath)
    const worktreeMatch = worktreeBasename.match(/^(.+)-worktree-(\d{5})$/)

    if (!worktreeMatch) {
      this.emitEvent('find-highest-worktree:fail', {
        error: 'Highest worktree does not match expected naming pattern',
        errorCode: 'INVALID_WORKTREE_NAME',
        worktreePath,
        duration: Date.now() - findWorktreeStart,
      })
      throw new Error('Highest worktree does not match expected naming pattern')
    }

    const projectName = worktreeMatch[1]
    const worktreeNum = worktreeMatch[2]
    const sessionName = `${projectName}-worktree-${worktreeNum}`

    this.emitEvent('find-highest-worktree:end', {
      worktreePath,
      projectName,
      worktreeNumber: worktreeNum,
      sessionName,
      branch: highestWorktree.branch,
      commit: highestWorktree.commit,
      duration: Date.now() - findWorktreeStart,
    })

    const validateSessionStart = Date.now()
    this.emitEvent('validate-existing-session:start')

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

      const sessionExists = sessions.includes(sessionName)
      this.emitEvent('validate-existing-session:end', {
        sessionName,
        exists: sessionExists,
        duration: Date.now() - validateSessionStart,
      })

      if (sessionExists) {
        this.emitEvent('validate-existing-session:fail', {
          error: `Session '${sessionName}' already exists`,
          errorCode: 'SESSION_EXISTS',
          sessionName,
          duration: Date.now() - validateSessionStart,
        })
        this.emitEvent('continue-session:fail', {
          error: `Session '${sessionName}' already exists`,
          errorCode: 'SESSION_EXISTS',
          duration: Date.now() - startTime,
        })
        throw new Error(`Session '${sessionName}' already exists`)
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes('already exists')) {
        this.emitEvent('validate-existing-session:fail', {
          error: 'Failed to list sessions',
          errorCode: 'LIST_SESSIONS_FAILED',
          sessionName,
          duration: Date.now() - validateSessionStart,
        })
      } else {
        throw error
      }
    }

    try {
      let expectedWindows: string[]
      try {
        expectedWindows = await this.getExpectedWindows(worktreePath, config)
      } catch (error) {
        this.emitEvent('analyze-project-scripts:fail', {
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
        })
        this.emitEvent('continue-session:fail', {
          error: `Failed to analyze project: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
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
          { ...options, worktree: false },
          config,
        )
      } catch (error) {
        this.emitEvent('continue-session:fail', {
          error: `Failed to create tmux session: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
        })
        throw error
      }

      const socketArgsArr = getTmuxSocketArgs(this.socketOptions)
      const socketArgs = socketArgsArr.join(' ')

      this.emitEvent('continue-session:end', {
        sessionName,
        worktreePath,
        windows,
        worktreeNumber: worktreeNum,
        branch: highestWorktree.branch,
        duration: Date.now() - startTime,
      })

      const setModeStart = Date.now()
      this.emitEvent('set-tmux-composer-mode:start')

      try {
        execSync(
          `tmux ${socketArgs} set-environment -t ${sessionName} TMUX_COMPOSER_MODE worktree`,
        )
        this.emitEvent('set-tmux-composer-mode:end', {
          mode: 'worktree',
          sessionName,
          duration: Date.now() - setModeStart,
        })
      } catch (error) {
        this.emitEvent('set-tmux-composer-mode:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'SET_MODE_FAILED',
          sessionName,
          duration: Date.now() - setModeStart,
        })
      }

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
      throw error
    }
  }
}
