export async function downloadJson(filename: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json)

  if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download({ url, filename, saveAs: false }, (_downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    })
    return
  }

  // Fallback for environments without the downloads API (should be rare in extension popup)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
