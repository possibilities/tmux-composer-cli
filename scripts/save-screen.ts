#!/usr/bin/env tsx

import { execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOCKET_NAME = 'control-test-instance'
const STABILITY_WAIT_MS = 1000
const POLL_INTERVAL_MS = 100

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

  // Kill any existing test instance
  killExistingSession()

  // Create temp project
  const projectPath = createTempProject()

  // Start automate-claude process
  console.error('Starting automate-claude process...')
  automateClaudeProcess = spawn(
    'node',
    [
      join(__dirname, '..', 'dist', 'cli.js'),
      'automate-claude',
      '-L',
      SOCKET_NAME,
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
  console.log(screenContent)

  // Clean up
  cleanupProcesses()
  killExistingSession()
  console.error('Done!')
}

main().catch(error => {
  console.error('Error:', error)
  cleanupProcesses()
  process.exit(1)
})
