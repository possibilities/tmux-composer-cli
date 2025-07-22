export interface PaneInfo {
  index: string
  width: number
  height: number
  currentCommand: string
  currentPath: string
  active: boolean
  cursorX?: number
  cursorY?: number
}

export interface PaneInfoWithContent extends PaneInfo {
  content: string
}

export interface WindowInfo {
  index: number
  name: string
  active: boolean
  panes: PaneInfo[]
}

export interface WindowInfoWithContent {
  index: number
  name: string
  active: boolean
  panes: PaneInfoWithContent[]
}

export interface SessionInfo {
  name: string
  mode: 'worktree' | 'project'
  port?: number
  startTime?: string
  windows?: WindowInfo[]
}

export interface ProjectInfo {
  name: string
  path: string
  projectType?: 'nextjs' | 'commanderjs' | 'unknown'
  git?: {
    branch: string
    commit: string
    status: 'clean' | 'dirty'
  }
  files?: {
    dotGit: boolean
    packageJson: boolean
    tmuxComposerConfig: boolean
  }
  latestCommit?: string
  latestChat?: string
  hasReleaseScript: boolean
  lastReleaseVersion?: string
  commitsSinceLastRelease?: number
  isGitRepositoryClean: boolean
  activeSessions?: SessionInfo[]
  isProjectsPath: boolean
}

export interface SessionData {
  name: string
  mode: 'worktree' | 'project'
  port?: number
  windows: WindowInfoWithContent[]
}

export interface ProjectsMap {
  [key: string]: {
    project: ProjectInfo
    config: Record<string, any>
  }
}
