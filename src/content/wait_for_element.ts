export function waitForElement(selector: string, timeoutMs = 10000): Promise<Element> {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect()
      reject(new Error(`Timeout waiting for selector: ${selector}`))
    }, timeoutMs)

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        clearTimeout(timeout)
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}


