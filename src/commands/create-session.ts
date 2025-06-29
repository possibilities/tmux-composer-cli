import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { EventBus } from '../core/event-bus.js'
import { getTmuxSocketArgs } from '../core/tmux-socket.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'
import {
  isGitRepositoryClean,
  getNextWorktreeNumber,
  createWorktree,
  installDependencies,
  CODE_PATH,
  WORKTREES_PATH,
} from '../core/git-utils.js'
import { ControlConfig } from '../core/constants.js'
import { saveSession, saveWindow } from '../db/index.js'
import type { NewSession, NewWindow } from '../db/schema.js'

interface CreateSessionOptions extends TmuxSocketOptions {
  projectName?: string
}

export class SessionCreator {
  private eventBus: EventBus
  private socketOptions: TmuxSocketOptions
  private dbPath?: string

  constructor(
    eventBus: EventBus,
    options: CreateSessionOptions = {},
    dbPath?: string,
  ) {
    this.eventBus = eventBus
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
    this.dbPath = dbPath
  }

  async create(projectPath: string, options: CreateSessionOptions = {}) {
    const projectName = options.projectName || path.basename(projectPath)
    const worktreeNum = getNextWorktreeNumber(projectName)
    const sessionName = `${projectName}-worktree-${worktreeNum}`

    this.eventBus.emitEvent({
      type: 'session-creating',
      sessionName,
    })

    try {
      if (!isGitRepositoryClean(projectPath)) {
        throw new Error(
          'Repository has uncommitted changes. Please commit or stash them first.',
        )
      }

      await fs.promises.mkdir(WORKTREES_PATH, { recursive: true })
      const worktreePath = createWorktree(projectPath, projectName, worktreeNum)

      installDependencies(worktreePath)

      const expectedWindows = await this.getExpectedWindows(worktreePath)

      this.eventBus.emitEvent({
        type: 'worktree-created',
        worktreeNumber: parseInt(worktreeNum),
        expectedWindows,
      })

      const newSession: NewSession = {
        sessionName,
        projectName,
        worktreePath,
      }
      await saveSession(newSession, this.dbPath)

      await this.createTmuxSession(sessionName, worktreePath, expectedWindows)

      this.eventBus.emitEvent({
        type: 'session-ready',
        sessionName,
        worktreeNumber: parseInt(worktreeNum),
      })

      console.log(`\n✓ Session created successfully!`)
      console.log(`\nSession name: ${sessionName}`)
      console.log(`Worktree path: ${worktreePath}`)
      const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
      console.log(`\nTo attach: tmux ${socketArgs} attach -t ${sessionName}`)
    } catch (error) {
      throw error
    }
  }

  private async getExpectedWindows(worktreePath: string): Promise<string[]> {
    const windows: string[] = []

    try {
      const packageJsonPath = path.join(worktreePath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return windows
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      if (scripts.dev) {
        windows.push('server')
      }

      if (scripts['lint:watch']) {
        windows.push('lint')
      }

      if (scripts['types:watch']) {
        windows.push('types')
      }

      if (scripts['test:watch']) {
        windows.push('test')
      }

      let controlConfig: ControlConfig | null = null
      try {
        const controlYamlPath = path.join(worktreePath, 'control.yaml')
        const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
        controlConfig = yaml.load(controlYamlContent) as ControlConfig
      } catch {}

      if (controlConfig?.agents?.act && controlConfig?.agents?.plan) {
        windows.push('work')
      }

      return windows
    } catch {
      return windows
    }
  }

  private async createTmuxSession(
    sessionName: string,
    worktreePath: string,
    expectedWindows: string[],
  ) {
    const packageJsonPath = path.join(worktreePath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found in worktree')
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const scripts = packageJson.scripts || {}

    let controlConfig: ControlConfig | null = null
    try {
      const controlYamlPath = path.join(worktreePath, 'control.yaml')
      const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
      controlConfig = yaml.load(controlYamlContent) as ControlConfig
    } catch {}

    let firstWindowCreated = false
    let windowIndex = 0

    const createSession = (windowName: string, command: string) => {
      this.eventBus.emitEvent({
        type: 'window-starting',
        windowName,
        command,
      })

      const socketArgs = getTmuxSocketArgs(this.socketOptions)
      const tmuxProcess = spawn(
        'tmux',
        [
          ...socketArgs,
          'new-session',
          '-d',
          '-s',
          sessionName,
          '-n',
          windowName,
          '-c',
          worktreePath,
          '-x',
          '80',
          '-y',
          '24',
        ],
        {
          detached: true,
          stdio: 'ignore',
        },
      )
      tmuxProcess.unref()

      setTimeout(() => {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
        )
      }, 50)

      firstWindowCreated = true
    }

    const createWindow = (windowName: string, command: string) => {
      this.eventBus.emitEvent({
        type: 'window-starting',
        windowName,
        command,
      })

      const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
      execSync(
        `tmux ${socketArgs} new-window -t ${sessionName} -n '${windowName}' -c ${worktreePath}`,
      )
      execSync(
        `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
      )
    }

    if (scripts.dev && expectedWindows.includes('server')) {
      const port = this.findAvailablePort()
      const command = `PORT=${port} pnpm run dev`

      if (!firstWindowCreated) {
        createSession('server', command)
      } else {
        createWindow('server', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'server',
        command: 'pnpm run dev',
        description: 'Development server',
        port,
      }
      await saveWindow(window, this.dbPath)

      this.eventBus.emitEvent({
        type: 'window-ready',
        windowName: 'server',
        port,
      })
    }

    if (scripts['lint:watch'] && expectedWindows.includes('lint')) {
      const command = 'pnpm run lint:watch'

      if (!firstWindowCreated) {
        createSession('lint', command)
      } else {
        createWindow('lint', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'lint',
        command: 'pnpm run lint:watch',
        description: 'Linting watch mode',
      }
      await saveWindow(window, this.dbPath)

      this.eventBus.emitEvent({
        type: 'window-ready',
        windowName: 'lint',
      })
    }

    if (scripts['types:watch'] && expectedWindows.includes('types')) {
      const command = 'pnpm run types:watch'

      if (!firstWindowCreated) {
        createSession('types', command)
      } else {
        createWindow('types', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'types',
        command: 'pnpm run types:watch',
        description: 'TypeScript type checking',
      }
      await saveWindow(window, this.dbPath)

      this.eventBus.emitEvent({
        type: 'window-ready',
        windowName: 'types',
      })
    }

    if (scripts['test:watch'] && expectedWindows.includes('test')) {
      const command = 'pnpm run test:watch'

      if (!firstWindowCreated) {
        createSession('test', command)
      } else {
        createWindow('test', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'test',
        command: 'pnpm run test:watch',
        description: 'Test watch mode',
      }
      await saveWindow(window, this.dbPath)

      this.eventBus.emitEvent({
        type: 'window-ready',
        windowName: 'test',
      })
    }

    if (!controlConfig?.agents?.act || !controlConfig?.agents?.plan) {
      if (expectedWindows.includes('work')) {
        throw new Error(
          'control.yaml must contain all required fields: agents.act, agents.plan',
        )
      }
    } else if (expectedWindows.includes('work')) {
      const command = controlConfig.agents.plan

      if (!firstWindowCreated) {
        createSession('work', command)
      } else {
        createWindow('work', command)
      }

      const window: NewWindow = {
        sessionName,
        index: windowIndex++,
        name: 'work',
        command: controlConfig.agents.plan,
        description: 'Work session',
      }
      await saveWindow(window, this.dbPath)

      if (controlConfig.context?.plan) {
        console.log('  Preparing context...')
        let contextOutput: string
        try {
          contextOutput = execSync(controlConfig.context.plan, {
            encoding: 'utf-8',
            cwd: worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
        } catch (error) {
          throw new Error(
            `Failed to execute context.plan command: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        const tempFile = `/tmp/control-context-${Date.now()}.txt`
        fs.writeFileSync(tempFile, contextOutput)
        try {
          execSync(`tmux ${socketArgs} load-buffer ${tempFile}`)
        } finally {
          try {
            fs.unlinkSync(tempFile)
          } catch {}
        }
      }

      this.eventBus.emitEvent({
        type: 'window-ready',
        windowName: 'work',
      })
    }

    setTimeout(() => {
      try {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        execSync(`tmux ${socketArgs} select-window -t ${sessionName}:work`)
      } catch {}
    }, 200)
  }

  private findAvailablePort(): number {
    const getRandomPort = () =>
      Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152
    const isPortAvailable = (port: number): boolean => {
      try {
        execSync(`lsof -ti:${port}`, { encoding: 'utf-8' })
        return false
      } catch {
        return true
      }
    }

    let port = getRandomPort()
    let attempts = 0
    while (!isPortAvailable(port) && attempts < 100) {
      port = getRandomPort()
      attempts++
    }
    if (attempts >= 100) {
      throw new Error('Could not find an available port')
    }
    return port
  }
}
