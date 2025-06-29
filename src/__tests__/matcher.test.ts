import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../core/matchers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Terminal size configurations matching e2e tests
const TERMINAL_SIZES = [
  { width: 80, height: 24 },
  { width: 50, height: 24 },
]

describe('Matcher mechanism', () => {
  TERMINAL_SIZES.forEach(terminalSize => {
    describe(`Terminal size ${terminalSize.width}x${terminalSize.height}`, () => {
      MATCHERS.forEach(matcher => {
        it(`should match ${matcher.name} pattern`, () => {
          const fixturePath = join(
            __dirname,
            '../../fixtures',
            `${matcher.name}-${terminalSize.width}x${terminalSize.height}.txt`,
          )
          const tmuxOutput = readFileSync(fixturePath, 'utf-8')

          const cleanedContent = cleanContent(tmuxOutput)
          const contentLines = cleanedContent.split('\n')
          const result = matchesPattern(contentLines, matcher.trigger)

          expect(result).toBe(true)
        })
      })
    })
  })
})
