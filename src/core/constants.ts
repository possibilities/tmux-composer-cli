export const POLL_INTERVAL = 500
export const MAX_CHECKSUM_CACHE_SIZE = 1000
export const AUTOMATION_PAUSE_MS = 500
export const DEFAULT_TERMINAL_WIDTH = 80
export const DEFAULT_TERMINAL_HEIGHT = 24

export interface Matcher {
  name: string
  trigger: string[]
  response: string
  runOnce: boolean
}

export const MATCHERS: Matcher[] = [
  {
    name: 'trust-folder',
    trigger: [
      'Do you trust the files in this folder?',
      ' Enter to confirm · Esc to exit',
    ],
    response: '<Enter>',
    runOnce: true,
  },
  {
    name: 'ensure-plan-mode',
    trigger: [' ? for shortcuts'],
    response: '<S-Tab><S-Tab>',
    runOnce: true,
  },
  {
    name: 'inject-initial-context',
    trigger: [' ⏸ plan mode on (shift+tab to cycle)'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
  },
]

export interface ControlConfig {
  name?: string
  agents?: {
    act?: string
    plan?: string
  }
  context?: {
    act?: string
    plan?: string
  }
}
