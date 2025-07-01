#!/usr/bin/env node

import { SessionCreator } from './dist/cli.js'

const creator = new SessionCreator()

creator.emitEvent('initialize-session-creation', {
  projectPath: '/test/path',
  options: {
    mode: 'act',
    attach: false,
  },
})

creator.emitEvent('create-worktree-session:start')
creator.emitEvent('analyze-project-metadata:start')
creator.emitEvent('analyze-project-metadata:end', {
  projectPath: '/test/path',
  projectName: 'test-project',
  worktreeNumber: 1,
  sessionName: 'test-project-worktree-1',
  duration: 50,
})

creator.emitEvent('ensure-clean-repository:start')
creator.emitEvent('ensure-clean-repository:fail', {
  isClean: false,
  error: 'Repository has uncommitted changes',
  errorCode: 'DIRTY_REPOSITORY',
  duration: 120,
})

creator.emitEvent('create-worktree-session:fail', {
  error: 'Repository has uncommitted changes',
  duration: 200,
})
