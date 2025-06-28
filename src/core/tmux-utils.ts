import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { getTmuxSocketString } from './tmux-socket.js'
import type { TmuxSocketOptions } from './tmux-socket.js'

const execAsync = promisify(exec)

export async function listSessions(
  socketOptions: TmuxSocketOptions = {},
): Promise<string[]> {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const { stdout } = await execAsync(
      `tmux ${socketArgs} list-sessions -F "#{session_name}"`,
      { encoding: 'utf-8' },
    )
    return stdout.trim() ? stdout.trim().split('\n') : []
  } catch {
    return []
  }
}

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

export async function checkHumanControl(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): Promise<boolean> {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const { stdout } = await execAsync(
      `tmux ${socketArgs} list-clients -t ${sessionName} -F "#{client_name}"`,
      { encoding: 'utf-8' },
    )
    const clientCount = stdout.trim() ? stdout.trim().split('\n').length : 0
    return clientCount > 0
  } catch {
    return false
  }
}

export function sendKeys(
  sessionName: string,
  windowName: string,
  keys: string,
  socketOptions: TmuxSocketOptions = {},
) {
  const socketArgs = getTmuxSocketString(socketOptions)
  const escapedKeys = keys.replace(/'/g, "'\"'\"'")
  execSync(
    `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} -l '${escapedKeys}'`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
  )
}

export function sendKey(
  sessionName: string,
  windowName: string,
  key: string,
  socketOptions: TmuxSocketOptions = {},
) {
  const socketArgs = getTmuxSocketString(socketOptions)
  execSync(
    `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} ${key}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
  )
}

export function pasteBuffer(
  sessionName: string,
  windowName: string,
  socketOptions: TmuxSocketOptions = {},
) {
  const socketArgs = getTmuxSocketString(socketOptions)
  execSync(`tmux ${socketArgs} paste-buffer -t ${sessionName}:${windowName}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  })
}

export async function resizeWindow(
  sessionName: string,
  windowName: string,
  width: number = 80,
  height: number = 24,
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

export function convertToTmuxKey(keyName: string): string {
  const keyMap: Record<string, string> = {
    Enter: 'Enter',
    Return: 'Enter',
    Tab: 'Tab',
    'S-Tab': 'BTab',
    Space: 'Space',
    Escape: 'Escape',
    Esc: 'Escape',
    Up: 'Up',
    Down: 'Down',
    Left: 'Left',
    Right: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Delete: 'Delete',
    Backspace: 'BSpace',
    Insert: 'Insert',
  }

  if (keyMap[keyName]) {
    return keyMap[keyName]
  }

  if (keyName.match(/^[CMS]-./)) {
    return keyName
  }

  if (keyName.match(/^F\d{1,2}$/)) {
    return keyName
  }

  return keyName
}
