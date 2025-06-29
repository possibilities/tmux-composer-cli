import { Command, Option } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { EventBus } from './core/event-bus.js'
import { TmuxAutomator } from './commands/automate-claude.js'
import { TmuxAutomatorNew } from './commands/automate-new.js'
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

  // Claude command with automate subcommand
  const claudeCommand = program
    .command('claude')
    .description('Claude-related commands')

  const automateCommand = claudeCommand
    .command('automate')
    .description('Monitor and automate Claude interactions in tmux sessions')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')

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

  // Claude automate-new subcommand
  claudeCommand
    .command('automate-new')
    .description('New automation approach (does nothing for now)')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
    .action(async options => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const eventBus = new EventBus()
      const automator = new TmuxAutomatorNew(eventBus, socketOptions)

      await automator.start()
    })

  // Session command with create subcommand
  const sessionCommand = program
    .command('session')
    .description('Session management commands')

  sessionCommand
    .command('create <project-path>')
    .description('Create a new tmux session with git worktree')
    .option('--mode <mode>', 'Session mode (act or plan)', 'act')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
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

  program
    .command('run-migrations', { hidden: true })
    .description('Run database migrations')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
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
