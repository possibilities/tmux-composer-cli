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
      projectsMap[currentDirName] = await getProjectData(projectsPath)
    } catch (error) {
      console.error(`Error processing ${currentDirName}:`, error)
    }

    const entries = fs.readdirSync(projectsPath, { withFileTypes: true })

    const projectPromises = entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const projectPath = path.join(projectsPath, entry.name)
        try {
          const data = await getProjectData(projectPath)
          return { name: entry.name, data }
        } catch (error) {
          console.error(`Error processing ${entry.name}:`, error)
          return null
        }
      })

    const results = await Promise.all(projectPromises)

    for (const result of results) {
      if (result) {
        projectsMap[result.name] = result.data
      }
    }

    return projectsMap
  }
}
