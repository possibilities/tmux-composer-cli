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
  latestCommit?: string
  latestChat?: string
  hasReleaseScript: boolean
  lastReleaseVersion?: string
  commitsSinceLastRelease?: number
  isGitRepositoryClean: boolean
}

export interface ProjectsMap {
  [key: string]: {
    project: ProjectInfo
    config: Record<string, any>
  }
}
