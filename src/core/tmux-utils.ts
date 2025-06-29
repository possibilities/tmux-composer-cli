import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { getTmuxSocketString } from './tmux-socket.js'
import type { TmuxSocketOptions } from './tmux-socket.js'
import { BIG_TERMINAL_WIDTH, BIG_TERMINAL_HEIGHT } from './constants.js'

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

export function hasBufferContent(
  socketOptions: TmuxSocketOptions = {},
): boolean {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const output = execSync(`tmux ${socketArgs} show-buffer`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return output.trim().length > 0
  } catch {
    return false
  }
}

export async function resizeWindow(
  sessionName: string,
  windowName: string,
  width: number = BIG_TERMINAL_WIDTH,
  height: number = BIG_TERMINAL_HEIGHT,
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

export function getSessionEnvironment(
  sessionName: string,
  variable: string,
  socketOptions: TmuxSocketOptions = {},
): string | null {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const output = execSync(
      `tmux ${socketArgs} showenv -t ${sessionName} ${variable}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    ).trim()

    if (output.startsWith(`${variable}=`)) {
      return output.substring(variable.length + 1)
    }
    return null
  } catch {
    return null
  }
}

export interface Pane {
  sessionId: string
  windowIndex: string
  paneIndex: string
  pid: string
}

export function getTmuxPanes(socketOptions: TmuxSocketOptions = {}): Pane[] {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const format = '#{session_id} #{window_index} #{pane_index} #{pane_pid}'
    const output = execSync(`tmux ${socketArgs} list-panes -a -F "${format}"`, {
      encoding: 'utf-8',
    })

    return output
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [sessionId, windowIndex, paneIndex, pid] = line.trim().split(' ')
        return { sessionId, windowIndex, paneIndex, pid }
      })
  } catch {
    return []
  }
}

export function getProcessTree(): Map<string, string[]> {
  const tree = new Map<string, string[]>()

  try {
    const psOutput = execSync(`ps -eo pid=,ppid=,comm=`, { encoding: 'utf-8' })
    psOutput.split('\n').forEach(line => {
      const parts = line.trim().split(/\s+/, 3)
      if (parts.length === 3) {
        const [pid, ppid, command] = parts
        if (!tree.has(ppid)) tree.set(ppid, [])
        tree.get(ppid)!.push(pid + ':' + command)
      }
    })
  } catch {}

  return tree
}

export function findDescendant(
  pid: string,
  command: string,
  tree: Map<string, string[]>,
): boolean {
  const stack = [pid]
  while (stack.length) {
    const current = stack.pop()!
    const children = tree.get(current) || []
    for (const entry of children) {
      const [childPid, childCmd] = entry.split(':')
      if (childCmd.includes(command)) return true
      stack.push(childPid)
    }
  }
  return false
}

export interface PaneWithCommand {
  sessionId: string
  windowIndex: string
  paneIndex: string
  paneId: string
}

export async function findPanesWithCommand(
  command: string,
  socketOptions: TmuxSocketOptions = {},
): Promise<PaneWithCommand[]> {
  const panes = getTmuxPanes(socketOptions)
  const tree = getProcessTree()
  const matchingPanes: PaneWithCommand[] = []

  for (const pane of panes) {
    if (findDescendant(pane.pid, command, tree)) {
      const paneId = `${pane.sessionId}:${pane.windowIndex}.${pane.paneIndex}`
      matchingPanes.push({
        sessionId: pane.sessionId,
        windowIndex: pane.windowIndex,
        paneIndex: pane.paneIndex,
        paneId,
      })
    }
  }

  return matchingPanes
}

export async function getWindowInfo(
  sessionName: string,
  windowName: string,
  socketOptions: TmuxSocketOptions = {},
): Promise<{ sessionId: string; windowIndex: string } | null> {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const { stdout } = await execAsync(
      `tmux ${socketArgs} list-windows -t ${sessionName} -F "#{session_id} #{window_index} #{window_name}"`,
      { encoding: 'utf-8' },
    )

    const lines = stdout.trim().split('\n')
    for (const line of lines) {
      const parts = line.split(' ')
      if (parts.length >= 3) {
        const [sessionId, windowIndex, ...windowNameParts] = parts
        const winName = windowNameParts.join(' ')
        if (winName === windowName) {
          return { sessionId, windowIndex }
        }
      }
    }
    return null
  } catch {
    return null
  }
}
