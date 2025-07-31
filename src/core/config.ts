import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { z } from 'zod'

const ConfigSchema = z
  .object({
    worktree: z.boolean().optional(),
    'worktrees-path': z.string().optional(),
    'projects-path': z.string().optional(),
    commands: z
      .object({
        'run-agent': z.string().optional(),
        'before-finish': z.string().optional(),
      })
      .optional(),
  })
  .strict()

export type Config = z.infer<typeof ConfigSchema>

export interface ConfigValue<T> {
  value: T
  source: 'global' | 'project' | 'default'
  sourcePath: string
}

export interface ConfigWithSources {
  worktree?: ConfigValue<boolean>
  'worktrees-path'?: ConfigValue<string>
  'projects-path'?: ConfigValue<string>
  commands?: {
    'run-agent'?: ConfigValue<string>
    'before-finish'?: ConfigValue<string>
  }
}

export function loadConfig(projectPath?: string): Config {
  const configBaseDir = projectPath || process.cwd()

  const CONFIG_FILE_LOCATIONS = [
    path.join(os.homedir(), '.config', 'tmux-composer', 'config.yaml'),
    path.join(os.homedir(), '.tmux-composer', 'config.yaml'),
    path.join(configBaseDir, '.tmux-composer.yaml'),
    path.join(configBaseDir, 'tmux-composer.yaml'),
  ]

  let mergedConfig: Config = {}

  for (const configPath of CONFIG_FILE_LOCATIONS) {
    try {
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const parsedYaml = yaml.load(fileContent)
        const validatedConfig = ConfigSchema.parse(parsedYaml)

        const newCommands = {
          ...(mergedConfig.commands || {}),
          ...(validatedConfig.commands || {}),
        }

        mergedConfig = { ...mergedConfig, ...validatedConfig }

        if (mergedConfig.commands || validatedConfig.commands) {
          mergedConfig.commands = newCommands
        }
      }
    } catch (error) {
      console.error(`Error loading config from ${configPath}:`, error)
      throw error
    }
  }

  return mergedConfig
}

export function loadConfigWithSources(projectPath?: string): ConfigWithSources {
  const configBaseDir = projectPath || process.cwd()

  const globalPaths = [
    path.join(os.homedir(), '.config', 'tmux-composer', 'config.yaml'),
    path.join(os.homedir(), '.tmux-composer', 'config.yaml'),
  ]

  const projectPaths = [
    path.join(configBaseDir, '.tmux-composer.yaml'),
    path.join(configBaseDir, 'tmux-composer.yaml'),
  ]

  const configWithSources: ConfigWithSources = {}

  const processConfigFile = (configPath: string, isGlobal: boolean) => {
    try {
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const parsedYaml = yaml.load(fileContent)
        const validatedConfig = ConfigSchema.parse(parsedYaml)

        if (validatedConfig.worktree !== undefined) {
          configWithSources.worktree = {
            value: validatedConfig.worktree,
            source: isGlobal ? 'global' : 'project',
            sourcePath: configPath,
          }
        }

        if (validatedConfig['worktrees-path'] !== undefined) {
          configWithSources['worktrees-path'] = {
            value: validatedConfig['worktrees-path'],
            source: isGlobal ? 'global' : 'project',
            sourcePath: configPath,
          }
        }

        if (validatedConfig['projects-path'] !== undefined) {
          configWithSources['projects-path'] = {
            value: validatedConfig['projects-path'],
            source: isGlobal ? 'global' : 'project',
            sourcePath: configPath,
          }
        }

        if (validatedConfig.commands) {
          if (!configWithSources.commands) {
            configWithSources.commands = {}
          }

          if (validatedConfig.commands['run-agent'] !== undefined) {
            configWithSources.commands['run-agent'] = {
              value: validatedConfig.commands['run-agent'],
              source: isGlobal ? 'global' : 'project',
              sourcePath: configPath,
            }
          }

          if (validatedConfig.commands['before-finish'] !== undefined) {
            configWithSources.commands['before-finish'] = {
              value: validatedConfig.commands['before-finish'],
              source: isGlobal ? 'global' : 'project',
              sourcePath: configPath,
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error loading config from ${configPath}:`, error)
      throw error
    }
  }

  for (const configPath of globalPaths) {
    processConfigFile(configPath, true)
  }

  for (const configPath of projectPaths) {
    processConfigFile(configPath, false)
  }

  return configWithSources
}
