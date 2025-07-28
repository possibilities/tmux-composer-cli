import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { getTmuxSocketString } from './tmux-socket.js'
import type { TmuxSocketOptions } from './tmux-socket.js'
import type { WindowInfo, PaneInfo } from '../types/project.js'

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

export function listSessions(socketOptions: TmuxSocketOptions = {}): string[] {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const stdout = execSync(
      `tmux ${socketArgs} list-sessions -F "#{session_name}"`,
      { encoding: 'utf-8' },
    )
    return stdout.trim() ? stdout.trim().split('\n') : []
  } catch {
    return []
  }
}

export function getAttachedSession(
  socketOptions: TmuxSocketOptions = {},
): string | null {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const stdout = execSync(
      `tmux ${socketArgs} display-message -p "#{client_session}"`,
      { encoding: 'utf-8' },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function switchToSession(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): boolean {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    execSync(`tmux ${socketArgs} switch-client -t ${sessionName}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

export function getAllTmuxSessions(
  socketOptions: TmuxSocketOptions = {},
): string[] {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const stdout = execSync(
      `tmux ${socketArgs} list-sessions -F "#{session_name}"`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    )
    return stdout.trim() ? stdout.trim().split('\n') : []
  } catch {
    return []
  }
}

export function getSessionMode(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): 'worktree' | 'project' | 'session' {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const mode = execSync(
      `tmux ${socketArgs} show-environment -t ${sessionName} TMUX_COMPOSER_MODE 2>/dev/null | cut -d= -f2`,
      { encoding: 'utf-8' },
    ).trim()

    return mode === 'worktree' || mode === 'session' ? mode : 'project'
  } catch {
    return 'project'
  }
}

export function getSessionPort(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): number | undefined {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const port = execSync(
      `tmux ${socketArgs} show-environment -t ${sessionName} PORT 2>/dev/null | cut -d= -f2`,
      { encoding: 'utf-8' },
    ).trim()

    return port ? parseInt(port, 10) : undefined
  } catch {
    return undefined
  }
}

export function getSessionPaneInfo(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): WindowInfo[] {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)

    const windowsOutput = execSync(
      `tmux ${socketArgs} list-windows -t ${sessionName} -F "#{window_index}|#{window_name}|#{window_active}"`,
      { encoding: 'utf-8' },
    )

    const windows: WindowInfo[] = []

    if (!windowsOutput.trim()) return windows

    const windowLines = windowsOutput.trim().split('\n')

    for (const windowLine of windowLines) {
      const [indexStr, name, activeStr] = windowLine.split('|')
      const windowIndex = parseInt(indexStr, 10)

      const panesOutput = execSync(
        `tmux ${socketArgs} list-panes -t ${sessionName}:${windowIndex} -F "#{pane_index}|#{pane_width}|#{pane_height}|#{pane_current_command}|#{pane_current_path}"`,
        { encoding: 'utf-8' },
      )

      const panes: PaneInfo[] = []

      if (panesOutput.trim()) {
        const paneLines = panesOutput.trim().split('\n')

        for (const paneLine of paneLines) {
          const parts = paneLine.split('|')
          if (parts.length >= 5) {
            const index = parts[0]
            const width = parseInt(parts[1], 10)
            const height = parseInt(parts[2], 10)
            const currentCommand = parts[3]
            const currentPath = parts.slice(4).join('|')

            panes.push({
              index,
              width,
              height,
              currentCommand,
              currentPath,
            })
          }
        }
      }

      windows.push({
        index: windowIndex,
        name,
        active: activeStr === '1',
        panes,
      })
    }

    return windows
  } catch {
    return []
  }
}

export function getProjectSessions(
  projectName: string,
  socketOptions: TmuxSocketOptions = {},
): Array<{
  name: string
  mode: 'worktree' | 'project' | 'session'
  port?: number
  windows?: WindowInfo[]
}> {
  const allSessions = getAllTmuxSessions(socketOptions)

  const matchingSessions = allSessions.filter(session => {
    if (session === projectName) {
      return true
    }

    const worktreePattern = new RegExp(`^${projectName}-worktree-\\d+$`)
    return worktreePattern.test(session)
  })

  return matchingSessions.map(sessionName => ({
    name: sessionName,
    mode: getSessionMode(sessionName, socketOptions),
    port: getSessionPort(sessionName, socketOptions),
    windows: getSessionPaneInfo(sessionName, socketOptions),
  }))
}
