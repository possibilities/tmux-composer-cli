import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const CODE_PATH = path.join(os.homedir(), 'code')
export const WORKTREES_PATH = path.join(os.homedir(), 'code', 'worktrees')

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

export function getNextWorktreeNumber(projectName: string): string {
  let i = 1
  while (i < 1000) {
    const num = i.toString().padStart(3, '0')
    const worktreePath = path.join(
      WORKTREES_PATH,
      `${projectName}-worktree-${num}`,
    )

    try {
      const branchExists = execSync(`git branch --list "worktree-${num}"`, {
        cwd: path.join(CODE_PATH, projectName),
        encoding: 'utf-8',
      }).trim()

      if (!branchExists && !fs.existsSync(worktreePath)) {
        return num
      }
    } catch {
      if (!fs.existsSync(worktreePath)) {
        return num
      }
    }

    i++
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
