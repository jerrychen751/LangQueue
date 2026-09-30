---
name: check-sites
description: Check that LangQueue still works on the live ChatGPT, Claude, and Gemini sites, and repair an adapter when a site changed its page. TRIGGER when the user asks to check the sites, run the live or site check, or smoke-test the extension; reports that insertion, sending, queues, chains, generation detection, or uploads broke on a site; or before a Chrome Web Store release. SKIP for failures that `npm test` reproduces without a live site.
---

# Check the live sites

LangQueue drives three sites through the adapters in `src/content/adapters/`. A site can change its page at any time, so a green `npm test` does not prove the extension still works. Three layers cover this:

- `tests/site-replay.test.mjs` replays scrubbed captures of each site (`tests/fixtures/sites/`) in headless Chrome, inside `npm test` and CI. It catches a code change that breaks an adapter against a page known to work. `npm test -- site-replay` runs only these.
- `npm run check:sites` runs the same probe (`tools/site_probe.ts`) against the live sites in a dedicated Chrome profile at `~/.langqueue-site-check`. It catches site changes.
- This skill covers what neither script reaches: the diagnosis and repair of an adapter, and the extension's own UI.

## 1. Run the live check

Run `npm run check:sites` for the check that sends nothing: it types a two-line prompt on each site, checks the read-back and the send button, and clears it. Add `-- --send` to also send the prompt, attach a text file and a PNG, and send again. `--send` sends from the user's accounts, so ask before each run unless the user asked for it in this request. Pass `-- --site claude` to check one site.

When a line reports a sign-in page or a Cloudflare challenge, run `npm run check:sites -- --login --site <site>` in the background and ask the user to sign in or pass the check in that window. Never click a Cloudflare box yourself. After the user says done, quit that window by sending SIGTERM to the Chrome process whose command line holds `--user-data-dir=<profile>` and the site URL, never to the user's own Chrome. Cloudflare challenges the debugging-port Chrome now and then, more often after several runs close together.

Each failed line names the lookup that broke, such as `chatgpt  send button found: null`. The run saves a screenshot and the page HTML of each failing site and prints the directory. A failed `typed text reads back` means the site's editor changed the inserted text beyond whitespace, which makes `sendPromptWhenReady` refuse to send. A single empty read-back on ChatGPT right after load has happened once while its editor started; rerun before treating it as a site change.

## 2. Repair a broken adapter

1. Read the saved page HTML, or open the site with the scratch pattern below, and find the element the failed lookup expects: the composer, the send or stop button, the attachment tiles, the busy indicators.
2. Change the adapter's selectors. Keep the guards in `page_dom.ts`: one visible candidate, local to the composer, never a stop button.
3. Recapture with `npm run check:sites -- --site <site> --send --capture`, which needs the user's approval because it sends. It rewrites `tests/fixtures/sites/<site>-*.html`.
4. Run `npm run verify`, then `npm run check:sites -- --site <site>` again.

To inspect a live page by script, launch Chrome with `--user-data-dir=~/.langqueue-site-check --remote-debugging-port=0`, read the port from `DevToolsActivePort` in the profile, connect with `chromium.connectOverCDP`, and `page.evaluate` the bundle from `scripts/build-site-probe.mjs`. Kill that Chrome before the turn ends.

A capture marks what a working live step used, and a replay fails when the adapter picks something else:

- `data-lq-expected="input"` and `"send"` mark the composer and the send button.
- `data-lq-added` marks the nodes a live upload added. Replay removes them, calls `attachFiles`, restores them, and waits for completion.
- `<template data-lq-popup>` holds a popup the adapter opened to reach an uploader, such as Gemini's upload menu. Replay shows it when the adapter clicks a popup trigger.

Captures go into a public repository. The probe keeps text only in the composer region, drops navigation landmarks and cross-origin image URLs, and replaces emails and UUIDs. Before committing a new capture, search it for the user's name, email, and conversation titles.

When a capture reproduces a known bug that will ship unfixed, mark that replay `todo` in `tests/site-replay.test.mjs` so it reports without failing the suite, and remove the mark with the fix.

## 3. Check the extension UI

The probe calls the adapters directly and never loads the extension. After a change to the controller, execution, popup, or prompt editor, or before a release, check these in Claude in Chrome with the built `dist` loaded as an unpacked extension, in a throwaway conversation on each site. Ask before each send:

- Insert a saved prompt from the popup, with and without automatic send.
- Type a prompt shortcut in the composer and pick a suggestion.
- Queue a prompt while a response streams. It should send after the response finishes.
- Run a two-step chain, then run it again and cancel after the first step. The composer should keep what was left.
- Insert a prompt with an attachment. The upload should finish before the send.
- Check the tab's console for LangQueue errors.

Report each item as passed or failed, with what the page showed.
