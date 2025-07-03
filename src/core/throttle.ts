export function throttle<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  wait: number,
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout | null = null
  let lastCallTime = 0
  let lastArgs: TArgs | null = null

  const invokeFunc = (args: TArgs) => {
    lastCallTime = Date.now()
    func(...args)
  }

  return function throttled(...args: TArgs) {
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
