export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  let lastCallTime = 0
  let lastArgs: Parameters<T> | null = null

  const invokeFunc = (args: Parameters<T>) => {
    lastCallTime = Date.now()
    func(...args)
  }

  return function throttled(...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastCall = now - lastCallTime

    lastArgs = args

    if (timeSinceLastCall >= wait) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      invokeFunc(args)
    }

    if (!timeout) {
      const remainingTime = wait - timeSinceLastCall
      timeout = setTimeout(
        () => {
          timeout = null
          if (lastArgs && Date.now() - lastCallTime >= wait) {
            invokeFunc(lastArgs)
            lastArgs = null
          }
        },
        remainingTime > 0 ? remainingTime : wait,
      )
    }
  }
}
