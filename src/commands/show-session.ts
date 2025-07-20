import { getSessionData } from '../core/session-utils.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

export class SessionShower {
  constructor(private socketOptions: TmuxSocketOptions = {}) {}

  async show(sessionName: string) {
    try {
      const sessionData = getSessionData(sessionName, this.socketOptions)
      const output = {
        session: sessionData,
      }
      console.log(JSON.stringify(output, null, 2))
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : String(error),
      )
      process.exit(1)
    }
  }
}
