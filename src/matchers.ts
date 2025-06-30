import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { type Matcher, parseMatchers } from './schemas/matcher-schema.js'

export { type Matcher } from './schemas/matcher-schema.js'

const matchersYaml = readFileSync(
  fileURLToPath(new URL('../matchers.yaml', import.meta.url)),
  'utf8',
)

const matchersData = yaml.load(matchersYaml)

export const MATCHERS: Matcher[] = parseMatchers(matchersData)
