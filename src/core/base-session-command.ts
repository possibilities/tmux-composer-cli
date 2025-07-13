import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type {
  EventName,
  TmuxEventWithOptionalData,
  EventDataMap,
} from './events.js'
import type { TmuxSocketOptions } from './tmux-socket.js'

export interface BaseSessionOptions extends TmuxSocketOptions {
  zmq?: boolean
  zmqSocket?: string
  zmqSocketPath?: string
}

export abstract class BaseSessionCommand extends EventEmitter {
  protected sessionId: string
  protected socketOptions: TmuxSocketOptions

  constructor(options: BaseSessionOptions = {}) {
    super()
    this.sessionId = randomUUID()
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  protected emitEvent<T extends EventName>(
    eventName: T,
    ...args: T extends keyof EventDataMap
      ? EventDataMap[T] extends undefined
        ? []
        : [data: EventDataMap[T]]
      : []
  ): void {
    const event = {
      event: eventName,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...(args.length > 0 ? { data: args[0] } : {}),
    } as TmuxEventWithOptionalData<T>

    const dataWithoutUndefined =
      args.length > 0 && args[0]
        ? Object.fromEntries(
            Object.entries(args[0] as Record<string, unknown>).filter(
              ([_, v]) => v !== undefined,
            ),
          )
        : undefined

    const finalEventData = {
      event: eventName,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      ...(dataWithoutUndefined && { data: dataWithoutUndefined }),
    }

    console.log(JSON.stringify(finalEventData))
    this.emit('event', event)
  }
}
