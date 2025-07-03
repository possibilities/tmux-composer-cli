import { execSync } from 'child_process'
import { loadConfig } from '../core/config.js'
import {
  syncWorktreeToMain,
  checkAndInstallDependencies,
} from '../core/git-sync.js'
import { getTmuxSocketArgs } from '../core/tmux-socket.js'
import type { TmuxSocketOptions } from '../core/tmux-socket.js'

export class SessionFinisher {
  private socketOptions: TmuxSocketOptions

  constructor(options: TmuxSocketOptions = {}) {
    this.socketOptions = {
      socketName: options.socketName,
      socketPath: options.socketPath,
    }
  }

  async finish(): Promise<void> {
    console.log('Loading configuration...')
    const config = loadConfig()

    const socketArgs = getTmuxSocketArgs(this.socketOptions).join(' ')

    let mode: string
    try {
      mode = execSync(
        `tmux ${socketArgs} show-environment TMUX_COMPOSER_MODE`,
        { encoding: 'utf-8' },
      )
        .trim()
        .replace('TMUX_COMPOSER_MODE=', '')
    } catch (error) {
      console.error(
        'Error: This command can only be used in sessions created by tmux-composer',
      )
      process.exit(1)
    }

    if (!['worktree', 'project'].includes(mode)) {
      console.error('Error: Invalid TMUX_COMPOSER_MODE value')
      process.exit(1)
    }

    console.log(`Finishing ${mode} session...`)

    if (config.commands?.['before-finish']) {
      console.log(
        `Running before-finish command: ${config.commands['before-finish']}`,
      )
      try {
        execSync(config.commands['before-finish'], {
          stdio: 'inherit',
          encoding: 'utf-8',
        })
        console.log('Before-finish command completed successfully')
      } catch (error) {
        console.error('Error: Before-finish command failed')
        process.exit(1)
      }
    }

    if (mode === 'worktree') {
      const currentPath = process.cwd()

      try {
        syncWorktreeToMain(currentPath)
      } catch (error) {
        console.error('Error: Failed to sync worktree to main branch')
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }

      try {
        checkAndInstallDependencies(currentPath)
      } catch (error) {
        console.error('Error: Failed to check/install dependencies')
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }

      const currentSession = execSync(
        `tmux ${socketArgs} display-message -p '#S'`,
        { encoding: 'utf-8' },
      ).trim()

      console.log(`Killing worktree session: ${currentSession}`)

      execSync(`tmux ${socketArgs} kill-session -t ${currentSession}`)
    }

    console.log('Session finished successfully')
  }
}
