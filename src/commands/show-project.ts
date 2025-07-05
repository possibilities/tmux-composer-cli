import { execSync } from 'child_process'
import path from 'path'
import { EventEmitter } from 'events'
import { loadConfigWithSources } from '../core/config.js'
import {
  isGitRepositoryClean,
  getNextWorktreeNumber,
} from '../core/git-utils.js'
import type { ConfigWithSources } from '../core/config.js'

interface ShowProjectOptions {
  json?: boolean
}

interface ProjectInfo {
  name: string
  path: string
  git: {
    branch: string
    commit: string
    status: 'clean' | 'dirty'
  }
  nextWorktreeNumber?: string
}

export class ProjectShower extends EventEmitter {
  async show(projectPath: string, options: ShowProjectOptions = {}) {
    const resolvedPath = projectPath || process.cwd()

    try {
      const projectInfo = this.getProjectInfo(resolvedPath)
      const configWithSources = loadConfigWithSources(resolvedPath)

      const resolvedConfigWithSources = this.applyDefaults(configWithSources)

      const resolvedWorktree = resolvedConfigWithSources.worktree?.value ?? true
      if (resolvedWorktree) {
        projectInfo.nextWorktreeNumber = getNextWorktreeNumber(resolvedPath)
      }

      if (options.json) {
        this.outputJson(projectInfo, resolvedConfigWithSources)
      } else {
        this.outputTable(projectInfo, resolvedConfigWithSources)
      }
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : String(error),
      )
      process.exit(1)
    }
  }

  private applyDefaults(
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

    return result
  }

  private getProjectInfo(projectPath: string): ProjectInfo {
    const projectName = path.basename(projectPath)

    const branch = execSync('git branch --show-current', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    const commit = execSync('git rev-parse --short HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim()

    const isClean = isGitRepositoryClean(projectPath)

    return {
      name: projectName,
      path: projectPath,
      git: {
        branch,
        commit,
        status: isClean ? 'clean' : 'dirty',
      },
    }
  }

  private outputJson(
    projectInfo: ProjectInfo,
    configWithSources: ConfigWithSources,
  ) {
    const output: {
      project: ProjectInfo & { nextWorktreeNumber?: string }
      config: Partial<ConfigWithSources>
    } = {
      project: {
        name: projectInfo.name,
        path: projectInfo.path,
        git: projectInfo.git,
        ...(projectInfo.nextWorktreeNumber && {
          nextWorktreeNumber: projectInfo.nextWorktreeNumber,
        }),
      },
      config: {},
    }

    if (configWithSources.worktree) {
      output.config['worktree'] = configWithSources.worktree
    }

    if (configWithSources['worktrees-path']) {
      output.config['worktrees-path'] = configWithSources['worktrees-path']
    }

    if (configWithSources.commands) {
      output.config['commands'] = {}

      if (configWithSources.commands['run-agent']) {
        output.config['commands']['run-agent'] =
          configWithSources.commands['run-agent']
      }

      if (configWithSources.commands['before-finish']) {
        output.config['commands']['before-finish'] =
          configWithSources.commands['before-finish']
      }
    }

    console.log(JSON.stringify(output, null, 2))
  }

  private outputTable(
    projectInfo: ProjectInfo,
    configWithSources: ConfigWithSources,
  ) {
    const rows: Array<{ property: string; value: string; source: string }> = []

    rows.push({
      property: 'Project Name',
      value: projectInfo.name,
      source: '-',
    })
    rows.push({
      property: 'Project Path',
      value: projectInfo.path,
      source: '-',
    })
    rows.push({
      property: 'Git Branch',
      value: projectInfo.git.branch,
      source: '-',
    })
    rows.push({
      property: 'Git Commit',
      value: projectInfo.git.commit,
      source: '-',
    })
    rows.push({
      property: 'Git Status',
      value: projectInfo.git.status,
      source: '-',
    })

    if (projectInfo.nextWorktreeNumber) {
      rows.push({
        property: 'Next Worktree Number',
        value: projectInfo.nextWorktreeNumber,
        source: '-',
      })
    }

    if (configWithSources.worktree) {
      rows.push({
        property: 'worktree',
        value: String(configWithSources.worktree.value),
        source: configWithSources.worktree.source,
      })
    }

    if (configWithSources['worktrees-path']) {
      rows.push({
        property: 'worktrees-path',
        value: configWithSources['worktrees-path'].value,
        source: configWithSources['worktrees-path'].source,
      })
    }

    if (configWithSources.commands?.['run-agent']) {
      const value = configWithSources.commands['run-agent'].value
      const truncatedValue =
        value.length > 50 ? value.substring(0, 47) + '...' : value
      rows.push({
        property: 'commands.run-agent',
        value: truncatedValue,
        source: configWithSources.commands['run-agent'].source,
      })
    }

    if (configWithSources.commands?.['before-finish']) {
      const value = configWithSources.commands['before-finish'].value
      const truncatedValue =
        value.length > 50 ? value.substring(0, 47) + '...' : value
      rows.push({
        property: 'commands.before-finish',
        value: truncatedValue,
        source: configWithSources.commands['before-finish'].source,
      })
    }

    const propertyWidth = Math.max(
      ...rows.map(r => r.property.length),
      'Property'.length,
    )
    const valueWidth = Math.max(
      ...rows.map(r => r.value.length),
      'Value'.length,
    )
    const sourceWidth = Math.max(
      ...rows.map(r => r.source.length),
      'Source'.length,
    )

    console.log(
      '┌' +
        '─'.repeat(propertyWidth + 2) +
        '┬' +
        '─'.repeat(valueWidth + 2) +
        '┬' +
        '─'.repeat(sourceWidth + 2) +
        '┐',
    )
    console.log(
      '│ ' +
        'Property'.padEnd(propertyWidth) +
        ' │ ' +
        'Value'.padEnd(valueWidth) +
        ' │ ' +
        'Source'.padEnd(sourceWidth) +
        ' │',
    )
    console.log(
      '├' +
        '─'.repeat(propertyWidth + 2) +
        '┼' +
        '─'.repeat(valueWidth + 2) +
        '┼' +
        '─'.repeat(sourceWidth + 2) +
        '┤',
    )

    for (const row of rows) {
      console.log(
        '│ ' +
          row.property.padEnd(propertyWidth) +
          ' │ ' +
          row.value.padEnd(valueWidth) +
          ' │ ' +
          row.source.padEnd(sourceWidth) +
          ' │',
      )
    }

    console.log(
      '└' +
        '─'.repeat(propertyWidth + 2) +
        '┴' +
        '─'.repeat(valueWidth + 2) +
        '┴' +
        '─'.repeat(sourceWidth + 2) +
        '┘',
    )
  }
}
