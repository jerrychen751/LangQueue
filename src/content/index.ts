/**
 * This file runs when the user's site URL matches one of the URLs specified in manifest.json.
 * 
 * It is the entry point of the content script, which runs inside of the context of a web page so it can read the page's DOM and interact with the page.
 */

import { initController } from './core/controller'
import { createChatGPTAdapter } from './adapters/chatgpt'
import { createClaudeAdapter } from './adapters/claude'
import { createGeminiAdapter } from './adapters/gemini'

const MARK = '__langqueue_content_script__';

// Declare global because declarations are local by default when file has imports (treated as module)
// Extends the DOM Window interface
declare global {
  interface Window {
    [MARK]?: boolean
  }
}

function initializeContentScript(): void {
  if (window[MARK]) {
    return;
  }

  window[MARK] = true;
  const adapters = [createChatGPTAdapter(), createClaudeAdapter(), createGeminiAdapter()];
  const adapter = adapters.find((entry) => entry.matchesAdapterDomain()); // each adapter handles determining what page user is on
  if (!adapter) {
    return;
  }

  initController(adapter);
}

initializeContentScript();