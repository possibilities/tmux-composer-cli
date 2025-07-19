import type { EventSource } from './zmq-publisher.js'
import type { ProjectInfo, SessionInfo } from '../types/project.js'

export type EventName =
  | 'session-changed'
  | 'pane-changed'
  | 'observe-session:start'
  | 'observe-session:exit'
  | 'kill-existing-server:start'
  | 'kill-existing-server:end'
  | 'kill-existing-server:fail'
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
  | 'create-tmux-window:start'
  | 'create-tmux-window:end'
  | 'create-tmux-window:fail'
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
  | 'find-highest-worktree:start'
  | 'find-highest-worktree:end'
  | 'find-highest-worktree:fail'
  | 'resume-session:start'
  | 'resume-session:end'
  | 'resume-session:fail'
  | 'find-all-worktrees:start'
  | 'find-all-worktrees:end'
  | 'find-all-worktrees:fail'
  | 'find-worktree:start'
  | 'find-worktree:end'
  | 'find-worktree:fail'
  | 'check-session-exists:start'
  | 'check-session-exists:end'
  | 'switch-to-existing-session:start'
  | 'switch-to-existing-session:end'
  | 'create-new-session:start'
  | 'create-new-session:end'
  | 'display-menu:start'
  | 'display-menu:end'
  | 'display-menu:fail'
  | 'display-menu:cancel'
  | 'initialize-continue-session:start'
  | 'initialize-continue-session:end'
  | 'validate-existing-session:start'
  | 'validate-existing-session:end'
  | 'validate-existing-session:fail'
  | 'set-tmux-composer-mode:start'
  | 'set-tmux-composer-mode:end'
  | 'set-tmux-composer-mode:fail'
  | 'check-existing-sessions:start'
  | 'check-existing-sessions:end'
  | 'analyze-worktree-sessions:start'
  | 'analyze-worktree-sessions:end'
  | 'prepare-menu-items:start'
  | 'prepare-menu-items:end'
  | 'select-worktree-session:fail'
  | 'finish-session:start'
  | 'finish-session:end'
  | 'finish-session:fail'
  | 'load-configuration:start'
  | 'load-configuration:end'
  | 'load-configuration:fail'
  | 'validate-composer-session:start'
  | 'validate-composer-session:end'
  | 'validate-composer-session:fail'
  | 'get-session-mode:start'
  | 'get-session-mode:end'
  | 'get-session-mode:fail'
  | 'run-before-finish-command:start'
  | 'run-before-finish-command:end'
  | 'run-before-finish-command:fail'
  | 'sync-worktree-to-main:start'
  | 'sync-worktree-to-main:end'
  | 'sync-worktree-to-main:fail'
  | 'check-install-dependencies:start'
  | 'check-install-dependencies:end'
  | 'check-install-dependencies:fail'
  | 'find-alternative-session:start'
  | 'find-alternative-session:end'
  | 'switch-before-kill:start'
  | 'switch-before-kill:end'
  | 'switch-before-kill:fail'
  | 'kill-current-session:start'
  | 'kill-current-session:end'
  | 'kill-current-session:fail'
  | 'close-session:start'
  | 'close-session:end'
  | 'close-session:fail'
  | 'get-current-session:start'
  | 'get-current-session:end'
  | 'get-current-session:fail'
  | 'get-project-info:start'
  | 'get-project-info:end'
  | 'get-project-info:fail'
  | 'list-all-sessions:start'
  | 'list-all-sessions:end'
  | 'list-all-sessions:fail'
  | 'check-attached-session:start'
  | 'check-attached-session:end'
  | 'switch-before-close:start'
  | 'switch-before-close:end'
  | 'switch-before-close:fail'
  | 'kill-session:start'
  | 'kill-session:end'
  | 'kill-session:fail'
  | 'sync-session:start'
  | 'sync-session:end'
  | 'sync-session:fail'

export interface WorktreeInfo {
  path: string
  number?: string
  branch?: string
}

export interface EventContext {
  project?: Partial<ProjectInfo>
  session?: Partial<SessionInfo>
  worktree?: WorktreeInfo
}

export type EventPayload<T extends EventName> = {
  context: EventContext
} & (T extends keyof EventDataMap
  ? EventDataMap[T] extends undefined
    ? {}
    : { details: EventDataMap[T] }
  : {})

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

export interface ObserveSessionStartData extends BaseEventData {
  sessionId: string
  sessionName: string
  socketPath: string
}

export interface ObserveSessionExitData extends BaseEventData {
  sessionId: string
  sessionName: string
  exitReason:
    | 'session-killed'
    | 'SIGINT'
    | 'SIGTERM'
    | 'SIGHUP'
    | 'SIGQUIT'
    | 'error'
  error?: string
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

export interface InitializeSessionCreationEndData extends BaseEventData {
  sessionPorts?: Record<string, number>
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
  port?: number
}

export interface CreateTmuxWindowStartData {
  windowName: string
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

export interface FindHighestWorktreeEndData extends BaseEventData {
  worktreePath: string
  projectName: string
  worktreeNumber: string
  sessionName: string
  branch: string
  commit: string
}

export interface FindHighestWorktreeFailData extends ErrorEventData {
  worktreePath?: string
}

export interface ContinueSessionEndData extends BaseEventData {
  sessionName: string
  worktreePath: string
  windows: string[]
  worktreeNumber: string
  branch: string
}

export interface ResumeSessionStartData {
  projectPath: string
  options: {
    socketName?: string | null
    socketPath?: string | null
    terminalWidth?: number
    terminalHeight?: number
    attach?: boolean
    worktree?: string
  }
}

export interface ResumeSessionEndData extends BaseEventData {
  cancelled?: boolean
  sessionName?: string
  action?: 'switched' | 'created'
  worktreePath?: string
}

export interface FindAllWorktreesEndData extends BaseEventData {
  worktreeCount: number
}

export interface DisplayMenuStartData {
  worktreeCount: number
}

export interface DisplayMenuCancelData extends BaseEventData {}

export interface InitializeContinueSessionEndData extends BaseEventData {}

export interface ValidateExistingSessionEndData extends BaseEventData {
  sessionName: string
  exists: boolean
}

export interface ValidateExistingSessionFailData extends ErrorEventData {
  sessionName: string
}

export interface SetTmuxComposerModeEndData extends BaseEventData {
  mode: string
  sessionName: string
}

export interface SetTmuxComposerModeFailData extends ErrorEventData {
  sessionName: string
}

export interface CheckExistingSessionsEndData extends BaseEventData {
  sessionsWithWorktrees: Array<{
    sessionName: string
    worktreeNumber: string
    worktreePath: string
    exists: boolean
  }>
}

export interface AnalyzeWorktreeSessionsEndData extends BaseEventData {
  totalWorktrees: number
  activeSessions: number
  worktreesWithoutSessions: number
}

export interface PrepareMenuItemsEndData extends BaseEventData {
  menuItemCount: number
}

export interface SelectWorktreeSessionFailData extends ErrorEventData {
  cancelled?: boolean
}

export interface FinishSessionStartData {
  options: {
    socketName?: string | null
    socketPath?: string | null
  }
}

export interface FinishSessionEndData extends BaseEventData {
  sessionName: string
  mode: 'worktree' | 'project'
  sessionKept: boolean
}

export interface LoadConfigurationEndData extends BaseEventData {
  hasBeforeFinishCommand: boolean
}

export interface ValidateComposerSessionEndData extends BaseEventData {
  isValid: boolean
  sessionName: string
}

export interface ValidateComposerSessionFailData extends ErrorEventData {
  sessionName?: string
}

export interface GetSessionModeEndData extends BaseEventData {
  mode: 'worktree' | 'project'
  sessionName: string
}

export interface GetSessionModeFailData extends ErrorEventData {
  sessionName: string
}

export interface RunBeforeFinishCommandEndData extends BaseEventData {
  command: string
  exitCode: number
}

export interface RunBeforeFinishCommandFailData extends ErrorEventData {
  command: string
  exitCode?: number
}

export interface SyncWorktreeToMainEndData extends BaseEventData {
  worktreePath: string
  mainBranch: string
  commitsMerged: number
}

export interface SyncWorktreeToMainFailData extends ErrorEventData {
  worktreePath: string
}

export interface CheckInstallDependenciesEndData extends BaseEventData {
  worktreePath: string
  dependenciesInstalled: boolean
  packageManager?: string
}

export interface CheckInstallDependenciesFailData extends ErrorEventData {
  worktreePath: string
}

export interface FindAlternativeSessionEndData extends BaseEventData {
  currentSession: string
  alternativeSession?: string
  hasAlternative: boolean
}

export interface SwitchBeforeKillEndData extends BaseEventData {
  fromSession: string
  toSession: string
}

export interface SwitchBeforeKillFailData extends ErrorEventData {
  fromSession: string
  toSession: string
}

export interface KillCurrentSessionEndData extends BaseEventData {
  sessionName: string
}

export interface KillCurrentSessionFailData extends ErrorEventData {
  sessionName: string
}

export interface CloseSessionStartData {
  options: {
    socketName?: string | null
    socketPath?: string | null
  }
}

export interface CloseSessionEndData extends BaseEventData {
  sessionName: string
}

export interface GetCurrentSessionEndData extends BaseEventData {
  sessionName: string
}

export interface GetCurrentSessionFailData extends ErrorEventData {}

export interface GetProjectInfoEndData extends BaseEventData {
  projectName: string
  projectPath: string
}

export interface GetProjectInfoFailData extends ErrorEventData {}

export interface ListAllSessionsEndData extends BaseEventData {
  sessions: string[]
  count: number
}

export interface CheckAttachedSessionEndData extends BaseEventData {
  attachedSession?: string
  isAttachedToCurrent: boolean
  currentSession: string
}

export interface SwitchBeforeCloseEndData extends BaseEventData {
  fromSession: string
  toSession: string
}

export interface SwitchBeforeCloseFailData extends ErrorEventData {
  fromSession: string
  toSession: string
}

export interface KillSessionEndData extends BaseEventData {
  sessionName: string
}

export interface KillSessionFailData extends ErrorEventData {
  sessionName: string
}

export interface SyncSessionStartData {
  options: {
    socketName?: string | null
    socketPath?: string | null
  }
}

export interface SyncSessionEndData extends BaseEventData {
  sessionName: string
  mode: 'worktree' | 'project'
}

export interface FindWorktreeStartData {
  worktreeInput: string
}

export interface FindWorktreeEndData extends BaseEventData {
  worktreeInput: string
  worktree: {
    number: number
    path: string
    branch?: string
    projectName: string
  }
}

export interface FindWorktreeFailData extends ErrorEventData {
  worktreeInput?: string
}

export interface CheckSessionExistsStartData {
  sessionName: string
}

export interface CheckSessionExistsEndData extends BaseEventData {
  sessionName: string
  exists: boolean
}

export interface SwitchToExistingSessionStartData {
  sessionName: string
}

export interface SwitchToExistingSessionEndData extends BaseEventData {
  sessionName: string
}

export interface CreateNewSessionStartData {
  sessionName: string
  worktreePath: string
}

export interface CreateNewSessionEndData extends BaseEventData {
  sessionName: string
  worktreePath: string
}

export type EventDataMap = {
  'session-changed': SessionChangedData
  'pane-changed': PaneChangedData
  'observe-session:start': ObserveSessionStartData
  'observe-session:exit': ObserveSessionExitData
  'kill-existing-server:start': undefined
  'kill-existing-server:end': BaseEventData
  'kill-existing-server:fail': ErrorEventData
  'initialize-session-creation:start': InitializeSessionCreationStartData
  'initialize-session-creation:end': InitializeSessionCreationEndData
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
  'create-tmux-window:start': CreateTmuxWindowStartData
  'create-tmux-window:end': CreateTmuxWindowEndData
  'create-tmux-window:fail': CreateTmuxWindowFailData
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
  'find-highest-worktree:start': undefined
  'find-highest-worktree:end': FindHighestWorktreeEndData
  'find-highest-worktree:fail': FindHighestWorktreeFailData
  'resume-session:start': ResumeSessionStartData
  'resume-session:end': ResumeSessionEndData
  'resume-session:fail': ErrorEventData
  'find-all-worktrees:start': undefined
  'find-all-worktrees:end': FindAllWorktreesEndData
  'find-all-worktrees:fail': ErrorEventData
  'find-worktree:start': FindWorktreeStartData
  'find-worktree:end': FindWorktreeEndData
  'find-worktree:fail': FindWorktreeFailData
  'check-session-exists:start': CheckSessionExistsStartData
  'check-session-exists:end': CheckSessionExistsEndData
  'switch-to-existing-session:start': SwitchToExistingSessionStartData
  'switch-to-existing-session:end': SwitchToExistingSessionEndData
  'create-new-session:start': CreateNewSessionStartData
  'create-new-session:end': CreateNewSessionEndData
  'display-menu:start': DisplayMenuStartData
  'display-menu:end': BaseEventData
  'display-menu:fail': ErrorEventData
  'display-menu:cancel': DisplayMenuCancelData
  'initialize-continue-session:start': undefined
  'initialize-continue-session:end': InitializeContinueSessionEndData
  'validate-existing-session:start': undefined
  'validate-existing-session:end': ValidateExistingSessionEndData
  'validate-existing-session:fail': ValidateExistingSessionFailData
  'set-tmux-composer-mode:start': undefined
  'set-tmux-composer-mode:end': SetTmuxComposerModeEndData
  'set-tmux-composer-mode:fail': SetTmuxComposerModeFailData
  'check-existing-sessions:start': undefined
  'check-existing-sessions:end': CheckExistingSessionsEndData
  'analyze-worktree-sessions:start': undefined
  'analyze-worktree-sessions:end': AnalyzeWorktreeSessionsEndData
  'prepare-menu-items:start': undefined
  'prepare-menu-items:end': PrepareMenuItemsEndData
  'select-worktree-session:fail': SelectWorktreeSessionFailData
  'finish-session:start': FinishSessionStartData
  'finish-session:end': FinishSessionEndData
  'finish-session:fail': ErrorEventData
  'load-configuration:start': undefined
  'load-configuration:end': LoadConfigurationEndData
  'load-configuration:fail': ErrorEventData
  'validate-composer-session:start': undefined
  'validate-composer-session:end': ValidateComposerSessionEndData
  'validate-composer-session:fail': ValidateComposerSessionFailData
  'get-session-mode:start': undefined
  'get-session-mode:end': GetSessionModeEndData
  'get-session-mode:fail': GetSessionModeFailData
  'run-before-finish-command:start': undefined
  'run-before-finish-command:end': RunBeforeFinishCommandEndData
  'run-before-finish-command:fail': RunBeforeFinishCommandFailData
  'sync-worktree-to-main:start': undefined
  'sync-worktree-to-main:end': SyncWorktreeToMainEndData
  'sync-worktree-to-main:fail': SyncWorktreeToMainFailData
  'check-install-dependencies:start': undefined
  'check-install-dependencies:end': CheckInstallDependenciesEndData
  'check-install-dependencies:fail': CheckInstallDependenciesFailData
  'find-alternative-session:start': undefined
  'find-alternative-session:end': FindAlternativeSessionEndData
  'switch-before-kill:start': undefined
  'switch-before-kill:end': SwitchBeforeKillEndData
  'switch-before-kill:fail': SwitchBeforeKillFailData
  'kill-current-session:start': undefined
  'kill-current-session:end': KillCurrentSessionEndData
  'kill-current-session:fail': KillCurrentSessionFailData
  'close-session:start': CloseSessionStartData
  'close-session:end': CloseSessionEndData
  'close-session:fail': ErrorEventData
  'get-current-session:start': undefined
  'get-current-session:end': GetCurrentSessionEndData
  'get-current-session:fail': GetCurrentSessionFailData
  'get-project-info:start': undefined
  'get-project-info:end': GetProjectInfoEndData
  'get-project-info:fail': GetProjectInfoFailData
  'list-all-sessions:start': undefined
  'list-all-sessions:end': ListAllSessionsEndData
  'list-all-sessions:fail': ErrorEventData
  'check-attached-session:start': undefined
  'check-attached-session:end': CheckAttachedSessionEndData
  'switch-before-close:start': undefined
  'switch-before-close:end': SwitchBeforeCloseEndData
  'switch-before-close:fail': SwitchBeforeCloseFailData
  'kill-session:start': undefined
  'kill-session:end': KillSessionEndData
  'kill-session:fail': KillSessionFailData
  'sync-session:start': SyncSessionStartData
  'sync-session:end': SyncSessionEndData
  'sync-session:fail': ErrorEventData
}

export interface TmuxEvent<T extends EventName = EventName> {
  event: T
  payload: EventPayload<T>
  timestamp: string
  sessionId: string
  source?: EventSource
}

export type TmuxEventWithOptionalData<T extends EventName = EventName> = {
  event: T
  payload?: EventPayload<T>
  timestamp: string
  sessionId: string
  source?: EventSource
}
