import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { buildSiteProbe } from '../scripts/build-site-probe.mjs';

// Each fixture is a scrubbed page captured after that step worked on the live site
const directory = 'tests/fixtures/sites';
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fixtures = (await readdir(directory)).filter(file => file.endsWith('.html')).sort();
const probe = await buildSiteProbe();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
after(() => browser.close());

async function openFixture(file) {
  const html = await readFile(`${directory}/${file}`, 'utf8');
  const meta = JSON.parse(html.match(/<meta name="langqueue-fixture" content="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // The fixture is served at its original URL so origin and hostname checks behave as on the live site; nothing reaches the network
  await page.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    if (request.resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/png', body: PIXEL });
    }
    return route.abort();
  });
  await page.goto(meta.url);
  await page.evaluate(async pixel => {
    // blob: URLs die with the captured session and captures blank every data: URL, so local previews get a fresh pixel in the same scheme
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(pixel), char => char.charCodeAt(0))], { type: 'image/png' }));
    for (const image of document.querySelectorAll('img[src^="blob:"]')) {
      image.src = url;
    }
    for (const image of document.querySelectorAll('img[src="data:,"]')) {
      image.src = `data:image/png;base64,${pixel}`;
    }
    // Lazy images offscreen never decode, so the wait is capped
    await Promise.race([
      Promise.all(Array.from(document.images, image => image.decode().catch(() => {}))),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }, PIXEL.toString('base64'));
  await page.evaluate(probe);
  return { page, meta };
}

for (const file of fixtures) {
  test(`${file} holds no email address`, async () => {
    const html = await readFile(`${directory}/${file}`, 'utf8');
    assert.deepEqual(html.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi)?.filter(address => address !== 'user@example.com') ?? [], []);
  });
  test(`replay ${file}`, { timeout: 30000 }, async () => {
    const { page, meta } = await openFixture(file);
    try {
      const report = await page.evaluate(() => LangQueueProbe.inspect());
      assert.equal(report.site, meta.site);
      assert.equal(report.inputIsExpected, true, `the adapter chose ${JSON.stringify(report.input)} instead of the composer used on the live site`);
      if (meta.state.startsWith('generating')) {
        assert.equal(report.generating, true);
        assert.equal(report.send, null);
        return;
      }
      assert.equal(report.generating, false);
      if (meta.state === 'typed' || meta.state === 'attached') {
        assert.equal(report.sendIsExpected, true, `the adapter chose ${JSON.stringify(report.send)} instead of the send button clicked on the live site`);
      }
      if (meta.state === 'typed') {
        assert.ok(await page.evaluate(() => LangQueueProbe.hasComposerText('LangQueue site check.\nReply with OK only.')), `the composer reads back ${JSON.stringify(report.inputText)}`);
      }
      if (meta.state === 'attached') {
        const files = meta.files.map(({ name, type }) => ({ name, type, base64: PIXEL.toString('base64') }));
        const upload = await page.evaluate(files => LangQueueProbe.replayUpload(files, 2000), files);
        assert.ok(upload.added > 0, 'the fixture has no nodes marked as added by the upload');
        assert.deepEqual(upload.attached, { ok: true });
        assert.equal(upload.uploaded, true);
      }
    } finally {
      await page.close();
    }
  });
}
