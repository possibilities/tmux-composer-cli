#!/usr/bin/env node

const WebSocket = require('ws')

const ws = new WebSocket('ws://localhost:8080')

ws.on('open', () => {
  console.log('Connected to control-cli WebSocket server')

  // Test 1: List sessions
  console.log('\n--- Testing list-sessions ---')
  ws.send(
    JSON.stringify({
      type: 'list-sessions',
      requestId: 'test-1',
    }),
  )

  // Test 2: Show session (replace with an actual session name if you have one)
  setTimeout(() => {
    console.log('\n--- Testing show-session ---')
    ws.send(
      JSON.stringify({
        type: 'show-session',
        sessionName: 'example-project-worktree-001',
        requestId: 'test-2',
      }),
    )
  }, 1000)
})

ws.on('message', data => {
  const event = JSON.parse(data)
  console.log('\nReceived event:', JSON.stringify(event, null, 2))
})

ws.on('error', error => {
  console.error('WebSocket error:', error)
})

ws.on('close', () => {
  console.log('\nDisconnected from server')
})

// Close after 5 seconds
setTimeout(() => {
  console.log('\nClosing connection...')
  ws.close()
}, 5000)
