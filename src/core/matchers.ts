export interface Matcher {
  name: string
  trigger: string[]
  wrappedTrigger?: string[]
  response: string
  runOnce: boolean
  mode: 'act' | 'plan' | 'all'
}

export const MATCHERS: Matcher[] = [
  {
    name: 'dismiss-trust-folder-confirmation',
    trigger: [
      'Do you trust the files in this folder?',
      'Enter to confirm · Esc to exit',
    ],
    response: '<Enter>',
    runOnce: false,
    mode: 'all',
  },
  {
    name: 'ensure-plan-mode',
    trigger: ['? for shortcuts'],
    wrappedTrigger: ['? for', 'shortcuts'],
    response: '<S-Tab><S-Tab>',
    runOnce: true,
    mode: 'plan',
  },
  {
    name: 'inject-initial-context-plan',
    trigger: ['⏸ plan mode on'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
    mode: 'plan',
  },
  {
    name: 'inject-initial-context-act',
    trigger: ['? for shortcuts'],
    wrappedTrigger: ['? for', 'shortcuts'],
    response: '{paste-buffer}<Enter>',
    runOnce: true,
    mode: 'act',
  },
  {
    name: 'dismiss-create-file-confirmation',
    trigger: ['Create file', 'Do you want to create', '1. Yes'],
    response: '1',
    runOnce: false,
    mode: 'all',
  },
  {
    name: 'dismiss-edit-file-confirmation',
    trigger: ['Edit file', 'Do you want to make this edit to', '1. Yes'],
    response: '1',
    runOnce: false,
    mode: 'all',
  },
  {
    name: 'dismiss-run-command-confirmation',
    trigger: ['Bash command', 'Do you want to proceed', '1. Yes'],
    response: '1',
    runOnce: false,
    mode: 'all',
  },
  {
    name: 'dismiss-read-file-confirmation',
    trigger: ['Read files', 'Do you want to proceed', '1. Yes'],
    response: '1',
    runOnce: false,
    mode: 'all',
  },
]
