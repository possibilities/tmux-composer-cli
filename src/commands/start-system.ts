import { execSync } from 'child_process'
import { getTmuxSocketArgs } from '../core/tmux-socket.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { BaseSessionCommand } from '../core/base-session-command.js'
import type { BaseSessionOptions } from '../core/base-session-command.js'

interface StartSystemOptions extends BaseSessionOptions {
  attach?: boolean
}

interface SessionConfig {
  name: string
  directory: string
  command: string
  port?: number
}

const SUPPORTED_SHELLS = [
  'bash',
  'zsh',
  'sh',
  'fish',
  'ksh',
  'tcsh',
  'csh',
] as const

export class SystemStarter extends BaseSessionCommand {
  constructor() {
    super({
      socketName: 'tmux-composer-system',
    })
  }

  async start(options: StartSystemOptions = {}) {
    const startTime = Date.now()

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'start-system',
        socketPath: getTmuxSocketArgs(this.socketOptions).join(' '),
      },
    })

    this.emitEvent('initialize-session-creation:start', {
      projectPath: process.cwd(),
      options: {
        socketName: this.socketOptions.socketName,
        socketPath: this.socketOptions.socketPath,
        terminalWidth: undefined,
        terminalHeight: undefined,
        attach: options.attach,
        worktreeMode: false,
      },
    })

    const sessions: SessionConfig[] = [
      {
        name: 'tmux',
        directory: '~/code/tmux-composer-ui',
        command: 'pnpm dev',
      },
      {
        name: 'claude',
        directory: '~/code/claude-code-metadata-browser',
        command: 'pnpm dev',
      },
      {
        name: 'observe',
        directory: '.',
        command: 'tmux-composer observe-observers',
      },
      {
        name: 'proxy',
        directory: '.',
        command: 'arthack-proxy',
      },
    ]

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    // Kill existing server if it exists
    try {
      const killStartTime = Date.now()
      this.emitEvent('kill-existing-server:start')

      execSync(`tmux ${socketArgs} kill-server 2>/dev/null || true`, {
        encoding: 'utf-8',
      })

      // Wait a moment for the server to fully terminate
      execSync('sleep 0.5')

      // Verify the server is gone
      let attempts = 0
      while (attempts < 10) {
        try {
          execSync(`tmux ${socketArgs} list-sessions 2>/dev/null`, {
            encoding: 'utf-8',
          })
          // If we get here, server is still running
          execSync('sleep 0.2')
          attempts++
        } catch {
          // Server is gone, which is what we want
          break
        }
      }

      if (attempts >= 10) {
        this.emitEvent('kill-existing-server:fail', {
          error: 'Failed to kill existing tmux server',
          errorCode: 'KILL_SERVER_FAILED',
          duration: Date.now() - killStartTime,
        })
        throw new Error('Failed to kill existing tmux server')
      }

      this.emitEvent('kill-existing-server:end', {
        duration: Date.now() - killStartTime,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Failed to kill')) {
        throw error
      }
      // If kill-server fails because no server exists, that's fine
    }

    const createdSessions: string[] = []
    const sessionPorts: Record<string, number> = {}

    for (const session of sessions) {
      const sessionStartTime = Date.now()
      this.emitEvent('create-tmux-session:start')

      try {
        const expandedDirectory = session.directory.replace(
          '~',
          process.env.HOME || '',
        )

        const port = this.findAvailablePort()
        sessionPorts[session.name] = port

        execSync(
          `tmux ${socketArgs} new-session -d -s ${session.name} -c ${expandedDirectory} -e PORT=${port}`,
          { stdio: 'ignore' },
        )

        const isPaneReady = await this.waitForPaneReady(session.name)

        if (!isPaneReady) {
          throw new Error(
            `Pane for session '${session.name}' did not become ready within timeout`,
          )
        }

        execSync(
          `tmux ${socketArgs} send-keys -t ${session.name} '${session.command}' Enter`,
        )

        createdSessions.push(session.name)

        this.emitEvent('create-tmux-session:end', {
          sessionName: session.name,
          sessionId: execSync(
            `tmux ${socketArgs} display-message -t ${session.name} -p '#{session_id}'`,
            { encoding: 'utf-8' },
          ).trim(),
          socketPath: getTmuxSocketArgs(this.socketOptions).join(' '),
          firstWindow: session.name,
          terminalSize: {
            width: 80,
            height: 24,
          },
          port,
          duration: Date.now() - sessionStartTime,
        })
      } catch (error) {
        this.emitEvent('create-tmux-session:fail', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'CREATION_FAILED',
          duration: Date.now() - sessionStartTime,
        })
        throw error
      }
    }

    this.emitEvent('initialize-session-creation:end', {
      duration: Date.now() - startTime,
      sessionPorts,
    })

    console.log('\nSessions created with ports:')
    for (const [sessionName, port] of Object.entries(sessionPorts)) {
      console.log(`  ${sessionName}: http://localhost:${port}`)
    }

    if (options.attach !== false && createdSessions.length > 0) {
      const attachStartTime = Date.now()
      this.emitEvent('attach-tmux-session:start')

      try {
        const insideTmux = !!process.env.TMUX
        const firstSession = createdSessions[0]

        if (insideTmux) {
          execSync(`tmux ${socketArgs} switch-client -t ${firstSession}`)
        } else {
          execSync(`tmux ${socketArgs} attach -t ${firstSession}`, {
            stdio: 'inherit',
          })
        }

        this.emitEvent('attach-tmux-session:end', {
          sessionName: firstSession,
          windowsReady: true,
          attachMethod: insideTmux ? 'switch-client' : 'attach',
          duration: Date.now() - attachStartTime,
        })
      } catch (error) {
        const attachCommand = process.env.TMUX
          ? `tmux ${socketArgs} switch-client -t ${createdSessions[0]}`
          : `tmux ${socketArgs} attach -t ${createdSessions[0]}`

        this.emitEvent('attach-tmux-session:fail', {
          sessionName: createdSessions[0],
          error: error instanceof Error ? error.message : String(error),
          attachCommand,
          insideTmux: !!process.env.TMUX,
          duration: Date.now() - attachStartTime,
        })

        console.error(
          `\nFailed to attach to session: ${error instanceof Error ? error.message : String(error)}`,
        )
        console.error(`Sessions created: ${createdSessions.join(', ')}`)
        console.error(`To attach manually, use: ${attachCommand}`)
      }
    }
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

  protected async waitForPaneReady(
    sessionName: string,
    maxWaitMs: number = 5000,
  ): Promise<boolean> {
    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
    const startTime = Date.now()
    const checkInterval = 100

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const paneInfo = execSync(
          `tmux ${socketArgs} list-panes -t ${sessionName} -F '#{pane_pid} #{pane_current_command}'`,
          { encoding: 'utf-8' },
        ).trim()

        if (paneInfo) {
          const [pid, currentCommand] = paneInfo.split(' ')

          const isShellReady = SUPPORTED_SHELLS.some(shell =>
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
