import { Command, Option } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { EventBus } from './core/event-bus.js'
import { TmuxAutomator } from './commands/automate-claude.js'
import { SessionCreator } from './commands/create-session.js'
import { runMigrations } from './db/index.js'
import { getDatabasePath } from './core/tmux-socket.js'
import type { TmuxSocketOptions } from './core/tmux-socket.js'
import { MATCHERS } from './core/matchers.js'

async function main() {
  const program = new Command()

  program
    .name('control')
    .description('Control CLI')
    .version(packageJson.version)

  const automateCommand = program
    .command('automate-claude')
    .description('Monitor and automate Claude interactions in tmux sessions')
    .option('-L <socket-name>', 'Use a different tmux socket name')
    .option('-S <socket-path>', 'Use a different tmux socket path')

  // Dynamically add skip options for each matcher
  for (const matcher of MATCHERS) {
    const optionName = `--skip-${matcher.name}`
    const description = `Skip the "${matcher.name.replace(/-/g, ' ')}" matcher`
    automateCommand.option(optionName, description)
  }

  automateCommand
    .addOption(
      new Option('--skip-migrations', 'Skip database migrations').hideHelp(),
    )
    .action(async options => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const dbPath = getDatabasePath(socketOptions)
      if (!options.skipMigrations) {
        try {
          runMigrations(dbPath)
        } catch (error) {
          console.error(
            `Failed to run database migrations for ${dbPath}:`,
            error,
          )
          process.exit(1)
        }
      }

      // Build skipMatchers object from options
      const skipMatchers: Record<string, boolean> = {}
      for (const matcher of MATCHERS) {
        const optionKey = `skip${matcher.name
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join('')}`
        skipMatchers[matcher.name] = options[optionKey] || false
      }

      const eventBus = new EventBus()
      const automator = new TmuxAutomator(
        eventBus,
        {
          ...socketOptions,
          skipMatchers,
        },
        dbPath,
      )

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
    .option('--mode <mode>', 'Session mode (act or plan)', 'act')
    .option('-L <socket-name>', 'Use a different tmux socket name')
    .option('-S <socket-path>', 'Use a different tmux socket path')
    .addOption(
      new Option('--skip-migrations', 'Skip database migrations').hideHelp(),
    )
    .action(async (projectPath, options) => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const dbPath = getDatabasePath(socketOptions)
      if (!options.skipMigrations) {
        try {
          runMigrations(dbPath)
        } catch (error) {
          console.error(
            `Failed to run database migrations for ${dbPath}:`,
            error,
          )
          process.exit(1)
        }
      }

      const eventBus = new EventBus()
      const creator = new SessionCreator(eventBus, socketOptions, dbPath)

      try {
        await creator.create(projectPath, {
          projectName: options.projectName,
          mode: options.mode,
          ...socketOptions,
        })
      } catch (error) {
        console.error(
          `\nFailed to create session: ${error instanceof Error ? error.message : String(error)}`,
        )
        process.exit(1)
      }
    })

  program
    .command('run-migrations', { hidden: true })
    .description('Run database migrations')
    .option('-L <socket-name>', 'Use a different tmux socket name')
    .option('-S <socket-path>', 'Use a different tmux socket path')
    .action(async options => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const dbPath = getDatabasePath(socketOptions)
      console.log(`Running migrations for database: ${dbPath}`)

      try {
        runMigrations(dbPath)
        console.log('Migrations completed successfully')
      } catch (error) {
        console.error(`Failed to run database migrations for ${dbPath}:`, error)
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
