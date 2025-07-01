import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { throttle } from '../core/throttle'

interface TmuxEvent {
  event: string
  data: any
  timestamp: string
}

interface PaneOutputData {
  sessionId: string
  windowIndex: string
  windowName: string
  paneIndex: string
  paneId: string
}

interface NodeError extends Error {
  code?: string
}

function normalizeSessionId(id: string): string {
  return id.startsWith('$') ? id : `$${id}`
}

export class TmuxPaneWatcher extends EventEmitter {
  private controlModeProcess: ChildProcess | null = null
  private currentSessionId: string | null = null
  private currentSessionName: string | null = null
  private ownPaneId: string | null = null
  private ownWindowId: string | null = null
  private isConnected = false
  private isShuttingDown = false
  private paneThrottlers = new Map<string, (data: any) => void>()

  constructor() {
    super()

    // Get our own pane ID from environment
    this.ownPaneId = process.env.TMUX_PANE || null

    this.on('event', (event: TmuxEvent) => {
      console.log(JSON.stringify(event))
    })
  }

  private emitEvent(eventName: string, data: any): void {
    const event: TmuxEvent = {
      event: eventName,
      data,
      timestamp: new Date().toISOString(),
    }
    this.emit('event', event)
  }

  async start() {
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

      const args = ['-C', 'attach-session', '-t', this.currentSessionId!]

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

        // Handle both LF and CRLF line endings
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

    const closeHandler = (code: number) => {
      this.cleanupControlMode()
    }

    const errorHandler = (error: NodeError) => {
      console.error('Control mode process error:', error)
      this.isConnected = false

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

    this.isConnected = true

    // Wait a bit for control mode to initialize
    await new Promise(resolve => setTimeout(resolve, 100))

    return true
  }

  private async writeToControlMode(data: string): Promise<void> {
    if (!this.controlModeProcess || !this.controlModeProcess.stdin) {
      throw new Error('Control mode process not available')
    }

    if (this.controlModeProcess.stdin.destroyed) {
      throw new Error('Control mode stdin is destroyed')
    }

    return new Promise((resolve, reject) => {
      this.controlModeProcess.stdin!.write(data, (error?: Error | null) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  private async getPaneInfo(paneId: string): Promise<{
    windowIndex: string
    windowName: string
    windowId: string
  } | null> {
    try {
      // Use display-message to get pane info directly
      const result = await this.runCommand(
        `tmux display-message -t ${paneId} -p "#{window_index} #{window_name} #{window_id}"`,
      )
      const parts = result.trim().split(' ')
      const windowIndex = parts[0]
      const windowId = parts[parts.length - 1]
      const windowName = parts.slice(1, -1).join(' ')
      return { windowIndex, windowName, windowId }
    } catch (error) {
      return null
    }
  }

  private cleanupControlMode() {
    this.isConnected = false

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
      // Use limited split to avoid parsing huge payloads
      const parts = line.split(' ', 3)

      if (parts[0] === '%output') {
        // Handle pane output event - parts[1] is paneId, parts[2] onwards is payload (ignored)
        const paneId = parts[1]

        // Skip output from our own pane
        if (paneId === this.ownPaneId) {
          return
        }

        // Query pane info on demand
        try {
          const paneInfo = await this.getPaneInfo(paneId)

          // Skip panes in the same window as this watcher
          if (paneInfo && paneInfo.windowId === this.ownWindowId) {
            return
          }

          const data = {
            sessionId: this.currentSessionId!,
            paneId: paneId,
            windowName: paneInfo?.windowName || 'unknown',
            windowIndex: paneInfo?.windowIndex || 'unknown',
          }

          // Get or create throttled emitter for this pane
          let throttledEmitter = this.paneThrottlers.get(paneId)
          if (!throttledEmitter) {
            throttledEmitter = throttle((data: any) => {
              this.emitEvent('pane-output', data)
            }, 100)
            this.paneThrottlers.set(paneId, throttledEmitter)
          }

          // Call throttled emitter with latest data
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
    this.isShuttingDown = true

    // Clear throttlers
    this.paneThrottlers.clear()

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
