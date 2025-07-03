import { execSync } from 'child_process'
import { getTmuxSocketArgs } from '../core/tmux-socket.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  listSessions,
  getAttachedSession,
  switchToSession,
} from '../core/tmux-utils.js'

export class SessionCloser {
  private socketOptions: TmuxSocketOptions

  constructor(options: TmuxSocketOptions = {}) {
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  close(): void {
    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    const currentSession = execSync(
      `tmux ${socketArgs} display-message -p '#S'`,
      { encoding: 'utf-8' },
    ).trim()

    console.log(`Closing session: ${currentSession}`)

    const allSessions = listSessions(this.socketOptions)
    const attachedSession = getAttachedSession(this.socketOptions)
    const isAttachedToCurrentSession = attachedSession === currentSession
    const hasOtherSessions = allSessions.length > 1

    if (isAttachedToCurrentSession && hasOtherSessions) {
      const otherSession = allSessions.find(s => s !== currentSession)
      if (otherSession) {
        console.log(`Switching to session: ${otherSession}`)
        switchToSession(otherSession, this.socketOptions)
      }
    }

    execSync(`tmux ${socketArgs} kill-session -t ${currentSession}`)
    console.log('Session closed successfully')
  }
}
