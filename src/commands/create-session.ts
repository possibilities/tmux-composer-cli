import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
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
import { socketExists } from '../core/tmux-utils.js'
import { TmuxComposerConfig, TERMINAL_SIZES } from '../core/constants.js'

interface CreateSessionOptions extends TmuxSocketOptions {
  mode?: 'act' | 'plan'
  terminalWidth?: number
  terminalHeight?: number
}

export class SessionCreator {
  private socketOptions: TmuxSocketOptions
  constructor(options: CreateSessionOptions = {}) {
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  async create(projectPath: string, options: CreateSessionOptions = {}) {
    const projectName = path.basename(projectPath)
    const worktreeNum = getNextWorktreeNumber(projectName)
    const sessionName = `${projectName}-worktree-${worktreeNum}`

    const mode = options.mode || 'act'
    if (mode !== 'act' && mode !== 'plan') {
      throw new Error('Invalid mode. Must be either "act" or "plan".')
    }

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

      await this.createTmuxSession(
        sessionName,
        worktreePath,
        expectedWindows,
        mode,
        options.terminalWidth,
        options.terminalHeight,
      )

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

      let tmuxComposerConfig: TmuxComposerConfig | null = null
      try {
        const controlYamlPath = path.join(worktreePath, 'control.yaml')
        const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
        tmuxComposerConfig = yaml.load(controlYamlContent) as TmuxComposerConfig
      } catch {}

      windows.push('work')

      return windows
    } catch {
      return windows
    }
  }

  private async createTmuxSession(
    sessionName: string,
    worktreePath: string,
    expectedWindows: string[],
    mode: 'act' | 'plan',
    terminalWidth?: number,
    terminalHeight?: number,
  ) {
    const packageJsonPath = path.join(worktreePath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found in worktree')
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const scripts = packageJson.scripts || {}

    let tmuxComposerConfig: TmuxComposerConfig | null = null
    try {
      const controlYamlPath = path.join(worktreePath, 'control.yaml')
      const controlYamlContent = fs.readFileSync(controlYamlPath, 'utf-8')
      tmuxComposerConfig = yaml.load(controlYamlContent) as TmuxComposerConfig
    } catch {}

    let firstWindowCreated = false
    let windowIndex = 0

    const createSession = (windowName: string, command: string) => {
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
          String(terminalWidth || TERMINAL_SIZES.big.width),
          '-y',
          String(terminalHeight || TERMINAL_SIZES.big.height),
        ],
        {
          detached: true,
          stdio: 'ignore',
        },
      )
      tmuxProcess.unref()

      let attempts = 0
      while (!socketExists(this.socketOptions) && attempts < 50) {
        execSync('sleep 0.1')
        attempts++
      }

      if (!socketExists(this.socketOptions)) {
        throw new Error('Tmux server failed to start')
      }

      setTimeout(() => {
        const socketArgsStr = getTmuxSocketArgs(this.socketOptions).join(' ')
        execSync(
          `tmux ${socketArgsStr} setenv -t ${sessionName} TMUX_COMPOSER_MODE ${mode}`,
        )
      }, 50)

      setTimeout(() => {
        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        execSync(
          `tmux ${socketArgs} send-keys -t ${sessionName}:${windowName} '${command}' Enter`,
        )
      }, 50)

      firstWindowCreated = true
    }

    const createWindow = (windowName: string, command: string) => {
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

      windowIndex++
    }

    if (scripts['lint:watch'] && expectedWindows.includes('lint')) {
      const command = 'pnpm run lint:watch'

      if (!firstWindowCreated) {
        createSession('lint', command)
      } else {
        createWindow('lint', command)
      }

      windowIndex++
    }

    if (scripts['types:watch'] && expectedWindows.includes('types')) {
      const command = 'pnpm run types:watch'

      if (!firstWindowCreated) {
        createSession('types', command)
      } else {
        createWindow('types', command)
      }

      windowIndex++
    }

    if (scripts['test:watch'] && expectedWindows.includes('test')) {
      const command = 'pnpm run test:watch'

      if (!firstWindowCreated) {
        createSession('test', command)
      } else {
        createWindow('test', command)
      }

      windowIndex++
    }

    if (expectedWindows.includes('work')) {
      let command = 'claude'

      if (tmuxComposerConfig?.agents) {
        if (typeof tmuxComposerConfig.agents === 'string') {
          command = tmuxComposerConfig.agents
        } else if (tmuxComposerConfig.agents[mode]) {
          command = tmuxComposerConfig.agents[mode]
        }
      }

      if (!firstWindowCreated) {
        createSession('work', command)
      } else {
        createWindow('work', command)
      }

      windowIndex++

      let contextCommand: string | undefined

      if (tmuxComposerConfig?.context) {
        if (typeof tmuxComposerConfig.context === 'string') {
          contextCommand = tmuxComposerConfig.context
        } else if (tmuxComposerConfig.context[mode]) {
          contextCommand = tmuxComposerConfig.context[mode]
        }
      }

      if (contextCommand) {
        console.log('  Preparing context...')
        let contextOutput: string
        try {
          contextOutput = execSync(contextCommand, {
            encoding: 'utf-8',
            cwd: worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
        } catch (error) {
          throw new Error(
            `Failed to execute context command: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')
        const tempFile = `/tmp/tmux-composer-context-${Date.now()}.txt`
        fs.writeFileSync(tempFile, contextOutput)
        try {
          execSync(`tmux ${socketArgs} load-buffer ${tempFile}`)
        } finally {
          try {
            fs.unlinkSync(tempFile)
          } catch {}
        }
      }
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
