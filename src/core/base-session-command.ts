import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type {
  EventName,
  TmuxEventWithOptionalData,
  EventDataMap,
  EventContext,
  EventPayload,
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
  protected eventContext: EventContext = {}

  constructor(options: BaseSessionOptions = {}) {
    super()
    this.sessionId = randomUUID()
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  protected updateContext(context: Partial<EventContext>): void {
    this.eventContext = { ...this.eventContext, ...context }
  }

  protected emitEvent<T extends EventName>(
    eventName: T,
    ...args: T extends keyof EventDataMap
      ? EventDataMap[T] extends undefined
        ? []
        : [data: EventDataMap[T]]
      : []
  ): void {
    const payload: EventPayload<T> = {
      context: this.eventContext,
      ...(args.length > 0 ? { details: args[0] } : {}),
    } as EventPayload<T>

    const event = {
      event: eventName,
      payload,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    } as TmuxEventWithOptionalData<T>

    const detailsWithoutUndefined =
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
      payload: {
        context: this.eventContext,
        ...(detailsWithoutUndefined && { details: detailsWithoutUndefined }),
      },
    }

    console.log(JSON.stringify(finalEventData))
    this.emit('event', event)
  }
}
