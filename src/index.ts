import { Command } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { EventBus } from './core/event-bus.js'
import { TmuxAutomator } from './commands/automate-claude.js'
import { SessionCreator } from './commands/create-session.js'
import { runMigrations } from './db/index.js'

async function main() {
  try {
    runMigrations()
  } catch (error) {
    console.error(`Failed to run database migrations:`, error)
    process.exit(1)
  }

  const program = new Command()

  program
    .name('control')
    .description('Control CLI')
    .version(packageJson.version)

  program
    .command('automate-claude')
    .description('Monitor and automate Claude interactions in tmux sessions')
    .option('-L <socket-name>', 'Use a different tmux socket name')
    .option('-S <socket-path>', 'Use a different tmux socket path')
    .option('--poll-interval <ms>', 'Polling interval in milliseconds', '500')
    .action(async options => {
      const eventBus = new EventBus()
      const automator = new TmuxAutomator(eventBus, {
        socketName: options.L,
        socketPath: options.S,
        pollInterval: parseInt(options.pollInterval, 10),
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
    .command('create-session <project-path>')
    .description('Create a new tmux session with git worktree')
    .option('--project-name <name>', 'Override project name')
    .option('-L <socket-name>', 'Use a different tmux socket name')
    .option('-S <socket-path>', 'Use a different tmux socket path')
    .action(async (projectPath, options) => {
      const eventBus = new EventBus()
      const creator = new SessionCreator(eventBus, {
        socketName: options.L,
        socketPath: options.S,
      })

      try {
        await creator.create(projectPath, {
          projectName: options.projectName,
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
