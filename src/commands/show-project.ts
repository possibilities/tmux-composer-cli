import { getProjectData } from '../core/project-utils.js'

export class ProjectShower {
  async show(projectPath: string) {
    const resolvedPath = projectPath || process.cwd()

    try {
      const output = await getProjectData(resolvedPath)
      console.log(JSON.stringify(output, null, 2))
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : String(error),
      )
      process.exit(1)
    }
  }
}
