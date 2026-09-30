import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { buildSiteProbe } from './build-site-probe.mjs';

const SITES = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
};
// A 1x1 PNG and a short text file, small enough to upload on every run
const ATTACHMENTS = [
  { name: 'langqueue-check.txt', type: 'text/plain', base64: Buffer.from('LangQueue attachment check.\n').toString('base64') },
  { name: 'langqueue-check.png', type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
];

const { values } = parseArgs({
  options: {
    login: { type: 'boolean', default: false },
    send: { type: 'boolean', default: false },
    capture: { type: 'boolean', default: false },
    site: { type: 'string', multiple: true },
  },
});
const profile = process.env.LANGQUEUE_CHECK_PROFILE || join(homedir(), '.langqueue-site-check');
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const selected = values.site?.length ? values.site : Object.keys(SITES);
if (values.capture && !values.send) {
  throw new Error('--capture needs --send, because fixtures are captured inside the conversation that the check creates.');
}
for (const site of selected) {
  if (!SITES[site]) {
    throw new Error(`Unknown site "${site}". Use ${Object.keys(SITES).join(', ')}.`);
  }
}

if (values.login) {
  // Sign-in runs in a plain Chrome window without a debugging port, because Google refuses sign-in from automated browsers
  console.log(`Sign in to each site in the Chrome window, then quit Chrome (Cmd+Q) to save the profile at ${profile}.`);
  const chrome = spawn(chromePath, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...selected.map(site => SITES[site])], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { chrome.on('exit', resolve); chrome.on('error', reject); });
  process.exit(0);
}

const probe = await buildSiteProbe();
const failures = await mkdtemp(join(tmpdir(), 'langqueue-site-check-'));
const results = [];

function record(site, step, ok, detail = '') {
  results.push({ site, step, ok });
  console.log(`${ok ? '✔' : '✘'} ${site.padEnd(8)}${step}${detail ? `: ${detail}` : ''}`);
  return ok;
}

async function waitFor(read, isDone, timeoutMs) {
  const started = Date.now();
  let value = await read().catch(() => null);
  while (!isDone(value) && Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
    value = await read().catch(() => null);
  }
  return value;
}

async function captureFixture(page, site, state) {
  if (!values.capture) {
    return;
  }
  await mkdir('tests/fixtures/sites', { recursive: true });
  const html = await page.evaluate(meta => LangQueueProbe.captureSnapshot(meta), { site, state, files: ATTACHMENTS.map(({ name, type }) => ({ name, type })) });
  await writeFile(`tests/fixtures/sites/${site}-${state}.html`, html);
  console.log(`  captured tests/fixtures/sites/${site}-${state}.html`);
}

async function sendAndAwaitResponse(page, site, label) {
  if (!record(site, `${label}: send clicked`, await page.evaluate(() => LangQueueProbe.clickSend()))) {
    return false;
  }
  const generating = await waitFor(() => page.evaluate(() => LangQueueProbe.inspect()), report => report?.generating, 20000);
  if (!record(site, `${label}: generation detected`, Boolean(generating?.generating))) {
    return false;
  }
  // A new chat can replace its composer when it becomes a conversation
  await page.evaluate(() => LangQueueProbe.markExpected());
  await captureFixture(page, site, label === 'text' ? 'generating' : 'generating-attachments');
  return record(site, `${label}: response finished`, await page.evaluate(() => LangQueueProbe.waitForIdle(180000)));
}

async function checkSite(context, site) {
  const probeText = 'LangQueue site check.\nReply with OK only.';
  const page = await context.newPage();
  try {
    await page.goto(SITES[site], { waitUntil: 'load' });
    // Some sites reload right after the first load, which drops the probe, so each read injects it again when it is missing
    const inspect = async () => {
      if (!await page.evaluate(() => 'LangQueueProbe' in globalThis)) {
        await page.evaluate(probe);
      }
      return page.evaluate(() => LangQueueProbe.inspect());
    };
    await waitFor(inspect, report => report?.input && !report.generating, 30000);
    // Gemini shows a plain textarea until its editor loads, so the input is read again after the page settles
    await page.waitForTimeout(2000);
    const idle = await inspect().catch(() => null);
    if (!idle?.input) {
      const challenged = /just a moment|verify you are human/i.test(await page.title()) || /challenge-platform|cf-turnstile/.test(await page.content());
      record(site, 'chat input found', false, challenged
        ? `Cloudflare is asking for human verification. Run npm run check:sites -- --login --site ${site}, pass the check in that window, quit Chrome, and rerun`
        : `none at ${page.url()}; if this is a sign-in page, run npm run check:sites -- --login --site ${site}`);
      return;
    }
    record(site, 'chat input found', true, JSON.stringify(idle.input));
    record(site, 'idle page is not generating', !idle.generating);
    await page.evaluate(text => LangQueueProbe.typeText(text), probeText);
    // Editors may rewrite inserted text a moment later, so the read-back waits before it compares
    await page.waitForTimeout(1000);
    const typed = await inspect();
    record(site, 'typed text reads back', await page.evaluate(text => LangQueueProbe.hasComposerText(text), probeText), JSON.stringify(typed.inputText));
    if (!record(site, 'send button found', Boolean(typed.send), JSON.stringify(typed.send))) {
      return;
    }
    if (!values.send) {
      await page.evaluate(() => LangQueueProbe.typeText(''));
      return;
    }
    if (!await sendAndAwaitResponse(page, site, 'text')) {
      return;
    }

    // Idle and typed captures come from the conversation, not the new-chat page, whose greeting can name the user
    await page.evaluate(() => LangQueueProbe.markExpected());
    await captureFixture(page, site, 'idle');
    await page.evaluate(text => LangQueueProbe.typeText(text), probeText);
    await page.waitForTimeout(1000);
    await page.evaluate(() => LangQueueProbe.markExpected());
    await captureFixture(page, site, 'typed');
    await page.evaluate(() => LangQueueProbe.typeText(''));

    await page.evaluate(() => LangQueueProbe.markBaseline());
    const attached = await page.evaluate(files => LangQueueProbe.attachFiles(files), ATTACHMENTS);
    if (!record(site, 'uploader accepted files', attached.ok, attached.error)) {
      return;
    }
    if (!record(site, 'upload completion detected', await page.evaluate(() => LangQueueProbe.waitForUploads(90000)))) {
      return;
    }
    await page.evaluate(text => LangQueueProbe.typeText(text), 'LangQueue attachment check. Reply with OK only.');
    await page.evaluate(() => LangQueueProbe.markExpected());
    await captureFixture(page, site, 'attached');
    await sendAndAwaitResponse(page, site, 'attachments');
  } catch (error) {
    record(site, 'check crashed', false, error instanceof Error ? error.message : String(error));
  } finally {
    if (results.some(result => result.site === site && !result.ok)) {
      const path = join(failures, `${site}.png`);
      await page.screenshot({ path }).catch(() => {});
      await writeFile(join(failures, `${site}.html`), await page.content().catch(() => '')).catch(() => {});
      console.log(`  failure screenshot and page HTML in ${failures}`);
    }
    await page.close().catch(() => {});
  }
}

// Chrome runs as a normal process with a debugging port, so sign-ins from --login carry over and pages lack the automation flags of a Playwright launch; Cloudflare can still notice the debugger now and then
await rm(join(profile, 'DevToolsActivePort'), { force: true });
const chrome = spawn(chromePath, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
try {
  const port = await waitFor(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''), Boolean, 15000);
  if (!port) {
    throw new Error(`Chrome did not open a debugging port. Quit any Chrome window using ${profile} and retry.`);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port.split('\n')[0]}`);
  for (const site of selected) {
    await checkSite(browser.contexts()[0], site);
  }
  await browser.close();
} finally {
  chrome.kill();
}
const failed = results.filter(result => !result.ok);
console.log(failed.length ? `\n${failed.length} check(s) failed.` : `\nAll ${results.length} checks passed.`);
if (!failed.length) {
  await rm(failures, { recursive: true, force: true });
}
process.exitCode = failed.length ? 1 : 0;
