import { Command } from 'commander'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import packageJson from '../package.json' assert { type: 'json' }

const TMUX_SOCKET_PATH = path.join(os.tmpdir(), 'control-app-tmux')
const POLL_INTERVAL = 500
const WEBSOCKET_PORT = 8080

class TmuxMonitor {
  private checksumCache = new Map<string, string>()
  private controlStateCache = new Map<string, boolean>()
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  private websocketEnabled: boolean
  private socketExistenceLogged = false
  private lastSocketState = false

  constructor(websocketEnabled: boolean) {
    this.websocketEnabled = websocketEnabled
    if (websocketEnabled) {
      this.wss = new WebSocketServer({ port: WEBSOCKET_PORT })
      this.setupWebSocketServer()
    }
  }

  private setupWebSocketServer() {
    if (!this.wss) return

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[${new Date().toISOString()}] WebSocket client connected`)
      this.clients.add(ws)

      ws.on('close', () => {
        console.log(
          `[${new Date().toISOString()}] WebSocket client disconnected`,
        )
        this.clients.delete(ws)
      })

      ws.on('error', error => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error)
        this.clients.delete(ws)
      })

      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
        }),
      )

      // Send current control states for all sessions
      for (const [sessionName, isHumanControlled] of this.controlStateCache) {
        ws.send(
          JSON.stringify({
            type: 'control-state',
            sessionName,
            isHumanControlled,
            timestamp: new Date().toISOString(),
          }),
        )
      }
    })

    console.log(
      `[${new Date().toISOString()}] WebSocket server listening on port ${WEBSOCKET_PORT}`,
    )
  }

  private broadcast(message: unknown) {
    if (!this.websocketEnabled) return

    const messageStr = JSON.stringify(message)
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr)
      }
    })
  }

  async start() {
    console.log(`[${new Date().toISOString()}] Starting tmux window monitor...`)
    console.log(
      `[${new Date().toISOString()}] Monitoring socket: ${TMUX_SOCKET_PATH}`,
    )
    if (!this.websocketEnabled) {
      console.log(`[${new Date().toISOString()}] WebSocket server disabled`)
    }

    setInterval(() => {
      this.pollAllWindows().catch(error => {
        console.error(
          `[${new Date().toISOString()}] Error during polling:`,
          error instanceof Error ? error.message : String(error),
        )
      })
    }, POLL_INTERVAL)

    this.pollAllWindows().catch(error => {
      console.error(
        `[${new Date().toISOString()}] Error during initial polling:`,
        error instanceof Error ? error.message : String(error),
      )
    })
  }

  private socketExists(): boolean {
    try {
      return fs.existsSync(TMUX_SOCKET_PATH)
    } catch {
      return false
    }
  }

  private async pollAllWindows() {
    const socketExists = this.socketExists()

    if (socketExists !== this.lastSocketState) {
      this.lastSocketState = socketExists
      if (!socketExists) {
        if (!this.socketExistenceLogged) {
          console.log(
            `[${new Date().toISOString()}] Waiting for tmux socket at ${TMUX_SOCKET_PATH}...`,
          )
          this.socketExistenceLogged = true
        }
      } else {
        console.log(
          `[${new Date().toISOString()}] Tmux socket detected at ${TMUX_SOCKET_PATH}`,
        )
        this.socketExistenceLogged = false
      }
    }

    if (!socketExists) {
      return
    }

    try {
      const sessions = this.listSessions()

      for (const sessionName of sessions) {
        const isHumanControlled = this.checkHumanControl(sessionName)
        const wasHumanControlled =
          this.controlStateCache.get(sessionName) || false

        if (isHumanControlled !== wasHumanControlled) {
          this.controlStateCache.set(sessionName, isHumanControlled)
          console.log(
            `[${new Date().toISOString()}] Control state changed for ${sessionName}: ${isHumanControlled ? 'Human' : 'Agent'}`,
          )

          this.broadcast({
            type: 'control-state',
            sessionName,
            isHumanControlled,
            timestamp: new Date().toISOString(),
          })

          if (!isHumanControlled && wasHumanControlled) {
            this.resizeSessionWindows(sessionName)
          }
        }

        if (isHumanControlled) {
          continue
        }

        const windows = this.listWindows(sessionName)

        for (const windowName of windows) {
          await this.captureWindow(sessionName, windowName)
        }
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error listing sessions:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private listSessions(): string[] {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-sessions -F "#{session_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }

  private listWindows(sessionName: string): string[] {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-windows -t ${sessionName} -F "#{window_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }

  private async captureWindow(sessionName: string, windowName: string) {
    const cacheKey = `${sessionName}:${windowName}`

    try {
      const content = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} capture-pane -p -t ${sessionName}:${windowName}`,
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      )

      const checksum = this.calculateChecksum(content)
      const previousChecksum = this.checksumCache.get(cacheKey)

      if (checksum !== previousChecksum) {
        this.checksumCache.set(cacheKey, checksum)
        console.log(
          `[${new Date().toISOString()}] Updated: ${sessionName}:${windowName} (checksum: ${checksum})`,
        )

        this.broadcast({
          type: 'update',
          sessionName,
          windowName,
          content,
          timestamp: new Date().toISOString(),
        })
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error capturing ${sessionName}:${windowName}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex')
  }

  private checkHumanControl(sessionName: string): boolean {
    try {
      const output = execSync(
        `tmux -S ${TMUX_SOCKET_PATH} list-clients -t ${sessionName} -F "#{client_name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim()

      const clientCount = output ? output.split('\n').length : 0
      return clientCount > 0
    } catch {
      return false
    }
  }

  private resizeSessionWindows(sessionName: string) {
    try {
      const windows = this.listWindows(sessionName)

      for (const windowName of windows) {
        try {
          execSync(
            `tmux -S ${TMUX_SOCKET_PATH} resize-window -t ${sessionName}:${windowName} -x 80 -y 24`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          )
          console.log(
            `[${new Date().toISOString()}] Resized window ${sessionName}:${windowName} to 80x24`,
          )
        } catch (error) {
          console.error(
            `[${new Date().toISOString()}] Failed to resize ${sessionName}:${windowName}:`,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error resizing windows for ${sessionName}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

async function main() {
  const program = new Command()

  program
    .name('control')
    .description('Control CLI')
    .version(packageJson.version)
    .option('--websocket', 'Enable WebSocket server', false)
    .option('--no-websocket', 'Disable WebSocket server')
    .action(options => {
      const websocketEnabled = options.websocket

      const monitor = new TmuxMonitor(websocketEnabled)
      monitor.start()

      process.on('SIGINT', () => {
        console.log(
          `\n[${new Date().toISOString()}] Shutting down tmux monitor...`,
        )
        process.exit(0)
      })

      process.on('SIGTERM', () => {
        console.log(
          `\n[${new Date().toISOString()}] Shutting down tmux monitor...`,
        )
        process.exit(0)
      })
    })

  try {
    program.exitOverride()
    program.configureOutput({
      writeErr: str => process.stderr.write(str),
    })

    await program.parseAsync(process.argv)
  } catch (error: any) {
    if (
      error.code === 'commander.help' ||
      error.code === 'commander.helpDisplayed'
    ) {
      process.exit(0)
    }
    console.error('Error:', error.message || error)
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
