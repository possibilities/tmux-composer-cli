import { spawn } from 'child_process'
import { promisify } from 'util'

const sleep = promisify(setTimeout)

export class TmuxAutomatorNew {
  private controlModeProcess: any = null
  private currentSessionName: string | null = null
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

  constructor() {}

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
      // Store both formats - with and without $ prefix
      this.currentSessionName = sessionId.trim()
      console.log(
        `Monitoring session: ${sessionName.trim()} (ID: ${this.currentSessionName})`,
      )
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
      console.log('Connecting to tmux control mode...')

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
      console.log(`Control mode process exited with code ${code}`)
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
          // Only display if the pane list has actually changed
          const currentHash = this.computePaneListHash()
          if (currentHash !== this.lastPaneListHash) {
            this.displayPaneList()
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
          (!info || info.session === this.currentSessionName)
        ) {
          console.log(`Window added: ${windowId}`)
          setTimeout(() => {
            console.log('Checking for claude in new window...')
            this.refreshPaneList().catch(error => {
              console.error('Failed to refresh pane list:', error)
            })
          }, 500)
        }
      } else if (parts[0] === '%window-close') {
        const windowId = parts[1]
        const info = this.windowIdMap.get(windowId)
        if (info && info.session === this.currentSessionName) {
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
        const windowId = parts[1]
        const newName = parts.slice(2).join(' ')
        const info = this.windowIdMap.get(windowId)
        if (info && info.session === this.currentSessionName) {
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
          this.displayPaneList()
        }
      } else if (parts[0] === '%layout-change') {
        const windowId = parts[1]
        const windowLayout = parts[2]
        const layoutMatch = windowLayout.match(/,(\d+)x(\d+),/)
        if (layoutMatch) {
          const [_, width, height] = layoutMatch
          const info = this.windowIdMap.get(windowId)
          if (info && info.session === this.currentSessionName) {
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
              console.log(`Window resized: ${key} to ${widthNum}x${heightNum}`)
              this.displayPaneList()
            }
          }
        }
        console.log(`Layout changed for window ${windowId}`)
        setTimeout(() => {
          this.refreshPaneList().catch(error => {
            console.error('Failed to refresh pane list:', error)
          })
        }, 100)
      } else if (parts[0] === '%session-window-changed') {
        const sessionId = parts[1]
        const windowId = parts[2]
        console.log(
          `Active window changed in session ${sessionId} to window ${windowId}`,
        )
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
              sessionName === this.currentSessionName ||
              sessionName === this.currentSessionName.replace('$', '') ||
              '$' + sessionName === this.currentSessionName
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
        setTimeout(() => this.displayPaneList(), 100)
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
          '%sessions-changed',
          '%output',
          '%exit',
          '%error',
        ].includes(parts[0])
      ) {
        console.log(`[DEBUG] Unhandled event: ${line}`)
        // For any unhandled event, refresh the pane list
        setTimeout(() => {
          this.refreshPaneList().catch(error => {
            console.error('Failed to refresh pane list:', error)
          })
        }, 100)
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

  private displayPaneList() {
    try {
      // Update the hash since we've already checked it before calling this method
      this.lastPaneListHash = this.computePaneListHash()

      console.log('\nCurrent panes in this session:')
      const panesByWindow = new Map<string, Array<[string, any]>>()

      for (const [paneId, pane] of this.panes.entries()) {
        const windowKey = `${pane.sessionName}:${pane.windowIndex}`
        if (!panesByWindow.has(windowKey)) {
          panesByWindow.set(windowKey, [])
        }
        panesByWindow.get(windowKey)!.push([paneId, pane])
      }

      const sortedWindows = Array.from(panesByWindow.keys()).sort()
      for (const windowKey of sortedWindows) {
        const panes = panesByWindow.get(windowKey)!
        panes.sort(
          (a, b) => parseInt(a[1].paneIndex) - parseInt(b[1].paneIndex),
        )

        for (const [paneId, pane] of panes) {
          const displayKey = `${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}`
          const sizeIndicator = ` [${pane.width}x${pane.height}]`
          const claudeIndicator = pane.hasClaude ? ' [claude]' : ''
          console.log(
            `  ${displayKey} - ${pane.windowName} - ${pane.command}${sizeIndicator}${claudeIndicator}`,
          )
        }
      }
    } catch (error) {
      console.error('Error displaying pane list:', error)
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
      this.displayPaneList()
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
    console.log('\nShutting down...')
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
