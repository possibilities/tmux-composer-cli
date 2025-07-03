import { execSync, spawnSync } from 'child_process'
import { SessionCreator } from './create-session.js'
import { getAllProjectWorktrees } from '../core/git-utils.js'
import { getTmuxSocketArgs, getTmuxSocketPath } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

interface ResumeSessionOptions extends TmuxSocketOptions {
  terminalWidth?: number
  terminalHeight?: number
  attach?: boolean
  zmq?: boolean
  zmqSocket?: string
  zmqSocketPath?: string
}

export class SessionResumer extends SessionCreator {
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

    const startTime = Date.now()

    this.emitEvent('resume-session:start', {
      projectPath,
      options: {
        socketName: options.socketName,
        socketPath: options.socketPath,
        terminalWidth: options.terminalWidth,
        terminalHeight: options.terminalHeight,
        attach: options.attach,
      },
    })

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
