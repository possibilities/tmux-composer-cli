import { Command, Option } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { TmuxSessionWatcher } from './commands/watch-session.js'
import { TmuxPaneWatcher } from './commands/watch-panes.js'
import { SessionCreator } from './commands/create-session.js'
import { EventObserver } from './commands/observe-events.js'
import type { TmuxSocketOptions } from './core/tmux-socket.js'

async function main() {
  const program = new Command()

  program
    .name('tmux-composer')
    .description('Tmux Composer CLI')
    .version(packageJson.version)

  program
    .command('watch-session')
    .description('watch session changes')
    .option('--no-zeromq', 'Disable ZeroMQ publishing')
    .action(async options => {
      const watcher = new TmuxSessionWatcher()

      await watcher.start(options)
    })

  program
    .command('watch-panes')
    .description('watch pane changes')
    .option('--no-zeromq', 'Disable ZeroMQ publishing')
    .action(async options => {
      const watcher = new TmuxPaneWatcher()

      await watcher.start(options)
    })

  program
    .command('create-session [project-path]')
    .description('create project session')
    .option('--mode <mode>', 'Session mode (act or plan)', 'act')
    .option('-L <socket-name>', 'Tmux socket name')
    .option('-S <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--no-attach', 'Do not attach to the session after creation')
    .option('--no-zeromq', 'Disable ZeroMQ publishing')
    .action(async (projectPath, options) => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.L,
        socketPath: options.S,
      }

      const creator = new SessionCreator(socketOptions)

      const resolvedProjectPath = projectPath || process.cwd()
      const shouldAttach = options.attach !== false

      try {
        await creator.create(resolvedProjectPath, {
          mode: options.mode,
          terminalWidth: options.terminalWidth,
          terminalHeight: options.terminalHeight,
          attach: shouldAttach,
          zeromq: options.zeromq,
          ...socketOptions,
        })

        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('observe-events')
    .description('observe all events')
    .option('--ws', 'Send events over a websocket connection', true)
    .action(async options => {
      const observer = new EventObserver()
      await observer.start(options)
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
    process.exit(1)
  }
}

main().catch(error => {
  process.exit(1)
})
