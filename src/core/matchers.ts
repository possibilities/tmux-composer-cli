export interface Matcher {
  name: string
  trigger: string[]
  response: string
  runOnce: boolean
  mode?: 'act' | 'plan'
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
    mode: 'plan',
  },
  {
    name: 'inject-initial-context-plan',
    trigger: [' ⏸ plan mode on (shift+tab to cycle)'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
    mode: 'plan',
  },
  {
    name: 'inject-initial-context-act',
    trigger: [' ? for shortcuts'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
    mode: 'act',
  },
]
