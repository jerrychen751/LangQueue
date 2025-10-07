## LangQueue

A Chrome extension for creating, organizing, and quickly inserting reusable prompts into ChatGPT and Google Gemini. Keep a personal prompt library, search and favorite items, and insert into the active chat with one click or a keyboard shortcut.

### Highlights

- **Prompt library**: Create, edit, favorite, tag, search, and sort (recent, most used, alphabetical).
- **One‑click insert**: Injects the selected prompt into ChatGPT or Gemini; falls back to copying to clipboard if direct insertion is unavailable.
- **Keyboard shortcuts**: Open library (Cmd/Ctrl+Shift+P), Enhance prompt (Cmd/Ctrl+Shift+E), Create prompt (Cmd/Ctrl+Shift+L). Manage shortcuts at `chrome://extensions/shortcuts`.
- **Import/Export**: Backup and restore your prompts as JSON with duplicate handling options.
- **Privacy**: All data is stored locally in Chrome storage. No external servers.

### Supported sites

- ChatGPT (`chat.openai.com`, `chatgpt.com`)
- Google Gemini (`gemini.google.com`)

### Install from source

Prerequisites: Node.js 18+ and npm.

```bash
cd extension
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and enable Developer mode.
2. Click Load unpacked and select `extension/dist`.

### Usage

- Open ChatGPT or Gemini, then open LangQueue from the toolbar or press Cmd/Ctrl+Shift+P.
- Create prompts via New Prompt or Cmd/Ctrl+Shift+L.
- Click Insert on a prompt to place it into the current input. If insertion is not available on the page, the prompt is copied to your clipboard so you can paste.
- Manage prompts with search, favorites, and sorting. Export/Import from Settings.

### Development

```bash
cd extension
npm install
npm run dev   # start Vite in development
npm run lint  # run ESLint
```

Load `extension/dist` as an unpacked extension while developing.

### Tech

- React 18, TypeScript, Vite, `@crxjs/vite-plugin`
- Tailwind CSS, lucide-react
- Chrome Extension Manifest V3, content scripts, Chrome storage APIs
