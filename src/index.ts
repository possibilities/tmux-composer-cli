import { Command, Option } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { TmuxAutomator } from './commands/automate-claude-old.js'
import { TmuxSessionWatcher } from './commands/watch-session.js'
import { SessionCreator } from './commands/create-session.js'
import type { TmuxSocketOptions } from './core/tmux-socket.js'
import { MATCHERS } from './matchers.js'

async function main() {
  const program = new Command()

  program
    .name('tmux-composer')
    .description('Tmux Composer CLI')
    .version(packageJson.version)

  const automateClaudeOldCommand = program
    .command('automate-claude-old')
    .description(
      'Monitor and automate Claude interactions in tmux sessions (legacy)',
    )
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')

  for (const matcher of MATCHERS) {
    const optionName = `--skip-${matcher.name}`
    const description = `Skip the "${matcher.name.replace(/-/g, ' ')}" matcher`
    automateClaudeOldCommand.option(optionName, description)
  }

  automateClaudeOldCommand.action(async options => {
    const socketOptions: TmuxSocketOptions = {
      socketName: options.L,
      socketPath: options.S,
    }

    const skipMatchers: Record<string, boolean> = {}
    for (const matcher of MATCHERS) {
      const optionKey = `skip${matcher.name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')}`
      skipMatchers[matcher.name] = options[optionKey] || false
    }

    const automator = new TmuxAutomator({
      ...socketOptions,
      skipMatchers,
    })

    console.log('Monitoring tmux sessions... Press Ctrl+C to stop')

    await automator.start()

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      process.exit(0)
    })
  })

  program
    .command('watch-session')
    .description('Monitor tmux control mode events for current session')
    .action(async () => {
      const watcher = new TmuxSessionWatcher()

      await watcher.start()
    })

  program
    .command('create-session <project-path>')
    .description('Create a new tmux session with git worktree')
    .option('--mode <mode>', 'Session mode (act or plan)', 'act')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .action(async (projectPath, options) => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const creator = new SessionCreator(socketOptions)

      try {
        await creator.create(projectPath, {
          mode: options.mode,
          terminalWidth: options.terminalWidth,
          terminalHeight: options.terminalHeight,
          ...socketOptions,
        })
      } catch (error) {
        console.error(
          `\nFailed to create session: ${error instanceof Error ? error.message : String(error)}`,
        )
        process.exit(1)
      }
    })

  try {
    program.exitOverride()
    program.configureOutput({
      writeErr: str => process.stderr.write(str),
    })

    await program.parseAsync(process.argv)
  } catch (error: any) {
    if (
      error.code === 'commander.help' ||
      error.code === 'commander.helpDisplayed'
    ) {
      process.exit(0)
    }
    console.error('Error:', error.message || error)
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
