import path from 'path'
import os from 'os'

export interface TmuxSocketOptions {
  socketName?: string // -L option
  socketPath?: string // -S option
}

export function getTmuxSocketArgs(options: TmuxSocketOptions): string[] {
  const args: string[] = []

  if (options.socketName) {
    args.push('-L', options.socketName)
  } else if (options.socketPath) {
    args.push('-S', options.socketPath)
  } else {
    // Default socket path
    args.push('-S', path.join(os.tmpdir(), 'control-app-tmux'))
  }

  return args
}

export function getTmuxSocketString(options: TmuxSocketOptions): string {
  return getTmuxSocketArgs(options).join(' ')
}
