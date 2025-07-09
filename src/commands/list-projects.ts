import fs from 'fs'
import path from 'path'
import { getProjectData } from '../core/project-utils.js'
import type { ProjectsMap } from '../types/project.js'

export class ProjectLister {
  async list() {
    const projectsPath = process.cwd()

    try {
      if (fs.existsSync(path.join(projectsPath, '.git'))) {
        console.error(
          'Error: Cannot list projects from within a git repository',
        )
        process.exit(1)
      }

      const projectsMap = await this.getProjectsMap(projectsPath)
      console.log(JSON.stringify(projectsMap, null, 2))
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : String(error),
      )
      process.exit(1)
    }
  }

  private async getProjectsMap(projectsPath: string): Promise<ProjectsMap> {
    const projectsMap: ProjectsMap = {}

    const currentDirName = path.basename(projectsPath)
    try {
      projectsMap[currentDirName] = getProjectData(projectsPath)
    } catch (error) {}

    const entries = fs.readdirSync(projectsPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const projectPath = path.join(projectsPath, entry.name)

      try {
        projectsMap[entry.name] = getProjectData(projectPath)
      } catch (error) {}
    }

    return projectsMap
  }
}
