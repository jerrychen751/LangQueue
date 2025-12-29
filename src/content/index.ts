import { initController } from './core/controller'
import { createChatGPTAdapter } from './adapters/chatgpt'
import { createClaudeAdapter } from './adapters/claude'
import { createGeminiAdapter } from './adapters/gemini'

(() => {
  const mark = '__langqueue_content_v2__'
  if ((window as unknown as Record<string, unknown>)[mark]) return
  ;(window as unknown as Record<string, unknown>)[mark] = true

  const adapters = [createChatGPTAdapter(), createClaudeAdapter(), createGeminiAdapter()]
  const adapter = adapters.find((entry) => entry.matches())
  if (!adapter) return

  initController(adapter)
})()

