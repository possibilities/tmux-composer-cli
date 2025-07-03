import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { EventName, TmuxEventWithOptionalData } from './events.js'
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
    event: T,
    data?: TmuxEventWithOptionalData<T>['data'],
  ): void {
    const eventData: TmuxEventWithOptionalData<T> = {
      event,
      data,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    }

    const dataWithoutUndefined = data
      ? Object.fromEntries(
          Object.entries(data).filter(([_, v]) => v !== undefined),
        )
      : undefined

    const finalEventData = {
      ...eventData,
      ...(dataWithoutUndefined && { data: dataWithoutUndefined }),
    }

    console.log(JSON.stringify(finalEventData))
    this.emit('event', eventData)
  }
}
