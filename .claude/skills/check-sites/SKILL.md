---
name: check-sites
description: Check that LangQueue still works on the live ChatGPT, Claude, and Gemini sites, and repair an adapter when a site changed its page. TRIGGER when the user asks to check the sites, run the live or site check, or smoke-test the extension; reports that insertion, sending, queues, chains, generation detection, or uploads broke on a site; or before a Chrome Web Store release. SKIP for failures that `npm test` reproduces without a live site.
---

# Check the live sites

LangQueue drives three sites through the adapters in `src/content/adapters/`. A site can change its page at any time, so a green `npm test` does not prove the extension still works. Two layers cover this:

- `tests/site-replay.test.mjs` replays scrubbed captures of each site (`tests/fixtures/sites/`) in headless Chrome, inside `npm test` and CI. It catches a code change that breaks an adapter against a page known to work. `npm test -- site-replay` runs only these.
- This skill covers the live sites: the check itself, the diagnosis and repair of an adapter, and the extension's own UI.

## 1. Run the live check

No script drives the live sites, because Cloudflare challenges a Chrome started with a debugging port on ChatGPT and Claude. Run the check in a browser where the user is signed in. Use the Claude desktop app's in-app browser first: no installed copy of LangQueue reacts to `$` and Enter there, so only the code under test does. Use the user's own Chrome through Claude in Chrome when the installed build is what needs checking.

The content script cannot be installed in the in-app browser, so load it as a page script:

1. Bundle an entry that sets `globalThis.__lqChrome` to a stub, then calls `initController` with the adapter whose `matchesAdapterDomain()` is true. The stub needs `runtime.sendMessage` (answer `GET_SETTINGS` with `{ ok: true, result: {} }` and the two searches with `{ ok: true, result: [] }`), `runtime.onMessage.addListener`, and `storage.onChanged.addListener`. Build one minified IIFE with Vite lib mode, `define: { chrome: 'globalThis.__lqChrome' }`, and `publicDir: false`, into the scratchpad.
2. Site CSP blocks a fetch to localhost. Serve the bundle from a local static server, and let a loader page there navigate to `<site>#lq=<byte length>.<base64url of the bundle>`. On the site, decode the hash into `sessionStorage`, navigate to the clean site URL, then run the stored code. ChatGPT's CSP blocks `eval`, so there append a `<script>` whose `nonce` is copied from a script already on the page and whose text is the code. On Claude and Gemini, run `(0, eval)` on it. Evaluating on the hash URL made ChatGPT reload on its first send, and a percent-encoded hash arrived mangled on Claude.
3. Claude and Gemini enforce Trusted Types. Create a `default` policy with pass-through `createHTML`, `createScript`, and `createScriptURL` before the eval.

Check these on each site, with real clicks and keys:

- The adapter finds the composer and, with a draft typed, the send button.
- `setInputText` reads back the same text through `isSameComposerText`.
- `isGenerating()` stays true for a whole response, including while a draft sits in the composer and while the model thinks before it writes. ChatGPT and Claude swap Stop for Send over a draft in that phase.
- Enter during a response puts the draft in the queue, and the queue sends it when the response ends.
- `attachFiles` and `waitForUploadsComplete` accept a small text file and an image. Gemini refuses uploads while its tab is hidden, so the browser pane must be showing.

A state that lasts a few seconds is easy to miss between tool calls. Put an awaited page-side promise that resolves when the state appears, and rejects otherwise, before the key press in one batch.

Test prompts send from the user's accounts. Ask before the first send unless the user has already approved test sends. Use a new throwaway conversation, mark each prompt as a LangQueue test, and list the conversations in the final reply. Afterwards remove the `sessionStorage` item, reload each tab, and stop the server. Never click a Cloudflare box yourself; ask the user to pass the check.

## 2. Repair a broken adapter

1. On the live page, find the element the failed lookup expects: the composer, the send or stop button, the attachment tiles, the busy indicators.
2. Change the adapter's selectors. Keep the guards in `page_dom.ts`: one visible candidate, local to the composer, never a stop button.
3. Run `npm run verify`, then repeat the live check for that site.

A capture marks what a working live step used, and a replay fails when the adapter picks something else:

- `data-lq-expected="input"` and `"send"` mark the composer and the send button.
- `data-lq-added` marks the nodes a live upload added. Replay removes them, calls `attachFiles`, restores them, and waits for completion.
- `<template data-lq-popup>` holds a popup the adapter opened to reach an uploader, such as Gemini's upload menu. Replay shows it when the adapter clicks a popup trigger.

Nothing regenerates the captures. Keep an adapter's older selectors as fallbacks when a repair allows it, so the capture still replays. When a capture can no longer pass, delete it and say so in the report. When a capture reproduces a known bug that will ship unfixed, mark that replay `todo` in `tests/site-replay.test.mjs` so it reports without failing the suite, and remove the mark with the fix.

## 3. Check the extension UI

The page-script check runs the controller without the popup or the background worker. After a change to the popup, the background worker, or attachment storage, or before a release, check these in Claude in Chrome with the built `dist` loaded as an unpacked extension, in a throwaway conversation on each site:

- Insert a saved prompt from the popup, with and without automatic send.
- Type a prompt shortcut in the composer and pick a suggestion.
- Queue a prompt while a response streams. It should send after the response finishes.
- Run a two-step chain, then run it again and cancel after the first step. The composer should keep what was left.
- Insert a prompt with an attachment. The upload should finish before the send.
- Check the tab's console for LangQueue errors.

Report each item as passed or failed, with what the page showed.
