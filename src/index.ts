import { Command } from 'commander'
import packageJson from '../package.json' assert { type: 'json' }
import { TmuxSessionWatcher } from './commands/observe-session.js'
import { TmuxPaneWatcher } from './commands/observe-panes.js'
import { SessionCreator } from './commands/start-session.js'
import { SessionContinuer } from './commands/continue-session.js'
import { SessionResumer } from './commands/resume-session.js'
import { EventObserver } from './commands/observe-observers.js'
import { SessionFinisher } from './commands/finish-session.js'
import { SessionSyncer } from './commands/sync-session.js'
import { SessionCloser } from './commands/close-session.js'
import { ProjectShower } from './commands/show-project.js'
import { ProjectLister } from './commands/list-projects.js'
import { SystemStarter } from './commands/start-system.js'
import type { TmuxSocketOptions } from './core/tmux-socket.js'

function createSocketOptions(options: any): TmuxSocketOptions {
  return {
    socketName: options.tmuxSocket,
    socketPath: options.tmuxSocketPath,
  }
}

async function main() {
  const program = new Command()

  program
    .name('tmux-composer')
    .description('Tmux Composer CLI')
    .version(packageJson.version)

  program
    .command('start-session [project-path]')
    .description('start session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--no-attach', 'Do not attach to the session after creation')
    .option('--worktree', 'Create session with worktree (default: true)')
    .option('--no-worktree', 'Create session without worktree')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .option(
      '--allow-dirty-non-worktree-session',
      'Allow starting session with dirty repository in non-worktree mode',
    )
    .action(async (projectPath, options) => {
      const socketOptions = createSocketOptions(options)

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
          allowDirtyNonWorktreeSession: options.allowDirtyNonWorktreeSession,
          ...socketOptions,
        })

        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('continue-session [project-path]')
    .description('continue session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--no-attach', 'Do not attach to the session after creation')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async (projectPath, options) => {
      const socketOptions = createSocketOptions(options)

      const continuer = new SessionContinuer(socketOptions)

      const resolvedProjectPath = projectPath || process.cwd()
      const shouldAttach = options.attach !== false

      try {
        await continuer.continue(resolvedProjectPath, {
          terminalWidth: options.terminalWidth,
          terminalHeight: options.terminalHeight,
          attach: shouldAttach,
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
    .command('resume-session [project-path]')
    .description('resume session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--terminal-width <width>', 'Terminal width', parseInt)
    .option('--terminal-height <height>', 'Terminal height', parseInt)
    .option('--no-attach', 'Do not attach to the session after creation')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .option('--worktree <worktree>', 'Worktree to resume (number or full name)')
    .action(async (projectPath, options) => {
      const socketOptions = createSocketOptions(options)

      const resumer = new SessionResumer(socketOptions)

      const resolvedProjectPath = projectPath || process.cwd()
      const shouldAttach = options.attach !== false

      try {
        await resumer.resume(resolvedProjectPath, {
          terminalWidth: options.terminalWidth,
          terminalHeight: options.terminalHeight,
          attach: shouldAttach,
          zmq: options.zmq,
          zmqSocket: options.zmqSocket,
          zmqSocketPath: options.zmqSocketPath,
          worktree: options.worktree,
          ...socketOptions,
        })

        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('finish-session')
    .description('finish session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .option('--keep-session', 'Do not kill the session (useful for debugging)')
    .action(async options => {
      const socketOptions = createSocketOptions(options)

      const finisher = new SessionFinisher({
        ...socketOptions,
        zmq: options.zmq,
        zmqSocket: options.zmqSocket,
        zmqSocketPath: options.zmqSocketPath,
        keepSession: options.keepSession,
      })

      try {
        await finisher.finish()
        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('sync-session')
    .description('sync session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const socketOptions = createSocketOptions(options)

      const syncer = new SessionSyncer({
        ...socketOptions,
        zmq: options.zmq,
        zmqSocket: options.zmqSocket,
        zmqSocketPath: options.zmqSocketPath,
      })

      try {
        await syncer.sync()
        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('close-session')
    .description('close session')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .option(
      '--force',
      'Force close session without confirmation for dirty repository',
    )
    .action(async options => {
      const socketOptions = createSocketOptions(options)

      const closer = new SessionCloser({
        ...socketOptions,
        zmq: options.zmq,
        zmqSocket: options.zmqSocket,
        zmqSocketPath: options.zmqSocketPath,
        force: options.force,
      })

      try {
        await closer.close()
        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
    })

  program
    .command('observe-session')
    .description('observe session')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const watcher = new TmuxSessionWatcher()

      await watcher.start(options)
    })

  program
    .command('observe-panes')
    .description('observe panes')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const watcher = new TmuxPaneWatcher()

      await watcher.start(options)
    })

  program
    .command('observe-observers')
    .description('observe observers')
    .option('--ws', 'Enable WebSocket server')
    .option('--no-ws', 'Disable WebSocket server')
    .option('--port <port>', 'WebSocket server port', parseInt)
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const observer = new EventObserver()
      await observer.start(options)
    })

  program
    .command('show-project [project-path]')
    .description('show project configuration and information')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .action(async (projectPath, options) => {
      const socketOptions = createSocketOptions(options)
      const shower = new ProjectShower(socketOptions)
      await shower.show(projectPath)
    })

  program
    .command('list-projects')
    .description('list all projects in current directory')
    .option('--tmux-socket <socket-name>', 'Tmux socket name')
    .option('--tmux-socket-path <socket-path>', 'Tmux socket path')
    .action(async options => {
      const socketOptions = createSocketOptions(options)
      const lister = new ProjectLister(socketOptions)
      await lister.list()
    })

  program
    .command('start-system')
    .description('start tmux-composer system sessions')
    .option('--no-attach', 'Do not attach to the sessions after creation')
    .option('--no-zmq', 'Disable ZeroMQ publishing')
    .option('--zmq-socket <name>', 'ZeroMQ socket name')
    .option('--zmq-socket-path <path>', 'ZeroMQ socket full path')
    .action(async options => {
      const starter = new SystemStarter()

      try {
        await starter.start({
          attach: options.attach !== false,
          zmq: options.zmq,
          zmqSocket: options.zmqSocket,
          zmqSocketPath: options.zmqSocketPath,
        })

        process.exit(0)
      } catch (error) {
        process.exit(1)
      }
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
