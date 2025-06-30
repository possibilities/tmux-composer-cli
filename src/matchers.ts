import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { type Matcher, parseMatchers } from './schemas/matcher-schema.js'

export { type Matcher } from './schemas/matcher-schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function loadMatchers(): Matcher[] {
  let matchersPath: string

  // Try to load from dist directory first (production)
  try {
    matchersPath = join(__dirname, 'matchers.yaml')
    const content = readFileSync(matchersPath, 'utf8')
    const data = yaml.load(content)
    return parseMatchers(data)
  } catch (error) {
    // Fallback to project root (development)
    try {
      matchersPath = join(__dirname, '..', 'matchers.yaml')
      const content = readFileSync(matchersPath, 'utf8')
      const data = yaml.load(content)
      return parseMatchers(data)
    } catch (fallbackError) {
      throw new Error(
        `Failed to load matchers.yaml from both production and development paths: ${error.message}, ${fallbackError.message}`,
      )
    }
  }
}

export const MATCHERS: Matcher[] = loadMatchers()
