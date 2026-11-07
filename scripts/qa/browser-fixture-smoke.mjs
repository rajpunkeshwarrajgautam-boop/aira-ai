// UI fixture smoke, NOT a live provider, OAuth, or database certification.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = process.env.AIRA_QA_MODULES;
if (!modules) throw new Error('Set AIRA_QA_MODULES to the optional QA package directory.');
const base = new URL(process.env.AIRA_QA_URL ?? 'http://localhost:3000');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Fixture smoke is restricted to an HTTP loopback app.');
const qaRequire = createRequire(path.join(path.resolve(modules), 'package.json'));
const webRequire = createRequire(path.join(root, 'perplexity-clone/my-turborepo/apps/web/package.json'));
const puppeteer = (await import(qaRequire.resolve('puppeteer-core'))).default;
const chromium = (await import(qaRequire.resolve('@sparticuz/chromium'))).default;
const { encode } = await import(webRequire.resolve('next-auth/jwt'));
const token = await encode({ token: { sub: 'aira-isolated-test', name: 'Fixture User', email: 'fixture@example.invalid' }, secret: 'local-development-only-not-for-production', salt: 'authjs.session-token' });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || await chromium.executablePath(), args: chromium.args, headless: true });
const json = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });
try {
  for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage();
    await page.deleteCookie({ name: "authjs.session-token", url: base.href });
    await page.setViewport({ width, height });
    await page.evaluateOnNewDocument(() => sessionStorage.setItem('aira-visited', '1'));
    await page.setRequestInterception(true);
    let failMemoryOnce = true;
    let memories = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth')) return request.continue();
      if (url.pathname === '/api/search') {
        const citations = [{ index: 1, url: 'https://example.org/source', title: 'Fixture source', publishedDate: null, rankingScore: 1 }];
        const events = [['metadata', { citations }], ['text', { delta: 'Fixture answer with evidence [1].' }], ['done', {}]];
        return request.respond({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
      }
      if (url.pathname === '/api/memory') {
        if (request.method() === 'GET' && failMemoryOnce) { failMemoryOnce = false; return request.respond(json({ error: { message: 'Fixture unavailable' } }, 503)); }
        if (request.method() === 'POST') {
          const data = JSON.parse(request.postData());
          memories = [{ id: 'fixture-memory', memoryKey: 'fixture', kind: data.kind, content: data.content, importance: 3, confidence: 1, pinned: true, recallCount: 0, updatedAt: new Date().toISOString() }];
        }
        if (request.method() === 'PATCH') memories = memories.map((item) => ({ ...item, pinned: false }));
        if (request.method() === 'DELETE') memories = [];
        return request.respond(json({ memories, ok: true }));
      }
      if (url.pathname === '/api/agent-platform/user-agents') return request.respond(json({ agents: [] }));
      return request.respond(json({ error: { message: 'Isolated fixture: service unavailable.' } }, 503));
    });
    await page.goto(base.href, { waitUntil: 'networkidle2' });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Skip to workspace');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'aira-workspace-content');
    await page.type('#search-query', 'What is a fixture?');
    await page.click('button[aria-label="Submit query"]');
    await page.waitForFunction(() => document.body.innerText.includes('Fixture answer with evidence'));
    assert.ok(await page.$('a[href="https://example.org/source"]'), 'fixture citation must link to its source');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    await page.setCookie({ name: 'authjs.session-token', value: token, url: base.href });
    await page.goto(new URL('/memory', base).href, { waitUntil: 'networkidle2' });
    assert.equal(new URL(page.url()).pathname, '/memory', 'test app must run with the documented local test secret');
    assert.ok(await page.$('[role="alert"]'), 'failed memory request must be announced');
    assert.equal(await page.evaluate(() => document.body.innerText.includes('Nothing planted yet')), false, 'load error must not appear as empty');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Try again'))?.click());
    await page.waitForFunction(() => document.body.innerText.includes('Nothing planted yet'));
    await page.type('textarea[aria-label="Memory content"]', 'I prefer concise research summaries.');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Remember this'))?.click());
    await page.waitForSelector('button[aria-label="Unpin memory"]');
    await page.click('button[aria-label="Unpin memory"]');
    await page.waitForSelector('button[aria-label="Pin memory"]');
    await page.click('button[aria-label="Delete memory"]');
    await page.waitForFunction(() => document.body.innerText.includes('Nothing planted yet'));
    await page.goto(new URL('/agents', base).href, { waitUntil: 'networkidle2' });
    assert.ok(await page.evaluate(() => document.body.innerText.includes('No agents yet.') && document.body.innerText.includes('Task history could not be loaded.')));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'agents must not overflow');
    console.log(`PASS ${label}: fixture answer/citation, memory retry/create/unpin/delete and agent states`);
    await page.close();
  }
} finally { await browser.close(); }
