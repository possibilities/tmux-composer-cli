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
    args.push('-S', path.join(os.tmpdir(), 'control-app-tmux'))
  }

  return args
}

export function getTmuxSocketString(options: TmuxSocketOptions): string {
  return getTmuxSocketArgs(options).join(' ')
}
