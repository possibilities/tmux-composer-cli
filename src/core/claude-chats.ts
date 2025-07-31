import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

const CLAUDE_CHATS_DB_PATH = path.join(os.homedir(), '.claude', 'chats.db')

export function getLatestChatTimestamp(
  projectPath: string,
  worktreesPath?: string,
): string | undefined {
  if (!fs.existsSync(CLAUDE_CHATS_DB_PATH)) {
    return undefined
  }

  let db: Database.Database | undefined
  try {
    db = new Database(CLAUDE_CHATS_DB_PATH, { readonly: true })

    const projectName = path.basename(projectPath)
    const actualWorktreesPath =
      worktreesPath || path.join(os.homedir(), 'worktrees')
    const worktreePattern = path.join(
      actualWorktreesPath,
      `${projectName}-worktree-%`,
    )

    const query = `
      SELECT created
      FROM entries
      WHERE cwd = ? OR cwd LIKE ?
      ORDER BY created DESC
      LIMIT 1
    `

    const row = db.prepare(query).get(projectPath, worktreePattern) as
      | { created: number }
      | undefined

    if (!row) {
      return undefined
    }

    const timestamp = new Date(row.created * 1000).toISOString()
    return timestamp
  } catch (error) {
    console.error('Error reading claude chats database:', error)
    return undefined
  } finally {
    if (db) {
      db.close()
    }
  }
}

export function getLatestChatTimestamps(
  projectPaths: string[],
): Map<string, string> {
  const timestamps = new Map<string, string>()

  if (!fs.existsSync(CLAUDE_CHATS_DB_PATH)) {
    return timestamps
  }

  let db: Database.Database | undefined
  try {
    db = new Database(CLAUDE_CHATS_DB_PATH, { readonly: true })

    const placeholders = projectPaths.map(() => '?').join(',')
    const query = `
      SELECT cwd, MAX(created) as latest_created
      FROM entries
      WHERE cwd IN (${placeholders})
      GROUP BY cwd
    `

    const rows = db.prepare(query).all(...projectPaths) as Array<{
      cwd: string
      latest_created: number
    }>

    for (const row of rows) {
      const timestamp = new Date(row.latest_created * 1000).toISOString()
      timestamps.set(row.cwd, timestamp)
    }

    return timestamps
  } catch (error) {
    console.error('Error reading claude chats database:', error)
    return timestamps
  } finally {
    if (db) {
      db.close()
    }
  }
}

export function getSessionStartTime(
  sessionName: string,
  projectPath: string,
  worktreesPath?: string,
): string | undefined {
  const tmuxSessionTimestamp = getTmuxSessionCreationTime(sessionName)
  if (tmuxSessionTimestamp) {
    return tmuxSessionTimestamp
  }

  return getFirstChatTimestamp(sessionName, projectPath, worktreesPath)
}

function getTmuxSessionCreationTime(sessionName: string): string | undefined {
  try {
    const tmuxOutput = execSync(
      `tmux ls -F "#{session_name}:#{session_created}" 2>/dev/null | grep "^${sessionName}:" | head -1`,
      { encoding: 'utf-8', shell: '/bin/bash' },
    ).trim()

    if (tmuxOutput) {
      const [, createdTimestamp] = tmuxOutput.split(':')
      if (createdTimestamp) {
        return new Date(parseInt(createdTimestamp) * 1000).toISOString()
      }
    }
    return undefined
  } catch (error) {
    return undefined
  }
}

function getFirstChatTimestamp(
  sessionName: string,
  projectPath: string,
  worktreesPath?: string,
): string | undefined {
  if (!fs.existsSync(CLAUDE_CHATS_DB_PATH)) {
    return undefined
  }

  let db: Database.Database | undefined
  try {
    db = new Database(CLAUDE_CHATS_DB_PATH, { readonly: true })

    let searchPath: string

    if (sessionName.includes('-worktree-')) {
      const actualWorktreesPath =
        worktreesPath || path.join(os.homedir(), 'worktrees')
      searchPath = path.join(actualWorktreesPath, sessionName)
    } else {
      searchPath = projectPath
    }

    const query = `
      SELECT MIN(created) as first_created
      FROM entries
      WHERE cwd = ?
    `

    const row = db.prepare(query).get(searchPath) as
      | { first_created: number }
      | undefined

    if (!row || !row.first_created) {
      return undefined
    }

    const timestamp = new Date(row.first_created * 1000).toISOString()
    return timestamp
  } catch (error) {
    console.error(
      'Error reading session start time from claude chats database:',
      error,
    )
    return undefined
  } finally {
    if (db) {
      db.close()
    }
  }
}
