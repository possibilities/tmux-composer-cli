import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getMainRepositoryPath } from './git-utils.js'

export function syncWorktreeToMain(worktreePath: string): void {
  console.log('Syncing worktree to main branch...')

  const mainRepoPath = getMainRepositoryPath(worktreePath)
  const currentBranch = execSync('git branch --show-current', {
    cwd: worktreePath,
    encoding: 'utf-8',
  }).trim()

  const mainBranch = 'main'

  execSync(`git checkout ${mainBranch}`, {
    cwd: mainRepoPath,
    encoding: 'utf-8',
  })

  execSync(`git merge ${currentBranch} --no-edit`, {
    cwd: mainRepoPath,
    encoding: 'utf-8',
  })

  console.log(`Successfully merged ${currentBranch} into ${mainBranch}`)

  execSync('git push', {
    cwd: mainRepoPath,
    encoding: 'utf-8',
  })
  console.log(`Successfully pushed ${mainBranch} to remote`)

  const packageJsonPath = path.join(mainRepoPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    if (packageJson.scripts?.build) {
      console.log('Running build in main project...')
      execSync('pnpm run build', {
        cwd: mainRepoPath,
        encoding: 'utf-8',
        stdio: 'inherit',
      })
      console.log('Build completed successfully')
    }
  }
}

export function checkAndInstallDependencies(worktreePath: string): void {
  const changedFiles = execSync(
    'git diff-tree --no-commit-id --name-only -r HEAD',
    {
      cwd: worktreePath,
      encoding: 'utf-8',
    },
  )
    .trim()
    .split('\n')
    .filter(Boolean)

  if (changedFiles.includes('pnpm-lock.yaml')) {
    console.log(
      'pnpm-lock.yaml was modified, installing dependencies in main project...',
    )

    const mainRepoPath = getMainRepositoryPath(worktreePath)
    const lockFilePath = path.join(mainRepoPath, 'pnpm-lock.yaml')

    if (fs.existsSync(lockFilePath)) {
      execSync('pnpm install', {
        cwd: mainRepoPath,
        encoding: 'utf-8',
        stdio: 'inherit',
      })
      console.log('Dependencies installed successfully')
    }
  }
}
