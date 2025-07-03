import type { EventSource } from './zmq-publisher.js'

export type EventName =
  | 'session-changed'
  | 'pane-changed'
  | 'initialize-session-creation:start'
  | 'initialize-session-creation:end'
  | 'analyze-project-metadata:start'
  | 'analyze-project-metadata:end'
  | 'analyze-project-metadata:fail'
  | 'analyze-project-structure:start'
  | 'analyze-project-structure:end'
  | 'analyze-project-scripts:start'
  | 'analyze-project-scripts:end'
  | 'analyze-project-scripts:fail'
  | 'ensure-clean-repository:start'
  | 'ensure-clean-repository:end'
  | 'ensure-clean-repository:fail'
  | 'ensure-clean-repository:warn'
  | 'skip-worktree-creation'
  | 'create-worktree-session:start'
  | 'create-worktree-session:end'
  | 'create-worktree-session:fail'
  | 'create-project-worktree:start'
  | 'create-project-worktree:end'
  | 'create-project-worktree:fail'
  | 'install-project-dependencies:start'
  | 'install-project-dependencies:end'
  | 'install-project-dependencies:fail'
  | 'create-tmux-session:start'
  | 'create-tmux-session:end'
  | 'create-tmux-session:fail'
  | 'create-tmux-window:server:start'
  | 'create-tmux-window:server:end'
  | 'create-tmux-window:server:fail'
  | 'create-tmux-window:lint:start'
  | 'create-tmux-window:lint:end'
  | 'create-tmux-window:lint:fail'
  | 'create-tmux-window:types:start'
  | 'create-tmux-window:types:end'
  | 'create-tmux-window:types:fail'
  | 'create-tmux-window:test:start'
  | 'create-tmux-window:test:end'
  | 'create-tmux-window:test:fail'
  | 'create-tmux-window:control:start'
  | 'create-tmux-window:control:end'
  | 'create-tmux-window:control:fail'
  | 'find-open-port:start'
  | 'find-open-port:end'
  | 'find-open-port:fail'
  | 'finalize-tmux-session:start'
  | 'finalize-tmux-session:end'
  | 'attach-tmux-session:start'
  | 'attach-tmux-session:end'
  | 'attach-tmux-session:fail'
  | 'switch-tmux-session:start'
  | 'select-window:fail'
  | 'continue-session:start'
  | 'continue-session:end'
  | 'continue-session:fail'
  | 'find-latest-worktree:start'
  | 'find-latest-worktree:end'
  | 'find-latest-worktree:fail'

export interface BaseEventData {
  duration?: number
}

export interface ErrorEventData extends BaseEventData {
  error: string
  errorCode?: string
}

export interface SessionChangedData {
  sessionId: string | null
  sessionName: string | null
  focusedWindowId: string | null
  focusedPaneId: string | null
  windows: Array<{
    windowId: string
    windowIndex: string
    windowName: string
    isActive: boolean
    panes: Array<{
      paneId: string
      paneIndex: string
      command: string
      width: number
      height: number
      isActive: boolean
    }>
  }>
}

export interface PaneChangedData {
  sessionId: string
  windowIndex: string
  windowName: string
  paneIndex: string
  paneId: string
  content: string
}

export interface InitializeSessionCreationStartData {
  projectPath: string
  options: {
    socketName?: string | null
    socketPath?: string | null
    terminalWidth?: number
    terminalHeight?: number
    attach?: boolean
    worktreeMode?: boolean
  }
}

export interface AnalyzeProjectMetadataEndData extends BaseEventData {
  projectPath: string
  projectName: string
  worktreeNumber?: string
  sessionName: string
  worktreeMode?: boolean
}

export interface AnalyzeProjectStructureEndData extends BaseEventData {
  hasPackageJson: boolean
  packageJsonPath: string | null
  worktreeMode?: boolean
}

export interface AnalyzeProjectScriptsEndData extends BaseEventData {
  availableScripts: string[]
  plannedWindows: string[]
  error?: string
}

export interface EnsureCleanRepositoryEndData extends BaseEventData {
  isClean: boolean
  branch: string
  commitHash: string
  uncommittedFiles: string[]
  stagedFiles: string[]
}

export interface EnsureCleanRepositoryFailData extends ErrorEventData {
  isClean: boolean
}

export interface EnsureCleanRepositoryWarnData extends BaseEventData {
  isClean: boolean
  warning: string
}

export interface SkipWorktreeCreationData extends BaseEventData {
  reason: string
  currentPath: string
}

export interface CreateProjectWorktreeEndData extends BaseEventData {
  sourcePath: string
  worktreePath: string
  branch: string
  worktreeNumber?: string
}

export interface CreateProjectWorktreeFailData extends ErrorEventData {
  sourcePath: string
  worktreeNumber?: string
}

export interface InstallProjectDependenciesEndData extends BaseEventData {
  packageManager: string
  worktreePath: string
  hasPackageJson: boolean
  hasLockfile: boolean
}

export interface InstallProjectDependenciesFailData extends ErrorEventData {
  packageManager: string
  worktreePath: string
}

export interface CreateTmuxSessionEndData extends BaseEventData {
  sessionName: string
  sessionId: string
  socketPath: string
  firstWindow: string
  terminalSize: {
    width: number
    height: number
  }
}

export interface CreateTmuxWindowEndData extends BaseEventData {
  windowName: string
  windowIndex: number
  windowId: string
  command: string
  port?: number
  script?: string
  commands?: string[]
}

export interface CreateTmuxWindowFailData extends ErrorEventData {
  windowName: string
}

export interface FindOpenPortEndData extends BaseEventData {
  port: number
  windowName: string
}

export interface FindOpenPortFailData extends ErrorEventData {
  attemptedPorts: number
}

export interface FinalizeTmuxSessionEndData extends BaseEventData {
  sessionName: string
  selectedWindow: string
  totalWindows: number
  worktreePath: string
  worktreeMode?: boolean
  totalDuration: number
}

export interface CreateWorktreeSessionEndData extends BaseEventData {
  sessionName: string
  worktreePath: string
  windows: string[]
  worktreeMode?: boolean
  totalDuration: number
}

export interface AttachTmuxSessionEndData extends BaseEventData {
  sessionName: string
  windowsReady: boolean
  waitDuration?: number
  attachMethod?: string
  warning?: string
}

export interface AttachTmuxSessionFailData extends ErrorEventData {
  sessionName: string
  attachCommand: string
  insideTmux: boolean
}

export interface SwitchTmuxSessionStartData {
  sessionName: string
  fromInsideTmux: boolean
}

export interface SelectWindowFailData extends ErrorEventData {
  sessionName: string
  window: string
}

export interface ContinueSessionStartData {
  projectPath: string
  options: {
    socketName?: string | null
    socketPath?: string | null
    terminalWidth?: number
    terminalHeight?: number
    attach?: boolean
  }
}

export interface FindLatestWorktreeEndData extends BaseEventData {
  worktreePath: string
  projectName: string
  worktreeNumber: string
  sessionName: string
  branch: string
  commit: string
}

export interface FindLatestWorktreeFailData extends ErrorEventData {
  worktreePath?: string
}

export interface ContinueSessionEndData extends BaseEventData {
  sessionName: string
  worktreePath: string
  windows: string[]
  worktreeNumber: string
  branch: string
}

export type EventDataMap = {
  'session-changed': SessionChangedData
  'pane-changed': PaneChangedData
  'initialize-session-creation:start': InitializeSessionCreationStartData
  'initialize-session-creation:end': BaseEventData
  'analyze-project-metadata:start': undefined
  'analyze-project-metadata:end': AnalyzeProjectMetadataEndData
  'analyze-project-metadata:fail': ErrorEventData
  'analyze-project-structure:start': undefined
  'analyze-project-structure:end': AnalyzeProjectStructureEndData
  'analyze-project-scripts:start': undefined
  'analyze-project-scripts:end': AnalyzeProjectScriptsEndData
  'analyze-project-scripts:fail': ErrorEventData
  'ensure-clean-repository:start': undefined
  'ensure-clean-repository:end': EnsureCleanRepositoryEndData
  'ensure-clean-repository:fail': EnsureCleanRepositoryFailData
  'ensure-clean-repository:warn': EnsureCleanRepositoryWarnData
  'skip-worktree-creation': SkipWorktreeCreationData
  'create-worktree-session:start': undefined
  'create-worktree-session:end': CreateWorktreeSessionEndData
  'create-worktree-session:fail': ErrorEventData
  'create-project-worktree:start': undefined
  'create-project-worktree:end': CreateProjectWorktreeEndData
  'create-project-worktree:fail': CreateProjectWorktreeFailData
  'install-project-dependencies:start': undefined
  'install-project-dependencies:end': InstallProjectDependenciesEndData
  'install-project-dependencies:fail': InstallProjectDependenciesFailData
  'create-tmux-session:start': undefined
  'create-tmux-session:end': CreateTmuxSessionEndData
  'create-tmux-session:fail': ErrorEventData
  'create-tmux-window:server:start': undefined
  'create-tmux-window:server:end': CreateTmuxWindowEndData
  'create-tmux-window:server:fail': CreateTmuxWindowFailData
  'create-tmux-window:lint:start': undefined
  'create-tmux-window:lint:end': CreateTmuxWindowEndData
  'create-tmux-window:lint:fail': CreateTmuxWindowFailData
  'create-tmux-window:types:start': undefined
  'create-tmux-window:types:end': CreateTmuxWindowEndData
  'create-tmux-window:types:fail': CreateTmuxWindowFailData
  'create-tmux-window:test:start': undefined
  'create-tmux-window:test:end': CreateTmuxWindowEndData
  'create-tmux-window:test:fail': CreateTmuxWindowFailData
  'create-tmux-window:control:start': undefined
  'create-tmux-window:control:end': CreateTmuxWindowEndData
  'create-tmux-window:control:fail': CreateTmuxWindowFailData
  'find-open-port:start': undefined
  'find-open-port:end': FindOpenPortEndData
  'find-open-port:fail': FindOpenPortFailData
  'finalize-tmux-session:start': undefined
  'finalize-tmux-session:end': FinalizeTmuxSessionEndData
  'attach-tmux-session:start': undefined
  'attach-tmux-session:end': AttachTmuxSessionEndData
  'attach-tmux-session:fail': AttachTmuxSessionFailData
  'switch-tmux-session:start': SwitchTmuxSessionStartData
  'select-window:fail': SelectWindowFailData
  'continue-session:start': ContinueSessionStartData
  'continue-session:end': ContinueSessionEndData
  'continue-session:fail': ErrorEventData
  'find-latest-worktree:start': undefined
  'find-latest-worktree:end': FindLatestWorktreeEndData
  'find-latest-worktree:fail': FindLatestWorktreeFailData
}

export interface TmuxEvent<T extends EventName = EventName> {
  event: T
  data: T extends keyof EventDataMap
    ? EventDataMap[T] extends undefined
      ? never
      : EventDataMap[T]
    : never
  timestamp: string
  sessionId: string
  source?: EventSource
}

export type TmuxEventWithOptionalData<T extends EventName = EventName> = {
  event: T
  data?: T extends keyof EventDataMap ? EventDataMap[T] : never
  timestamp: string
  sessionId: string
  source?: EventSource
}
