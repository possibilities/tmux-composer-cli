import { Subscriber } from 'zeromq'
import WebSocket, { WebSocketServer } from 'ws'

const WS_PORT = 31337

const ZMQ_SOCKET_PATH = 'ipc:///tmp/tmux-composer-events.sock'

export class EventObserver {
  private subscriber: Subscriber | null = null
  private isRunning = false
  private wsServer: WebSocketServer | null = null

  async start(options: { ws?: boolean } = {}): Promise<void> {
    try {
      this.subscriber = new Subscriber()
      await this.subscriber.bind(ZMQ_SOCKET_PATH)
      await this.subscriber.subscribe()

      this.isRunning = true
      console.error('[INFO] Connected to ZeroMQ event publisher')
      console.error(`[INFO] Listening for events on ${ZMQ_SOCKET_PATH}`)

      if (options.ws !== false) {
        this.wsServer = new WebSocketServer({ port: WS_PORT })
        console.error(
          `[INFO] WebSocket server listening on ws://localhost:${WS_PORT}`,
        )
        this.wsServer.on('connection', socket => {
          socket.on('error', err => {
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
