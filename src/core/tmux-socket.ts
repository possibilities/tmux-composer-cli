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

export function getDatabasePath(options: TmuxSocketOptions): string {
  const baseDir = path.join(os.homedir(), '.control')

  if (options.socketName) {
    // If socket name is provided, use it in the database filename
    return path.join(baseDir, `cli-${options.socketName}.db`)
  } else if (options.socketPath) {
    // If socket path is provided, use its basename in the database filename
    const socketBasename = path.basename(options.socketPath)
    return path.join(baseDir, `cli-${socketBasename}.db`)
  } else {
    // Default behavior - use the standard database name
    return path.join(baseDir, 'cli.db')
  }
}
