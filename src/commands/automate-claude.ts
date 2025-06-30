import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { LRUCache } from 'lru-cache'
import { EventBus } from '../core/event-bus.js'
import {
  cleanContent,
  matchesPattern,
  matchesLastPattern,
  matchesFullPattern,
} from '../matcher.js'
import {
  listSessions,
  listWindows,
  capturePane,
  capturePaneWithScrollback,
  sendKeys,
  sendKey,
  pasteBuffer,
  convertToTmuxKey,
  socketExists,
  findPanesWithCommand,
  getWindowInfo,
  getTmuxPanes,
  getProcessTree,
  findDescendant,
  hasBufferContent,
  getSessionEnvironment,
} from '../core/tmux-utils.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  POLL_INTERVAL,
  MAX_CHECKSUM_CACHE_SIZE,
  AUTOMATION_PAUSE_MS,
  TERMINAL_SIZES,
} from '../core/constants.js'
import { MATCHERS } from '../core/matchers.js'

interface AutomateTmuxOptions extends TmuxSocketOptions {
  skipMatchers?: Record<string, boolean>
}

export class TmuxAutomator {
  private checksumCache = new LRUCache<string, string>({
    max: MAX_CHECKSUM_CACHE_SIZE,
  })
  private executedMatchers = new Set<string>()
  private knownWindows = new Set<string>()
  private socketExistenceLogged = false
  private lastSocketState = false
  private eventBus: EventBus
  private socketOptions: TmuxSocketOptions
  private claudeWindowsCache = new Set<string>()
  private claudeSeenWindows = new Set<string>()
  private checkedPanes = new Set<string>()
  private lastClaudeCheck = 0
  private readonly CLAUDE_CHECK_INTERVAL = 500
  private skipMatchers: Record<string, boolean>

  constructor(eventBus: EventBus, options: AutomateTmuxOptions = {}) {
    this.eventBus = eventBus
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
    this.skipMatchers = options.skipMatchers || {}
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
    }

    setInterval(() => {
      this.pollAllWindows().catch(error => {
        this.eventBus.emitEvent({
          type: 'error',
          message: 'Error during polling',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
    }, POLL_INTERVAL)

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

  private shouldSkipMatcher(matcherName: string): boolean {
    let skip = false
    let reason = ''

    // Special handling for inject-initial-context matchers
    if (
      matcherName === 'inject-initial-context-plan' ||
      matcherName === 'inject-initial-context-act'
    ) {
      const hasBuffer = hasBufferContent(this.socketOptions)
      skip = this.skipMatchers[matcherName] || !hasBuffer
      reason = skip
        ? `skipMatchers[${matcherName}]=${this.skipMatchers[matcherName]}, hasBuffer=${hasBuffer}`
        : 'not skipping, has buffer content'
    } else {
      skip = this.skipMatchers[matcherName] || false
      reason = skip
        ? `skipMatchers[${matcherName}] is true`
        : `skipMatchers[${matcherName}] is false`
    }

    console.log(
      `[DEBUG] shouldSkipMatcher('${matcherName}'): ${skip} - ${reason}`,
    )
    return skip
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

      const removedPanes = Array.from(this.checkedPanes).filter(
        id => !currentPaneIds.has(id),
      )
      removedPanes.forEach(paneId => {
        this.checkedPanes.delete(paneId)
      })

      const newPanes = allPanes.filter(p => {
        const paneId = `${p.sessionId}:${p.windowIndex}.${p.paneIndex}`
        return !this.checkedPanes.has(paneId)
      })

      for (const pane of newPanes) {
        const paneId = `${pane.sessionId}:${pane.windowIndex}.${pane.paneIndex}`
        this.checkedPanes.add(paneId)
      }

      this.claudeWindowsCache.clear()
      const tree = getProcessTree()

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

        // Check for logout detection
        if (cleanedContent.includes("Let's get started")) {
          console.error('\n❌ ERROR: Claude has been logged out unexpectedly!')
          console.error(
            'The screen contains "Let\'s get started" which indicates you have been logged out.',
          )
          console.error('Please log in again and restart the automation.')
          process.exit(1)
        }

        console.log(
          `Checking ${sessionName}:${windowName} for automation patterns (claude detected)...`,
        )
        console.log('[DEBUG] Cleaned content:')
        console.log('--- START CLEANED CONTENT ---')
        console.log(cleanedContent)
        console.log('--- END CLEANED CONTENT ---')
        console.log(`[DEBUG] Number of cleaned lines: ${cleanedLines.length}`)

        const sessionMode = getSessionEnvironment(
          sessionName,
          'CONTROL_MODE',
          this.socketOptions,
        )

        for (const matcher of MATCHERS) {
          if (this.shouldSkipMatcher(matcher.name)) {
            if (process.env.VERBOSE) {
              console.log(`Skipping matcher: ${matcher.name}`)
            }
            continue
          }

          if (
            matcher.mode !== 'all' &&
            sessionMode &&
            matcher.mode !== sessionMode
          ) {
            if (process.env.VERBOSE) {
              console.log(
                `Skipping matcher ${matcher.name} - mode mismatch (matcher: ${matcher.mode}, session: ${sessionMode})`,
              )
            }
            continue
          }

          console.log(`[DEBUG] Checking matcher: ${matcher.name}`)
          console.log(
            `[DEBUG] Trigger patterns: ${JSON.stringify(matcher.trigger)}`,
          )

          let patternMatches = false

          const checkTrigger = async (
            trigger: string[],
            triggerType: string,
          ): Promise<boolean> => {
            if (trigger.length === 1) {
              const matches = matchesPattern(cleanedLines, trigger)
              console.log(
                `[DEBUG] ${triggerType} - Single pattern matches: ${matches}`,
              )
              return matches
            } else {
              console.log(
                `[DEBUG] ${triggerType} - Two-phase matching for ${trigger.length} patterns`,
              )

              const lastPatternMatches = matchesLastPattern(
                cleanedLines,
                trigger,
              )
              console.log(
                `[DEBUG] ${triggerType} - Phase 1 - Last pattern matches: ${lastPatternMatches}`,
              )

              if (lastPatternMatches) {
                console.log(
                  `[DEBUG] ${triggerType} - Phase 2 - Capturing full scrollback for complete match`,
                )
                try {
                  const fullContent = await capturePaneWithScrollback(
                    sessionName,
                    windowName,
                    this.socketOptions,
                  )
                  const cleanedFullContent = cleanContent(fullContent)
                  const cleanedFullLines = cleanedFullContent.split('\n')

                  const matches = matchesFullPattern(cleanedFullLines, trigger)
                  console.log(
                    `[DEBUG] ${triggerType} - Phase 2 - Full pattern matches: ${matches}`,
                  )
                  return matches
                } catch (error) {
                  console.error('[DEBUG] Error capturing scrollback:', error)
                  return matchesPattern(cleanedLines, trigger)
                }
              }
              return false
            }
          }

          patternMatches = await checkTrigger(
            matcher.trigger,
            'Regular trigger',
          )

          if (!patternMatches && matcher.wrappedTrigger) {
            console.log(
              `[DEBUG] Regular trigger didn't match, trying wrapped trigger`,
            )
            patternMatches = await checkTrigger(
              matcher.wrappedTrigger,
              'Wrapped trigger',
            )
          }

          if (patternMatches) {
            const matcherKey = `${sessionName}:${windowName}:${matcher.name}`
            console.log(`[DEBUG] Matcher ${matcher.name} matched!`)

            if (matcher.runOnce && this.executedMatchers.has(matcherKey)) {
              console.log(
                `[DEBUG] Matcher ${matcher.name} already executed, skipping`,
              )
              continue
            }

            console.log(
              `[DEBUG] Sending keys for matcher ${matcher.name}: ${matcher.response}`,
            )
            this.parseAndSendKeys(sessionName, windowName, matcher.response)

            if (matcher.runOnce) {
              this.executedMatchers.add(matcherKey)
              console.log(`[DEBUG] Marked matcher ${matcher.name} as executed`)
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
}
