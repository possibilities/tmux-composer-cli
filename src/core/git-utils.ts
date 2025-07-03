import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const WORKTREES_PATH = path.join(os.homedir(), 'code', 'worktrees')

export function getMainRepositoryPath(worktreePath: string): string {
  try {
    const gitCommonDir = execSync(
      'git rev-parse --path-format=absolute --git-common-dir',
      {
        cwd: worktreePath,
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
    execSync('git diff --quiet && git diff --cached --quiet', {
      cwd: projectPath,
      encoding: 'utf-8',
    })
    return true
  } catch {
    return false
  }
}

export function getNextWorktreeNumber(projectPath: string): string {
  const projectName = path.basename(projectPath)
  const usedNumbers = new Set<number>()

  try {
    const branches = execSync('git branch --list "worktree-*"', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    if (branches) {
      const branchNumbers = branches
        .split('\n')
        .map(branch => branch.trim().replace(/^\*?\s*/, ''))
        .filter(branch => /^worktree-\d{3}$/.test(branch))
        .map(branch => parseInt(branch.substring(9), 10))

      branchNumbers.forEach(num => usedNumbers.add(num))
    }
  } catch {}

  if (fs.existsSync(WORKTREES_PATH)) {
    try {
      const dirs = fs.readdirSync(WORKTREES_PATH)
      const pattern = new RegExp(`^${projectName}-worktree-(\\d{3})$`)

      dirs.forEach(dir => {
        const match = dir.match(pattern)
        if (match) {
          usedNumbers.add(parseInt(match[1], 10))
        }
      })
    } catch {}
  }

  for (let i = 1; i < 1000; i++) {
    if (!usedNumbers.has(i)) {
      return i.toString().padStart(3, '0')
    }
  }

  throw new Error('No available worktree numbers')
}

export function createWorktree(
  projectPath: string,
  projectName: string,
  worktreeNum: string,
): string {
  const worktreePath = path.join(
    WORKTREES_PATH,
    `${projectName}-worktree-${worktreeNum}`,
  )
  const branchName = `worktree-${worktreeNum}`

  execSync(`git worktree add -q "${worktreePath}" -b "${branchName}"`, {
    cwd: projectPath,
    encoding: 'utf-8',
  })

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
