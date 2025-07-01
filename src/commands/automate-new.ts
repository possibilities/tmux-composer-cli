import { spawn } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'

const sleep = promisify(setTimeout)

export class TmuxAutomatorNew extends EventEmitter {
  private controlModeProcess: any = null
  private currentSessionName: string | null = null
  private currentSessionId: string | null = null
  private isConnected = false
  private isShuttingDown = false
  private panes = new Map<
    string,
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
  private paneToKeyMap = new Map<string, string>()
  private inCommandOutput = false
  private hasDisplayedInitialList = false
  private claudeCheckInterval: NodeJS.Timeout | null = null
  private isCheckingClaude = false
  private claudeCheckResults = new Map<string, boolean>()
  private lastPaneListHash = ''
  private forceEmitAfterRefresh = false

  constructor() {
    super()

    // Set up default console logger
    this.on('event', event => {
      console.log(JSON.stringify(event))
    })
  }

  private emitEvent(eventName: string, data: any) {
    this.emit('event', {
      event: eventName,
      data,
    })
  }

  async start() {
    console.log('Starting tmux control mode monitor for current session...')

    // Get current session ID (which is what control mode returns)
    try {
      const sessionName = await this.runCommand(
        'tmux display-message -p "#{session_name}"',
      )
      const sessionId = await this.runCommand(
        'tmux display-message -p "#{session_id}"',
      )
      // Store both session name and ID
      this.currentSessionId = sessionId.trim()
      this.currentSessionName = sessionName.trim()
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

      // Use control mode within current session
      const args = ['-C']
      // Connecting to tmux control mode

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
        const lines = output.split('\n').filter(line => line.trim())

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
      // Control mode process exited with code ${code}
      this.cleanupControlMode()
    }

    const errorHandler = (error: Error) => {
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

    this.controlModeProcess.stdout.on('data', stdoutHandler)
    this.controlModeProcess.stderr.on('data', stderrHandler)
    this.controlModeProcess.on('close', closeHandler)
    this.controlModeProcess.on('error', errorHandler)

    this.isConnected = true

    await sleep(100)

    try {
      // List all panes (we'll filter by session later)
      await this.writeToControlMode(
        `list-panes -a -F "PANE %#{pane_id} #{session_id}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id}"\n`,
      )

      this.startClaudeChecking()
      return true
    } catch (error) {
      console.error('Failed to initialize control mode:', error)
      this.cleanupControlMode()
      return false
    }
  }

  private async writeToControlMode(data: string): Promise<void> {
    if (!this.controlModeProcess || !this.controlModeProcess.stdin) {
      throw new Error('Control mode process not available')
    }

    if (this.controlModeProcess.stdin.destroyed) {
      throw new Error('Control mode stdin is destroyed')
    }

    return new Promise((resolve, reject) => {
      this.controlModeProcess.stdin.write(data, error => {
        if (error) {
          if (error.code === 'EPIPE') {
            console.error('EPIPE error: tmux connection lost')
            this.cleanupControlMode()
          }
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  private cleanupControlMode() {
    this.isConnected = false

    if (this.controlModeProcess) {
      this.controlModeProcess.stdout.removeAllListeners()
      this.controlModeProcess.stderr.removeAllListeners()
      this.controlModeProcess.removeAllListeners()

      if (
        this.controlModeProcess.stdin &&
        !this.controlModeProcess.stdin.destroyed
      ) {
        this.controlModeProcess.stdin.end()
      }

      this.controlModeProcess = null
    }

    this.panes.clear()
    this.windowIdMap.clear()
    this.paneToKeyMap.clear()
    this.hasDisplayedInitialList = false
    this.lastPaneListHash = ''

    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = null
    }
  }

  private processControlModeOutput(line: string) {
    try {
      const parts = line.split(' ')

      if (parts[0] === '%begin') {
        this.inCommandOutput = true
        return
      } else if (parts[0] === '%end') {
        this.inCommandOutput = false
        if (this.isCheckingClaude) {
          this.isCheckingClaude = false
          this.processClaudeCheckResults()
          return
        }
        if (this.panes.size > 0) {
          if (!this.hasDisplayedInitialList) {
            this.hasDisplayedInitialList = true
          }
          // Emit if the pane list has changed or if forced after refresh
          const currentHash = this.computePaneListHash()
          if (
            currentHash !== this.lastPaneListHash ||
            this.forceEmitAfterRefresh
          ) {
            this.emitPanesChanged()
            this.forceEmitAfterRefresh = false
          }
        }
        return
      }

      if (parts[0] === '%window-add') {
        const windowId = parts[1]
        // Only process if it's from current session
        const info = this.windowIdMap.get(windowId)
        if (
          this.hasDisplayedInitialList &&
          (!info || info.session === this.currentSessionId)
        ) {
          // Window added, refresh pane list
          setTimeout(() => {
            this.refreshPaneList().catch(error => {
              console.error('Failed to refresh pane list:', error)
            })
          }, 500)
        }
      } else if (parts[0] === '%window-close') {
        const windowId = parts[1]
        const info = this.windowIdMap.get(windowId)
        if (info && info.session === this.currentSessionId) {
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
          // Window closed, panes removed
        }
      } else if (parts[0] === '%window-renamed') {
        const windowId = parts[1]
        const newName = parts.slice(2).join(' ')
        const info = this.windowIdMap.get(windowId)
        if (info && info.session === this.currentSessionId) {
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
          // Window renamed
          this.emitPanesChanged()
        }
      } else if (parts[0] === '%layout-change') {
        const windowId = parts[1]
        const windowLayout = parts[2]
        const layoutMatch = windowLayout.match(/,(\d+)x(\d+),/)
        if (layoutMatch) {
          const [_, width, height] = layoutMatch
          const info = this.windowIdMap.get(windowId)
          if (info && info.session === this.currentSessionId) {
            const key = `${info.session}:${info.index}`
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
              // Window resized
              this.displayPaneList()
            }
          }
        }
        // Layout changed
        setTimeout(() => {
          this.refreshPaneList().catch(error => {
            console.error('Failed to refresh pane list:', error)
          })
        }, 100)
      } else if (parts[0] === '%session-window-changed') {
        const sessionId = parts[1]
        const windowId = parts[2]
        // Active window changed
      } else if (parts[0] === '%session-changed') {
        // Session focus changed - only log if it's our session
        const sessionId = parts[1]
        if (
          sessionId === this.currentSessionId ||
          sessionId === '$' + this.currentSessionId.replace('$', '')
        ) {
          // Session focus changed
        }
      } else if (parts[0] === '%sessions-changed') {
        this.refreshPaneList().catch(error => {
          console.error('Failed to refresh pane list:', error)
        })
      } else if (this.inCommandOutput && !parts[0].startsWith('%')) {
        if (line.startsWith('CHECK ')) {
          const checkMatch = line.match(/^CHECK (%%\d+) (.+)$/)
          if (checkMatch) {
            const [_, paneId, command] = checkMatch

            if (command === 'claude') {
              this.claudeCheckResults.set(paneId, true)
            }
          }
        } else if (line.startsWith('PANE ')) {
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

            const existingPane = this.panes.get(paneId)
            const hasClaude = command === 'claude'

            // Only track panes from current session
            // Compare both with and without $ prefix
            const sessionMatches =
              sessionName === this.currentSessionId ||
              sessionName === this.currentSessionId.replace('$', '') ||
              '$' + sessionName === this.currentSessionId
            if (sessionMatches) {
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

              this.paneToKeyMap.set(paneId, displayKey)

              this.windowIdMap.set(windowId, {
                session: sessionName,
                index: windowIndex,
              })
            }
          }
        }
      }

      if (parts[0] === '%window-close') {
        setTimeout(() => this.emitPanesChanged(), 100)
      }

      // Handle window-pane-changed (fired when panes are split/changed)
      if (parts[0] === '%window-pane-changed') {
        setTimeout(() => {
          this.refreshPaneList().catch(error => {
            console.error('Failed to refresh pane list:', error)
          })
        }, 100)
      }

      // Handle unlinked-window-add (fired when new window is created)
      if (parts[0] === '%unlinked-window-add') {
        setTimeout(() => {
          this.refreshPaneList().catch(error => {
            console.error('Failed to refresh pane list:', error)
          })
        }, 100)
      }

      // Log any unhandled events starting with %
      if (
        parts[0].startsWith('%') &&
        ![
          '%begin',
          '%end',
          '%window-add',
          '%window-close',
          '%window-renamed',
          '%layout-change',
          '%session-window-changed',
          '%session-changed',
          '%sessions-changed',
          '%output',
          '%exit',
          '%error',
          '%unlinked-window-renamed',
          '%window-pane-changed',
          '%unlinked-window-add',
        ].includes(parts[0])
      ) {
        // Unhandled event: ${line}
      }
    } catch (error) {
      console.error('Error processing control mode output:', error)
      console.error('Line that caused error:', line)
    }
  }

  private computePaneListHash(): string {
    // Create a deterministic string representation of the current pane state
    const paneData: string[] = []
    for (const [paneId, pane] of this.panes.entries()) {
      paneData.push(
        `${paneId}:${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}:${pane.windowName}:${pane.command}:${pane.width}x${pane.height}:${pane.hasClaude}`,
      )
    }
    return paneData.sort().join('|')
  }

  private emitPanesChanged() {
    try {
      // Update the hash since we've already checked it before calling this method
      this.lastPaneListHash = this.computePaneListHash()

      // Build windows structure
      const windowsMap = new Map<string, any>()

      for (const [paneId, pane] of this.panes.entries()) {
        const windowKey = `${pane.sessionName}:${pane.windowIndex}`

        if (!windowsMap.has(windowKey)) {
          const windowInfo = this.windowIdMap.values().next().value
          const windowId = Array.from(this.windowIdMap.entries()).find(
            ([_, info]) =>
              info.session === pane.sessionName &&
              info.index === pane.windowIndex,
          )?.[0]

          windowsMap.set(windowKey, {
            windowId: windowId || '',
            windowIndex: pane.windowIndex,
            windowName: pane.windowName,
            panes: [],
          })
        }

        windowsMap.get(windowKey).panes.push({
          paneId,
          paneIndex: pane.paneIndex,
          command: pane.command,
          width: pane.width,
          height: pane.height,
          hasClaude: pane.hasClaude,
        })
      }

      // Sort windows and panes
      const windows = Array.from(windowsMap.values()).sort(
        (a, b) => parseInt(a.windowIndex) - parseInt(b.windowIndex),
      )

      for (const window of windows) {
        window.panes.sort(
          (a: any, b: any) => parseInt(a.paneIndex) - parseInt(b.paneIndex),
        )
      }

      // Emit the event
      this.emitEvent('panes-changed', {
        sessionId: this.currentSessionId,
        sessionName: this.currentSessionName,
        windows,
      })
    } catch (error) {
      console.error('Error emitting panes changed:', error)
    }
  }

  private async refreshPaneList() {
    if (
      this.controlModeProcess &&
      this.controlModeProcess.stdin &&
      !this.controlModeProcess.stdin.destroyed
    ) {
      try {
        this.panes.clear()
        this.windowIdMap.clear()
        this.paneToKeyMap.clear()
        this.lastPaneListHash = ''
        this.forceEmitAfterRefresh = true // Force emit after refresh completes
        await this.writeToControlMode(
          `list-panes -a -F "PANE %#{pane_id} #{session_id}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id}"\n`,
        )
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

    for (const [paneId, pane] of this.panes) {
      const hadClaude = pane.hasClaude
      const hasClaude = this.claudeCheckResults.has(paneId)

      if (hasClaude !== hadClaude) {
        this.panes.set(paneId, { ...pane, hasClaude })
        hasChanges = true
      }
    }

    if (hasChanges) {
      this.emitPanesChanged()
    }
  }

  private startClaudeChecking() {
    try {
      if (this.claudeCheckInterval) {
        clearInterval(this.claudeCheckInterval)
      }

      this.claudeCheckInterval = setInterval(() => {
        this.checkForClaudeUpdates().catch(error => {
          console.error('Error in Claude check interval:', error)
        })
      }, 1000)
    } catch (error) {
      console.error('Failed to start Claude checking:', error)
    }
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

    for (const [_, pane] of this.panes) {
      if (now - pane.firstSeen < 20000) {
        hasNewPanes = true
        break
      }
    }

    if (!hasNewPanes && this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = setInterval(() => {
        this.checkForClaudeUpdates().catch(error => {
          console.error('Error in Claude check interval:', error)
        })
      }, 3000)
    }

    try {
      this.claudeCheckResults.clear()
      this.isCheckingClaude = true
      await this.writeToControlMode(
        `list-panes -a -F "CHECK %#{pane_id} #{pane_current_command}"\n`,
      )
    } catch (error) {
      console.error('Failed to check for Claude updates:', error)
      if (error.code === 'EPIPE') {
        this.cleanupControlMode()
      }
    }
  }

  private shutdown() {
    this.isShuttingDown = true

    if (this.claudeCheckInterval) {
      clearInterval(this.claudeCheckInterval)
      this.claudeCheckInterval = null
    }

    if (this.controlModeProcess) {
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

    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')

    process.exit(0)
  }
}
