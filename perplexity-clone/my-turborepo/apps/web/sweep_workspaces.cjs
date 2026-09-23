const puppeteer = require('C:/Users/WORKSTATION/.gemini/antigravity-ide/brain/8ffeb75b-177e-4514-9d49-86d0ab6484ec/scratch/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { encode } = require('next-auth/jwt');

const SCRATCH_DIR = 'C:/Users/WORKSTATION/.gemini/antigravity-ide/brain/8ffeb75b-177e-4514-9d49-86d0ab6484ec/scratch';
const env = dotenv.parse(fs.readFileSync('.env.local'));

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'projects', path: '/projects' },
  { name: 'memory', path: '/memory' },
  { name: 'knowledge', path: '/knowledge' },
  { name: 'settings', path: '/settings' },
  { name: 'compare', path: '/compare' },
  { name: 'workflows', path: '/workflows' },
  { name: 'agents', path: '/agents' },
  { name: 'work', path: '/work' },
  { name: 'browser', path: '/browser' },
  { name: 'omniroute', path: '/omniroute' },
  { name: 'control_center', path: '/control-center' },
  { name: 'governance', path: '/governance' },
  { name: 'workspace_search', path: '/workspace-search' },
  { name: 'runs', path: '/runs' },
  { name: 'artifacts', path: '/artifacts' },
  { name: 'swarms', path: '/swarms' }
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 }
];

async function runSweep() {
  const secret = env.AUTH_SECRET;
  const token = {
    name: 'QA Engineer',
    email: 'qa@aira-ai.in',
    sub: 'user_qa_123',
    id: 'user_qa_123'
  };
  const jwt = await encode({ token, secret, salt: 'authjs.session-token' });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 }
  });

  const page = await browser.newPage();
  await page.setCookie({
    name: 'authjs.session-token',
    value: jwt,
    domain: 'localhost',
    path: '/'
  });

  const auditResults = [];

  // Desktop sweep across all 17 routes
  console.log('--- Commencing Desktop 1440x900 Sweep across all 17 routes ---');
  await page.setViewport({ width: 1440, height: 900 });

  for (const route of ROUTES) {
    console.log(`[Desktop] Checking ${route.name} (${route.path})...`);
    try {
      await page.goto(`http://localhost:3125${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => {
        const p = document.querySelector('.aira-preloader');
        return !p || p.getAttribute('data-hidden') === 'true' || window.getComputedStyle(p).display === 'none';
      }, { timeout: 4000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));

      const styles = await page.evaluate(() => {
        const body = document.body;
        const main = document.querySelector('.aira-v2-main') || document.querySelector('main');
        const stage = document.querySelector('.aira-v2-workspace-stage') || document.querySelector('.aira-v2-page');
        const cards = Array.from(document.querySelectorAll('.aira-card, .aira-surface, [class*="card"], [class*="panel"], form, section > div, main > div'));
        
        return {
          currentUrl: window.location.href,
          pageTitle: document.title,
          bodyBg: window.getComputedStyle(body).backgroundColor,
          mainBg: main ? window.getComputedStyle(main).backgroundColor : 'n/a',
          stageBg: stage ? window.getComputedStyle(stage).backgroundColor : 'n/a',
          firstCardBg: cards[0] ? window.getComputedStyle(cards[0]).backgroundColor : 'none',
          firstCardColor: cards[0] ? window.getComputedStyle(cards[0]).color : 'none'
        };
      });

      const screenshotFile = path.join(SCRATCH_DIR, `auth_audit_desktop_${route.name}.png`);
      await page.screenshot({ path: screenshotFile });
      auditResults.push({ viewport: 'desktop', ...route, ...styles, screenshot: screenshotFile });
      console.log(`[Desktop] Captured ${route.name}: stageBg=${styles.stageBg}, cardBg=${styles.firstCardBg}`);
    } catch (err) {
      console.error(`[Desktop] Error on ${route.name}:`, err.message);
      auditResults.push({ viewport: 'desktop', ...route, error: err.message });
    }
  }

  // Responsive sweeps (Tablet & Mobile) on key workspace routes
  const RESPONSIVE_ROUTES = ROUTES.filter(r => ['home', 'projects', 'memory', 'work', 'settings', 'omniroute'].includes(r.name));

  for (const vp of [VIEWPORTS[1], VIEWPORTS[2]]) {
    console.log(`--- Commencing ${vp.name} (${vp.width}x${vp.height}) Sweep ---`);
    await page.setViewport({ width: vp.width, height: vp.height });

    for (const route of RESPONSIVE_ROUTES) {
      console.log(`[${vp.name}] Checking ${route.name} (${route.path})...`);
      try {
        await page.goto(`http://localhost:3125${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForFunction(() => {
          const p = document.querySelector('.aira-preloader');
          return !p || p.getAttribute('data-hidden') === 'true' || window.getComputedStyle(p).display === 'none';
        }, { timeout: 4000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));

        const screenshotFile = path.join(SCRATCH_DIR, `auth_audit_${vp.name}_${route.name}.png`);
        await page.screenshot({ path: screenshotFile });
        auditResults.push({ viewport: vp.name, ...route, screenshot: screenshotFile });
        console.log(`[${vp.name}] Captured ${route.name}`);
      } catch (err) {
        console.error(`[${vp.name}] Error on ${route.name}:`, err.message);
        auditResults.push({ viewport: vp.name, ...route, error: err.message });
      }
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(SCRATCH_DIR, 'auth_audit_results.json'), JSON.stringify(auditResults, null, 2));
  console.log('Real authenticated multi-viewport sweep complete! Results written to auth_audit_results.json');
}

runSweep().catch(console.error);
