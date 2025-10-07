(() => {
  const mark = '__langqueue_content_injected__'
  if ((window as unknown as Record<string, unknown>)[mark]) return
  ;(window as unknown as Record<string, unknown>)[mark] = true
  window.dispatchEvent(new CustomEvent('langqueue:content-ready'))
})()


