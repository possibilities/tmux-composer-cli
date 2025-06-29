import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Add fixture files to the watch list
    forceRerunTriggers: ['**/fixtures/**/*.txt'],
    // Tests are isolated through unique socket names generated in save-screen.ts
    // Each test run uses a unique socket name based on process.pid and timestamp
    // This prevents conflicts when tests run in parallel
  },
})
