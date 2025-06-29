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
} from 'fs'
import { tmpdir, homedir } from 'os'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import dedent from 'dedent'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SAVE_FIXTURES = process.argv.includes('--save-fixtures')

const SOCKET_NAME = `control-test-${process.pid}-${Date.now()}`
const STABILITY_WAIT_MS = 1000
const POLL_INTERVAL_MS = 100
const WORKTREES_PATH = join(homedir(), 'code', 'worktrees')
const DB_PATH = join(homedir(), '.control', `cli-${SOCKET_NAME}.db`)
const TEMP_FIXTURES_DIR = join(
  tmpdir(),
  `control-cli-fixtures-temp-${process.pid}-${Date.now()}`,
)

const DEFAULT_CONFIG = dedent`
  name: test-project
  agents:
    act: claude
    plan: claude
  context:
    act: echo "Let us make a plan"
    plan: echo "Let us make a plan"
`

const TEST_RUNS = [
  {
    automateClaudeArguments: [
      '--skip-trust-folder',
      '--skip-ensure-plan-mode',
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    fixtureFileName: 'trust-folder.txt',
    configFile: DEFAULT_CONFIG,
  },
  {
    automateClaudeArguments: [
      '--skip-ensure-plan-mode',
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    fixtureFileName: 'ensure-plan-mode.txt',
    configFile: DEFAULT_CONFIG,
  },
  {
    automateClaudeArguments: [
      '--skip-inject-initial-context-act',
      '--skip-inject-initial-context-plan',
    ],
    createSessionArguments: [],
    fixtureFileName: 'inject-initial-context-plan.txt',
    configFile: DEFAULT_CONFIG,
  },
  {
    automateClaudeArguments: [],
    createSessionArguments: [],
    fixtureFileName: null,
    configFile: DEFAULT_CONFIG,
  },
]

let actualSessionName = ''
let workWindowIndex = ''
let automateClaudeProcess: ChildProcess | null = null
let createSessionProcess: ChildProcess | null = null

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

  return tempDir
}

function createSession(projectPath: string, additionalArgs: string[] = []) {
  console.error('Creating new session...')

  return new Promise<void>((resolve, reject) => {
    let output = ''

    createSessionProcess = spawn(
      'node',
      [
        join(__dirname, '..', '..', 'dist', 'cli.js'),
        'create-session',
        projectPath,
        '--project-name',
        'test-project',
        '-L',
        SOCKET_NAME,
        '--skip-migrations',
        ...additionalArgs,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

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

  automateClaudeProcess = spawn(
    'node',
    [
      join(__dirname, '..', '..', 'dist', 'cli.js'),
      'automate-claude',
      '-L',
      SOCKET_NAME,
      '--skip-migrations',
      ...additionalArgs,
    ],
    {
      stdio: 'inherit',
    },
  )

  automateClaudeProcess.on('error', error => {
    console.error('Error starting automate-claude:', error)
    cleanupProcesses()
    process.exit(1)
  })

  automateClaudeProcess.on('exit', code => {
    console.error(`automate-claude exited with code ${code}`)
  })
}

async function runIteration(
  iterationNumber: number,
  testRun: (typeof TEST_RUNS)[0],
) {
  const additionalArgs = testRun.automateClaudeArguments
  console.log(`\n${'='.repeat(60)}`)
  console.log(`=== Iteration ${iterationNumber} of ${TEST_RUNS.length} ===`)
  console.log(
    `Flags: ${additionalArgs.length > 0 ? additionalArgs.join(' ') : '(none)'}`,
  )
  console.log(`${'='.repeat(60)}\n`)

  killExistingSession()

  const projectPath = createTempProject(testRun.configFile)

  await startAutomateClaude(additionalArgs)

  await createSession(projectPath, testRun.createSessionArguments)

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

  console.log(`\n--- Screen output for iteration ${iterationNumber} ---`)
  console.log(screenContent)
  console.log(`--- End of iteration ${iterationNumber} ---\n`)

  if (SAVE_FIXTURES && testRun.fixtureFileName) {
    const tempFixturePath = join(TEMP_FIXTURES_DIR, testRun.fixtureFileName)
    writeFileSync(tempFixturePath, screenContent)
    console.error(`Saved fixture to temporary location: ${tempFixturePath}`)
  }

  cleanupProcesses()
  killExistingSession()

  actualSessionName = ''
  workWindowIndex = ''
}

function cleanupTestProjectWorktrees() {
  console.error('Cleaning up test-project worktrees...')
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

  if (!existsSync(finalFixturesDir)) {
    mkdirSync(finalFixturesDir, { recursive: true })
  }

  const fixturesToCopy = TEST_RUNS.map(run => run.fixtureFileName).filter(
    (fileName): fileName is string => fileName !== null,
  )

  for (const fileName of fixturesToCopy) {
    const tempPath = join(TEMP_FIXTURES_DIR, fileName)
    const finalPath = join(finalFixturesDir, fileName)

    if (existsSync(tempPath)) {
      copyFileSync(tempPath, finalPath)
      console.error(`Copied ${fileName} to ${finalPath}`)
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

  if (SAVE_FIXTURES && !existsSync(TEMP_FIXTURES_DIR)) {
    mkdirSync(TEMP_FIXTURES_DIR, { recursive: true })
  }

  const performFullCleanup = () => {
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
    for (let i = 0; i < TEST_RUNS.length; i++) {
      await runIteration(i + 1, TEST_RUNS[i])
    }

    console.error('All iterations complete!')

    if (SAVE_FIXTURES) {
      copyFixturesToFinalLocation()
    }

    console.error('Performing final cleanup...')
    cleanupProcesses()
    killExistingSession()
    cleanupTestDatabase()
    cleanupTestProjectWorktrees()
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
