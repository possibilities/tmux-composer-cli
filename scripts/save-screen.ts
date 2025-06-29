#!/usr/bin/env tsx

import { execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOCKET_NAME = 'control-test-instance'
const STABILITY_WAIT_MS = 1000
const POLL_INTERVAL_MS = 100
const WORKTREES_PATH = join(homedir(), 'code', 'worktrees')
const DB_PATH = join(homedir(), '.control', 'cli.db')

// Define the different automate-claude flag configurations for each iteration
const AUTOMATE_CLAUDE_CONFIGS = [
  [
    '--skip-trust-folder',
    '--skip-ensure-plan-mode',
    '--skip-inject-initial-context',
  ],
  ['--skip-ensure-plan-mode', '--skip-inject-initial-context'],
  ['--skip-inject-initial-context'],
  [],
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
    console.error('Killed existing test server')
  } catch {
    // Server doesn't exist, that's fine
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

function createTempProject(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'control-test-'))
  console.error(`Created temp directory: ${tempDir}`)

  // Initialize git repo
  execSync('git init', { cwd: tempDir })

  // Create a minimal package.json
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    scripts: {
      dev: 'echo "Dev server running"',
    },
  }

  execSync(
    `echo '${JSON.stringify(packageJson, null, 2)}' > ${tempDir}/package.json`,
  )

  // Create a control.yaml
  const controlYaml = `name: test-project
agents:
  act: claude
  plan: claude
context:
  act: echo "Let us make a plan"
  plan: echo "Let us make a plan"`

  execSync(`echo '${controlYaml}' > ${tempDir}/control.yaml`)

  // Create readme
  execSync(`touch ${tempDir}/readme.md`)

  // Add all files and commit
  execSync('git add .', { cwd: tempDir })
  execSync('git commit -m "Initial commit"', { cwd: tempDir })

  console.error('Git repository initialized and committed')

  return tempDir
}

function createSession(projectPath: string) {
  console.error('Creating new session...')

  return new Promise<void>((resolve, reject) => {
    let output = ''

    createSessionProcess = spawn(
      'node',
      [
        join(__dirname, '..', 'dist', 'cli.js'),
        'create-session',
        projectPath,
        '--project-name',
        'test-project',
        '-L',
        SOCKET_NAME,
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

      // Parse session name from output
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
      // Content changed, reset stability timer
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
      join(__dirname, '..', 'dist', 'cli.js'),
      'automate-claude',
      '-L',
      SOCKET_NAME,
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

async function runIteration(iterationNumber: number, additionalArgs: string[]) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(
    `=== Iteration ${iterationNumber} of ${AUTOMATE_CLAUDE_CONFIGS.length} ===`,
  )
  console.log(
    `Flags: ${additionalArgs.length > 0 ? additionalArgs.join(' ') : '(none)'}`,
  )
  console.log(`${'='.repeat(60)}\n`)

  // Kill any existing test instance
  killExistingSession()

  // Create temp project
  const projectPath = createTempProject()

  // Start automate-claude process with iteration-specific flags
  await startAutomateClaude(additionalArgs)

  // Create the session
  await createSession(projectPath)

  // Wait a bit for session to initialize
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Verify session exists and find work window
  try {
    const windows = execSync(
      `tmux -L ${SOCKET_NAME} list-windows -t ${actualSessionName} -F "#{window_index} #{window_name}"`,
      { encoding: 'utf-8' },
    )
    console.error('Available windows:')
    console.error(windows)

    // Find the work window
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

  // Wait for stable screen and capture
  const screenContent = await waitForStableScreen()

  // Output to stdout
  console.log(`\n--- Screen output for iteration ${iterationNumber} ---`)
  console.log(screenContent)
  console.log(`--- End of iteration ${iterationNumber} ---\n`)

  // Clean up
  cleanupProcesses()
  killExistingSession()

  // Reset variables for next iteration
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

async function cleanupTestProjectDatabase() {
  console.error('Cleaning up test-project database entries...')

  if (!existsSync(DB_PATH)) {
    console.error('No database found, skipping database cleanup')
    return
  }

  try {
    const client = createClient({
      url: `file:${DB_PATH}`,
    })
    const db = drizzle(client)

    // Delete all sessions where sessionName or projectName contains 'test-project'
    const result = await db.run(
      sql`DELETE FROM sessions WHERE session_name LIKE '%test-project%' OR project_name = 'test-project'`,
    )

    const deletedRows = result.rowsAffected
    if (deletedRows > 0) {
      console.error(
        `Deleted ${deletedRows} test-project session(s) from database`,
      )
    } else {
      console.error('No test-project sessions found in database')
    }

    client.close()
  } catch (error) {
    console.error('Error cleaning up database:', error)
  }
}

async function main() {
  console.error('Starting save-screen script...')

  // Register cleanup handlers
  process.on('exit', () => {
    cleanupProcesses()
  })

  process.on('SIGINT', () => {
    console.error('\nReceived SIGINT, cleaning up...')
    cleanupProcesses()
    process.exit(1)
  })

  process.on('SIGTERM', () => {
    console.error('\nReceived SIGTERM, cleaning up...')
    cleanupProcesses()
    process.exit(1)
  })

  process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error)
    cleanupProcesses()
    process.exit(1)
  })

  // Clean up any existing test-project worktrees and database entries before starting
  cleanupTestProjectWorktrees()
  await cleanupTestProjectDatabase()

  // Run iterations with different configurations
  for (let i = 0; i < AUTOMATE_CLAUDE_CONFIGS.length; i++) {
    await runIteration(i + 1, AUTOMATE_CLAUDE_CONFIGS[i])
  }

  console.error('All iterations complete!')
}

main().catch(error => {
  console.error('Error:', error)
  cleanupProcesses()
  process.exit(1)
})
