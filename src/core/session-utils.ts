import { execSync } from 'child_process'
import { getTmuxSocketString } from './tmux-socket.js'
import {
  getSessionPaneInfo,
  getSessionMode,
  getSessionPort,
} from './tmux-utils.js'
import type { TmuxSocketOptions } from './tmux-socket.js'
import type { WindowInfoWithContent, SessionData } from '../types/project.js'

export function getSessionData(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): SessionData {
  const sessionExists = checkSessionExists(sessionName, socketOptions)
  if (!sessionExists) {
    throw new Error(`Session '${sessionName}' not found`)
  }

  const mode = getSessionMode(sessionName, socketOptions)
  const port = getSessionPort(sessionName, socketOptions)
  const windows = getSessionPaneInfo(sessionName, socketOptions)

  const windowsWithContent: WindowInfoWithContent[] = windows.map(window => {
    const panesWithContent = window.panes.map(pane => {
      const paneTarget = `${sessionName}:${window.index}.${pane.index}`
      const content = capturePaneContent(paneTarget, socketOptions)

      return {
        ...pane,
        content,
      }
    })

    return {
      ...window,
      panes: panesWithContent,
    }
  })

  return {
    name: sessionName,
    mode,
    port,
    windows: windowsWithContent,
  }
}

function checkSessionExists(
  sessionName: string,
  socketOptions: TmuxSocketOptions = {},
): boolean {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    execSync(`tmux ${socketArgs} has-session -t ${sessionName}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function capturePaneContent(
  paneTarget: string,
  socketOptions: TmuxSocketOptions = {},
): string {
  try {
    const socketArgs = getTmuxSocketString(socketOptions)
    const content = execSync(
      `tmux ${socketArgs} capture-pane -p -t ${paneTarget}`,
      { encoding: 'utf-8' },
    )
    return content
  } catch {
    return ''
  }
}
