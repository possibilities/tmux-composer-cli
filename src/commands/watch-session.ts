import { spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { throttle } from '../core/throttle.js'
import { enableZmqPublishing } from '../core/zmq-publisher.js'
import { getTmuxSocketPath, getTmuxSocketArgs } from '../core/tmux-socket.js'
import type { SessionChangedData, TmuxEvent } from '../core/events.js'

const sleep = promisify(setTimeout)

interface PaneInfo {
  sessionName: string
  windowIndex: string
  paneIndex: string
  windowName: string
  command: string
  firstSeen: number
  width: number
  height: number
  isActive: boolean
  windowActive: boolean
}

interface WindowInfo {
  session: string
  index: string
}

class TmuxControlModeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'TmuxControlModeError'
  }
}

interface NodeError extends Error {
  code?: string
}

function normalizeSessionId(id: string): string {
  return id.startsWith('$') ? id : `$${id}`
}

export class TmuxSessionWatcher extends EventEmitter {
  private controlModeProcess: ChildProcess | null = null
  private currentSessionName: string | null = null
  private currentSessionId: string | null = null
  private panes = new Map<string, PaneInfo>()
  private windowIdMap = new Map<string, WindowInfo>()
  private paneToKeyMap = new Map<string, string>()
  private inCommandOutput = false
  private hasDisplayedInitialList = false
  private lastPaneListHash = ''
  private forceEmitAfterRefresh = false
  private resizeHandler: (() => void) | null = null
  private throttledRefreshPaneList: () => void
  private readonly sessionId = randomUUID()

  constructor() {
    super()

    this.on('event', (event: TmuxEvent) => {
      console.log(JSON.stringify(event))
    })

    this.throttledRefreshPaneList = throttle(() => {
      this.refreshPaneList().catch(error => {
        console.error('Failed to refresh pane list:', error)
      })
    }, 150)
  }

  private emitEvent(
    eventName: 'session-changed',
    data: SessionChangedData,
  ): void {
    const event: TmuxEvent<'session-changed'> = {
      event: eventName,
      data,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    }
    this.emit('event', event)
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
      this.currentSessionId = normalizeSessionId(sessionId.trim())
      this.currentSessionName = sessionName.trim()
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
        script: 'watch-session',
        sessionId: this.currentSessionId,
        sessionName: this.currentSessionName,
        socketPath,
      },
    })

    this.setupSignalHandlers()
    this.setupResizeHandler()
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

  private setupResizeHandler() {
    const handler = () => {
      this.throttledRefreshPaneList()
    }

    this.resizeHandler = handler

    if (process.stdout && process.stdout.on) {
      process.stdout.on('resize', handler)
    }

    process.on('SIGWINCH', handler)
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

    await sleep(100)

    try {
      await this.writeToControlMode(
        `list-panes -s -F "PANE %#{pane_id} #{session_id}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id} #{pane_active} #{window_active}"\n`,
      )

      return true
    } catch (error) {
      console.error('Failed to initialize control mode:', error)
      this.cleanupControlMode()
      return false
    }
  }

  private async writeToControlMode(data: string): Promise<void> {
    const process = this.controlModeProcess
    if (!process || !process.stdin) {
      throw new TmuxControlModeError('Control mode process not available')
    }

    if (process.stdin.destroyed) {
      throw new TmuxControlModeError('Control mode stdin is destroyed')
    }

    return new Promise((resolve, reject) => {
      process.stdin!.write(data, (error?: Error | null) => {
        if (error) {
          const nodeError = error as NodeError
          if (nodeError.code === 'EPIPE') {
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

    if (this.resizeHandler) {
      if (process.stdout && process.stdout.off) {
        process.stdout.off('resize', this.resizeHandler)
      }
      process.off('SIGWINCH', this.resizeHandler)
      this.resizeHandler = null
    }

    this.panes.clear()
    this.windowIdMap.clear()
    this.paneToKeyMap.clear()
    this.hasDisplayedInitialList = false
    this.lastPaneListHash = ''
  }

  private processControlModeOutput(line: string) {
    try {
      const parts = line.split(' ')

      if (parts[0] === '%begin') {
        this.inCommandOutput = true
        return
      } else if (parts[0] === '%end') {
        this.inCommandOutput = false
        if (this.panes.size > 0) {
          if (!this.hasDisplayedInitialList) {
            this.hasDisplayedInitialList = true
          }
          const currentHash = this.computePaneListHash()
          if (
            currentHash !== this.lastPaneListHash ||
            this.forceEmitAfterRefresh
          ) {
            this.emitSessionChanged()
            this.forceEmitAfterRefresh = false
          }
        }
        return
      }

      if (parts[0] === '%window-add') {
        if (this.hasDisplayedInitialList) {
          this.throttledRefreshPaneList()
        }
      } else if (parts[0] === '%window-close') {
        const info = this.windowIdMap.get(parts[1])
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

          this.windowIdMap.delete(parts[1])
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
          this.emitSessionChanged()
        }
      } else if (parts[0] === '%layout-change') {
        const windowId = parts[1]
        const windowLayout = parts[2]
        const layoutMatch = windowLayout.match(/,(\d+)x(\d+),/)
        if (layoutMatch) {
          const [_, width, height] = layoutMatch
          const info = this.windowIdMap.get(windowId)
          if (info && info.session === this.currentSessionId) {
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
              this.emitSessionChanged()
            }
          }
        }
        this.throttledRefreshPaneList()
      } else if (parts[0] === '%session-window-changed') {
      } else if (parts[0] === '%session-changed') {
        const sessionId = normalizeSessionId(parts[1])
        if (sessionId === this.currentSessionId) {
        }
      } else if (parts[0] === '%sessions-changed') {
        return
      } else if (this.inCommandOutput && !parts[0].startsWith('%')) {
        if (line.startsWith('PANE ')) {
          const match = line.match(
            /^PANE (%%\d+) ([^:]+):(\d+)\.(\d+) (.+?) ([^ ]+) (\d+)x(\d+) (@@\d+) (\d) (\d)$/,
          )
          if (match) {
            const [
              _,
              paneId,
              sessionIdStr,
              windowIndex,
              paneIndex,
              windowName,
              command,
              width,
              height,
              windowId,
              paneActive,
              windowActive,
            ] = match
            const displayKey = `${sessionIdStr}:${windowIndex}.${paneIndex}`

            const existingPane = this.panes.get(paneId)

            const capturedSessionId = normalizeSessionId(sessionIdStr)
            this.panes.set(paneId, {
              sessionName: capturedSessionId,
              windowIndex,
              paneIndex,
              windowName: windowName.trim(),
              command,
              firstSeen: existingPane?.firstSeen ?? Date.now(),
              width: parseInt(width, 10),
              height: parseInt(height, 10),
              isActive: paneActive === '1',
              windowActive: windowActive === '1',
            })

            this.paneToKeyMap.set(paneId, displayKey)

            this.windowIdMap.set(windowId, {
              session: capturedSessionId,
              index: windowIndex,
            })
          }
        }
      }

      if (parts[0] === '%window-close') {
        this.emitSessionChanged()
      }

      if (parts[0] === '%window-pane-changed') {
        const windowId = parts[1]
        const windowInfo = this.windowIdMap.get(windowId)
        if (windowInfo && windowInfo.session === this.currentSessionId) {
          this.throttledRefreshPaneList()
        }
      }

      if (parts[0] === '%unlinked-window-add') {
        return
      }

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
      }
    } catch (error) {
      console.error('Error processing control mode output:', error)
      console.error('Line that caused error:', line)
    }
  }

  private computePaneListHash(): string {
    const paneData: string[] = []
    for (const [paneId, pane] of this.panes.entries()) {
      paneData.push(
        `${paneId}:${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}:${pane.windowName}:${pane.command}:${pane.width}x${pane.height}:${pane.isActive}:${pane.windowActive}`,
      )
    }
    return paneData.sort().join('|')
  }

  private emitSessionChanged() {
    try {
      this.lastPaneListHash = this.computePaneListHash()

      const windowsMap = new Map<string, SessionChangedData['windows'][0]>()
      let focusedWindowId: string | null = null
      let focusedPaneId: string | null = null

      for (const [paneId, pane] of this.panes.entries()) {
        const windowKey = `${pane.sessionName}:${pane.windowIndex}`

        if (!windowsMap.has(windowKey)) {
          const windowId = Array.from(this.windowIdMap.entries()).find(
            ([_, info]) =>
              info.session === pane.sessionName &&
              info.index === pane.windowIndex,
          )?.[0]

          windowsMap.set(windowKey, {
            windowId: windowId || '',
            windowIndex: pane.windowIndex,
            windowName: pane.windowName,
            isActive: pane.windowActive,
            panes: [],
          })

          if (pane.windowActive && windowId) {
            focusedWindowId = windowId
          }
        }

        if (pane.isActive && pane.windowActive) {
          focusedPaneId = paneId
        }

        const window = windowsMap.get(windowKey)
        if (window) {
          window.panes.push({
            paneId,
            paneIndex: pane.paneIndex,
            command: pane.command,
            width: pane.width,
            height: pane.height,
            isActive: pane.isActive,
          })
        }
      }

      const windows = Array.from(windowsMap.values()).sort(
        (a, b) => parseInt(a.windowIndex) - parseInt(b.windowIndex),
      )

      for (const window of windows) {
        window.panes.sort(
          (a, b) => parseInt(a.paneIndex) - parseInt(b.paneIndex),
        )
      }

      const data: SessionChangedData = {
        sessionId: this.currentSessionId,
        sessionName: this.currentSessionName,
        focusedWindowId,
        focusedPaneId,
        windows,
      }
      this.emitEvent('session-changed', data)
    } catch (error) {
      console.error('Error emitting session changed:', error)
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
        this.forceEmitAfterRefresh = true
        await this.writeToControlMode(
          `list-panes -s -F "PANE %#{pane_id} #{session_id}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_width}x#{pane_height} @#{window_id} #{pane_active} #{window_active}"\n`,
        )
      } catch (error) {
        console.error('Failed to refresh pane list:', error)
        const nodeError = error as NodeError
        if (nodeError.code === 'EPIPE') {
          this.cleanupControlMode()
        }
      }
    }
  }

  private shutdown() {
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

    if (this.resizeHandler) {
      if (process.stdout && process.stdout.off) {
        process.stdout.off('resize', this.resizeHandler)
      }
      process.off('SIGWINCH', this.resizeHandler)
      this.resizeHandler = null
    }

    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')

    process.exit(0)
  }
}
