import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Add fixture files to the watch list
    forceRerunTriggers: ['**/fixtures/**/*.txt'],
  },
})
