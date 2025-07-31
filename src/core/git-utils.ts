import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadConfig } from './config.js'

export function isInProjectsDir(projectPath: string): boolean {
  const projectsPath = process.env.PROJECTS_PATH
  if (!projectsPath) return false

  const normalizedProjectPath = path.resolve(projectPath)
  const normalizedProjectsPath = path.resolve(projectsPath)

  return normalizedProjectPath === normalizedProjectsPath
}

export function getWorktreesPath(projectPath?: string): string {
  const envPath = process.env.TMUX_COMPOSER_WORKTREES_PATH
  if (envPath) {
    return path.resolve(envPath.replace(/^~/, os.homedir()))
  }

  const config = loadConfig(projectPath)
  if (config['worktrees-path']) {
    return path.resolve(config['worktrees-path'].replace(/^~/, os.homedir()))
  }

  return path.join(os.homedir(), 'worktrees')
}

export function getMainRepositoryPath(worktreePath: string): string {
  try {
    const gitCommonDir = execSync(
      `git -C "${worktreePath}" rev-parse --path-format=absolute --git-common-dir`,
      {
        encoding: 'utf-8',
      },
    ).trim()

    if (gitCommonDir.endsWith('.git')) {
      return path.dirname(gitCommonDir)
    }

    return gitCommonDir
  } catch (error) {
    throw new Error(
      `Failed to find main repository path: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function isGitRepositoryClean(projectPath: string): boolean {
  try {
    execSync(
      `git -C "${projectPath}" diff --quiet && git -C "${projectPath}" diff --cached --quiet`,
      {
        encoding: 'utf-8',
      },
    )
    return true
  } catch {
    return false
  }
}

export function getNextSessionNumber(projectPath: string): string {
  const projectName = path.basename(projectPath)
  const usedNumbers = new Set<number>()

  const branches = execSync(
    `git -C "${projectPath}" for-each-ref --format='%(refname:short)' refs/heads/worktree-*`,
    {
      encoding: 'utf-8',
    },
  ).trim()

  if (branches) {
    const branchNumbers = branches
      .split('\n')
      .map(branch => branch.trim().replace(/^\*?\s*/, ''))
      .filter(branch => /^worktree-\d{5}$/.test(branch))
      .map(branch => parseInt(branch.substring(9), 10))

    branchNumbers.forEach(num => usedNumbers.add(num))
  }

  try {
    const worktrees = getExistingWorktrees(projectPath)
    worktrees.forEach(wt => {
      if (wt.branch && /^worktree-\d{5}$/.test(wt.branch)) {
        const num = parseInt(wt.branch.substring(9), 10)
        usedNumbers.add(num)
      }
    })
  } catch {}

  const worktreesPath = getWorktreesPath(projectPath)
  if (fs.existsSync(worktreesPath)) {
    const dirs = fs.readdirSync(worktreesPath)
    const worktreePattern = new RegExp(`^${projectName}-worktree-(\\d{5})$`)

    dirs.forEach(dir => {
      const match = dir.match(worktreePattern)
      if (match) {
        usedNumbers.add(parseInt(match[1], 10))
      }
    })
  }

  for (let i = 1; i < 1000; i++) {
    if (!usedNumbers.has(i)) {
      return i.toString().padStart(5, '0')
    }
  }

  throw new Error('No available session numbers')
}

export function createWorktree(
  projectPath: string,
  projectName: string,
  worktreeNum: string,
): string {
  const worktreePath = path.join(
    getWorktreesPath(projectPath),
    `${projectName}-worktree-${worktreeNum}`,
  )
  const branchName = `worktree-${worktreeNum}`

  try {
    execSync(
      `git -C "${projectPath}" worktree add -q "${worktreePath}" -b "${branchName}"`,
      {
        encoding: 'utf-8',
      },
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage.includes('already exists')) {
      try {
        execSync(
          `git -C "${projectPath}" worktree add -q "${worktreePath}" "${branchName}"`,
          {
            encoding: 'utf-8',
          },
        )
      } catch (retryError) {
        throw new Error(
          `Failed to create worktree: Branch '${branchName}' already exists and may be in use by another worktree. ` +
            `Run 'git worktree list' in ${projectPath} to check existing worktrees.`,
        )
      }
    } else {
      throw error
    }
  }

  const envFilePath = path.join(projectPath, '.env')
  const worktreeEnvPath = path.join(worktreePath, '.env')

  if (fs.existsSync(envFilePath)) {
    try {
      fs.copyFileSync(envFilePath, worktreeEnvPath)
    } catch (copyError) {
      console.error(
        `Warning: Failed to copy .env file to worktree: ${copyError instanceof Error ? copyError.message : String(copyError)}`,
      )
    }
  }

  return worktreePath
}

export function installDependencies(worktreePath: string) {
  const lockFilePath = path.join(worktreePath, 'pnpm-lock.yaml')
  if (fs.existsSync(lockFilePath)) {
    execSync('pnpm install', {
      cwd: worktreePath,
      encoding: 'utf-8',
    })
  }
}

export interface WorktreeInfo {
  path: string
  branch: string
  commit: string
  bare?: boolean
  detached?: boolean
  locked?: boolean
  prunable?: boolean
}

export function getExistingWorktrees(projectPath: string): WorktreeInfo[] {
  try {
    const output = execSync(
      `git -C "${projectPath}" worktree list --porcelain`,
      {
        encoding: 'utf-8',
      },
    ).trim()

    if (!output) return []

    const worktrees: WorktreeInfo[] = []
    const lines = output.split('\n')
    let currentWorktree: Partial<WorktreeInfo> = {}

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (currentWorktree.path) {
          worktrees.push(currentWorktree as WorktreeInfo)
        }
        currentWorktree = { path: line.substring(9) }
      } else if (line.startsWith('HEAD ')) {
        currentWorktree.commit = line.substring(5)
      } else if (line.startsWith('branch ')) {
        currentWorktree.branch = line.substring(7).replace('refs/heads/', '')
      } else if (line === 'bare') {
        currentWorktree.bare = true
      } else if (line === 'detached') {
        currentWorktree.detached = true
      } else if (line.startsWith('locked')) {
        currentWorktree.locked = true
      } else if (line.startsWith('prunable')) {
        currentWorktree.prunable = true
      } else if (line === '' && currentWorktree.path) {
        worktrees.push(currentWorktree as WorktreeInfo)
        currentWorktree = {}
      }
    }

    if (currentWorktree.path) {
      worktrees.push(currentWorktree as WorktreeInfo)
    }

    return worktrees
  } catch (error) {
    throw new Error(
      `Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function getLatestWorktree(projectPath: string): WorktreeInfo | null {
  const worktrees = getExistingWorktrees(projectPath)
  const worktreesPath = getWorktreesPath(projectPath)

  const projectWorktrees = worktrees.filter(wt => {
    const wtBasename = path.basename(wt.path)
    return (
      /-worktree-\d{5}$/.test(wtBasename) && wt.path.startsWith(worktreesPath)
    )
  })

  if (projectWorktrees.length === 0) return null

  const worktreesWithStats = projectWorktrees.map(wt => {
    try {
      const stats = fs.statSync(wt.path)
      return { ...wt, mtime: stats.mtime }
    } catch {
      return { ...wt, mtime: new Date(0) }
    }
  })

  worktreesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  return worktreesWithStats[0]
}

export interface WorktreeInfoWithNumber extends WorktreeInfo {
  worktreeNumber: number
  projectName: string
  mtime: Date
}

export function getAllProjectWorktrees(
  projectPath: string,
): WorktreeInfoWithNumber[] {
  const worktrees = getExistingWorktrees(projectPath)
  const worktreesPath = getWorktreesPath(projectPath)

  const projectWorktrees = worktrees.filter(wt => {
    const wtBasename = path.basename(wt.path)
    return (
      /-worktree-\d{5}$/.test(wtBasename) && wt.path.startsWith(worktreesPath)
    )
  })

  const worktreesWithInfo = projectWorktrees
    .map(wt => {
      const wtBasename = path.basename(wt.path)
      const match = wtBasename.match(/^(.+)-worktree-(\d{5})$/)

      if (!match) return null

      if (!fs.existsSync(wt.path)) {
        return null
      }

      try {
        execSync(`git -C "${wt.path}" rev-parse --is-inside-work-tree`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        })
      } catch {
        return null
      }

      try {
        const stats = fs.statSync(wt.path)
        return {
          ...wt,
          projectName: match[1],
          worktreeNumber: parseInt(match[2], 10),
          mtime: stats.mtime,
        }
      } catch {
        return {
          ...wt,
          projectName: match[1],
          worktreeNumber: parseInt(match[2], 10),
          mtime: new Date(0),
        }
      }
    })
    .filter((wt): wt is WorktreeInfoWithNumber => wt !== null)

  worktreesWithInfo.sort((a, b) => b.worktreeNumber - a.worktreeNumber)

  return worktreesWithInfo
}
