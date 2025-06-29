import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanContent,
  matchesPattern,
  matchesLastPattern,
  matchesFullPattern,
} from '../matcher.js'
import { MATCHERS } from '../core/matchers.js'
import { TERMINAL_SIZES } from '../core/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Matcher mechanism', () => {
  Object.entries(TERMINAL_SIZES).forEach(([sizeName, terminalSize]) => {
    describe(`Terminal size ${terminalSize.width}x${terminalSize.height}`, () => {
      MATCHERS.forEach(matcher => {
        it(`should match ${matcher.name} pattern with pane view`, () => {
          const fixturePath = join(
            __dirname,
            '../../fixtures',
            `${matcher.name}-${terminalSize.width}x${terminalSize.height}.txt`,
          )
          const tmuxOutput = readFileSync(fixturePath, 'utf-8')

          const cleanedContent = cleanContent(tmuxOutput)
          const contentLines = cleanedContent.split('\n')

          let result: boolean
          if (matcher.trigger.length === 1) {
            result = matchesPattern(contentLines, matcher.trigger)
          } else {
            result = matchesLastPattern(contentLines, matcher.trigger)
          }

          expect(result).toBe(true)
        })

        if (matcher.trigger.length > 1) {
          it(`should match ${matcher.name} pattern with two-phase matching`, () => {
            const paneFixturePath = join(
              __dirname,
              '../../fixtures',
              `${matcher.name}-${terminalSize.width}x${terminalSize.height}.txt`,
            )
            const fullFixturePath = join(
              __dirname,
              '../../fixtures',
              `${matcher.name}-${terminalSize.width}x${terminalSize.height}-full.txt`,
            )

            if (!existsSync(fullFixturePath)) {
              console.log(
                `Skipping full fixture test for ${matcher.name} - fixture not yet generated`,
              )
              return
            }

            const paneOutput = readFileSync(paneFixturePath, 'utf-8')
            const fullOutput = readFileSync(fullFixturePath, 'utf-8')

            const cleanedPaneContent = cleanContent(paneOutput)
            const paneLines = cleanedPaneContent.split('\n')

            const cleanedFullContent = cleanContent(fullOutput)
            const fullLines = cleanedFullContent.split('\n')

            const lastPatternResult = matchesLastPattern(
              paneLines,
              matcher.trigger,
            )
            expect(lastPatternResult).toBe(true)

            const fullPatternResult = matchesFullPattern(
              fullLines,
              matcher.trigger,
            )
            expect(fullPatternResult).toBe(true)
          })
        }
      })
    })
  })
})
