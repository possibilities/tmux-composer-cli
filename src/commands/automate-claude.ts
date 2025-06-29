import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { LRUCache } from 'lru-cache'
import { EventBus } from '../core/event-bus.js'
import { cleanContent, matchesPattern } from '../matcher.js'
import {
  listSessions,
  listWindows,
  capturePane,
  checkHumanControl,
  sendKeys,
  sendKey,
  pasteBuffer,
  resizeWindow,
  convertToTmuxKey,
  socketExists,
  findPanesWithCommand,
  getWindowInfo,
  getTmuxPanes,
  getProcessTree,
  findDescendant,
} from '../core/tmux-utils.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  POLL_INTERVAL,
  MAX_CHECKSUM_CACHE_SIZE,
  MATCHERS,
  AUTOMATION_PAUSE_MS,
} from '../core/constants.js'

interface AutomateTmuxOptions extends TmuxSocketOptions {
  pollInterval?: number
}

export class TmuxAutomator {
  private checksumCache = new LRUCache<string, string>({
    max: MAX_CHECKSUM_CACHE_SIZE,
  })
  private controlStateCache = new Map<string, boolean>()
  private executedMatchers = new Set<string>()
  private knownWindows = new Set<string>()
  private socketExistenceLogged = false
  private lastSocketState = false
  private eventBus: EventBus
  private socketOptions: TmuxSocketOptions
  private pollInterval: number
  private claudeWindowsCache = new Set<string>()
  private claudeSeenWindows = new Set<string>()
  private checkedPanes = new Set<string>()
  private lastClaudeCheck = 0
  private readonly CLAUDE_CHECK_INTERVAL = 500

  constructor(eventBus: EventBus, options: AutomateTmuxOptions = {}) {
    this.eventBus = eventBus
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
    this.pollInterval = options.pollInterval || POLL_INTERVAL
  }

  async start() {
    if (process.env.VERBOSE) {
      console.log(`Starting tmux window monitor...`)
      if (this.socketOptions.socketName) {
        console.log(`Socket name: ${this.socketOptions.socketName}`)
      } else if (this.socketOptions.socketPath) {
        console.log(`Socket path: ${this.socketOptions.socketPath}`)
      } else {
        console.log(`Using default socket`)
      }
      console.log(`Poll interval: ${this.pollInterval}ms`)
    }

    setInterval(() => {
      this.pollAllWindows().catch(error => {
        this.eventBus.emitEvent({
          type: 'error',
          message: 'Error during polling',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
    }, this.pollInterval)

    this.pollAllWindows().catch(error => {
      this.eventBus.emitEvent({
        type: 'error',
        message: 'Error during initial polling',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    })
  }

  private socketExists(): boolean {
    return socketExists(this.socketOptions)
  }

  private async updateClaudeWindowsCache() {
    const now = Date.now()
    if (now - this.lastClaudeCheck < this.CLAUDE_CHECK_INTERVAL) {
      return
    }

    this.lastClaudeCheck = now

    try {
      const startTime = Date.now()

      const allPanes = getTmuxPanes(this.socketOptions)
      const currentPaneIds = new Set(
        allPanes.map(p => `${p.sessionId}:${p.windowIndex}.${p.paneIndex}`),
      )

      // Remove panes that no longer exist
      const removedPanes = Array.from(this.checkedPanes).filter(
        id => !currentPaneIds.has(id),
      )
      removedPanes.forEach(paneId => {
        this.checkedPanes.delete(paneId)
      })

      // Find new panes to check
      const newPanes = allPanes.filter(p => {
        const paneId = `${p.sessionId}:${p.windowIndex}.${p.paneIndex}`
        return !this.checkedPanes.has(paneId)
      })

      // Mark new panes as checked
      for (const pane of newPanes) {
        const paneId = `${pane.sessionId}:${pane.windowIndex}.${pane.paneIndex}`
        this.checkedPanes.add(paneId)
      }

      // Always rebuild the claude windows cache to catch claude starting in existing panes
      this.claudeWindowsCache.clear()
      const tree = getProcessTree()

      // Check all panes for claude
      for (const pane of allPanes) {
        if (findDescendant(pane.pid, 'claude', tree)) {
          const windowKey = `${pane.sessionId}:${pane.windowIndex}`
          this.claudeWindowsCache.add(windowKey)
        }
      }

      const searchTime = Date.now() - startTime

      if (process.env.VERBOSE) {
        console.log(
          `Checked ${newPanes.length} new panes in ${searchTime}ms. Claude running in ${this.claudeWindowsCache.size} windows:`,
          Array.from(this.claudeWindowsCache),
        )
      }
    } catch (error) {
      this.eventBus.emitEvent({
        type: 'error',
        message: 'Error finding claude processes',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private hasClaudeRunning(sessionId: string, windowIndex: string): boolean {
    const windowKey = `${sessionId}:${windowIndex}`
    return this.claudeWindowsCache.has(windowKey)
  }

  private async pollAllWindows() {
    const socketExists = this.socketExists()

    if (socketExists !== this.lastSocketState) {
      this.lastSocketState = socketExists
      if (!socketExists) {
        if (this.socketExistenceLogged) {
          console.log(`Tmux server disconnected. Waiting for reconnection...`)
          this.executedMatchers.clear()
          this.knownWindows.clear()
          this.checksumCache.clear()
          this.claudeWindowsCache.clear()
          this.claudeSeenWindows.clear()
          this.checkedPanes.clear()
        } else {
          console.log(`Waiting for tmux socket...`)
        }
        this.socketExistenceLogged = true
      } else {
        if (this.socketExistenceLogged) {
          console.log(`Tmux socket detected`)
        }
        this.socketExistenceLogged = false
      }
    }

    if (!socketExists) {
      return
    }

    await this.updateClaudeWindowsCache()

    try {
      const sessions = await listSessions(this.socketOptions)

      for (const sessionName of sessions) {
        const isHumanControlled = await checkHumanControl(
          sessionName,
          this.socketOptions,
        )
        const wasHumanControlled =
          this.controlStateCache.get(sessionName) || false

        if (isHumanControlled !== wasHumanControlled) {
          this.controlStateCache.set(sessionName, isHumanControlled)

          this.eventBus.emitEvent({
            type: 'session-control',
            sessionName,
            isHumanControlled,
          })

          if (!isHumanControlled && wasHumanControlled) {
            this.resizeSessionWindows(sessionName)
          }
        }

        if (isHumanControlled) {
          continue
        }

        const windows = await listWindows(sessionName, this.socketOptions)

        await Promise.all(
          windows.map(windowName =>
            this.captureWindow(sessionName, windowName),
          ),
        )
      }
    } catch (error) {
      this.eventBus.emitEvent({
        type: 'error',
        message: 'Error listing sessions',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private async captureWindow(sessionName: string, windowName: string) {
    const cacheKey = `${sessionName}:${windowName}`

    try {
      const startTime = Date.now()
      const rawContent = await capturePane(
        sessionName,
        windowName,
        this.socketOptions,
      )
      const captureTime = Date.now() - startTime

      if (captureTime > 100 && process.env.VERBOSE) {
        console.log(
          `Slow capture for ${sessionName}:${windowName}: ${captureTime}ms`,
        )
      }

      const checksum = this.calculateChecksum(rawContent)
      const previousChecksum = this.checksumCache.get(cacheKey)
      const windowKey = `${sessionName}:${windowName}`

      const isNewWindow = !this.knownWindows.has(windowKey)
      if (isNewWindow) {
        this.knownWindows.add(windowKey)
      }

      if (checksum !== previousChecksum || isNewWindow) {
        this.checksumCache.set(cacheKey, checksum)

        if (isNewWindow && process.env.VERBOSE) {
          console.log(`New window detected: ${sessionName}:${windowName}`)
        }

        this.eventBus.emitEvent({
          type: 'window-content',
          sessionName,
          windowName,
          content: rawContent,
        })
      }

      const windowInfo = await getWindowInfo(
        sessionName,
        windowName,
        this.socketOptions,
      )
      const hasClaude = windowInfo
        ? this.hasClaudeRunning(windowInfo.sessionId, windowInfo.windowIndex)
        : false

      const isClaudeNewlyDetected =
        hasClaude && !this.claudeSeenWindows.has(windowKey)
      if (isClaudeNewlyDetected) {
        this.claudeSeenWindows.add(windowKey)
        if (process.env.VERBOSE) {
          console.log(`Claude newly detected in ${sessionName}:${windowName}`)
        }
      }

      if (
        (checksum !== previousChecksum && hasClaude) ||
        isClaudeNewlyDetected
      ) {
        const cleanedContent = cleanContent(rawContent)
        const cleanedLines = cleanedContent.split('\n')

        console.log(
          `Checking ${sessionName}:${windowName} for automation patterns (claude detected)...`,
        )

        for (const matcher of MATCHERS) {
          const patternMatches = matchesPattern(cleanedLines, matcher.trigger)

          if (patternMatches) {
            const matcherKey = `${sessionName}:${windowName}:${matcher.name}`

            if (matcher.runOnce && this.executedMatchers.has(matcherKey)) {
              continue
            }

            this.parseAndSendKeys(sessionName, windowName, matcher.response)

            if (matcher.runOnce) {
              this.executedMatchers.add(matcherKey)
            }

            this.eventBus.emitEvent({
              type: 'window-automation',
              sessionName,
              windowName,
              matcherName: matcher.name,
            })
          }
        }
      }
    } catch (error) {
      this.eventBus.emitEvent({
        type: 'error',
        message: `Error capturing ${sessionName}:${windowName}`,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex')
  }

  private parseAndSendKeys(
    sessionName: string,
    windowName: string,
    response: string,
  ) {
    const parts: Array<{ type: 'text' | 'key' | 'command'; value: string }> = []
    let currentText = ''
    let i = 0

    while (i < response.length) {
      if (response[i] === '<') {
        if (currentText) {
          parts.push({ type: 'text', value: currentText })
          currentText = ''
        }

        const closeIndex = response.indexOf('>', i)
        if (closeIndex === -1) {
          currentText += response[i]
          i++
        } else {
          const keyName = response.substring(i + 1, closeIndex)
          parts.push({ type: 'key', value: keyName })
          i = closeIndex + 1
        }
      } else if (response[i] === '{') {
        if (currentText) {
          parts.push({ type: 'text', value: currentText })
          currentText = ''
        }

        const closeIndex = response.indexOf('}', i)
        if (closeIndex === -1) {
          currentText += response[i]
          i++
        } else {
          const commandName = response.substring(i + 1, closeIndex)
          parts.push({ type: 'command', value: commandName })
          i = closeIndex + 1
        }
      } else {
        currentText += response[i]
        i++
      }
    }

    if (currentText) {
      parts.push({ type: 'text', value: currentText })
    }

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      try {
        if (part.type === 'text') {
          sendKeys(sessionName, windowName, part.value, this.socketOptions)
        } else if (part.type === 'key') {
          const tmuxKey = convertToTmuxKey(part.value)
          sendKey(sessionName, windowName, tmuxKey, this.socketOptions)

          if (index < parts.length - 1) {
            execSync(`sleep ${AUTOMATION_PAUSE_MS / 1000}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
          }
        } else if (part.type === 'command') {
          if (part.value === 'paste-buffer') {
            pasteBuffer(sessionName, windowName, this.socketOptions)
          }
          if (index < parts.length - 1) {
            execSync(`sleep ${AUTOMATION_PAUSE_MS / 1000}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
          }
        }
      } catch (error) {
        this.eventBus.emitEvent({
          type: 'error',
          message: `Failed to send keys to ${sessionName}:${windowName}`,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
  }

  private async resizeSessionWindows(sessionName: string) {
    try {
      const windows = await listWindows(sessionName, this.socketOptions)

      await Promise.all(
        windows.map(async windowName => {
          try {
            await resizeWindow(
              sessionName,
              windowName,
              80,
              24,
              this.socketOptions,
            )
          } catch (error) {
            this.eventBus.emitEvent({
              type: 'error',
              message: `Failed to resize ${sessionName}:${windowName}`,
              error: error instanceof Error ? error : new Error(String(error)),
            })
          }
        }),
      )
    } catch (error) {
      this.eventBus.emitEvent({
        type: 'error',
        message: `Error resizing windows for ${sessionName}`,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
}
