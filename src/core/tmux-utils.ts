import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { getTmuxSocketString } from './tmux-socket.js'
import type { TmuxSocketOptions } from './tmux-socket.js'

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
): 'worktree' | 'project' {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const mode = execSync(
      `tmux ${socketArgs} show-environment -t ${sessionName} TMUX_COMPOSER_MODE 2>/dev/null | cut -d= -f2`,
      { encoding: 'utf-8' },
    ).trim()

    return mode === 'worktree' ? 'worktree' : 'project'
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

export function getProjectSessions(
  projectName: string,
  socketOptions: TmuxSocketOptions = {},
): Array<{ name: string; mode: 'worktree' | 'project'; port?: number }> {
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
  }))
}
