export const POLL_INTERVAL = 500
export const MAX_CHECKSUM_CACHE_SIZE = 1000
export const AUTOMATION_PAUSE_MS = 500

export const DEFAULT_TERMINAL_WIDTH = 80
export const DEFAULT_TERMINAL_HEIGHT = 24

export const TEST_TERMINAL_SIZES = [
  { width: 80, height: 24, name: 'big' },
  { width: 50, height: 24, name: 'small' },
]

export interface ControlConfig {
  name?: string
  agents?: {
    act?: string
    plan?: string
  }
  context?: {
    act?: string
    plan?: string
  }
}
