import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../core/matchers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function testMatcherPattern(matcherName: string) {
  const fixturePath = join(__dirname, '../../fixtures', `${matcherName}.txt`)
  const tmuxOutput = readFileSync(fixturePath, 'utf-8')

  const matcher = MATCHERS.find(m => m.name === matcherName)
  if (!matcher) {
    throw new Error(`${matcherName} matcher not found`)
  }

  const cleanedContent = cleanContent(tmuxOutput)
  const contentLines = cleanedContent.split('\n')
  const result = matchesPattern(contentLines, matcher.trigger)

  expect(result).toBe(true)
}

describe('Matcher mechanism', () => {
  it('should match dismiss-trust-folder-confirmation pattern', () => {
    testMatcherPattern('dismiss-trust-folder-confirmation')
  })
  it('should match ensure-plan-mode pattern', () => {
    testMatcherPattern('ensure-plan-mode')
  })
  it('should match inject-initial-context-plan pattern', () => {
    testMatcherPattern('inject-initial-context-plan')
  })
  it('should match dismiss-create-file-confirmation pattern', () => {
    testMatcherPattern('dismiss-create-file-confirmation')
  })
  it('should match dismiss-edit-file-confirmation pattern', () => {
    testMatcherPattern('dismiss-edit-file-confirmation')
  })
  it('should match dismiss-run-command-confirmation pattern', () => {
    testMatcherPattern('dismiss-run-command-confirmation')
  })
})
