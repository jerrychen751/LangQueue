<img width="1218" height="685" alt="Screenshot 2026-01-21 at 8 24 25 PM" src="https://github.com/user-attachments/assets/5d933464-5492-4398-b26c-6a8f3b8031d4" />
<img width="744" height="591" alt="Screenshot 2026-01-21 at 8 25 39 PM" src="https://github.com/user-attachments/assets/b793b078-9a81-4a56-8804-08d4a9267e08" />

## LangQueue

LangQueue is a personal prompt orchestration Chrome extension for ChatGPT, Claude, and Gemini. It keeps a local prompt library and surfaces fast, in‑page insertion tools so you can drop structured prompts and chains into an active chat without leaving the page.

### Capabilities

- **Slash command overlay**: Type `//` in supported chats to search saved prompts; insert with Tab or click. The overlay anchors above the input to stay out of the way.
- **In‑page editor**: Edit or delete prompts from the overlay in a centered modal without opening the extension popup.
- **Prompt insertion**: Replaces the entire input with the saved prompt for predictable, clean insertion.
- **Queue while generating**: Press Enter during generation to queue the prompt and auto‑send once the model is idle.
- **Prompt chains**: Run multi‑step sequences with optional delays and auto‑send.
- **Page tweaks**: Optional behavior changes like preventing auto‑scroll on submit.
- **Privacy**: All data stays in local Chrome storage; no external services.

### Supported sites

- ChatGPT (`chat.openai.com`, `chatgpt.com`)
- Claude (`claude.ai`)
- Google Gemini (`gemini.google.com`)

### Tech stack

- TypeScript, React 18, Vite, `@crxjs/vite-plugin`
- Tailwind CSS for popup UI; Shadow DOM for in‑page overlay and editor isolation
- Chrome Extension Manifest V3, content scripts, service worker background, Chrome storage APIs

### Architecture

LangQueue is content‑script‑first. The in‑page controller handles slash detection, overlay UI, in‑page editing, prompt insertion, queueing, chain execution, and page tweaks. The background service worker stays thin and only coordinates storage and messaging. The popup is a lightweight library surface rather than the primary interaction model.

- Content core: `src/content/core` (slash detection, overlay, editor, insertion, queue, chains, tweaks).
- Site adapters: `src/content/adapters` (ChatGPT, Claude, Gemini DOM heuristics and send/generate detection).
- Background: `src/background/index.ts` (settings, prompt search, usage logging, updates/deletes).
- Popup UI: `src/popup` (library view and minimal settings).
