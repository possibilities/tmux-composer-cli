import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { z } from 'zod'

const ConfigSchema = z.object({
  commands: z
    .object({
      'before-finish': z.string().optional(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>

const CONFIG_FILE_LOCATIONS = [
  path.join(os.homedir(), '.config', 'tmux-composer', 'config.yaml'),
  path.join(os.homedir(), '.tmux-composer', 'config.yaml'),
  path.join(process.cwd(), '.tmux-composer.yaml'),
  path.join(process.cwd(), 'tmux-composer.yaml'),
]

export function loadConfig(): Config {
  let mergedConfig: Config = {}

  for (const configPath of CONFIG_FILE_LOCATIONS) {
    try {
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const parsedYaml = yaml.load(fileContent)
        const validatedConfig = ConfigSchema.parse(parsedYaml)
        mergedConfig = { ...mergedConfig, ...validatedConfig }

        if (validatedConfig.commands) {
          mergedConfig.commands = {
            ...mergedConfig.commands,
            ...validatedConfig.commands,
          }
        }
      }
    } catch (error) {
      console.error(`Error loading config from ${configPath}:`, error)
      throw error
    }
  }

  return mergedConfig
}
