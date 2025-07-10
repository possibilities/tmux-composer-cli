import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isGitRepositoryClean } from './git-utils.js'
import { loadConfigWithSources } from './config.js'
import { getLatestChatTimestamp } from './claude-chats.js'
import { getProjectSessions } from './tmux-utils.js'
import type { ConfigWithSources } from './config.js'
import type { ProjectInfo } from '../types/project.js'

const RELEASE_SCRIPT_NAMES = [
  'release',
  'release:patch',
  'release:minor',
  'release:major',
] as const

export async function getProjectInfo(
  projectPath: string,
  worktreesPath?: string,
  isProjectsPath: boolean = false,
): Promise<ProjectInfo> {
  const projectName = path.basename(projectPath)
  const projectInfo: ProjectInfo = {
    name: projectName,
    path: projectPath,
    hasReleaseScript: false,
    isGitRepositoryClean: true,
    isProjectsPath,
  }

  projectInfo.files = getFileIndicators(projectPath)
  projectInfo.hasReleaseScript = checkHasReleaseScript(projectPath)

  if (isGitRepository(projectPath)) {
    const branch = execSync('git branch --show-current', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    const commit = execSync('git rev-parse --short HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    const isClean = isGitRepositoryClean(projectPath)
    projectInfo.isGitRepositoryClean = isClean

    const latestCommit = execSync('git log -1 --format=%cd --date=iso-strict', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    projectInfo.git = {
      branch,
      commit,
      status: isClean ? 'clean' : 'dirty',
    }
    projectInfo.latestCommit = latestCommit

    const lastReleaseVersion = getLastReleaseVersion(projectPath)
    if (lastReleaseVersion) {
      projectInfo.lastReleaseVersion = lastReleaseVersion
      projectInfo.commitsSinceLastRelease = getCommitsSinceRelease(
        projectPath,
        lastReleaseVersion,
      )
    }
  }

  const latestChat = getLatestChatTimestamp(projectPath, worktreesPath)
  if (latestChat) {
    projectInfo.latestChat = latestChat
  }

  const activeSessions = getProjectSessions(projectName)
  if (activeSessions.length > 0) {
    projectInfo.activeSessions = activeSessions
  }

  return projectInfo
}

export function isGitRepository(projectPath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

export function getFileIndicators(projectPath: string): ProjectInfo['files'] {
  const dotGit = fs.existsSync(path.join(projectPath, '.git'))
  const packageJson = fs.existsSync(path.join(projectPath, 'package.json'))
  const tmuxComposerConfig =
    fs.existsSync(path.join(projectPath, 'tmux-composer.yaml')) ||
    fs.existsSync(path.join(projectPath, '.tmux-composer.yaml'))

  return {
    dotGit,
    packageJson,
    tmuxComposerConfig,
  }
}

export function applyDefaults(
  configWithSources: ConfigWithSources,
): ConfigWithSources {
  const result: ConfigWithSources = { ...configWithSources }

  if (!result.worktree) {
    result.worktree = {
      value: true,
      source: 'default',
      sourcePath: 'default',
    }
  }

  if (!result['projects-path']) {
    result['projects-path'] = {
      value: path.join(os.homedir(), 'code'),
      source: 'default',
      sourcePath: 'default',
    }
  }

  if (!result['worktrees-path']) {
    result['worktrees-path'] = {
      value: path.join(os.homedir(), 'worktrees'),
      source: 'default',
      sourcePath: 'default',
    }
  }

  return result
}

export function extractRelevantConfig(
  configWithSources: ConfigWithSources,
): Partial<ConfigWithSources> {
  const {
    worktree,
    'worktrees-path': worktreesPath,
    commands,
  } = configWithSources
  const relevantCommands = commands
    ? {
        ...(commands['run-agent'] && { 'run-agent': commands['run-agent'] }),
        ...(commands['before-finish'] && {
          'before-finish': commands['before-finish'],
        }),
      }
    : undefined

  return {
    ...(worktree && { worktree }),
    ...(worktreesPath && { 'worktrees-path': worktreesPath }),
    ...(relevantCommands &&
      Object.keys(relevantCommands).length > 0 && {
        commands: relevantCommands,
      }),
  }
}

function getLastReleaseVersion(projectPath: string): string | undefined {
  try {
    const lastTag = execSync('git describe --tags --abbrev=0', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()

    const versionPattern = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?)$/
    if (versionPattern.test(lastTag)) {
      return lastTag
    }
    return undefined
  } catch {
    return undefined
  }
}

function getCommitsSinceRelease(
  projectPath: string,
  releaseTag: string,
): number {
  try {
    const commitCount = execSync(
      `git rev-list --count ${JSON.stringify(releaseTag)}..HEAD`,
      {
        cwd: projectPath,
        encoding: 'utf-8',
      },
    ).trim()
    return parseInt(commitCount, 10)
  } catch {
    return 0
  }
}

function checkHasReleaseScript(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8')
    const packageJson = JSON.parse(packageJsonContent)
    const scripts = packageJson.scripts || {}

    return RELEASE_SCRIPT_NAMES.some(scriptName => scriptName in scripts)
  } catch {
    return false
  }
}

export async function getProjectData(projectPath: string) {
  const configWithSources = loadConfigWithSources(projectPath)
  const resolvedConfigWithSources = applyDefaults(configWithSources)
  const worktreesPath = resolvedConfigWithSources['worktrees-path']?.value
  const projectsPath = resolvedConfigWithSources['projects-path']?.value

  const normalizedProjectPath = path.resolve(projectPath)
  const normalizedProjectsPath = projectsPath
    ? path.resolve(projectsPath)
    : null

  const isAtProjectsPath =
    normalizedProjectsPath && normalizedProjectPath === normalizedProjectsPath

  if (isAtProjectsPath) {
    resolvedConfigWithSources.worktree = {
      value: true,
      source: 'project',
      sourcePath: undefined as any,
    }
  }

  const projectInfo = await getProjectInfo(
    projectPath,
    worktreesPath,
    !!isAtProjectsPath,
  )

  return {
    project: projectInfo,
    config: extractRelevantConfig(resolvedConfigWithSources),
  }
}
