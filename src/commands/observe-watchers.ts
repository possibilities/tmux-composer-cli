import { Subscriber } from 'zeromq'

const ZMQ_SOCKET_PATH = 'ipc:///tmp/tmux-composer-events.sock'

export class EventObserver {
  private subscriber: Subscriber | null = null
  private isRunning = false

  async start(): Promise<void> {
    try {
      this.subscriber = new Subscriber()
      await this.subscriber.bind(ZMQ_SOCKET_PATH)
      await this.subscriber.subscribe()

      this.isRunning = true
      console.error('[INFO] Connected to ZeroMQ event publisher')
      console.error(`[INFO] Listening for events on ${ZMQ_SOCKET_PATH}`)

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
        console.log(message.toString())
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

    process.exit(0)
  }
}
