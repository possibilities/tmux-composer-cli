const { Subscriber } = require('zeromq')

async function main() {
  const subscriber = new Subscriber()

  try {
    subscriber.connect('ipc:///tmp/tmux-composer-events.sock')
    subscriber.subscribe('')

    console.log('Listening for ZeroMQ events...')

    for await (const [msg] of subscriber) {
      const event = JSON.parse(msg.toString())
      console.log('\n=== Event Received ===')
      console.log('Event:', event.event)
      console.log('Timestamp:', event.timestamp)
      if (event.source) {
        console.log('Source:')
        console.log('  Script:', event.source.script)
        console.log('  Session ID:', event.source.sessionId)
        console.log('  Session Name:', event.source.sessionName)
        console.log('  Socket Path:', event.source.socketPath)
        console.log('  PID:', event.source.pid)
        console.log('  Hostname:', event.source.hostname)
      }
      if (event.data) {
        console.log('Data:', JSON.stringify(event.data, null, 2))
      }
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

main().catch(console.error)
