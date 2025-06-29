import path from 'path'
import os from 'os'

export interface TmuxSocketOptions {
  socketName?: string
  socketPath?: string
}

export function getTmuxSocketArgs(options: TmuxSocketOptions): string[] {
  const args: string[] = []

  if (options.socketName) {
    args.push('-L', options.socketName)
  } else if (options.socketPath) {
    args.push('-S', options.socketPath)
  } else {
    // Check if we're inside a tmux session
    const tmuxEnv = process.env.TMUX
    if (tmuxEnv) {
      // TMUX env var format: /path/to/socket,pid,pane
      const socketPath = tmuxEnv.split(',')[0]
      if (socketPath) {
        args.push('-S', socketPath)
      } else {
        // Fallback to default tmux socket if parsing fails
        // (no args means use default)
      }
    } else {
      // Outside tmux, use default socket (no args means use default)
    }
  }

  return args
}

export function getTmuxSocketString(options: TmuxSocketOptions): string {
  return getTmuxSocketArgs(options).join(' ')
}
