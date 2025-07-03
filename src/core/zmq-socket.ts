import fs from 'fs'
import path from 'path'

export interface ZmqSocketOptions {
  socketName?: string
  socketPath?: string
}

export function getZmqSocketDirectory(): string {
  const uid = process.getuid ? process.getuid() : 1000
  return `/tmp/tmux-composer-${uid}`
}

export function getZmqSocketPath(options: ZmqSocketOptions = {}): string {
  if (options.socketPath) {
    return options.socketPath
  }

  const socketDir = getZmqSocketDirectory()
  const socketName = options.socketName || 'default'

  return `ipc://${socketDir}/${socketName}`
}

export async function ensureZmqSocketDirectory(): Promise<void> {
  const socketDir = getZmqSocketDirectory()

  try {
    await fs.promises.mkdir(socketDir, {
      recursive: true,
      mode: 0o700,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}

export function cleanupStaleSocket(socketPath: string): void {
  const match = socketPath.match(/^ipc:\/\/(.+)$/)
  if (!match) return

  const filePath = match[1]

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    console.error(`Failed to cleanup stale socket at ${filePath}:`, error)
  }
}
