export interface ProjectInfo {
  name: string
  path: string
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
  lastActivity?: string
}

export interface ProjectsMap {
  [key: string]: {
    project: ProjectInfo
    config: Record<string, any>
  }
}
