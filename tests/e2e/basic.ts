#!/usr/bin/env tsx

import { execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
} from 'fs'
import { tmpdir, homedir } from 'os'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import dedent from 'dedent'
import {
  TERMINAL_SIZES,
  MAX_SCROLLBACK_LINES,
} from '../../src/core/constants.js'

const DEFAULT_CONFIG = dedent`
  name: default-test-project
  agents:
    act: claude
    plan: claude
  context:
    act: echo "Do nothing but wait for my feature description to make a plan"
    plan: echo "Do nothing but wait for my feature description to make a plan"
`

const TEST_TERMINAL_SIZES = Object.values(TERMINAL_SIZES)

const TEST_RUNS = [
  {
    automateClaudeArguments: [
      '--skip-dismiss-trust-folder-confirmation',
      '--skip-ensure-plan-mode',
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    configFile: DEFAULT_CONFIG,
    mode: 'plan' as const,
    fixtureFileName: 'dismiss-trust-folder-confirmation.txt',
  },
  {
    automateClaudeArguments: [
      '--skip-ensure-plan-mode',
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    configFile: DEFAULT_CONFIG,
    mode: 'plan' as const,
    fixtureFileName: 'ensure-plan-mode.txt',
  },
  {
    automateClaudeArguments: [
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    configFile: DEFAULT_CONFIG,
    mode: 'plan' as const,
    fixtureFileName: 'inject-initial-context-plan.txt',
  },
  {
    automateClaudeArguments: [
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    configFile: DEFAULT_CONFIG,
    mode: 'act' as const,
    fixtureFileName: 'inject-initial-context-act.txt',
  },
  {
    automateClaudeArguments: ['--skip-dismiss-create-file-confirmation'],
    createSessionArguments: [],
    mode: 'act' as const,
    fixtureFileName: 'dismiss-create-file-confirmation.txt',
    configFile: dedent`
      name: create-file-test-project
      agents:
        act: claude
        plan: claude
      context:
        act: echo "Create a file called funny.txt with 5 funny words in it, one on each line"
        plan: echo "Create a file called funny.txt with 5 funny words in it, one on each line"
    `,
  },
  {
    automateClaudeArguments: ['--skip-dismiss-edit-file-confirmation'],
    createSessionArguments: [],
    mode: 'act' as const,
    fixtureFileName: 'dismiss-edit-file-confirmation.txt',
    configFile: dedent`
      name: edit-file-test-project
      agents:
        act: claude
        plan: claude
      context:
        act: echo "Create a file called funny.txt with 5 funny words in it, one on each line. Then, after saving, add 1 more funny word to it."
        plan: echo "Create a file called funny.txt with 5 funny words in it, one on each line. Then, after saving, add 1 more funny word to it."
    `,
  },
  {
    automateClaudeArguments: ['--skip-dismiss-run-command-confirmation'],
    createSessionArguments: [],
    mode: 'act' as const,
    fixtureFileName: 'dismiss-run-command-confirmation.txt',
    configFile: dedent`
      name: run-command-test-project
      agents:
        act: claude
        plan: claude
      context:
        act: echo "Run 'ls -lsa /tmp' in the current directory"
        plan: echo "Run 'ls -lsa /tmp' in the current directory"
    `,
  },
  {
    automateClaudeArguments: ['--skip-dismiss-read-file-confirmation'],
    createSessionArguments: [],
    mode: 'act' as const,
    fixtureFileName: 'dismiss-read-file-confirmation.txt',
    configFile: dedent`
      name: read-file-test-project
      agents:
        act: claude
        plan: claude
      context:
        act: echo "Read the file '/tmp/control-e2e-basic-date1.txt' and show he content"
        plan: echo "Read the file '/tmp/control-e2e-basic-date1.txt' and show he content"
    `,
  },
]

const __dirname = dirname(fileURLToPath(import.meta.url))

const SAVE_FIXTURES = process.argv.includes('--save-fixtures')
const NO_CLEANUP = process.argv.includes('--no-cleanup')

const SOCKET_NAME = `control-test-${process.pid}-${Date.now()}`
const STABILITY_WAIT_MS = 2000
const POLL_INTERVAL_MS = 100
const WORKTREES_PATH = join(homedir(), 'code', 'worktrees')
const DB_PATH = join(homedir(), '.control', `cli-${SOCKET_NAME}.db`)
const TEMP_FIXTURES_DIR = join(
  tmpdir(),
  `control-cli-fixtures-temp-${process.pid}-${Date.now()}`,
)

let actualSessionName = ''
let workWindowIndex = ''
let automateClaudeProcess: ChildProcess | null = null
let createSessionProcess: ChildProcess | null = null

function cleanupPreviousTestRuns() {
  console.error('Cleaning up previous test runs...')

  // Clean up test sockets
  try {
    const tmuxDir = '/tmp/tmux-1000'
    if (existsSync(tmuxDir)) {
      const files = readdirSync(tmuxDir)
      const testSockets = files.filter(f => f.startsWith('control-test-'))

      for (const socket of testSockets) {
        const socketPath = join(tmuxDir, socket)
        try {
          // Try to kill any sessions on this socket first
          execSync(`tmux -S ${socketPath} kill-server`, { stdio: 'ignore' })
        } catch {
          // Ignore errors, socket might already be dead
        }

        try {
          rmSync(socketPath, { force: true })
          console.error(`Deleted old test socket: ${socket}`)
        } catch (error) {
          console.error(`Failed to delete socket ${socket}:`, error)
        }
      }

      if (testSockets.length === 0) {
        console.error('No old test sockets found')
      } else {
        console.error(`Cleaned up ${testSockets.length} old test socket(s)`)
      }
    }
  } catch (error) {
    console.error('Error cleaning up test sockets:', error)
  }

  // Clean up test databases
  try {
    const controlDir = join(homedir(), '.control')
    if (existsSync(controlDir)) {
      const files = readdirSync(controlDir)
      const testDbs = files.filter(
        f => f.startsWith('cli-control-test-') && f.endsWith('.db'),
      )

      for (const db of testDbs) {
        const dbPath = join(controlDir, db)
        try {
          rmSync(dbPath, { force: true })
          console.error(`Deleted old test database: ${db}`)
        } catch (error) {
          console.error(`Failed to delete database ${db}:`, error)
        }
      }

      if (testDbs.length === 0) {
        console.error('No old test databases found')
      } else {
        console.error(`Cleaned up ${testDbs.length} old test database(s)`)
      }
    }
  } catch (error) {
    console.error('Error cleaning up test databases:', error)
  }
}

function killExistingSession() {
  try {
    execSync(`tmux -L ${SOCKET_NAME} kill-server`, {
      stdio: 'ignore',
    })
    console.error(`Killed existing test server for socket: ${SOCKET_NAME}`)
  } catch {
    console.error(`No existing server found for socket: ${SOCKET_NAME}`)
  }
}

function cleanupProcesses() {
  console.error('Cleaning up processes...')

  if (automateClaudeProcess) {
    try {
      automateClaudeProcess.kill('SIGTERM')
      console.error('Killed automate-claude process')
    } catch (error) {
      console.error('Error killing automate-claude:', error)
    }
    automateClaudeProcess = null
  }

  if (createSessionProcess) {
    try {
      createSessionProcess.kill('SIGTERM')
      console.error('Killed create-session process')
    } catch (error) {
      console.error('Error killing create-session:', error)
    }
    createSessionProcess = null
  }
}

function createTempProject(configContent: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'control-test-'))
  console.error(`Created temp directory: ${tempDir}`)

  execSync('git init', { cwd: tempDir })

  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    scripts: {
      dev: 'echo "Dev server running"',
    },
  }

  writeFileSync(
    join(tempDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  )

  writeFileSync(join(tempDir, 'control.yaml'), configContent)

  writeFileSync(join(tempDir, 'readme.md'), '')

  execSync('git add .', { cwd: tempDir })
  execSync('git commit -m "Initial commit"', { cwd: tempDir })

  console.error('Git repository initialized and committed')

  execSync('date > /tmp/control-e2e-basic-date1.txt')
  console.error('Created temp files with timestamps in /tmp')

  return tempDir
}

function createSession(
  projectPath: string,
  additionalArgs: string[] = [],
  terminalWidth?: number,
  terminalHeight?: number,
) {
  console.error('Creating new session...')
  if (terminalWidth && terminalHeight) {
    console.error(`Terminal size: ${terminalWidth}x${terminalHeight}`)
  }

  return new Promise<void>((resolve, reject) => {
    let output = ''

    const args = [
      join(__dirname, '..', '..', 'dist', 'cli.js'),
      'session',
      'create',
      projectPath,
      '-L',
      SOCKET_NAME,
      '--skip-migrations',
    ]

    if (terminalWidth !== undefined && terminalHeight !== undefined) {
      args.push('--terminal-width', String(terminalWidth))
      args.push('--terminal-height', String(terminalHeight))
    }

    args.push(...additionalArgs)

    createSessionProcess = spawn('node', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    createSessionProcess.stdout?.on('data', data => {
      const chunk = data.toString()
      output += chunk
      process.stderr.write(chunk)
    })

    createSessionProcess.stderr?.on('data', data => {
      process.stderr.write(data)
    })

    createSessionProcess.on('error', error => {
      console.error('Error creating session:', error)
      cleanupProcesses()
      reject(error)
    })

    createSessionProcess.on('exit', code => {
      if (code !== 0) {
        console.error(`create-session exited with code ${code}`)
        cleanupProcesses()
        reject(new Error(`create-session failed with code ${code}`))
        return
      }

      const sessionMatch = output.match(/Session name: (\S+)/)
      if (sessionMatch) {
        actualSessionName = sessionMatch[1]
        console.error(`Created session: ${actualSessionName}`)
        resolve()
      } else {
        console.error('Could not parse session name from output')
        console.error(output)
        reject(new Error('Failed to parse session name'))
      }
    })
  })
}

function captureScreen(): string {
  if (!actualSessionName || !workWindowIndex) {
    console.error('No session name or window index available')
    return ''
  }

  try {
    const output = execSync(
      `tmux -L ${SOCKET_NAME} capture-pane -t ${actualSessionName}:${workWindowIndex} -p`,
      {
        encoding: 'utf-8',
      },
    )
    return output
  } catch (error) {
    console.error('Failed to capture screen:', error)
    return ''
  }
}

function captureScreenWithScrollback(): string {
  if (!actualSessionName || !workWindowIndex) {
    console.error('No session name or window index available')
    return ''
  }

  try {
    const output = execSync(
      `tmux -L ${SOCKET_NAME} capture-pane -t ${actualSessionName}:${workWindowIndex} -p -S -${MAX_SCROLLBACK_LINES}`,
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    return output
  } catch (error) {
    console.error('Failed to capture screen with scrollback:', error)
    return ''
  }
}

function calculateChecksum(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

async function waitForStableScreen(): Promise<string> {
  console.error('Waiting for screen to stabilize...')

  let lastContent = ''
  let lastChecksum = ''
  let stableStartTime = 0

  while (true) {
    const content = captureScreen()
    const checksum = calculateChecksum(content)

    if (checksum === lastChecksum) {
      const stableDuration = Date.now() - stableStartTime
      if (stableDuration >= STABILITY_WAIT_MS) {
        console.error(`Screen stable for ${stableDuration}ms`)
        return content
      }
    } else {
      lastContent = content
      lastChecksum = checksum
      stableStartTime = Date.now()
      console.error('Screen changed, resetting stability timer')
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

async function startAutomateClaude(additionalArgs: string[]) {
  console.error('Starting automate-claude process...')
  console.error('Additional args:', additionalArgs)

  return new Promise<void>((resolve, reject) => {
    let stderrOutput = ''

    automateClaudeProcess = spawn(
      'node',
      [
        join(__dirname, '..', '..', 'dist', 'cli.js'),
        'claude',
        'automate',
        '-L',
        SOCKET_NAME,
        '--skip-migrations',
        ...additionalArgs,
      ],
      {
        stdio: ['pipe', 'inherit', 'pipe'],
      },
    )

    automateClaudeProcess.stderr?.on('data', data => {
      const chunk = data.toString()
      stderrOutput += chunk
      process.stderr.write(chunk)
    })

    automateClaudeProcess.on('error', error => {
      console.error('Error starting automate-claude:', error)
      cleanupProcesses()
      reject(error)
    })

    automateClaudeProcess.on('exit', code => {
      console.error(`automate-claude exited with code ${code}`)
      if (code === 1) {
        // Exit code 1 indicates a critical error (like logout detection or invalid options)
        console.error('\n' + '='.repeat(60))
        console.error('❌ AUTOMATE-CLAUDE FAILED WITH ERROR CODE 1')
        console.error('='.repeat(60))
        if (stderrOutput.trim()) {
          console.error('Error details:')
          console.error(stderrOutput.trim())
        }
        console.error('Command was:')
        console.error(
          `  node ${join(__dirname, '..', '..', 'dist', 'cli.js')} claude automate -L ${SOCKET_NAME} --skip-migrations ${additionalArgs.join(' ')}`,
        )
        console.error('='.repeat(60) + '\n')
        cleanupProcesses()
        process.exit(1)
      }
    })

    // Resolve immediately since automate-claude runs in the background
    resolve()
  })
}

async function runIteration(
  iterationNumber: number,
  testRun: (typeof TEST_RUNS)[0],
  terminalSize: (typeof TEST_TERMINAL_SIZES)[0],
) {
  const additionalArgs = testRun.automateClaudeArguments
  console.log(`\n${'='.repeat(60)}`)
  console.log(`=== Iteration ${iterationNumber} ===`)
  console.log(`Terminal size: ${terminalSize.width}x${terminalSize.height}`)
  console.log(
    `Flags: ${additionalArgs.length > 0 ? additionalArgs.join(' ') : '(none)'}`,
  )
  console.log(`${'='.repeat(60)}\n`)

  killExistingSession()

  const projectPath = createTempProject(testRun.configFile)

  await startAutomateClaude(additionalArgs)

  await createSession(
    projectPath,
    ['--mode', testRun.mode, ...testRun.createSessionArguments],
    terminalSize.width,
    terminalSize.height,
  )

  await new Promise(resolve => setTimeout(resolve, 2000))

  try {
    const windows = execSync(
      `tmux -L ${SOCKET_NAME} list-windows -t ${actualSessionName} -F "#{window_index} #{window_name}"`,
      { encoding: 'utf-8' },
    )
    console.error('Available windows:')
    console.error(windows)

    const windowLines = windows.trim().split('\n')
    for (const line of windowLines) {
      const [index, name] = line.split(' ')
      if (name === 'work') {
        workWindowIndex = index
        console.error(`Found work window at index ${workWindowIndex}`)
        break
      }
    }

    if (!workWindowIndex) {
      console.error('Could not find work window, using last window')
      workWindowIndex = windowLines[windowLines.length - 1].split(' ')[0]
    }
  } catch (error) {
    console.error('Failed to list windows:', error)
  }

  const screenContent = await waitForStableScreen()

  const screenContentWithScrollback = captureScreenWithScrollback()

  console.log(`\n--- Screen output for iteration ${iterationNumber} ---`)
  console.log(screenContent)
  console.log(`--- End of iteration ${iterationNumber} ---\n`)

  if (SAVE_FIXTURES && testRun.fixtureFileName) {
    const baseName = testRun.fixtureFileName.replace('.txt', '')

    const sizedFileName = `${baseName}-${terminalSize.width}x${terminalSize.height}.txt`
    const tempFixturePath = join(TEMP_FIXTURES_DIR, sizedFileName)
    writeFileSync(tempFixturePath, screenContent)
    console.error(
      `Saved pane fixture to temporary location: ${tempFixturePath}`,
    )

    const fullFileName = `${baseName}-${terminalSize.width}x${terminalSize.height}-full.txt`
    const tempFullFixturePath = join(TEMP_FIXTURES_DIR, fullFileName)
    writeFileSync(tempFullFixturePath, screenContentWithScrollback)
    console.error(
      `Saved full scrollback fixture to temporary location: ${tempFullFixturePath}`,
    )
  }

  if (!NO_CLEANUP) {
    cleanupProcesses()
    killExistingSession()
    actualSessionName = ''
    workWindowIndex = ''
  }
}

function cleanupTestProjectWorktrees() {
  console.error('Cleaning up test-project worktrees...')

  // Clean up ~/.claude.json entries
  const claudeJsonPath = join(homedir(), '.claude.json')
  if (existsSync(claudeJsonPath)) {
    try {
      // First, clean up old backups (keep only 4 newest)
      const claudeDir = dirname(claudeJsonPath)
      const files = readdirSync(claudeDir)
      const backupFiles = files
        .filter(f => f.startsWith('.claude.json.backup.'))
        .map(f => ({
          name: f,
          path: join(claudeDir, f),
          mtime: execSync(`stat -c %Y "${join(claudeDir, f)}"`, {
            encoding: 'utf-8',
          }).trim(),
        }))
        .sort((a, b) => parseInt(b.mtime) - parseInt(a.mtime))

      // Delete old backups, keeping only the 4 newest
      if (backupFiles.length > 4) {
        const backupsToDelete = backupFiles.slice(4)
        for (const backup of backupsToDelete) {
          try {
            rmSync(backup.path)
            console.error(`Deleted old backup: ${backup.name}`)
          } catch (error) {
            console.error(`Failed to delete old backup ${backup.name}:`, error)
          }
        }
      }

      // Create timestamped backup
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '-')
        .split('.')[0]
      const backupPath = `${claudeJsonPath}.backup.${timestamp}`
      copyFileSync(claudeJsonPath, backupPath)
      console.error(`Created backup: ${backupPath}`)

      // Read and parse the file
      const claudeJsonContent = readFileSync(claudeJsonPath, 'utf-8')
      const claudeJson = JSON.parse(claudeJsonContent)

      // Count entries before cleanup
      let removedCount = 0

      // Remove test worktree entries from projects
      if (claudeJson.projects) {
        const originalCount = Object.keys(claudeJson.projects).length
        console.error(`Found ${originalCount} total projects in ~/.claude.json`)

        const filteredProjects: Record<string, any> = {}

        for (const [key, value] of Object.entries(claudeJson.projects)) {
          if (
            !key.match(
              /\/home\/mike\/code\/worktrees\/test-project-worktree-\d+$/,
            )
          ) {
            filteredProjects[key] = value
          } else {
            console.error(`Removing test worktree entry: ${key}`)
            removedCount++
          }
        }

        claudeJson.projects = filteredProjects
        const newCount = Object.keys(filteredProjects).length
        console.error(`After filtering: ${newCount} projects remaining`)

        // Write back to file
        writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2))

        // Verify the write succeeded
        const verifyContent = readFileSync(claudeJsonPath, 'utf-8')
        const verifyJson = JSON.parse(verifyContent)
        const verifyCount = Object.keys(verifyJson.projects).length
        console.error(
          `Verified file written: ${verifyCount} projects in file after write`,
        )

        if (removedCount > 0) {
          console.error(
            `Removed ${removedCount} test worktree entries from ~/.claude.json`,
          )
        } else {
          console.error('No test worktree entries found in ~/.claude.json')
        }
      } else {
        console.error('No projects section found in ~/.claude.json')
      }
    } catch (error) {
      console.error('Error cleaning up ~/.claude.json:', error)
    }
  }

  // Clean up worktree directories
  try {
    const dirs = readdirSync(WORKTREES_PATH)
    const testWorktrees = dirs.filter(dir =>
      dir.startsWith('test-project-worktree-'),
    )

    for (const dir of testWorktrees) {
      const worktreePath = join(WORKTREES_PATH, dir)
      try {
        rmSync(worktreePath, { recursive: true, force: true })
        console.error(`Deleted worktree: ${dir}`)
      } catch (error) {
        console.error(`Failed to delete worktree ${dir}:`, error)
      }
    }

    if (testWorktrees.length === 0) {
      console.error('No test-project worktrees found')
    } else {
      console.error(
        `Cleaned up ${testWorktrees.length} test-project worktree(s)`,
      )
    }
  } catch (error) {
    console.error('Error accessing worktrees directory:', error)
  }
}

function cleanupTestDatabase() {
  console.error(`Cleaning up test database: ${DB_PATH}`)

  if (!existsSync(DB_PATH)) {
    console.error('No test database found, skipping database cleanup')
    return
  }

  try {
    rmSync(DB_PATH, { force: true })
    console.error('Deleted test database')
  } catch (error) {
    console.error('Error deleting test database:', error)
  }
}

function copyFixturesToFinalLocation() {
  console.error('Copying fixtures to final location...')

  const finalFixturesDir = join(process.cwd(), 'fixtures')

  // Clear existing fixtures directory
  if (existsSync(finalFixturesDir)) {
    console.error('Clearing existing fixtures directory...')
    rmSync(finalFixturesDir, { recursive: true, force: true })
  }

  // Recreate the fixtures directory
  mkdirSync(finalFixturesDir, { recursive: true })

  // Get all fixture files with terminal sizes in their names
  const baseFileNames = TEST_RUNS.map(run => run.fixtureFileName).filter(
    (fileName): fileName is string => fileName !== null,
  )

  for (const baseFileName of baseFileNames) {
    for (const terminalSize of TEST_TERMINAL_SIZES) {
      const baseName = baseFileName.replace('.txt', '')

      const sizedFileName = `${baseName}-${terminalSize.width}x${terminalSize.height}.txt`
      const tempPath = join(TEMP_FIXTURES_DIR, sizedFileName)
      const finalPath = join(finalFixturesDir, sizedFileName)

      if (existsSync(tempPath)) {
        copyFileSync(tempPath, finalPath)
        console.error(`Copied ${sizedFileName} to ${finalPath}`)
      }

      const fullFileName = `${baseName}-${terminalSize.width}x${terminalSize.height}-full.txt`
      const tempFullPath = join(TEMP_FIXTURES_DIR, fullFileName)
      const finalFullPath = join(finalFixturesDir, fullFileName)

      if (existsSync(tempFullPath)) {
        copyFileSync(tempFullPath, finalFullPath)
        console.error(`Copied ${fullFileName} to ${finalFullPath}`)
      }
    }
  }

  try {
    rmSync(TEMP_FIXTURES_DIR, { recursive: true, force: true })
    console.error('Cleaned up temporary fixtures directory')
  } catch (error) {
    console.error('Error cleaning up temp fixtures:', error)
  }
}

async function runMigrations() {
  console.error('Running database migrations...')
  return new Promise<void>((resolve, reject) => {
    const migrateProcess = spawn(
      'node',
      [
        join(__dirname, '..', '..', 'dist', 'cli.js'),
        'run-migrations',
        '-L',
        SOCKET_NAME,
      ],
      {
        stdio: 'inherit',
      },
    )

    migrateProcess.on('error', error => {
      console.error('Error running migrations:', error)
      reject(error)
    })

    migrateProcess.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`Migration process exited with code ${code}`))
      } else {
        console.error('Migrations completed successfully')
        resolve()
      }
    })
  })
}

async function main() {
  console.error('Starting e2e basic test...')
  console.error(`Using unique socket name: ${SOCKET_NAME}`)
  console.error(`Database path: ${DB_PATH}`)
  if (SAVE_FIXTURES) {
    console.error('Fixtures will be saved')
  }
  if (NO_CLEANUP) {
    console.error('No-cleanup mode: artifacts will be preserved for inspection')
  }

  // Clean up any previous test runs first
  cleanupPreviousTestRuns()

  if (SAVE_FIXTURES && !existsSync(TEMP_FIXTURES_DIR)) {
    mkdirSync(TEMP_FIXTURES_DIR, { recursive: true })
  }

  const performFullCleanup = () => {
    if (NO_CLEANUP) {
      console.error('\nNo-cleanup mode: Skipping cleanup')
      return
    }
    cleanupProcesses()
    killExistingSession()
    cleanupTestDatabase()
    if (SAVE_FIXTURES) {
      try {
        rmSync(TEMP_FIXTURES_DIR, { recursive: true, force: true })
      } catch {}
    }
  }

  process.on('exit', () => {
    performFullCleanup()
  })

  process.on('SIGINT', () => {
    console.error('\nReceived SIGINT, cleaning up...')
    performFullCleanup()
    process.exit(1)
  })

  process.on('SIGTERM', () => {
    console.error('\nReceived SIGTERM, cleaning up...')
    performFullCleanup()
    process.exit(1)
  })

  process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error)
    performFullCleanup()
    process.exit(1)
  })

  cleanupTestProjectWorktrees()
  cleanupTestDatabase()

  try {
    await runMigrations()
  } catch (error) {
    console.error('Failed to run migrations:', error)
    process.exit(1)
  }

  try {
    let iterationNumber = 1
    for (const terminalSize of TEST_TERMINAL_SIZES) {
      for (let i = 0; i < TEST_RUNS.length; i++) {
        await runIteration(iterationNumber++, TEST_RUNS[i], terminalSize)
      }
    }

    console.error('All iterations complete!')

    if (SAVE_FIXTURES) {
      copyFixturesToFinalLocation()
    }

    if (NO_CLEANUP) {
      console.error('\n' + '='.repeat(60))
      console.error('NO-CLEANUP MODE: Preserving test artifacts')
      console.error('='.repeat(60))
      console.error('\nArtifacts left behind:')
      console.error(`- Database: ${DB_PATH}`)
      console.error(`- Socket: /tmp/tmux-1000/${SOCKET_NAME}`)
      if (actualSessionName) {
        console.error(`- Session: ${actualSessionName}`)
        console.error(`\nTo attach to the tmux session:`)
        console.error(`  tmux -L ${SOCKET_NAME} attach -t ${actualSessionName}`)
      }
      const worktrees = readdirSync(WORKTREES_PATH).filter(d =>
        d.startsWith('test-project-worktree-'),
      )
      if (worktrees.length > 0) {
        console.error(`\nWorktrees created:`)
        worktrees.forEach(w => {
          console.error(`  - ${join(WORKTREES_PATH, w)}`)
        })
      }
      console.error('\n' + '='.repeat(60))

      // In no-cleanup mode, we need to exit explicitly since processes are still running
      process.exit(0)
    } else {
      console.error('Performing final cleanup...')
      cleanupProcesses()
      killExistingSession()
      cleanupTestDatabase()
      cleanupTestProjectWorktrees()
    }
  } catch (error) {
    console.error('Error during iterations:', error)
    if (SAVE_FIXTURES) {
      try {
        rmSync(TEMP_FIXTURES_DIR, { recursive: true, force: true })
      } catch {}
    }
    cleanupProcesses()
    killExistingSession()
    cleanupTestDatabase()
    throw error
  }
}

main().catch(error => {
  console.error('Error:', error)
  cleanupProcesses()
  process.exit(1)
})
