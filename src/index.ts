import { Command, Option } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { TmuxAutomator } from './commands/automate-claude-old.js'
import { TmuxSessionWatcher } from './commands/watch-session.js'
import { TmuxPaneWatcher } from './commands/watch-panes.js'
import { SessionCreator } from './commands/create-session.js'
import { EventObserver } from './commands/observe-watchers.js'
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

    // Commands handle their own output

    await automator.start()

    process.on('SIGINT', () => {
      // Commands handle their own output
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      // Commands handle their own output
      process.exit(0)
    })
  })

  program
    .command('watch-session')
    .description('Watch for session changes')
    .action(async () => {
      const watcher = new TmuxSessionWatcher()

      await watcher.start()
    })

  program
    .command('watch-panes')
    .description('Watch for pane changes')
    .action(async () => {
      const watcher = new TmuxPaneWatcher()

      await watcher.start()
    })

  program
    .command('create-session <project-path>')
    .description('Create worktree and session for project')
    .option('--mode <mode>', 'Session mode (act or plan)', 'act')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--attach', 'Attach to the session after creation')
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
          attach: options.attach,
          ...socketOptions,
        })
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('observe-watchers')
    .description('Observe all watchers')
    .action(async () => {
      const observer = new EventObserver()
      await observer.start()
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
    // Commands handle their own output
    process.exit(1)
  }
}

main().catch(error => {
  // Commands handle their own output
  process.exit(1)
})
