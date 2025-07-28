import { execSync } from 'child_process'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { BaseSessionCommand } from '../core/base-session-command.js'
import type { BaseSessionOptions } from '../core/base-session-command.js'
import {
  listSessions,
  getAttachedSession,
  switchToSession,
} from '../core/tmux-utils.js'
import {
  getMainRepositoryPath,
  isGitRepositoryClean,
} from '../core/git-utils.js'
import { confirmAction } from '../core/prompt-utils.js'
import * as path from 'path'

interface CloseSessionOptions extends BaseSessionOptions {
  force?: boolean
}

export class SessionCloser extends BaseSessionCommand {
  private force: boolean

  constructor(options: CloseSessionOptions = {}) {
    super(options)
    this.force = options.force ?? false
  }

  async close(): Promise<void> {
    const startTime = Date.now()

    this.emitEvent('close-session:start', {
      options: {
        socketName: this.socketOptions.socketName,
        socketPath: this.socketOptions.socketPath,
      },
    })

    const socketPath = getTmuxSocketPath(this.socketOptions)

    const options = this.socketOptions as CloseSessionOptions
    if (options.zmq === false && (options.zmqSocket || options.zmqSocketPath)) {
      console.error(
        'Error: Cannot use --no-zmq with --zmq-socket or --zmq-socket-path',
      )
      process.exit(1)
    }

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'close-session',
        socketPath,
      },
    })

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    const getCurrentStart = Date.now()
    this.emitEvent('get-current-session:start')

    let currentSession: string
    try {
      currentSession = execSync(`tmux ${socketArgs} display-message -p '#S'`, {
        encoding: 'utf-8',
      }).trim()

      this.updateContext({
        session: {
          name: currentSession,
        },
      })

      this.emitEvent('get-current-session:end', {
        sessionName: currentSession,
        duration: Date.now() - getCurrentStart,
      })
    } catch (error) {
      this.emitEvent('get-current-session:fail', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'SESSION_NOT_FOUND',
        duration: Date.now() - getCurrentStart,
      })
      this.emitEvent('close-session:fail', {
        error: 'Failed to get current session',
        errorCode: 'SESSION_NOT_FOUND',
        duration: Date.now() - startTime,
      })
      throw error
    }

    const getProjectStart = Date.now()
    this.emitEvent('get-project-info:start')

    let projectPath: string | undefined
    let projectName: string | undefined

    try {
      projectPath = getMainRepositoryPath(process.cwd())
      projectName = path.basename(projectPath)

      this.updateContext({
        project: {
          name: projectName,
          path: projectPath,
        },
      })

      this.emitEvent('get-project-info:end', {
        projectName,
        projectPath,
        duration: Date.now() - getProjectStart,
      })
    } catch (error) {
      this.emitEvent('get-project-info:fail', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'PROJECT_NOT_FOUND',
        duration: Date.now() - getProjectStart,
      })
    }

    if (projectPath && !this.force) {
      const checkRepoStart = Date.now()
      this.emitEvent('check-repository-status:start')

      try {
        const isClean = isGitRepositoryClean(projectPath)
        this.emitEvent('check-repository-status:end', {
          isClean,
          projectPath,
          duration: Date.now() - checkRepoStart,
        })

        if (!isClean) {
          const confirmStart = Date.now()
          this.emitEvent('confirm-close-dirty:start')

          const confirmed = await confirmAction(
            'Warning: Repository has uncommitted changes. Close session anyway? (y/N) ',
          )

          if (!confirmed) {
            this.emitEvent('confirm-close-dirty:cancel', {
              duration: Date.now() - confirmStart,
            })
            this.emitEvent('close-session:cancel', {
              reason: 'User cancelled due to dirty repository',
              duration: Date.now() - startTime,
            })
            console.log('Session close cancelled.')
            return
          }

          this.emitEvent('confirm-close-dirty:end', {
            confirmed: true,
            duration: Date.now() - confirmStart,
          })
        }
      } catch (error) {
        this.emitEvent('check-repository-status:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'REPO_CHECK_FAILED',
          duration: Date.now() - checkRepoStart,
        })
        console.warn(
          'Warning: Unable to check repository status. Proceeding with close.',
        )
      }
    }

    const getModeStart = Date.now()
    this.emitEvent('get-session-mode:start')

    let mode: 'worktree' | 'project' | undefined
    try {
      const modeOutput = execSync(
        `tmux ${socketArgs} show-environment TMUX_COMPOSER_MODE`,
        {
          encoding: 'utf-8',
        },
      )
        .trim()
        .replace('TMUX_COMPOSER_MODE=', '')

      if (modeOutput === 'worktree' || modeOutput === 'project') {
        mode = modeOutput

        this.updateContext({
          session: {
            name: currentSession,
            mode: mode,
          },
        })

        this.emitEvent('get-session-mode:end', {
          mode: mode,
          sessionName: currentSession,
          duration: Date.now() - getModeStart,
        })
      } else {
        this.emitEvent('get-session-mode:fail', {
          error: 'Invalid TMUX_COMPOSER_MODE value',
          errorCode: 'INVALID_MODE',
          sessionName: currentSession,
          duration: Date.now() - getModeStart,
        })
      }
    } catch (error) {
      this.emitEvent('get-session-mode:fail', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'MODE_NOT_FOUND',
        sessionName: currentSession,
        duration: Date.now() - getModeStart,
      })
    }

    const listSessionsStart = Date.now()
    this.emitEvent('list-all-sessions:start')

    let allSessions: string[]
    let attachedSession: string | null
    try {
      allSessions = listSessions(this.socketOptions)
      attachedSession = getAttachedSession(this.socketOptions)
      this.emitEvent('list-all-sessions:end', {
        sessions: allSessions,
        count: allSessions.length,
        duration: Date.now() - listSessionsStart,
      })
    } catch (error) {
      this.emitEvent('list-all-sessions:fail', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'LIST_FAILED',
        duration: Date.now() - listSessionsStart,
      })
      this.emitEvent('close-session:fail', {
        error: 'Failed to list sessions',
        errorCode: 'LIST_FAILED',
        duration: Date.now() - startTime,
      })
      throw error
    }

    const checkAttachedStart = Date.now()
    this.emitEvent('check-attached-session:start')

    const isAttachedToCurrentSession = attachedSession === currentSession
    const hasOtherSessions = allSessions.length > 1

    this.emitEvent('check-attached-session:end', {
      attachedSession: attachedSession ?? undefined,
      isAttachedToCurrent: isAttachedToCurrentSession,
      currentSession,
      duration: Date.now() - checkAttachedStart,
    })

    if (isAttachedToCurrentSession && hasOtherSessions) {
      const otherSession = allSessions.find(s => s !== currentSession)
      if (otherSession) {
        const switchStart = Date.now()
        this.emitEvent('switch-before-close:start')

        try {
          switchToSession(otherSession, this.socketOptions)
          this.emitEvent('switch-before-close:end', {
            fromSession: currentSession,
            toSession: otherSession,
            duration: Date.now() - switchStart,
          })
        } catch (error) {
          this.emitEvent('switch-before-close:fail', {
            error: error instanceof Error ? error.message : String(error),
            errorCode: 'SWITCH_FAILED',
            fromSession: currentSession,
            toSession: otherSession,
            duration: Date.now() - switchStart,
          })
        }
      }
    }

    const killStart = Date.now()
    this.emitEvent('kill-session:start')

    try {
      execSync(`tmux ${socketArgs} kill-session -t ${currentSession}`)
      this.emitEvent('kill-session:end', {
        sessionName: currentSession,
        duration: Date.now() - killStart,
      })
    } catch (error) {
      this.emitEvent('kill-session:fail', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'KILL_FAILED',
        sessionName: currentSession,
        duration: Date.now() - killStart,
      })
      this.emitEvent('close-session:fail', {
        error: 'Failed to kill session',
        errorCode: 'KILL_FAILED',
        duration: Date.now() - startTime,
      })
      throw error
    }

    this.emitEvent('close-session:end', {
      sessionName: currentSession,
      duration: Date.now() - startTime,
    })
  }
}
