import { Publisher } from 'zeromq'
import { EventEmitter } from 'events'

const ZMQ_SOCKET_PATH = 'ipc:///tmp/tmux-composer-events.sock'

export interface TmuxEvent {
  event: string
  data?: any
  timestamp: string
}

export class ZmqEventPublisher {
  private publisher: Publisher | null = null
  private isConnected = false
  private eventQueue: TmuxEvent[] = []

  async connect(): Promise<void> {
    if (this.isConnected) {
      return
    }

    try {
      this.publisher = new Publisher()
      this.publisher.linger = 1000
      await this.publisher.bind(ZMQ_SOCKET_PATH)

      await new Promise(resolve => setTimeout(resolve, 100))

      this.isConnected = true

      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()
        if (event) {
          await this.publishEvent(event)
        }
      }
    } catch (error) {
      console.error('[ZMQ] Failed to connect publisher:', error)
      throw error
    }
  }

  async publishEvent(event: TmuxEvent): Promise<void> {
    if (!this.isConnected || !this.publisher) {
      this.eventQueue.push(event)
      if (!this.isConnected) {
        this.connect().catch(error => {
          console.error('[ZMQ] Failed to connect during publish:', error)
        })
      }
      return
    }

    try {
      const message = JSON.stringify(event)
      await this.publisher.send(message)
    } catch (error) {
      console.error('[ZMQ] Failed to publish event:', error)
      this.eventQueue.push(event)
    }
  }

  async disconnect(): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.unbind(ZMQ_SOCKET_PATH)
        await this.publisher.close()
      } catch (error) {
        console.error('[ZMQ] Error during disconnect:', error)
      }
      this.publisher = null
      this.isConnected = false
    }
  }
}

let publisherInstance: ZmqEventPublisher | null = null

export function getZmqPublisher(): ZmqEventPublisher {
  if (!publisherInstance) {
    publisherInstance = new ZmqEventPublisher()
  }
  return publisherInstance
}

export async function shutdownZmqPublisher(): Promise<void> {
  if (publisherInstance) {
    await publisherInstance.disconnect()
    publisherInstance = null
  }
}

export async function enableZmqPublishing(
  emitter: EventEmitter,
): Promise<void> {
  const publisher = getZmqPublisher()

  try {
    await publisher.connect()
  } catch (error) {
    console.error('[ZMQ] Failed to initialize publisher:', error)
  }

  emitter.on('event', async (event: TmuxEvent) => {
    try {
      await publisher.publishEvent(event)
    } catch (error) {
      console.error('[ZMQ] Failed to publish event:', error)
    }
  })

  const cleanupHandler = async () => {
    await shutdownZmqPublisher()
  }

  process.once('SIGINT', cleanupHandler)
  process.once('SIGTERM', cleanupHandler)
  process.once('exit', cleanupHandler)
}
