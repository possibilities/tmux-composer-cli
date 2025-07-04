import { execSync, spawnSync } from 'child_process'
import { SessionContinuer } from './continue-session.js'
import { getAllProjectWorktrees } from '../core/git-utils.js'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { loadConfig } from '../core/config.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

interface ResumeSessionOptions extends TmuxSocketOptions {
  terminalWidth?: number
  terminalHeight?: number
  attach?: boolean
  zmq?: boolean
  zmqSocket?: string
  zmqSocketPath?: string
  worktree?: string
}

export class SessionResumer extends SessionContinuer {
  constructor(options: ResumeSessionOptions = {}) {
    super(options)
  }

  async resume(projectPath: string, options: ResumeSessionOptions = {}) {
    if (options.zmq === false && (options.zmqSocket || options.zmqSocketPath)) {
      console.error(
        'Error: Cannot use --no-zmq with --zmq-socket or --zmq-socket-path',
      )
      process.exit(1)
    }

    if (options.attach === false && !options.worktree && !process.env.TMUX) {
      console.error(
        'Error: Cannot use --no-attach without --worktree when not in a tmux session (menu cannot be displayed)',
      )
      process.exit(1)
    }

    const startTime = Date.now()

    this.emitEvent('resume-session:start', {
      projectPath,
      options: {
        socketName: options.socketName,
        socketPath: options.socketPath,
        terminalWidth: options.terminalWidth,
        terminalHeight: options.terminalHeight,
        attach: options.attach,
        worktree: options.worktree,
      },
    })

    const socketPath = getTmuxSocketPath(this.socketOptions)

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'resume-session',
        socketPath,
      },
    })

    const config = loadConfig(projectPath)

    if (config['no-worktree']) {
      this.emitEvent('resume-session:fail', {
        error:
          'Resume session is not available when no-worktree is configured. Use create-session instead.',
        errorCode: 'NO_WORKTREE_MODE',
        duration: Date.now() - startTime,
      })
      throw new Error(
        'Resume session is not available when no-worktree is configured. Use create-session instead.',
      )
    }

    const findWorktreesStart = Date.now()
    this.emitEvent('find-all-worktrees:start')

    const worktrees = getAllProjectWorktrees(projectPath)

    if (worktrees.length === 0) {
      this.emitEvent('find-all-worktrees:fail', {
        error: 'No worktrees found for this repository',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - findWorktreesStart,
      })
      this.emitEvent('resume-session:fail', {
        error:
          'No worktrees found for this repository. Use create-session to create one.',
        errorCode: 'NO_WORKTREES',
        duration: Date.now() - startTime,
      })
      throw new Error(
        'No worktrees found for this repository. Use create-session to create one.',
      )
    }

    this.emitEvent('find-all-worktrees:end', {
      worktreeCount: worktrees.length,
      duration: Date.now() - findWorktreesStart,
    })

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    if (options.worktree) {
      const worktreeInput = options.worktree.trim()

      const findWorktreeStart = Date.now()
      this.emitEvent('find-worktree:start', {
        worktreeInput,
      })

      let targetWorktree = null

      for (const wt of worktrees) {
        const worktreeNumber = wt.worktreeNumber.toString()
        const paddedNumber = worktreeNumber.padStart(5, '0')
        const sessionName = `${wt.projectName}-worktree-${paddedNumber}`

        if (
          worktreeNumber === worktreeInput ||
          paddedNumber === worktreeInput ||
          sessionName === worktreeInput
        ) {
          targetWorktree = wt
          break
        }
      }

      if (!targetWorktree) {
        this.emitEvent('find-worktree:fail', {
          error: `Worktree '${worktreeInput}' not found`,
          errorCode: 'WORKTREE_NOT_FOUND',
          duration: Date.now() - findWorktreeStart,
        })
        this.emitEvent('resume-session:fail', {
          error: `Worktree '${worktreeInput}' not found`,
          errorCode: 'WORKTREE_NOT_FOUND',
          duration: Date.now() - startTime,
        })
        throw new Error(`Worktree '${worktreeInput}' not found`)
      }

      this.emitEvent('find-worktree:end', {
        worktreeInput,
        worktree: {
          number: targetWorktree.worktreeNumber,
          path: targetWorktree.path,
          branch: targetWorktree.branch,
          projectName: targetWorktree.projectName,
        },
        duration: Date.now() - findWorktreeStart,
      })

      const sessionName = `${targetWorktree.projectName}-worktree-${targetWorktree.worktreeNumber
        .toString()
        .padStart(5, '0')}`

      await enableZmqPublishing(this, {
        zmq: options.zmq,
        socketName: options.zmqSocket,
        socketPath: options.zmqSocketPath,
        source: {
          script: 'resume-session',
          socketPath,
        },
      })

      const checkSessionStart = Date.now()
      this.emitEvent('check-session-exists:start', {
        sessionName,
      })

      let sessionExists = false
      try {
        const sessions = execSync(
          `tmux ${socketArgs} list-sessions -F '#{session_name}'`,
          {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          },
        )
          .trim()
          .split('\n')

        sessionExists = sessions.includes(sessionName)
      } catch {}

      this.emitEvent('check-session-exists:end', {
        sessionName,
        exists: sessionExists,
        duration: Date.now() - checkSessionStart,
      })

      if (sessionExists) {
        if (options.attach !== false) {
          const switchSessionStart = Date.now()
          this.emitEvent('switch-to-existing-session:start', {
            sessionName,
          })

          execSync(`tmux ${socketArgs} switch-client -t ${sessionName}`, {
            stdio: 'inherit',
          })

          this.emitEvent('switch-to-existing-session:end', {
            sessionName,
            duration: Date.now() - switchSessionStart,
          })
        }

        this.emitEvent('resume-session:end', {
          sessionName,
          action: 'switched',
          worktreePath: targetWorktree.path,
          duration: Date.now() - startTime,
        })
      } else {
        const createSessionStart = Date.now()
        this.emitEvent('create-new-session:start', {
          sessionName,
          worktreePath: targetWorktree.path,
        })

        const continueOptions = {
          ...options,
          attach: options.attach !== false,
        }

        await this.continue(projectPath, continueOptions)

        if (targetWorktree.branch) {
          execSync(
            `cd ${targetWorktree.path} && git checkout ${targetWorktree.branch}`,
            {
              stdio: 'inherit',
            },
          )
        }

        this.emitEvent('create-new-session:end', {
          sessionName,
          worktreePath: targetWorktree.path,
          duration: Date.now() - createSessionStart,
        })

        this.emitEvent('resume-session:end', {
          sessionName,
          action: 'created',
          worktreePath: targetWorktree.path,
          duration: Date.now() - startTime,
        })
      }

      return
    }

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'resume-session',
        socketPath,
      },
    })

    const checkSessionsStart = Date.now()
    this.emitEvent('check-existing-sessions:start')

    const sessionsWithWorktrees: Array<{
      sessionName: string
      worktreeNumber: string
      worktreePath: string
      exists: boolean
    }> = []

    const menuItems: string[] = []
    const currentDirectory = process.cwd()

    for (const wt of worktrees) {
      const sessionName = `${wt.projectName}-worktree-${wt.worktreeNumber
        .toString()
        .padStart(5, '0')}`

      let sessionExists = false
      try {
        const sessions = execSync(
          `tmux ${socketArgs} list-sessions -F '#{session_name}'`,
          {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          },
        )
          .trim()
          .split('\n')

        sessionExists = sessions.includes(sessionName)
      } catch {}

      sessionsWithWorktrees.push({
        sessionName,
        worktreeNumber: wt.worktreeNumber.toString().padStart(5, '0'),
        worktreePath: wt.path,
        exists: sessionExists,
      })

      const dateStr = wt.mtime.toLocaleDateString()
      const timeStr = wt.mtime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      const branchName = wt.branch || 'detached'
      const existsMarker = sessionExists ? ' [ACTIVE]' : ''

      const displayName = `${wt.worktreeNumber
        .toString()
        .padStart(
          5,
          '0',
        )} | ${branchName} | ${dateStr} ${timeStr}${existsMarker}`

      const shortcut =
        wt.worktreeNumber < 10 ? wt.worktreeNumber.toString() : ''

      const terminalOptions = []
      if (options.terminalWidth)
        terminalOptions.push(`--terminal-width ${options.terminalWidth}`)
      if (options.terminalHeight)
        terminalOptions.push(`--terminal-height ${options.terminalHeight}`)
      if (options.attach === false) terminalOptions.push('--no-attach')
      if (options.zmq === false) terminalOptions.push('--no-zmq')
      if (options.zmqSocket)
        terminalOptions.push(`--zmq-socket ${options.zmqSocket}`)
      if (options.zmqSocketPath)
        terminalOptions.push(`--zmq-socket-path ${options.zmqSocketPath}`)
      if (options.socketName)
        terminalOptions.push(`--tmux-socket ${options.socketName}`)
      if (options.socketPath)
        terminalOptions.push(`--tmux-socket-path ${options.socketPath}`)

      const optionsString =
        terminalOptions.length > 0 ? ` ${terminalOptions.join(' ')}` : ''

      const command = sessionExists
        ? `run-shell "cd ${currentDirectory} && tmux ${socketArgs} switch-client -t ${sessionName}"`
        : `run-shell "cd ${currentDirectory} && ${process.argv[0]} ${process.argv[1]} continue-session ${projectPath}${optionsString} && sleep 0.1 && cd ${wt.path} && git checkout ${wt.branch}"`

      menuItems.push(displayName)
      menuItems.push(shortcut)
      menuItems.push(command)
    }

    this.emitEvent('check-existing-sessions:end', {
      sessionsWithWorktrees,
      duration: Date.now() - checkSessionsStart,
    })

    const analyzeStart = Date.now()
    this.emitEvent('analyze-worktree-sessions:start')

    const activeSessions = sessionsWithWorktrees.filter(s => s.exists).length
    const worktreesWithoutSessions = worktrees.length - activeSessions

    this.emitEvent('analyze-worktree-sessions:end', {
      totalWorktrees: worktrees.length,
      activeSessions,
      worktreesWithoutSessions,
      duration: Date.now() - analyzeStart,
    })

    const prepareMenuStart = Date.now()
    this.emitEvent('prepare-menu-items:start')

    this.emitEvent('prepare-menu-items:end', {
      menuItemCount: menuItems.length / 3,
      duration: Date.now() - prepareMenuStart,
    })

    const menuCommand = [
      'tmux',
      ...getTmuxSocketArgs(this.socketOptions),
      'display-menu',
      '-T',
      'Select Worktree',
      ...menuItems,
    ]

    this.emitEvent('display-menu:start', {
      worktreeCount: worktrees.length,
    })

    const result = spawnSync(menuCommand[0], menuCommand.slice(1), {
      stdio: 'inherit',
    })

    if (result.error) {
      this.emitEvent('display-menu:fail', {
        error: result.error.message,
        duration: Date.now() - startTime,
      })
      this.emitEvent('resume-session:fail', {
        error: `Failed to display menu: ${result.error.message}`,
        duration: Date.now() - startTime,
      })
      throw result.error
    }

    if (result.status !== 0) {
      this.emitEvent('display-menu:cancel', {
        duration: Date.now() - startTime,
      })
      this.emitEvent('select-worktree-session:fail', {
        error: 'Menu cancelled',
        errorCode: 'MENU_CANCELLED',
        cancelled: true,
        duration: Date.now() - startTime,
      })
      this.emitEvent('resume-session:end', {
        cancelled: true,
        duration: Date.now() - startTime,
      })
    } else {
      this.emitEvent('display-menu:end', {
        duration: Date.now() - startTime,
      })
      this.emitEvent('resume-session:end', {
        duration: Date.now() - startTime,
      })
    }
  }
}
