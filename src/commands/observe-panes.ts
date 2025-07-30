import { spawn, ChildProcess } from 'child_process'
import { throttle } from '../core/throttle.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { getTmuxSocketPath, getTmuxSocketArgs } from '../core/tmux-socket.js'
import { BaseSessionCommand } from '../core/base-session-command.js'
import type { PaneChangedData, TmuxEvent } from '../core/events.js'
import type { BaseSessionOptions } from '../core/base-session-command.js'

interface NodeError extends Error {
  code?: string
}

function normalizeSessionId(id: string): string {
  return id.startsWith('$') ? id : `$${id}`
}

export class TmuxPaneWatcher extends BaseSessionCommand {
  private controlModeProcess: ChildProcess | null = null
  private currentSessionId: string | null = null
  private currentSessionName: string | null = null
  private ownPaneId: string | null = null
  private ownWindowId: string | null = null
  private paneThrottlers = new Map<string, (data: PaneChangedData) => void>()
  private paneContents = new Map<string, string>()

  constructor(options: BaseSessionOptions = {}) {
    super(options)

    this.ownPaneId = process.env.TMUX_PANE || null

    this.on('event', (event: TmuxEvent) => {
      console.log(JSON.stringify(event))
    })
  }

  async start(
    options: { zmq?: boolean; zmqSocket?: string; zmqSocketPath?: string } = {},
  ) {
    if (options.zmq === false && (options.zmqSocket || options.zmqSocketPath)) {
      console.error(
        'Error: Cannot use --no-zmq with --zmq-socket or --zmq-socket-path',
      )
      process.exit(1)
    }

    try {
      const sessionName = await this.runCommand(
        'tmux display-message -p "#{session_name}"',
      )
      const sessionId = await this.runCommand(
        'tmux display-message -p "#{session_id}"',
      )
      const windowId = await this.runCommand(
        'tmux display-message -p "#{window_id}"',
      )
      this.currentSessionId = normalizeSessionId(sessionId.trim())
      this.currentSessionName = sessionName.trim()
      this.ownWindowId = windowId.trim()

      this.updateContext({
        session: {
          name: this.currentSessionName,
          mode: 'session',
        },
      })

      console.error(
        `[INFO] Monitoring panes in session ${this.currentSessionName}`,
      )
      console.error(`[INFO] Ignoring output from panes in the same window`)
    } catch (error) {
      console.error(
        'Failed to get current session. Are you running inside tmux?',
      )
      process.exit(1)
    }

    const socketPath = getTmuxSocketPath({})

    await enableZmqPublishing(this, {
      zmq: options.zmq,
      socketName: options.zmqSocket,
      socketPath: options.zmqSocketPath,
      source: {
        script: 'observe-panes',
        sessionId: this.currentSessionId,
        sessionName: this.currentSessionName,
        socketPath,
      },
    })

    this.setupSignalHandlers()
    await this.connectControlMode()
  }

  private async runCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command])
      let output = ''
      child.stdout.on('data', data => {
        output += data.toString()
      })
      child.on('close', code => {
        if (code === 0) resolve(output)
        else reject(new Error(`Command failed with code ${code}`))
      })
    })
  }

  private async capturePaneContent(paneId: string): Promise<string> {
    try {
      const content = await this.runCommand(
        `tmux capture-pane -p -J -t ${paneId}`,
      )
      return content
    } catch (error) {
      console.error(
        `[DEBUG] Failed to capture pane content for ${paneId}:`,
        error,
      )
      return ''
    }
  }

  private setupSignalHandlers() {
    const signalHandler = () => this.shutdown()
    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)
  }

  private async connectControlMode(): Promise<boolean> {
    try {
      if (this.controlModeProcess) {
        this.controlModeProcess!.stdout?.removeAllListeners()
        this.controlModeProcess!.stderr?.removeAllListeners()
        this.controlModeProcess!.removeAllListeners()

        if (
          this.controlModeProcess!.stdin &&
          !this.controlModeProcess!.stdin.destroyed
        ) {
          this.controlModeProcess!.stdin.end()
        }

        this.controlModeProcess!.kill()
        this.controlModeProcess = null
      }

      const socketArgs = getTmuxSocketArgs({})
      const args = [
        ...socketArgs,
        '-C',
        'attach-session',
        '-t',
        this.currentSessionId!,
      ]

      this.controlModeProcess = spawn('tmux', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      console.error('Failed to spawn tmux process:', error)
      return false
    }

    const stdoutHandler = (data: Buffer) => {
      try {
        const output = data.toString()

        const lines = output.split(/\r?\n/).filter(line => line.trim())

        for (const line of lines) {
          this.processControlModeOutput(line)
        }
      } catch (error) {
        console.error('Error processing stdout:', error)
      }
    }

    const stderrHandler = (data: Buffer) => {
      const errorMessage = data.toString().trim()
      console.error('Control mode error:', errorMessage)

      if (
        errorMessage.includes('no server running') ||
        errorMessage.includes('lost server') ||
        errorMessage.includes('server exited')
      ) {
        this.cleanupControlMode()
      }
    }

    const closeHandler = () => {
      this.cleanupControlMode()
    }

    const errorHandler = (error: NodeError) => {
      console.error('Control mode process error:', error)

      if (error.code === 'ENOENT') {
        console.error(
          'tmux command not found. Please ensure tmux is installed.',
        )
      } else if (error.code === 'EACCES') {
        console.error('Permission denied when accessing tmux.')
      }
    }

    this.controlModeProcess!.stdout!.on('data', stdoutHandler)
    this.controlModeProcess!.stderr!.on('data', stderrHandler)
    this.controlModeProcess!.on('close', closeHandler)
    this.controlModeProcess!.on('error', errorHandler)

    await new Promise(resolve => setTimeout(resolve, 100))

    return true
  }

  private async getPaneInfo(paneId: string): Promise<{
    windowIndex: string
    windowName: string
    windowId: string
    sessionId: string
    paneIndex: string
  } | null> {
    try {
      const result = await this.runCommand(
        `tmux display-message -t ${paneId} -p "#{session_id} #{window_index} #{window_name} #{window_id} #{pane_index}"`,
      )
      const parts = result.trim().split(' ')
      const sessionId = parts[0]
      const windowIndex = parts[1]
      const paneIndex = parts[parts.length - 1]
      const windowId = parts[parts.length - 2]
      const windowName = parts.slice(2, -2).join(' ')
      return { sessionId, windowIndex, windowName, windowId, paneIndex }
    } catch (error) {
      return null
    }
  }

  private cleanupControlMode() {
    if (this.controlModeProcess) {
      this.controlModeProcess.stdout?.removeAllListeners()
      this.controlModeProcess.stderr?.removeAllListeners()
      this.controlModeProcess.removeAllListeners()

      if (
        this.controlModeProcess.stdin &&
        !this.controlModeProcess.stdin.destroyed
      ) {
        this.controlModeProcess.stdin.end()
      }

      this.controlModeProcess = null
    }
  }

  private async processControlModeOutput(line: string) {
    try {
      const parts = line.split(' ', 3)

      if (parts[0] === '%output') {
        const paneId = parts[1]

        if (paneId === this.ownPaneId) {
          return
        }

        try {
          const paneInfo = await this.getPaneInfo(paneId)

          if (
            !paneInfo ||
            normalizeSessionId(paneInfo.sessionId) !== this.currentSessionId
          ) {
            return
          }

          if (paneInfo.windowId === this.ownWindowId) {
            return
          }

          const data = {
            sessionId: this.currentSessionId!,
            paneId: paneId,
            windowName: paneInfo.windowName,
            windowIndex: paneInfo.windowIndex,
            paneIndex: paneInfo.paneIndex,
            content: '',
          }

          let throttledEmitter = this.paneThrottlers.get(paneId)
          if (!throttledEmitter) {
            throttledEmitter = throttle(async (data: PaneChangedData) => {
              const currentContent = await this.capturePaneContent(paneId)
              const lastContent = this.paneContents.get(paneId)

              if (!lastContent || lastContent !== currentContent) {
                this.paneContents.set(paneId, currentContent)
                const eventData = { ...data, content: currentContent }
                this.emitEvent('pane-changed', eventData)
              }
            }, 100)
            this.paneThrottlers.set(paneId, throttledEmitter)
          }

          throttledEmitter(data)
        } catch (error) {
          console.error(`[DEBUG] Failed to get pane info for ${paneId}:`, error)
        }
      }
    } catch (error) {
      console.error('Error processing control mode output:', error)
      console.error('Line that caused error:', line)
    }
  }

  private shutdown() {
    this.paneThrottlers.clear()
    this.paneContents.clear()

    if (this.controlModeProcess) {
      this.controlModeProcess.stdout?.removeAllListeners()
      this.controlModeProcess.stderr?.removeAllListeners()
      this.controlModeProcess.removeAllListeners()

      if (
        this.controlModeProcess.stdin &&
        !this.controlModeProcess.stdin.destroyed
      ) {
        this.controlModeProcess.stdin.end()
      }

      this.controlModeProcess.kill()
      this.controlModeProcess = null
    }

    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')

    process.exit(0)
  }
}
