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
  private windows = new Map<
    string,
    { name: string; hasClaude: boolean; firstSeen: number }
  >()
  private windowIdMap = new Map<string, { session: string; index: string }>()
  private inCommandOutput = false
  private hasDisplayedInitialList = false
  private claudeCheckInterval: NodeJS.Timeout | null = null
  private isCheckingClaude = false
  private claudeCheckResults = new Map<string, boolean>()
  private paneToWindowMap = new Map<string, string>()

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
    let waitingMessageShown = false
    while (!this.isShuttingDown) {
      if (!socketExists(this.socketOptions)) {
        if (this.isConnected) {
          console.log('Tmux server disconnected. Waiting for reconnection...')
          this.isConnected = false
          waitingMessageShown = true
          // Clear window data on disconnect
          this.windows.clear()
          this.windowIdMap.clear()
          this.paneToWindowMap.clear()
          this.hasDisplayedInitialList = false
          // Stop claude checking
          if (this.claudeCheckInterval) {
            clearInterval(this.claudeCheckInterval)
            this.claudeCheckInterval = null
          }
        } else if (!waitingMessageShown) {
          console.log('Waiting for tmux server...')
          waitingMessageShown = true
        }
        await sleep(1000)
        continue
      }

      if (!this.isConnected) {
        console.log('Tmux server detected. Connecting in control mode...')
        waitingMessageShown = false // Reset for next disconnect
        // Clear any stale data before reconnecting
        this.windows.clear()
        this.windowIdMap.clear()
        this.paneToWindowMap.clear()
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
    const args = socketArgs.split(' ').concat(['-C', 'attach'])

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
      this.paneToWindowMap.clear()
      this.hasDisplayedInitialList = false
      // Stop claude checking
      if (this.claudeCheckInterval) {
        clearInterval(this.claudeCheckInterval)
        this.claudeCheckInterval = null
      }
    })

    this.controlModeProcess.on('error', (error: Error) => {
      console.error('Failed to start control mode:', error)
      this.isConnected = false
    })

    this.isConnected = true

    // Wait a bit for connection to establish
    await sleep(100)

    // Request list of all windows with window IDs and pane info
    this.controlModeProcess.stdin.write(
      'list-panes -a -F "#{session_name}:#{window_index}: #{window_name} [@#{window_id}] %#{pane_id} #{pane_pid} #{pane_current_command}"\n',
    )

    // Start periodic claude checking
    this.startClaudeChecking()
  }

  private processControlModeOutput(line: string) {
    const parts = line.split(' ')

    // Handle command output markers
    if (parts[0] === '%begin') {
      this.inCommandOutput = true
      return
    } else if (parts[0] === '%end') {
      this.inCommandOutput = false
      // Don't display window list if we're just checking for claude
      if (this.isCheckingClaude) {
        this.isCheckingClaude = false
        // Process the claude check results
        this.processClaudeCheckResults()
        return
      }
      // Display window list after command output if we have windows
      if (this.windows.size > 0) {
        // On startup, only display once
        if (!this.hasDisplayedInitialList) {
          this.hasDisplayedInitialList = true
        }
        this.displayWindowList()
      }
      return
    }

    if (parts[0] === '%window-add') {
      // Format: %window-add @window_id
      const windowId = parts[1]
      // During startup, this is just the initial window being added
      // After startup, refresh the window list to include the new window
      if (this.hasDisplayedInitialList) {
        console.log(`Window added: ${windowId}`)
        // Wait a bit for claude to start, then refresh
        setTimeout(() => {
          console.log('Checking for claude in new window...')
          this.refreshWindowList()
        }, 500)
      }
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
      // Format: %window-renamed @window_id new-name
      const windowId = parts[1]
      const newName = parts.slice(2).join(' ')
      const info = this.windowIdMap.get(windowId)
      if (info) {
        const key = `${info.session}:${info.index}`
        const existingWindow = this.windows.get(key)
        if (existingWindow) {
          this.windows.set(key, { ...existingWindow, name: newName })
          console.log(`Window renamed: ${key} to ${newName}`)
          // Display the updated window list
          this.displayWindowList()
        }
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
      // Format: %output %pane_id content
      if (parts.length >= 2) {
        const paneId = parts[1]
        const windowKey = this.paneToWindowMap.get(paneId)
        if (windowKey) {
          const window = this.windows.get(windowKey)
          if (window) {
            console.log(`[${window.name}]`)
          }
        }
      }
      return
    } else if (this.inCommandOutput && !parts[0].startsWith('%')) {
      // Check if this is a claude status check
      if (line.startsWith('CHECK ')) {
        const checkMatch = line.match(/^CHECK ([^:]+):(\d+) (.+)$/)
        if (checkMatch) {
          const [_, sessionName, windowIndex, command] = checkMatch
          const key = `${sessionName}:${windowIndex}`

          // Mark that this window has claude if the command is claude
          if (command === 'claude') {
            this.claudeCheckResults.set(key, true)
          }
        }
      } else {
        // This is pane list output from list-panes command
        // Format: session:index: name [@@window_id] %%pane_id pid command
        const match = line.match(
          /^([^:]+):(\d+): (.+) \[@@(\d+)\] (%%\d+) (\d+) (.+)$/,
        )
        if (match) {
          const [
            _,
            sessionName,
            windowIndex,
            windowName,
            windowId,
            paneId,
            pid,
            command,
          ] = match
          const key = `${sessionName}:${windowIndex}`

          // Map pane ID to window key
          this.paneToWindowMap.set(paneId, key)

          // Check if this pane or window already exists
          const existingWindow = this.windows.get(key)
          const hasClaude =
            command === 'claude' || (existingWindow?.hasClaude ?? false)

          this.windows.set(key, {
            name: windowName.trim(),
            hasClaude,
            firstSeen: existingWindow?.firstSeen ?? Date.now(),
          })
          this.windowIdMap.set(`@${windowId}`, {
            session: sessionName,
            index: windowIndex,
          })
        }
      }
    }

    // Display current window list after window close
    if (parts[0] === '%window-close') {
      setTimeout(() => this.displayWindowList(), 100)
    }
  }

  private displayWindowList() {
    console.log('\nCurrent windows:')
    const sorted = Array.from(this.windows.entries()).sort()
    for (const [key, window] of sorted) {
      const claudeIndicator = window.hasClaude ? ' [claude]' : ''
      console.log(`  ${key} - ${window.name}${claudeIndicator}`)
    }
  }

  private async refreshWindowList() {
    if (this.controlModeProcess && this.controlModeProcess.stdin) {
      // Clear existing data before refresh
      this.windows.clear()
      this.windowIdMap.clear()
      this.paneToWindowMap.clear()
      this.controlModeProcess.stdin.write(
        'list-panes -a -F "#{session_name}:#{window_index}: #{window_name} [@#{window_id}] %#{pane_id} #{pane_pid} #{pane_current_command}"\n',
      )
      // The window list will be displayed when the %end marker is received
    }
  }

  private processClaudeCheckResults() {
    let hasChanges = false

    // Update all windows based on check results
    for (const [key, window] of this.windows) {
      const hadClaude = window.hasClaude
      const hasClaude = this.claudeCheckResults.has(key)

      if (hasClaude !== hadClaude) {
        this.windows.set(key, { ...window, hasClaude })
        hasChanges = true
      }
    }

    // Only redisplay if something changed
    if (hasChanges) {
      this.displayWindowList()
    }
  }

  private startClaudeChecking() {
    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
    }

    // Check every second
    this.claudeCheckInterval = setInterval(() => {
      this.checkForClaudeUpdates()
    }, 1000)
  }

  private async checkForClaudeUpdates() {
    if (
      !this.controlModeProcess ||
      !this.controlModeProcess.stdin ||
      !this.hasDisplayedInitialList
    ) {
      return
    }

    const now = Date.now()
    let hasNewWindows = false

    // Check if we have any windows less than 20 seconds old
    for (const [_, window] of this.windows) {
      if (now - window.firstSeen < 20000) {
        hasNewWindows = true
        break
      }
    }

    // If no new windows and we're checking every second, switch to 3-second interval
    if (!hasNewWindows && this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = setInterval(() => {
        this.checkForClaudeUpdates()
      }, 3000)
    }

    // Clear previous results and request updated pane info to check for claude
    this.claudeCheckResults.clear()
    this.isCheckingClaude = true
    this.controlModeProcess.stdin.write(
      'list-panes -a -F "CHECK #{session_name}:#{window_index} #{pane_current_command}"\n',
    )
  }

  private shutdown() {
    console.log('\nShutting down...')
    this.isShuttingDown = true

    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = null
    }

    if (this.controlModeProcess) {
      this.controlModeProcess.kill()
      this.controlModeProcess = null
    }

    process.exit(0)
  }
}
