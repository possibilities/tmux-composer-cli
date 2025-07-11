import { Subscriber } from 'zeromq'
import WebSocket, { WebSocketServer } from 'ws'
import {
  getZmqSocketPath,
  ensureZmqSocketDirectory,
} from '../core/zmq-socket.js'

export class EventObserver {
  private subscriber: Subscriber | null = null
  private isRunning = false
  private wsServer: WebSocketServer | null = null

  async start(
    options: {
      ws?: boolean
      port?: number
      zmqSocket?: string
      zmqSocketPath?: string
    } = {},
  ): Promise<void> {
    try {
      await ensureZmqSocketDirectory()

      const socketPath = getZmqSocketPath({
        socketName: options.zmqSocket,
        socketPath: options.zmqSocketPath,
      })

      this.subscriber = new Subscriber()
      await this.subscriber.bind(socketPath)
      await this.subscriber.subscribe()

      this.isRunning = true
      console.error('[INFO] Connected to ZeroMQ event publisher')
      console.error(`[INFO] Listening for events on ${socketPath}`)

      const wsEnabled = options.ws ?? true
      if (wsEnabled) {
        const getPortValue = () => {
          if (options.port) return options.port
          if (process.env.PORT) {
            const envPort = parseInt(process.env.PORT, 10)
            if (isNaN(envPort) || envPort < 1 || envPort > 65535) {
              console.error(
                `[WARN] Invalid PORT environment variable: ${process.env.PORT}. Using default port 31337.`,
              )
              return 31337
            }
            return envPort
          }
          return 31337
        }
        const port = getPortValue()
        this.wsServer = new WebSocketServer({ port })
        console.error(
          `[INFO] WebSocket server listening on ws://localhost:${port}`,
        )
        this.wsServer.on('connection', (socket: WebSocket) => {
          socket.on('error', (err: Error) => {
            console.error('[WS] client error:', err)
          })
        })
      }

      this.setupSignalHandlers()

      await this.receiveMessages()
    } catch (error) {
      console.error('[ERROR] Failed to start event observer:', error)
      process.exit(1)
    }
  }

  private async receiveMessages(): Promise<void> {
    if (!this.subscriber) return

    try {
      for await (const [message] of this.subscriber) {
        const text = message.toString()
        console.log(text)

        if (this.wsServer) {
          for (const client of this.wsServer.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(text)
            }
          }
        }
      }
    } catch (error) {
      if (this.isRunning) {
        console.error('[ERROR] Error receiving messages:', error)
      }
    }
  }

  private setupSignalHandlers(): void {
    const shutdownHandler = () => {
      this.shutdown()
    }

    process.on('SIGINT', shutdownHandler)
    process.on('SIGTERM', shutdownHandler)
  }

  private shutdown(): void {
    this.isRunning = false

    if (this.subscriber) {
      try {
        this.subscriber.close()
      } catch (error) {
        console.error('[ERROR] Error during shutdown:', error)
      }
    }

    if (this.wsServer) {
      try {
        this.wsServer.close()
      } catch (error) {
        console.error('[ERROR] Error closing WebSocket server:', error)
      }
    }

    process.exit(0)
  }
}
