import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../core/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Matcher mechanism', () => {
  it('should match do-you-trust-this-folder pattern', () => {
    const fixturePath = join(
      __dirname,
      '../../fixtures/do-you-trust-this-folder.txt',
    )
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')

    const folderIsTrustedMatcher = MATCHERS.find(
      m => m.name === 'do-you-trust-this-folder',
    )
    if (!folderIsTrustedMatcher) {
      throw new Error('do-you-trust-this-folder matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, folderIsTrustedMatcher.trigger)

    expect(result).toBe(true)
  })

  it('should match ensure-plan-mode pattern', () => {
    const fixturePath = join(__dirname, '../../fixtures/ensure-plan-mode.txt')
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')
    const ensurePlanModeMatcher = MATCHERS.find(
      m => m.name === 'ensure-plan-mode',
    )
    if (!ensurePlanModeMatcher) {
      throw new Error('ensure-plan-mode matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, ensurePlanModeMatcher.trigger)

    expect(result).toBe(true)
  })

  it('should match plan-mode-on pattern', () => {
    const fixturePath = join(__dirname, '../../fixtures/plan-mode-on.txt')
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')
    const planModeOnMatcher = MATCHERS.find(m => m.name === 'plan-mode-on')
    if (!planModeOnMatcher) {
      throw new Error('plan-mode-on matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, planModeOnMatcher.trigger)

    expect(result).toBe(true)
  })
})
