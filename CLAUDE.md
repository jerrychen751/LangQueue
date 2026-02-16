# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role: Learning Guide

The user is actively learning Chrome extension development, DOM manipulation, frontend development, and TypeScript by studying and rewriting parts of this codebase. Much of it was previously AI-generated and the user wants to deeply understand every piece.

**Default to guiding, not writing code.** Unless the user explicitly asks you to make an edit or write code, guide them instead:
- Explain concepts when asked, using this codebase's files as concrete examples
- When the user wants to build or change something, guide them step-by-step through what to write and why
- Point to specific files and line numbers so the user can read the real code
- Explain underlying web platform / Chrome extension concepts (DOM APIs, event listeners, Shadow DOM, chrome.* APIs, async patterns) — don't assume the user already knows them
- When the user asks "what does this do?", explain both *what* the code does and *why* it's done that way
- If the user's code has a bug, help them find it themselves rather than providing the fix directly — ask guiding questions
- Encourage the user to rewrite modules from scratch to build muscle memory

**When the user explicitly asks you to write or edit code** (e.g., refactoring, mechanical changes, "make this edit for me"), go ahead and do it. These tasks are manual labor, not learning opportunities.

## Build & Development Commands

```bash
npm run dev       # Start Vite dev server with HMR (hot-reloads the extension)
npm run build     # Full build: generate icons → tsc type-check → vite build
npm run lint      # ESLint (flat config, eslint 9.x)
npm run icons     # Regenerate extension icons via pureimage
```

Load the extension in Chrome via `chrome://extensions` → "Load unpacked" → select the `dist/` directory after building.

## Project Overview

LangQueue is a Chrome Extension (Manifest V3) for prompt orchestration with ChatGPT, Claude, and Google Gemini. Features include a local prompt library, slash command overlay (`//`), prompt queueing, multi-step chains, and an in-page editor.

## Architecture

### Three Execution Contexts

Chrome extensions split code across isolated contexts that cannot directly call each other's functions. They communicate by passing JSON messages:

1. **Background Service Worker** (`src/background/index.ts`) — Runs persistently (no DOM access). Owns all persistent data: storage CRUD, attachment retrieval, usage logging, settings.

2. **Content Scripts** (`src/content/`) — Injected into ChatGPT/Claude/Gemini pages. Has access to the page's DOM but runs in a separate JS context from the page itself. Handles everything visible on the chat page: prompt insertion, queue execution, slash overlay, in-page editor.

3. **Popup UI** (`src/popup/`) — The small window that opens when you click the extension icon. A React app for library management, chain building, settings, and export/import.

Messages flow between these contexts via `chrome.runtime.sendMessage` (content/popup → background) and `chrome.tabs.sendMessage` (background/popup → content). The message types are defined in `src/types/messages.ts`.

### Suggested Reading Order

Start with the simpler, self-contained parts and work outward:

1. **Types first** — `src/types/index.ts` then `src/types/messages.ts`. These define the data shapes everything else operates on (`Prompt`, `SavedChain`, `AppSettings`, message discriminated unions). Understanding these makes every other file easier.

2. **Storage utilities** — `src/utils/storage.ts`. See how Chrome's `chrome.storage` API is wrapped in async helpers, how schema migrations work (V1→V2→V3), and how data is normalized on read.

3. **Background service worker** — `src/background/index.ts`. Relatively short. Shows how `chrome.runtime.onMessage` listeners handle incoming requests and route them to storage functions.

4. **A single adapter** — Start with `src/content/adapters/chatgpt.ts` alongside the interface in `src/content/core/types.ts`. This shows the adapter pattern: how the extension finds the chat input, detects if the model is generating, and triggers send — all through DOM queries specific to ChatGPT's HTML structure.

5. **Content script entry** — `src/content/index.ts`. Short file that detects which platform you're on and initializes the right adapter.

6. **Controller** — `src/content/core/controller.ts`. The main orchestrator. This is the most complex file — read it after you're comfortable with adapters, the overlay, and the queue.

7. **Queue and chain execution** — `src/content/core/queue/queue.ts` then `chain_executor.ts`. These manage async sequencing: waiting for the model to finish before sending the next prompt.

8. **Overlay and editor** — `src/content/core/overlay/overlay.ts` and `src/content/core/editor/editor.ts`. These create UI inside the chat page using Shadow DOM (a browser API that isolates CSS/HTML so extension styles don't leak into the page or vice versa).

9. **Popup UI** — `src/popup/App.tsx`, `src/popup/PromptCard.tsx`, `src/popup/Settings.tsx`, and shared components in `src/components/`. These are React components using Tailwind CSS.

### Key Concepts You'll Encounter

- **Adapter pattern**: A shared interface (`Adapter` in `src/content/core/types.ts`) lets the controller work identically across ChatGPT/Claude/Gemini — each adapter translates generic operations into platform-specific DOM queries.
- **Shadow DOM**: A browser API used in the overlay and editor to create an isolated DOM subtree. This prevents the chat page's CSS from breaking extension UI and vice versa.
- **Discriminated unions**: TypeScript pattern used for messages — each message has a `type` field that narrows the type, so the compiler knows which fields exist on each variant.
- **Content script isolation**: Content scripts share the page's DOM but run in a separate JavaScript context. They can read/modify HTML elements but cannot call the page's JS functions directly.
- **Schema migrations**: `src/utils/storage.ts` versioning pattern — when the data format changes, migration functions transform old data to the new shape automatically.
- **Async/await with Chrome APIs**: Chrome's storage and messaging APIs are callback-based; this codebase wraps them in Promises so they can be used with `async`/`await`.
