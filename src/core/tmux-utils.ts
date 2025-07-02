import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { getTmuxSocketString } from './tmux-socket.js'
import type { TmuxSocketOptions } from './tmux-socket.js'
import { TERMINAL_SIZES } from './constants.js'

const execAsync = promisify(exec)

export async function listWindows(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): Promise<string[]> {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const { stdout } = await execAsync(
      `tmux ${socketArgs} list-windows -t ${sessionName} -F "#{window_name}"`,
      { encoding: 'utf-8' },
    )
    return stdout.trim() ? stdout.trim().split('\n') : []
  } catch {
    return []
  }
}

export async function capturePane(
  sessionName: string,
  windowName: string,
  socketOptions: TmuxSocketOptions = {},
): Promise<string> {
  const socketArgs = getTmuxSocketString(socketOptions)
  const { stdout } = await execAsync(
    `tmux ${socketArgs} capture-pane -p -t ${sessionName}:${windowName}`,
    {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  return stdout
}

export async function resizeWindow(
  sessionName: string,
  windowName: string,
  width: number = TERMINAL_SIZES.big.width,
  height: number = TERMINAL_SIZES.big.height,
  socketOptions: TmuxSocketOptions = {},
) {
  const socketArgs = getTmuxSocketString(socketOptions)
  await execAsync(
    `tmux ${socketArgs} resize-window -t ${sessionName}:${windowName} -x ${width} -y ${height}`,
    { encoding: 'utf-8' },
  )
}

export function socketExists(socketOptions: TmuxSocketOptions = {}): boolean {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    execSync(`tmux ${socketArgs} list-sessions`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

