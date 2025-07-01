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
    const tmuxEnv = process.env.TMUX
    if (tmuxEnv) {
      const socketPath = tmuxEnv.split(',')[0]
      if (socketPath) {
        args.push('-S', socketPath)
      } else {
      }
    } else {
    }
  }

  return args
}

export function getTmuxSocketString(options: TmuxSocketOptions): string {
  return getTmuxSocketArgs(options).join(' ')
}

export function getTmuxSocketPath(options: TmuxSocketOptions): string {
  if (options.socketPath) {
    return options.socketPath
  }

  if (options.socketName) {
    const uid = process.getuid ? process.getuid() : 1000
    return `/tmp/tmux-${uid}/${options.socketName}`
  }

  const tmuxEnv = process.env.TMUX
  if (tmuxEnv) {
    const socketPath = tmuxEnv.split(',')[0]
    if (socketPath) {
      return socketPath
    }
  }

  const uid = process.getuid ? process.getuid() : 1000
  return `/tmp/tmux-${uid}/default`
}
