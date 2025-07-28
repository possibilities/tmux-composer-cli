import { execSync } from 'child_process'
import { loadConfig } from '../core/config.js'
import {
  syncWorktreeToMain,
  checkAndInstallDependencies,
} from '../core/git-sync.js'
import { getMainRepositoryPath } from '../core/git-utils.js'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { BaseSessionCommand } from '../core/base-session-command.js'
import type { BaseSessionOptions } from '../core/base-session-command.js'
import * as path from 'path'

export class SessionSyncer extends BaseSessionCommand {
  constructor(options: BaseSessionOptions = {}) {
    super(options)
  }

  async sync(): Promise<void> {
    const startTime = Date.now()

    this.emitEvent('sync-session:start', {
      options: {
        socketName: this.socketOptions.socketName,
        socketPath: this.socketOptions.socketPath,
      },
    })

    const socketPath = getTmuxSocketPath(this.socketOptions)

    const options = this.socketOptions as BaseSessionOptions
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
        script: 'sync-session',
        socketPath,
      },
    })

    const loadConfigStart = Date.now()
    this.emitEvent('load-configuration:start')

    let config
    let projectPath: string
    try {
      projectPath = getMainRepositoryPath(process.cwd())
      const projectName = path.basename(projectPath)

      this.updateContext({
        project: {
          name: projectName,
          path: projectPath,
        },
      })

      config = loadConfig(projectPath)
      this.emitEvent('load-configuration:end', {
        hasBeforeFinishCommand: !!config.commands?.['before-finish'],
        duration: Date.now() - loadConfigStart,
      })
    } catch (error) {
      this.emitEvent('load-configuration:fail', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - loadConfigStart,
      })
      this.emitEvent('sync-session:fail', {
        error: 'Failed to load configuration',
        errorCode: 'CONFIG_LOAD_FAILED',
        duration: Date.now() - startTime,
      })
      throw error
    }

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    const validateSessionStart = Date.now()
    this.emitEvent('validate-composer-session:start')

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

      this.emitEvent('validate-composer-session:end', {
        isValid: true,
        sessionName: currentSession,
        duration: Date.now() - validateSessionStart,
      })
    } catch (error) {
      this.emitEvent('validate-composer-session:fail', {
        error: 'Failed to get current session',
        errorCode: 'SESSION_NOT_FOUND',
        duration: Date.now() - validateSessionStart,
      })
      this.emitEvent('sync-session:fail', {
        error: 'Failed to get current session',
        errorCode: 'SESSION_NOT_FOUND',
        duration: Date.now() - startTime,
      })
      throw error
    }

    const getModeStart = Date.now()
    this.emitEvent('get-session-mode:start')

    let mode: string
    try {
      mode = execSync(
        `tmux ${socketArgs} show-environment TMUX_COMPOSER_MODE`,
        { encoding: 'utf-8' },
      )
        .trim()
        .replace('TMUX_COMPOSER_MODE=', '')

      this.updateContext({
        session: {
          name: currentSession,
          mode: mode as 'worktree' | 'project' | 'session',
        },
      })

      this.emitEvent('get-session-mode:end', {
        mode: mode as 'worktree' | 'project' | 'session',
        sessionName: currentSession,
        duration: Date.now() - getModeStart,
      })
    } catch (error) {
      this.emitEvent('get-session-mode:fail', {
        error:
          'This command can only be used in sessions created by tmux-composer',
        errorCode: 'NOT_COMPOSER_SESSION',
        sessionName: currentSession,
        duration: Date.now() - getModeStart,
      })
      this.emitEvent('sync-session:fail', {
        error:
          'This command can only be used in sessions created by tmux-composer',
        errorCode: 'NOT_COMPOSER_SESSION',
        duration: Date.now() - startTime,
      })
      console.error(
        'Error: This command can only be used in sessions created by tmux-composer',
      )
      process.exit(1)
    }

    if (!['worktree', 'project'].includes(mode)) {
      this.emitEvent('sync-session:fail', {
        error: 'Invalid TMUX_COMPOSER_MODE value',
        errorCode: 'INVALID_MODE',
        duration: Date.now() - startTime,
      })
      console.error('Error: Invalid TMUX_COMPOSER_MODE value')
      process.exit(1)
    }

    if (config.commands?.['before-finish']) {
      const beforeFinishStart = Date.now()
      const command = config.commands['before-finish']
      this.emitEvent('run-before-finish-command:start')

      try {
        execSync(command, {
          stdio: 'inherit',
          encoding: 'utf-8',
          cwd: process.cwd(),
        })
        this.emitEvent('run-before-finish-command:end', {
          command,
          exitCode: 0,
          duration: Date.now() - beforeFinishStart,
        })
      } catch (error) {
        const exitCode =
          (error as NodeJS.ErrnoException & { status?: number }).status || 1
        this.emitEvent('run-before-finish-command:fail', {
          error: 'Before-finish command failed',
          errorCode: 'BEFORE_FINISH_FAILED',
          command,
          exitCode,
          duration: Date.now() - beforeFinishStart,
        })
        this.emitEvent('sync-session:fail', {
          error: 'Before-finish command failed',
          errorCode: 'BEFORE_FINISH_FAILED',
          duration: Date.now() - startTime,
        })
        console.error('Error: Before-finish command failed')
        console.error((error as Error).message || error)
        process.exit(1)
      }
    }

    if (mode === 'worktree') {
      const currentPath = process.cwd()

      this.updateContext({
        worktree: {
          path: currentPath,
        },
      })

      const syncStart = Date.now()
      this.emitEvent('sync-worktree-to-main:start')

      try {
        syncWorktreeToMain(currentPath)
        this.emitEvent('sync-worktree-to-main:end', {
          worktreePath: currentPath,
          mainBranch: 'main',
          commitsMerged: 0,
          duration: Date.now() - syncStart,
        })
      } catch (error) {
        this.emitEvent('sync-worktree-to-main:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'SYNC_FAILED',
          worktreePath: currentPath,
          duration: Date.now() - syncStart,
        })
        this.emitEvent('sync-session:fail', {
          error: 'Failed to sync worktree to main branch',
          errorCode: 'SYNC_FAILED',
          duration: Date.now() - startTime,
        })
        console.error('Error: Failed to sync worktree to main branch')
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }

      const depsStart = Date.now()
      this.emitEvent('check-install-dependencies:start')

      try {
        checkAndInstallDependencies(currentPath)
        this.emitEvent('check-install-dependencies:end', {
          worktreePath: currentPath,
          dependenciesInstalled: true,
          duration: Date.now() - depsStart,
        })
      } catch (error) {
        this.emitEvent('check-install-dependencies:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'DEPS_INSTALL_FAILED',
          worktreePath: currentPath,
          duration: Date.now() - depsStart,
        })
        this.emitEvent('sync-session:fail', {
          error: 'Failed to check/install dependencies',
          errorCode: 'DEPS_INSTALL_FAILED',
          duration: Date.now() - startTime,
        })
        console.error('Error: Failed to check/install dependencies')
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    }

    this.emitEvent('sync-session:end', {
      sessionName: currentSession,
      mode: mode as 'worktree' | 'project' | 'session',
      duration: Date.now() - startTime,
    })
  }
}
