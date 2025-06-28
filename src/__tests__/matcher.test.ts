import { describe, it, expect } from 'vitest'
import dedent from 'dedent'
import { cleanContent, matchesPattern } from '../matcher.js'

describe('Matcher mechanism', () => {
  it('should match folder-is-trusted pattern', () => {
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

    const folderIsTrustedPattern = [
      ' ❯ 1. Yes, proceed',
      '   2. No, exit',
      '   Enter to confirm · Esc to exit',
    ]

    const cleanedContent = cleanContent(tmuxOutput)
    const contentLines = cleanedContent.split('\n')
    const result = matchesPattern(contentLines, folderIsTrustedPattern)

    expect(result).toBe(true)
  })
})
