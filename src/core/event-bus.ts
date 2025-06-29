import { EventEmitter } from 'events'

export interface EventData {
  timestamp: string
  [key: string]: any
}

export interface WindowContentEvent extends EventData {
  type: 'window-content'
  sessionName: string
  windowName: string
  content: string
}

export interface WindowAutomationEvent extends EventData {
  type: 'window-automation'
  sessionName: string
  windowName: string
  matcherName: string
}

export interface SessionCreatingEvent extends EventData {
  type: 'session-creating'
  sessionName: string
}

export interface WorktreeCreatedEvent extends EventData {
  type: 'worktree-created'
  worktreeNumber: number
  expectedWindows: string[]
}

export interface WindowStartingEvent extends EventData {
  type: 'window-starting'
  windowName: string
  command: string
}

export interface WindowReadyEvent extends EventData {
  type: 'window-ready'
  windowName: string
  port?: number
}

export interface SessionReadyEvent extends EventData {
  type: 'session-ready'
  sessionName: string
  worktreeNumber: number
}

export interface ErrorEvent extends EventData {
  type: 'error'
  message: string
  error?: Error
}

export type Event =
  | WindowContentEvent
  | WindowAutomationEvent
  | SessionCreatingEvent
  | WorktreeCreatedEvent
  | WindowStartingEvent
  | WindowReadyEvent
  | SessionReadyEvent
  | ErrorEvent

export class EventBus extends EventEmitter {
  constructor() {
    super()
    this.setupLogging()
  }

  private setupLogging() {
    this.on('window-content', (event: WindowContentEvent) => {
      if (process.env.VERBOSE) {
        console.log(
          `[${event.timestamp}] WINDOW-CONTENT: ${event.sessionName}:${event.windowName}`,
        )
      }
    })

    this.on('window-automation', (event: WindowAutomationEvent) => {
      console.log(
        `✓ Automated ${event.matcherName} for ${event.sessionName}:${event.windowName}`,
      )
    })

    this.on('session-creating', (event: SessionCreatingEvent) => {
      console.log(`Creating session: ${event.sessionName}...`)
    })

    this.on('worktree-created', (event: WorktreeCreatedEvent) => {
      console.log(`✓ Created worktree #${event.worktreeNumber}`)
    })

    this.on('window-starting', (event: WindowStartingEvent) => {
      console.log(`  Starting ${event.windowName} window...`)
    })

    this.on('window-ready', (event: WindowReadyEvent) => {
      console.log(
        `  ✓ ${event.windowName} ready${event.port ? ` (port: ${event.port})` : ''}`,
      )
    })

    this.on('session-ready', (event: SessionReadyEvent) => {})

    this.on('error', (event: ErrorEvent) => {
      console.error(`✗ ${event.message}`)
    })
  }

  emitEvent<T extends Event>(event: Omit<T, 'timestamp'>): void {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    } as T

    this.emit(event.type, fullEvent)
  }
}
