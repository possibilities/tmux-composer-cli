declare module 'process' {
  interface Stdout {
    on(event: 'resize', listener: () => void): this
    off(event: 'resize', listener: () => void): this
  }
}

export {}
