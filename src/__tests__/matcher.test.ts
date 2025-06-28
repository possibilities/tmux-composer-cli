import { describe, it, expect } from 'vitest'
import dedent from 'dedent'
import { cleanContent, matchesPattern } from '../matcher.js'
import { MATCHERS } from '../index.js'

describe('Matcher mechanism', () => {
  it('should match do-you-trust-this-folder pattern', () => {
    const tmuxOutput = dedent`
      ┌─╼[02:25:14]
      └─╼[~/code/worktrees/icon-creator-ui-worktree-130]
       ╰╼[worktree-130]╾─╼[40504c6]
      ▶ claude "$(context-composer work-on-icon-creator)"
      ╭──────────────────────────────────────────────────────────────────────────────╮
      │                                                                              │
      │ Do you trust the files in this folder?                                       │
      │                                                                              │
      │ /home/mike/code/worktrees/icon-creator-ui-worktree-130                       │
      │                                                                              │
      │ Claude Code may read files in this folder. Reading untrusted files may lead  │
      │ Claude Code to behave in unexpected ways.                                    │
      │                                                                              │
      │ With your permission Claude Code may execute files in this folder. Executing │
      │  untrusted code is unsafe.                                                   │
      │                                                                              │
      │ https://docs.anthropic.com/s/claude-code-security                            │
      │                                                                              │
      │ ❯ 1. Yes, proceed                                                            │
      │   2. No, exit                                                                │
      │                                                                              │
      ╰──────────────────────────────────────────────────────────────────────────────╯
         Enter to confirm · Esc to exit
      
    `

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
})
