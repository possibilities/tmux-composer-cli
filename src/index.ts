import { Command } from 'commander'
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
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const watcher = new TmuxSessionWatcher()

      await watcher.start(options)
    })

  program
    .command('watch-panes')
    .description('watch pane changes')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const watcher = new TmuxPaneWatcher()

      await watcher.start(options)
    })

  program
    .command('create-session [project-path]')
    .description('create project session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--no-attach', 'Do not attach to the session after creation')
    .option('--no-worktree', 'Create session without worktree')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async (projectPath, options) => {
      const socketOptions: TmuxSocketOptions = {
        socketName: options.tmuxSocket,
        socketPath: options.tmuxSocketPath,
      }

      const creator = new SessionCreator(socketOptions)

      const resolvedProjectPath = projectPath || process.cwd()
      const shouldAttach = options.attach !== false

      try {
        await creator.create(resolvedProjectPath, {
          terminalWidth: options.terminalWidth,
          terminalHeight: options.terminalHeight,
          attach: shouldAttach,
          worktree: options.worktree,
          zmq: options.zmq,
          zmqSocket: options.zmqSocket,
          zmqSocketPath: options.zmqSocketPath,
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
    .option('--ws', 'Enable WebSocket server')
    .option('--no-ws', 'Disable WebSocket server')
    .option('--ws-port <port>', 'WebSocket server port', parseInt, 31337)
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
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
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'commander.help' ||
        error.code === 'commander.helpDisplayed')
    ) {
      process.exit(0)
    }
    process.exit(1)
  }
}

main().catch(() => {
  process.exit(1)
})
