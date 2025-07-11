import { getProjectData } from '../core/project-utils.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

export class ProjectShower {
  constructor(private socketOptions: TmuxSocketOptions = {}) {}

  async show(projectPath: string) {
    const resolvedPath = projectPath || process.cwd()

    try {
      const output = await getProjectData(resolvedPath, this.socketOptions)
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
