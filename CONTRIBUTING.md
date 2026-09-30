# Developing LangQueue

Use Node.js 24 and npm. The package engine declaration and CI use Node 24, and the test runner builds for that runtime.

## Install and load the extension

From the repository root:

```bash
npm ci
npm run verify
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repository's `dist` directory. Open a supported ChatGPT, Claude, or Gemini conversation and refresh it if it was already open. Pin LangQueue in Chrome's extension menu to open its library quickly.

After a production rebuild, click **Reload** on the extension card and refresh the chat tabs. Reloading only the extension does not replace content scripts already running in a page.

## Work on the interface

```bash
npm run dev
```

Open the development server's `/popup.html` page to work on the popup with sample Chrome API data, and `/onboarding.html` for the first-run welcome and import page. This browser preview uses a development mock; it does not test real extension storage, tab messaging, or content scripts.

For extension development, keep the Vite server running and load its generated `dist` directory in Chrome. Use the production build and reload steps above for the final check. A production build replaces the development output.

## Verify a change

`npm run verify` runs regression tests, ESLint, the TypeScript check and production build, then validates the emitted manifest and its resource paths. The same command runs in CI on pushes and pull requests. CI installs the committed dependency versions with `npm ci`.

Individual commands are available when narrowing a failure:

- `npm test` runs the Node tests through the project's Vite runner. Temporary bundles and fixture files are removed when the run finishes.
- `npm run lint` applies the configured rules to TypeScript and TSX source files. The Node `.mjs` tests run through `npm test`; they do not currently have an ESLint rule set.
- `npm run build` generates icons, checks TypeScript, and emits the extension into `dist`.
- `npm run validate:build` checks an existing build. It verifies manifest identity, permissions, supported sites, compiled entrypoints, and referenced resource files.

The manifest validator checks packaging; it cannot prove that a site's DOM selectors still work. Use a test conversation for live checks and send only text or attachments you intend to transmit.

## Check the live sites

ChatGPT, Claude, and Gemini change their pages without notice, and the regression tests cannot see those changes. `npm test` includes `tests/site-replay.test.mjs`, which loads scrubbed captures of each site from `tests/fixtures/sites/` into headless Chrome and checks that each adapter still finds the composer, the send button, the generating state, and finished uploads that worked when the page was captured. It needs Google Chrome installed. `npm test -- site-replay` runs only those tests; any argument limits the run to test files whose names contain it.

`npm run check:sites` runs the same checks against the live sites. It uses a separate Chrome profile at `~/.langqueue-site-check` (override with `LANGQUEUE_CHECK_PROFILE`, and the browser with `CHROME_PATH`). Sign in once:

```bash
npm run check:sites -- --login
```

Sign in to all three sites in the window that opens, then quit Chrome. Later runs reuse that session:

- `npm run check:sites` types a prompt on each site, checks that it reads back and that the send button is found, then clears it. It sends nothing.
- `npm run check:sites -- --send` also sends a short prompt, attaches a small text file and a 1×1 PNG, and sends again. It sends from your accounts.
- `--site claude` limits a run to one site. `--send --capture` also rewrites that site's fixtures in `tests/fixtures/sites/`. Captures keep text only around the composer and replace emails, UUIDs, and images from other hosts, but search new captures for your name, email, and conversation titles before committing them.

If a site shows a sign-in page or a Cloudflare "Verify you are human" check, the run says so. Open the profile with `--login --site <site>`, sign in or pass the check, quit Chrome, and run again. Cloudflare sometimes challenges the checked browser, more often after several runs close together.

A failed line names the lookup that broke. The run also prints the directory where it saved a screenshot and the page HTML for each failing site. The `check-sites` Claude Code skill in `.claude/skills/` describes how to repair an adapter from there, and lists the extension checks that still need a person or an agent in the browser.

With the Vite server running, open `/tests/fixtures/composer.html` to check real textarea and contenteditable behavior. The fixture reports `PASS: 14/14` when multiline insertion, Windows line endings, and paragraph append work. Its send controls are local stubs; it never sends to an AI provider.

Queues and chains require an established conversation. Start a conversation with a manual message before running a sequence. Automatic execution stops if the conversation URL changes. Appending into a rich editor preserves visible text and line breaks while converting its existing formatting to plain text.

For execution changes, check ordinary insertion, queueing while a response runs, chain completion, cancellation, and a draft typed while execution waits. Confirm that failures stop later prompts and that recovery controls explain what remains in the composer. For interface changes, inspect the popup and injected UI at desktop size, use the controls with the keyboard, and check the console for errors.

## Diagnose extension failures

Open the extension card's **Errors** view for load failures. Inspect the service worker from the same card for background errors. Use the chat tab's developer console for injected UI and adapter failures. Inspect the popup while it is open for popup errors.

When reporting a bug, include the browser version, supported site, extension version from `manifest.json`, steps to reproduce, expected result, and observed result. Remove private prompts, conversation content, and attachments from logs or screenshots before sharing them.
