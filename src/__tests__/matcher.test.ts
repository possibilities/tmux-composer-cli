import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../core/matchers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Matcher mechanism', () => {
  MATCHERS.forEach(matcher => {
    it(`should match ${matcher.name} pattern`, () => {
      const fixturePath = join(
        __dirname,
        '../../fixtures',
        `${matcher.name}.txt`,
      )
      const tmuxOutput = readFileSync(fixturePath, 'utf-8')

      const cleanedContent = cleanContent(tmuxOutput)
      const contentLines = cleanedContent.split('\n')
      const result = matchesPattern(contentLines, matcher.trigger)

      expect(result).toBe(true)
    })
  })
})
