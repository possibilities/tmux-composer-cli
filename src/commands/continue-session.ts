import { execSync, spawnSync } from 'child_process'
import path from 'path'
import { SessionCreator } from './create-session.js'
import { getLatestWorktree } from '../core/git-utils.js'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
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

    const findWorktreeStart = Date.now()
    this.emitEvent('find-latest-worktree:start')

    const latestWorktree = getLatestWorktree(projectPath)
    
    if (!latestWorktree) {
      this.emitEvent('find-latest-worktree:fail', {
        error: 'No worktrees found for this repository',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - findWorktreeStart,
      })
      this.emitEvent('continue-session:fail', {
        error: 'No worktrees found for this repository. Use create-session to create one.',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - startTime,
      })
      throw new Error('No worktrees found for this repository. Use create-session to create one.')
    }

    const worktreePath = latestWorktree.path
    const worktreeBasename = path.basename(worktreePath)
    const worktreeMatch = worktreeBasename.match(/^(.+)-worktree-(\d{3})$/)
    
    if (!worktreeMatch) {
      this.emitEvent('find-latest-worktree:fail', {
        error: 'Latest worktree does not match expected naming pattern',
        errorCode: 'INVALID_WORKTREE_NAME',
        worktreePath,
        duration: Date.now() - findWorktreeStart,
      })
      throw new Error('Latest worktree does not match expected naming pattern')
    }

    const projectName = worktreeMatch[1]
    const worktreeNum = worktreeMatch[2]
    const sessionName = `${projectName}-worktree-${worktreeNum}`

    this.emitEvent('find-latest-worktree:end', {
      worktreePath,
      projectName,
      worktreeNumber: worktreeNum,
      sessionName,
      branch: latestWorktree.branch,
      commit: latestWorktree.commit,
      duration: Date.now() - findWorktreeStart,
    })

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
        this.emitEvent('continue-session:fail', {
          error: `Session '${sessionName}' already exists`,
          errorCode: 'SESSION_EXISTS',
          duration: Date.now() - startTime,
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

    try {
      let expectedWindows: string[]
      try {
        expectedWindows = await this.getExpectedWindows(worktreePath)
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
        branch: latestWorktree.branch,
        duration: Date.now() - startTime,
      })

      if (options.attach) {
        const attachStart = Date.now()
        this.emitEvent('attach-tmux-session:start')

        await this.waitForWindows(sessionName, windows)

        try {
          const firstWindow = windows[0]
          if (firstWindow) {
            execSync(
              `tmux ${socketArgs} select-window -t ${sessionName}:${firstWindow}`,
            )
          }
        } catch (error) {
          this.emitEvent('select-window:fail', {
            sessionName,
            window: windows[0] || 'none',
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
      throw error
    }
  }
}