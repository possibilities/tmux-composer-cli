export const POLL_INTERVAL = 500
export const MAX_CHECKSUM_CACHE_SIZE = 1000
export const AUTOMATION_PAUSE_MS = 500
export const MAX_SCROLLBACK_LINES = 2000

export const TERMINAL_SIZES = {
  big: { width: 80, height: 24 },
  small: { width: 50, height: 24 },
}

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
