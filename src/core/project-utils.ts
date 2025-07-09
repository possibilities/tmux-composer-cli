import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isGitRepositoryClean } from './git-utils.js'
import { loadConfigWithSources } from './config.js'
import { getLatestChatTimestamp } from './claude-chats.js'
import type { ConfigWithSources } from './config.js'
import type { ProjectInfo } from '../types/project.js'

export async function getProjectInfo(
  projectPath: string,
  worktreesPath?: string,
): Promise<ProjectInfo> {
  const projectName = path.basename(projectPath)
  const projectInfo: ProjectInfo = {
    name: projectName,
    path: projectPath,
  }

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
  }

  projectInfo.files = getFileIndicators(projectPath)

  const latestChat = getLatestChatTimestamp(projectPath, worktreesPath)
  if (latestChat) {
    projectInfo.latestChat = latestChat
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

export async function getProjectData(projectPath: string) {
  const configWithSources = loadConfigWithSources(projectPath)
  const resolvedConfigWithSources = applyDefaults(configWithSources)
  const worktreesPath = resolvedConfigWithSources['worktrees-path']?.value

  const projectInfo = await getProjectInfo(projectPath, worktreesPath)

  return {
    project: projectInfo,
    config: extractRelevantConfig(resolvedConfigWithSources),
  }
}
