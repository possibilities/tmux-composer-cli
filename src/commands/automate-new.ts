import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import { getTmuxSocketString } from '../core/tmux-socket.js'
import { socketExists } from '../core/tmux-utils.js'
import { spawn } from 'child_process'
import { promisify } from 'util'

const sleep = promisify(setTimeout)

interface AutomateNewOptions extends TmuxSocketOptions {}

export class TmuxAutomatorNew {
  private socketOptions: TmuxSocketOptions
  private controlModeProcess: any = null
  private isConnected = false
  private isShuttingDown = false
  private panes = new Map<
    string, // pane_id
    {
      sessionName: string
      windowIndex: string
      paneIndex: string
      windowName: string
      command: string
      hasClaude: boolean
      firstSeen: number
      width: number
      height: number
    }
  >()
  private windowIdMap = new Map<string, { session: string; index: string }>()
  private paneToKeyMap = new Map<string, string>() // Maps pane_id to display key
  private inCommandOutput = false
  private hasDisplayedInitialList = false
  private claudeCheckInterval: NodeJS.Timeout | null = null
  private isCheckingClaude = false
  private claudeCheckResults = new Map<string, boolean>()

  constructor(options: AutomateNewOptions = {}) {
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  async start() {
    console.log('Starting tmux control mode monitor...')

    this.setupSignalHandlers()
    await this.monitorAndConnect()
  }

  private setupSignalHandlers() {
    const signalHandler = () => this.shutdown()
    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)
  }

  private async monitorAndConnect() {
    let waitingMessageShown = false
    while (!this.isShuttingDown) {
      if (!socketExists(this.socketOptions)) {
        if (this.isConnected) {
          console.log('Tmux server disconnected. Waiting for reconnection...')
          this.isConnected = false
          waitingMessageShown = true
          // Clear pane data on disconnect
          this.panes.clear()
          this.windowIdMap.clear()
          this.paneToKeyMap.clear()
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
        this.panes.clear()
        this.windowIdMap.clear()
        this.paneToKeyMap.clear()
        this.hasDisplayedInitialList = false
        await this.connectControlMode()
      }

      await sleep(1000)
    }
  }

  private async connectControlMode() {
    if (this.controlModeProcess) {
      // Clean up existing process properly
      this.controlModeProcess.stdout.removeAllListeners()
      this.controlModeProcess.stderr.removeAllListeners()
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

    const socketArgs = getTmuxSocketString(this.socketOptions)
    const args = socketArgs.split(' ').concat(['-C', 'attach'])

    console.log(`Connecting with args: tmux ${args.join(' ')}`)

    this.controlModeProcess = spawn('tmux', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdoutHandler = (data: Buffer) => {
      const output = data.toString()
      const lines = output.split('\n').filter(line => line.trim())

      for (const line of lines) {
        this.processControlModeOutput(line)
      }
    }

    const stderrHandler = (data: Buffer) => {
      console.error('Control mode error:', data.toString())
    }

    const closeHandler = (code: number) => {
      console.log(`Control mode process exited with code ${code}`)
      this.cleanupControlMode()
    }

    const errorHandler = (error: Error) => {
      console.error('Failed to start control mode:', error)
      this.isConnected = false
    }

    this.controlModeProcess.stdout.on('data', stdoutHandler)
    this.controlModeProcess.stderr.on('data', stderrHandler)
    this.controlModeProcess.on('close', closeHandler)
    this.controlModeProcess.on('error', errorHandler)

    this.isConnected = true

    // Wait a bit for connection to establish
    await sleep(100)

    try {
      // Request list of all panes with detailed info
      this.controlModeProcess.stdin.write(
        'list-panes -a -F "PANE %#{pane_id} #{session_name}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id}"\n',
      )

      // Start periodic claude checking
      this.startClaudeChecking()
    } catch (error) {
      console.error('Failed to initialize control mode:', error)
      this.cleanupControlMode()
    }
  }

  private cleanupControlMode() {
    this.isConnected = false

    // Remove all event listeners from the process before nulling it
    if (this.controlModeProcess) {
      this.controlModeProcess.stdout.removeAllListeners()
      this.controlModeProcess.stderr.removeAllListeners()
      this.controlModeProcess.removeAllListeners()

      // Close stdin to prevent EPIPE errors
      if (
        this.controlModeProcess.stdin &&
        !this.controlModeProcess.stdin.destroyed
      ) {
        this.controlModeProcess.stdin.end()
      }

      this.controlModeProcess = null
    }

    // Clear pane data when control mode closes
    this.panes.clear()
    this.windowIdMap.clear()
    this.paneToKeyMap.clear()
    this.hasDisplayedInitialList = false

    // Stop claude checking
    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = null
    }
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
      // Display pane list after command output if we have panes
      if (this.panes.size > 0) {
        // On startup, only display once
        if (!this.hasDisplayedInitialList) {
          this.hasDisplayedInitialList = true
        }
        this.displayPaneList()
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
          this.refreshPaneList()
        }, 500)
      }
    } else if (parts[0] === '%window-close') {
      // Format: %window-close @window_id
      const windowId = parts[1]
      const info = this.windowIdMap.get(windowId)
      if (info) {
        // Remove all panes belonging to this window
        const panesToRemove: string[] = []
        for (const [paneId, pane] of this.panes) {
          if (
            pane.sessionName === info.session &&
            pane.windowIndex === info.index
          ) {
            panesToRemove.push(paneId)
          }
        }

        for (const paneId of panesToRemove) {
          this.panes.delete(paneId)
          this.paneToKeyMap.delete(paneId)
        }

        this.windowIdMap.delete(windowId)
        console.log(
          `Window closed: ${info.session}:${info.index} (removed ${panesToRemove.length} panes)`,
        )
      }
    } else if (parts[0] === '%window-renamed') {
      // Format: %window-renamed @window_id new-name
      const windowId = parts[1]
      const newName = parts.slice(2).join(' ')
      const info = this.windowIdMap.get(windowId)
      if (info) {
        // Update window name for all panes in this window
        let updatedCount = 0
        for (const [paneId, pane] of this.panes) {
          if (
            pane.sessionName === info.session &&
            pane.windowIndex === info.index
          ) {
            this.panes.set(paneId, { ...pane, windowName: newName })
            updatedCount++
          }
        }
        console.log(
          `Window renamed: ${info.session}:${info.index} to ${newName} (updated ${updatedCount} panes)`,
        )
        // Display the updated pane list
        this.displayPaneList()
      }
    } else if (parts[0] === '%layout-change') {
      // Format: %layout-change window-id window-layout window-visible-layout window-flags
      const windowId = parts[1]
      const windowLayout = parts[2]
      // Parse dimensions from layout string (e.g. "b25f,80x24,0,0,2")
      const layoutMatch = windowLayout.match(/,(\d+)x(\d+),/)
      if (layoutMatch) {
        const [_, width, height] = layoutMatch
        const info = this.windowIdMap.get(windowId)
        if (info) {
          const key = `${info.session}:${info.index}`
          // Update dimensions for all panes in this window
          const widthNum = parseInt(width, 10)
          const heightNum = parseInt(height, 10)
          let hasChanges = false

          for (const [paneId, pane] of this.panes) {
            if (
              pane.sessionName === info.session &&
              pane.windowIndex === info.index
            ) {
              if (pane.width !== widthNum || pane.height !== heightNum) {
                this.panes.set(paneId, {
                  ...pane,
                  width: widthNum,
                  height: heightNum,
                })
                hasChanges = true
              }
            }
          }

          if (hasChanges) {
            console.log(`Window resized: ${key} to ${widthNum}x${heightNum}`)
            this.displayPaneList()
          }
        }
      }
      // Refresh pane list on any layout change (splits, closes, resizes)
      console.log(`Layout changed for window ${windowId}`)
      // Small delay to ensure tmux has updated its state
      setTimeout(() => {
        this.refreshPaneList()
      }, 100)
    } else if (parts[0] === '%session-window-changed') {
      const sessionId = parts[1]
      const windowId = parts[2]
      console.log(
        `Active window changed in session ${sessionId} to window ${windowId}`,
      )
    } else if (parts[0] === '%sessions-changed') {
      // Sessions list changed, refresh windows
      this.refreshPaneList()
    } else if (parts[0] === '%output') {
      // Format: %output %pane_id content
      if (parts.length >= 2) {
        const paneId = parts[1]
        const displayKey = this.paneToKeyMap.get(paneId)
        const pane = this.panes.get(paneId)
        if (displayKey && pane) {
          console.log(`[${displayKey} - ${pane.windowName} - ${pane.command}]`)
        }
      }
      return
    } else if (this.inCommandOutput && !parts[0].startsWith('%')) {
      // Check if this is a claude status check
      if (line.startsWith('CHECK ')) {
        const checkMatch = line.match(/^CHECK (%%\d+) (.+)$/)
        if (checkMatch) {
          const [_, paneId, command] = checkMatch

          // Mark that this pane has claude if the command is claude
          if (command === 'claude') {
            this.claudeCheckResults.set(paneId, true)
          }
        }
      } else if (line.startsWith('PANE ')) {
        // This is pane list output from list-panes command
        // Format: PANE %pane_id session:window.pane windowName command widthxheight @window_id
        const match = line.match(
          /^PANE (%%\d+) ([^:]+):(\d+)\.(\d+) (.+?) ([^ ]+) (\d+)x(\d+) (@@\d+)$/,
        )
        if (match) {
          const [
            _,
            paneId,
            sessionName,
            windowIndex,
            paneIndex,
            windowName,
            command,
            width,
            height,
            windowId,
          ] = match
          const displayKey = `${sessionName}:${windowIndex}.${paneIndex}`

          // Store pane info
          const existingPane = this.panes.get(paneId)
          const hasClaude = command === 'claude'

          this.panes.set(paneId, {
            sessionName,
            windowIndex,
            paneIndex,
            windowName: windowName.trim(),
            command,
            hasClaude,
            firstSeen: existingPane?.firstSeen ?? Date.now(),
            width: parseInt(width, 10),
            height: parseInt(height, 10),
          })

          // Map pane ID to display key for easy lookup
          this.paneToKeyMap.set(paneId, displayKey)

          // Keep window ID mapping for window events
          this.windowIdMap.set(windowId, {
            session: sessionName,
            index: windowIndex,
          })
        }
      }
    }

    // Display current window list after window close
    if (parts[0] === '%window-close') {
      setTimeout(() => this.displayPaneList(), 100)
    }
  }

  private displayPaneList() {
    console.log('\nCurrent panes:')
    // Group panes by session:window for better display
    const panesByWindow = new Map<string, Array<[string, any]>>()

    for (const [paneId, pane] of this.panes.entries()) {
      const windowKey = `${pane.sessionName}:${pane.windowIndex}`
      if (!panesByWindow.has(windowKey)) {
        panesByWindow.set(windowKey, [])
      }
      panesByWindow.get(windowKey)!.push([paneId, pane])
    }

    // Sort windows and display panes
    const sortedWindows = Array.from(panesByWindow.keys()).sort()
    for (const windowKey of sortedWindows) {
      const panes = panesByWindow.get(windowKey)!
      // Sort panes by pane index
      panes.sort((a, b) => parseInt(a[1].paneIndex) - parseInt(b[1].paneIndex))

      for (const [paneId, pane] of panes) {
        const displayKey = `${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}`
        const sizeIndicator = ` [${pane.width}x${pane.height}]`
        const claudeIndicator = pane.hasClaude ? ' [claude]' : ''
        console.log(
          `  ${displayKey} - ${pane.windowName} - ${pane.command}${sizeIndicator}${claudeIndicator}`,
        )
      }
    }
  }

  private async refreshPaneList() {
    if (
      this.controlModeProcess &&
      this.controlModeProcess.stdin &&
      !this.controlModeProcess.stdin.destroyed
    ) {
      try {
        // Clear existing data before refresh
        this.panes.clear()
        this.windowIdMap.clear()
        this.paneToKeyMap.clear()
        this.controlModeProcess.stdin.write(
          'list-panes -a -F "PANE %#{pane_id} #{session_name}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id}"\n',
        )
        // The pane list will be displayed when the %end marker is received
      } catch (error) {
        console.error('Failed to refresh pane list:', error)
        if (error.code === 'EPIPE') {
          this.cleanupControlMode()
        }
      }
    }
  }

  private processClaudeCheckResults() {
    let hasChanges = false

    // Update all panes based on check results
    for (const [paneId, pane] of this.panes) {
      const hadClaude = pane.hasClaude
      const hasClaude = this.claudeCheckResults.has(paneId)

      if (hasClaude !== hadClaude) {
        this.panes.set(paneId, { ...pane, hasClaude })
        hasChanges = true
      }
    }

    // Only redisplay if something changed
    if (hasChanges) {
      this.displayPaneList()
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
      !this.hasDisplayedInitialList ||
      this.controlModeProcess.stdin.destroyed
    ) {
      return
    }

    const now = Date.now()
    let hasNewPanes = false

    // Check if we have any panes less than 20 seconds old
    for (const [_, pane] of this.panes) {
      if (now - pane.firstSeen < 20000) {
        hasNewPanes = true
        break
      }
    }

    // If no new panes and we're checking every second, switch to 3-second interval
    if (!hasNewPanes && this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = setInterval(() => {
        this.checkForClaudeUpdates()
      }, 3000)
    }

    try {
      // Clear previous results and request updated pane info to check for claude
      this.claudeCheckResults.clear()
      this.isCheckingClaude = true
      this.controlModeProcess.stdin.write(
        'list-panes -a -F "CHECK %#{pane_id} #{pane_current_command}"\n',
      )
    } catch (error) {
      console.error('Failed to check for Claude updates:', error)
      if (error.code === 'EPIPE') {
        this.cleanupControlMode()
      }
    }
  }

  private shutdown() {
    console.log('\nShutting down...')
    this.isShuttingDown = true

    // Clean up intervals
    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = null
    }

    // Clean up control mode process
    if (this.controlModeProcess) {
      // Remove listeners before killing to prevent errors
      this.controlModeProcess.stdout.removeAllListeners()
      this.controlModeProcess.stderr.removeAllListeners()
      this.controlModeProcess.removeAllListeners()

      // Close stdin before killing
      if (
        this.controlModeProcess.stdin &&
        !this.controlModeProcess.stdin.destroyed
      ) {
        this.controlModeProcess.stdin.end()
      }

      // Kill the process
      this.controlModeProcess.kill()
      this.controlModeProcess = null
    }

    // Remove signal handlers to prevent duplicate handlers on restart
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')

    process.exit(0)
  }
}
