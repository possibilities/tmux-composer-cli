import { EventBus } from '../core/event-bus.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import { getTmuxSocketString } from '../core/tmux-socket.js'
import { socketExists } from '../core/tmux-utils.js'
import { spawn } from 'child_process'
import { promisify } from 'util'

const sleep = promisify(setTimeout)

interface AutomateNewOptions extends TmuxSocketOptions {}

export class TmuxAutomatorNew {
  private eventBus: EventBus
  private socketOptions: TmuxSocketOptions
  private controlModeProcess: any = null
  private isConnected = false
  private isShuttingDown = false
  private windows = new Map<string, string>()
  private windowIdMap = new Map<string, { session: string; index: string }>()
  private inCommandOutput = false
  private hasDisplayedInitialList = false

  constructor(eventBus: EventBus, options: AutomateNewOptions = {}) {
    this.eventBus = eventBus
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  async start() {
    console.log('Starting tmux control mode monitor...')

    process.on('SIGINT', () => {
      this.shutdown()
    })

    process.on('SIGTERM', () => {
      this.shutdown()
    })

    await this.monitorAndConnect()
  }

  private async monitorAndConnect() {
    while (!this.isShuttingDown) {
      if (!socketExists(this.socketOptions)) {
        if (this.isConnected) {
          console.log('Tmux server disconnected. Waiting for reconnection...')
          this.isConnected = false
          // Clear window data on disconnect
          this.windows.clear()
          this.windowIdMap.clear()
          this.hasDisplayedInitialList = false
        } else {
          console.log('Waiting for tmux server...')
        }
        await sleep(1000)
        continue
      }

      if (!this.isConnected) {
        console.log('Tmux server detected. Connecting in control mode...')
        // Clear any stale data before reconnecting
        this.windows.clear()
        this.windowIdMap.clear()
        this.hasDisplayedInitialList = false
        await this.connectControlMode()
      }

      await sleep(1000)
    }
  }

  private async connectControlMode() {
    if (this.controlModeProcess) {
      this.controlModeProcess.kill()
      this.controlModeProcess = null
    }

    const socketArgs = getTmuxSocketString(this.socketOptions)
    const args = socketArgs.split(' ').concat(['-C'])

    console.log(`Connecting with args: tmux ${args.join(' ')}`)

    this.controlModeProcess = spawn('tmux', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.controlModeProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString()
      const lines = output.split('\n').filter(line => line.trim())

      for (const line of lines) {
        this.processControlModeOutput(line)
      }
    })

    this.controlModeProcess.stderr.on('data', (data: Buffer) => {
      console.error('Control mode error:', data.toString())
    })

    this.controlModeProcess.on('close', (code: number) => {
      console.log(`Control mode process exited with code ${code}`)
      this.isConnected = false
      this.controlModeProcess = null
      // Clear window data when control mode closes
      this.windows.clear()
      this.windowIdMap.clear()
      this.hasDisplayedInitialList = false
    })

    this.controlModeProcess.on('error', (error: Error) => {
      console.error('Failed to start control mode:', error)
      this.isConnected = false
    })

    this.isConnected = true

    // Wait a bit for connection to establish
    await sleep(100)

    // Request list of all windows with window IDs
    console.log('Requesting window list...')
    this.controlModeProcess.stdin.write(
      'list-windows -a -F "#{session_name}:#{window_index}: #{window_name} [@#{window_id}]"\n',
    )
  }

  private processControlModeOutput(line: string) {
    const parts = line.split(' ')

    // Handle command output markers
    if (parts[0] === '%begin') {
      this.inCommandOutput = true
      return
    } else if (parts[0] === '%end') {
      this.inCommandOutput = false
      // Only display initial list once
      if (this.windows.size > 0 && !this.hasDisplayedInitialList) {
        this.displayWindowList()
        this.hasDisplayedInitialList = true
      }
      return
    }

    if (parts[0] === '%window-add') {
      // Format: %window-add @window_id
      const windowId = parts[1]
      console.log(`Window added: ${windowId} (requesting details...)`)
      // Request window details
      this.requestWindowDetails(windowId)
    } else if (parts[0] === '%window-close') {
      // Format: %window-close @window_id
      const windowId = parts[1]
      // Find and remove window by ID
      for (const [key, _] of this.windows) {
        const info = this.windowIdMap.get(windowId)
        if (info && key === `${info.session}:${info.index}`) {
          this.windows.delete(key)
          this.windowIdMap.delete(windowId)
          console.log(`Window closed: ${key}`)
          break
        }
      }
    } else if (parts[0] === '%window-renamed') {
      // Format: %window-renamed $session_id @window_id new-name
      const sessionId = parts[1]
      const windowId = parts[2]
      const newName = parts.slice(3).join(' ')
      const info = this.windowIdMap.get(windowId)
      if (info) {
        const key = `${info.session}:${info.index}`
        this.windows.set(key, newName)
        console.log(`Window renamed: ${key} to ${newName}`)
      }
    } else if (parts[0] === '%session-window-changed') {
      const sessionId = parts[1]
      const windowId = parts[2]
      console.log(
        `Active window changed in session ${sessionId} to window ${windowId}`,
      )
    } else if (parts[0] === '%sessions-changed') {
      // Sessions list changed, refresh windows
      this.refreshWindowList()
    } else if (parts[0] === '%output') {
      // Skip terminal output from panes
      return
    } else if (this.inCommandOutput && !parts[0].startsWith('%')) {
      // This is window list output from list-windows command
      // Format: session:index: name [@@window_id]
      const match = line.match(/^([^:]+):(\d+): (.+) \[@@(\d+)\]$/)
      if (match) {
        const [_, sessionName, windowIndex, windowName, windowId] = match
        const key = `${sessionName}:${windowIndex}`
        this.windows.set(key, windowName.trim())
        this.windowIdMap.set(`@${windowId}`, {
          session: sessionName,
          index: windowIndex,
        })
      }
    }

    // Display current window list after changes
    if (
      parts[0] === '%window-add' ||
      parts[0] === '%window-close' ||
      parts[0] === '%window-renamed'
    ) {
      setTimeout(() => this.displayWindowList(), 100)
    }
  }

  private async requestWindowDetails(windowId: string) {
    if (this.controlModeProcess && this.controlModeProcess.stdin) {
      this.controlModeProcess.stdin.write(
        `list-windows -a -F "#{session_name}:#{window_index}: #{window_name} [@#{window_id}]" -f "@#{==:#{window_id},${windowId}}"\n`,
      )
    }
  }

  private displayWindowList() {
    console.log('\nCurrent windows:')
    const sorted = Array.from(this.windows.entries()).sort()
    for (const [key, name] of sorted) {
      console.log(`  ${key} - ${name}`)
    }
  }

  private async refreshWindowList() {
    if (this.controlModeProcess && this.controlModeProcess.stdin) {
      // Clear existing data before refresh
      this.windows.clear()
      this.windowIdMap.clear()
      this.controlModeProcess.stdin.write(
        'list-windows -a -F "#{session_name}:#{window_index}: #{window_name} [@#{window_id}]"\n',
      )
    }
  }

  private shutdown() {
    console.log('\nShutting down...')
    this.isShuttingDown = true

    if (this.controlModeProcess) {
      this.controlModeProcess.kill()
      this.controlModeProcess = null
    }

    process.exit(0)
  }
}
