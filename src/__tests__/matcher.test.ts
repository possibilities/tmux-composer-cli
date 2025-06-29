import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../core/matchers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Matcher mechanism', () => {
  it('should match trust-folder pattern', () => {
    const fixturePath = join(__dirname, '../../fixtures/trust-folder.txt')
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')

    const folderIsTrustedMatcher = MATCHERS.find(m => m.name === 'trust-folder')
    if (!folderIsTrustedMatcher) {
      throw new Error('trust-folder matcher not found')
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

  it('should match inject-initial-context-plan pattern', () => {
    const fixturePath = join(
      __dirname,
      '../../fixtures/inject-initial-context-plan.txt',
    )
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')
    const planModeOnMatcher = MATCHERS.find(
      m => m.name === 'inject-initial-context-plan',
    )
    if (!planModeOnMatcher) {
      throw new Error('inject-initial-context-plan matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, planModeOnMatcher.trigger)

    expect(result).toBe(true)
  })

  it('should match dismiss-create-file-confirmation pattern', () => {
    const fixturePath = join(
      __dirname,
      '../../fixtures/dismiss-create-file-confirmation.txt',
    )
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')
    const planModeOnMatcher = MATCHERS.find(
      m => m.name === 'dismiss-create-file-confirmation',
    )
    if (!planModeOnMatcher) {
      throw new Error('dismiss-create-file-confirmation matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, planModeOnMatcher.trigger)

    expect(result).toBe(true)
  })

  it('should match dismiss-edit-file-confirmation pattern', () => {
    const fixturePath = join(
      __dirname,
      '../../fixtures/dismiss-edit-file-confirmation.txt',
    )
    const tmuxOutput = readFileSync(fixturePath, 'utf-8')
    const planModeOnMatcher = MATCHERS.find(
      m => m.name === 'dismiss-edit-file-confirmation',
    )
    if (!planModeOnMatcher) {
      throw new Error('dismiss-edit-file-confirmation matcher not found')
    }

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, planModeOnMatcher.trigger)

    expect(result).toBe(true)
  })
})
