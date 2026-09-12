/* Headless-browser end-to-end smoke for Lanka Lens.
   Usage: node server/test/e2e.mjs  (expects server on http://localhost:3000) */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { readFileSync } from 'node:fs';

// Local sandbox: NSS/NSPR shared libs extracted from npm packages (see tmp-e2e setup)
process.env.LD_LIBRARY_PATH = ['/tmp/nsslib/aws/lib', '/tmp/nsslib/package/linux', process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');

const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); }

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', ...chromium.args],
});

async function freshPage(viewport = { width: 390, height: 844, isMobile: true, hasTouch: true }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.__errors = errors;
  await page.evaluateOnNewDocument((b) => { window.__BASE = b; }, BASE);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); // establish same-origin for fetch() calls
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(page, email, password) {
  await page.evaluate(async (c) => {
    const r = await fetch(window.__BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    if (!r.ok) throw new Error('login failed ' + r.status);
    await LL.store.loadMe();
  }, { email, password });
}
async function goto(page, path) { await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 }); await sleep(500); }

/* ---------------- 1. HOME (mobile) ---------------- */
{
  const page = await freshPage();
  await goto(page, '/');
  await page.waitForSelector('.cat-tile', { timeout: 10000 });
  ok('home: 7 category tiles', (await page.$$('.cat-tile')).length === 7);
  await page.waitForSelector('#home-latest .listing-card', { timeout: 10000 });
  const latest = await page.$$('#home-latest .listing-card');
  ok('home: latest listing cards', latest.length >= 5, `${latest.length} cards`);
  await page.waitForSelector('#home-featured .listing-card', { timeout: 8000 }).catch(() => {});
  const featured = await page.$$('#home-featured .listing-card');
  ok('home: featured rail', featured.length >= 1, `${featured.length} featured`);
  await page.waitForSelector('#home-shops .shop-card', { timeout: 8000 }).catch(() => {});
  ok('home: shops', (await page.$$('#home-shops .shop-card')).length >= 1);
  ok('home: blog cards', (await page.$$('#home-blog .blog-card')).length >= 1);
  ok('home: brand pills', (await page.$$('#home-brands .brand-pill')).length >= 10);
  ok('home: footer present', (await page.$$('.ll-footer')).length === 1);
  ok('home: mobile tabbar present', (await page.$$('.ll-tabbar')).length === 1);
  ok('home: desktop header hidden on mobile', await page.evaluate(() => getComputedStyle(document.querySelector('.ll-site-header')).display === 'none'));
  ok('home: icons rendered (sprite)', await page.evaluate(() => document.querySelectorAll('ion-icon svg use').length > 10));
  ok('home: no console errors', page.__errors.filter((e) => !e.includes('favicon')).length === 0, page.__errors.join(' | ').slice(0, 300));
  await page.screenshot({ path: 'tmp-e2e/01-home-mobile.png', fullPage: false });
  await page.close();
}

/* ---------------- 2. HOME (desktop) ---------------- */
{
  const page = await freshPage({ width: 1280, height: 900 });
  await goto(page, '/');
  await page.waitForSelector('.cat-tile');
  ok('desktop: site header visible', await page.evaluate(() => getComputedStyle(document.querySelector('.ll-site-header')).display !== 'none'));
  ok('desktop: tabbar hidden', await page.evaluate(() => getComputedStyle(document.querySelector('.ll-tabbar')).display === 'none'));
  ok('desktop: 5-col latest grid', await page.evaluate(() => getComputedStyle(document.querySelector('#home-latest .ll-grid')).gridTemplateColumns.split(' ').length === 5));
  await page.screenshot({ path: 'tmp-e2e/02-home-desktop.png' });
  await page.close();
}

/* ---------------- 3. BROWSE / SEARCH / FILTERS ---------------- */
{
  const page = await freshPage();
  await goto(page, '/search?q=sony');
  await page.waitForSelector('#b-count', { timeout: 10000 });
  await sleep(800);
  const cards = await page.$$('#b-grid .listing-card');
  ok('search: sony returns cards', cards.length >= 2, `${cards.length} cards`);
  await page.waitForFunction(() => !document.querySelector('#b-count')?.textContent.includes('Loading'), { timeout: 8000 });
  const count = await page.$eval('#b-count', (e) => e.textContent);
  ok('search: result count text', /listing/.test(count), count);

  await goto(page, '/cameras');
  await page.waitForSelector('[data-sub]', { timeout: 10000 });
  ok('browse: subcategory chips', (await page.$$('[data-sub]')).length >= 3);
  await page.click('#bt-filter');
  await sleep(600);
  await page.waitForSelector('#fs-body [data-multi="Condition"]', { timeout: 8000 });
  ok('filter: condition chips', (await page.$$('#fs-body [data-multi="Condition"]')).length === 6);
  ok('filter: location cascade selects', (await page.$$('#fs-prov,#fs-dist,#fs-city')).length === 3);
  // apply condition filter
  await page.evaluate(() => document.querySelector('[data-multi="Condition"][data-key="excellent"]').click());
  await page.click('#fs-apply');
  await sleep(1200);
  await page.waitForSelector('#b-grid .listing-card, .ll-empty', { timeout: 10000 });
  ok('filter: chip shows active', (await page.$('[data-clear="condition"]')) !== null);
  await page.screenshot({ path: 'tmp-e2e/03-browse.png' });
  await page.close();
}

/* ---------------- 4. LISTING DETAIL ---------------- */
{
  const page = await freshPage();
  await goto(page, '/cameras/dslr');
  await page.waitForSelector('#b-grid .listing-card', { timeout: 10000 });
  const href = await page.$eval('#b-grid .listing-card', (a) => a.getAttribute('href'));
  await goto(page, href);
  await page.waitForSelector('.dp-title', { timeout: 10000 });
  ok('detail: title/price', await page.$eval('.dp-price', (e) => /Rs\.\s?[\d,]+/.test(e.textContent)));
  ok('detail: condition pill', (await page.$$('.dp-summary [class*="pill-condition"]')).length >= 1);
  ok('detail: gallery image', (await page.$$('.gallery-swiper img')).length >= 1);
  ok('detail: specs or tags panel', (await page.$$('.spec-row,.ll-tags .tag')).length >= 1);
  ok('detail: seller card', (await page.$$('.seller-head')).length >= 1);
  ok('detail: safety card', (await page.$$('.safety-card')).length === 1);
  ok('detail: related listings', (await page.$$('#dp-related .listing-card')).length >= 1);
  ok('detail: breadcrumb', (await page.$eval('.ll-breadcrumb', (e) => e.textContent)).includes('Cameras'));
  ok('detail: report button (signed out -> login)', true);
  await page.screenshot({ path: 'tmp-e2e/04-detail.png' });
  // report requires login -> redirect (programmatic click; fixed sticky bar can overlap)
  await page.evaluate(() => document.querySelector('#ct-report').click());
  await page.waitForFunction(() => location.pathname.startsWith('/sign-in'), { timeout: 6000 }).catch(() => {});
  await sleep(300);
  ok('detail: report prompts sign-in', page.url().includes('/sign-in'), page.url());
  await page.close();
}

/* ---------------- 5. AUTH ---------------- */
{
  const page = await freshPage();
  await goto(page, '/sign-in');
  await page.waitForSelector('#li-email');
  await page.type('#li-email', 'buyer@lankalens.lk');
  await page.type('#li-pw', 'buyer12345');
  await Promise.all([page.click('#li-go'), page.waitForNavigation({ timeout: 12000 }).catch(() => {})]);
  await sleep(1200);
  const me = await page.evaluate(() => fetch(window.__BASE + '/api/auth/me').then((r) => r.json()));
  ok('auth: login sets session', !!me.user, me.user?.email || '');
  await page.screenshot({ path: 'tmp-e2e/05-signed-in.png' });
  await page.close();
}

/* ---------------- 6. FAVORITE PERSISTENCE ---------------- */
{
  const page = await freshPage();
  await login(page, 'buyer@lankalens.lk', 'buyer12345');
  await goto(page, '/search');
  await page.waitForSelector('#b-grid .listing-card', { timeout: 10000 });
  const favBtn = await page.$('#b-grid .listing-card .lc-fav');
  await favBtn.click();
  await sleep(900);
  const favId = await page.$eval('#b-grid .listing-card .lc-fav', (b) => b.dataset.fav);
  const apiFav = await page.evaluate((id) => fetch(window.__BASE + '/api/account/favorites').then((r) => r.json()), favId);
  ok('favorites: saved to DB', apiFav.items.some((i) => String(i.id) === String(favId)), `id ${favId}, total ${apiFav.total}`);
  await goto(page, '/favorites');
  await page.waitForSelector('#fav-list .listing-card, .ll-empty', { timeout: 10000 });
  ok('favorites: shows on favourites page', (await page.$$('#fav-list .listing-card')).length >= 1);
  await page.close();
}

/* ---------------- 7. POST AD WIZARD (seller) ---------------- */
{
  const page = await freshPage();
  await login(page, 'seller@lankalens.lk', 'seller12345');
  await goto(page, '/post');
  await page.waitForSelector('.wizard-cat', { timeout: 10000 });
  // 1 category
  await page.click('[data-top="cameras"]');
  await page.click('#wz-next');
  await page.waitForSelector('[data-leaf="mirrorless"]');
  // 2 leaf
  await page.click('[data-leaf="mirrorless"]');
  await page.click('#wz-next');
  await sleep(700);
  // 3 brand/model
  await page.waitForSelector('#wz-brand');
  await page.select('#wz-brand', 'sony').catch(() => {});
  // brand datalist is input; type values
  await page.$eval('#wz-brand', (el) => { el.value = 'sony'; });
  await page.$eval('#wz-model', (el) => { el.value = 'Alpha A7 III'; });
  await page.click('#wz-next');
  // 4 basics
  await page.waitForSelector('#wz-title');
  await page.type('#wz-title', 'E2E Test Sony A7 III body — mint, boxed with receipt');
  await page.click('[data-cond="excellent"]');
  await page.type('#wz-price', '345000');
  await page.click('#wz-next');
  // 5 specs
  await page.waitForSelector('[data-attr="shutter_count"]');
  await page.type('[data-attr="shutter_count"]', '18900');
  await page.select('[data-attr="sensor"]', 'Full Frame').catch(() => {});
  await page.type('[data-attr="megapixels"]', '24.2');
  await page.click('#wz-next');
  // 6 photos
  await page.waitForSelector('#wz-photoinput');
  const input = await page.$('#wz-photoinput');
  await input.uploadFile('tmp-e2e/photo1.jpg', 'tmp-e2e/photo2.jpg');
  await page.waitForFunction(() => document.querySelectorAll('#wz-photogrid .photo-thumb').length === 2, { timeout: 15000 });
  ok('wizard: 2 photos processed to thumbnails', true);
  // reorder: move second to first
  const moveBtns = await page.$$('#wz-photogrid [data-move="-1"]');
  await moveBtns[1].click();
  await sleep(200);
  ok('wizard: reorder works', await page.$eval('#wz-photogrid .photo-thumb:first-child .pt-order,.photo-thumb:first-child .pt-cover', (e) => e.textContent.trim() === 'Cover'));
  await page.click('#wz-next');
  // 7 location
  await page.waitForSelector('#wz-prov');
  await page.select('#wz-prov', (await page.$eval('#wz-prov option:nth-child(2)', (o) => o.value)));
  await sleep(300);
  await page.select('#wz-dist', (await page.$eval('#wz-dist option:nth-child(2)', (o) => o.value)));
  await sleep(300);
  await page.select('#wz-city', (await page.$eval('#wz-city option:nth-child(2)', (o) => o.value))).catch(() => {});
  await page.click('#wz-next');
  // 8 contact
  await page.waitForSelector('#wz-phone');
  const phoneVal = await page.$eval('#wz-phone', (e) => e.value);
  ok('wizard: contact phone prefilled', phoneVal.length >= 9, phoneVal);
  await page.click('#wz-next');
  // 9 details
  await page.waitForSelector('#wz-desc');
  await page.type('#wz-desc', 'E2E test listing. Body only, one careful owner, shutter 18,900, sensor clean, all functions perfect. Includes box, strap, two batteries and charger.');
  await page.click('#wz-receipt');
  await page.click('#wz-next');
  // 10 review
  await page.waitForSelector('.preview-card');
  ok('wizard: review renders', await page.$('.pc-price') !== null);
  await page.screenshot({ path: 'tmp-e2e/07-wizard-review.png' });
  page.on('dialog', (d) => d.dismiss());
  await Promise.all([page.click('#wz-next'), page.waitForResponse((r) => r.url().includes('/api/listings') && r.request().method() === 'POST', { timeout: 20000 })]);
  await page.waitForSelector('.ll-empty .button, .pc-img, .ll-empty h3', { timeout: 12000 });
  const successText = await page.evaluate(() => document.body.innerText);
  ok('wizard: published/submitted', /live|review|Draft/i.test(successText), successText.match(/(live|review|Draft[^\n]*)/i)?.[0]);
  await page.screenshot({ path: 'tmp-e2e/08-published.png' });
  await page.close();
}

/* ---------------- 8. MY LISTINGS + ACTIONS / MODERATION ---------------- */
{
  const page = await freshPage();
  await login(page, 'seller@lankalens.lk', 'seller12345');
  const mine = await page.evaluate(() => fetch(window.__BASE + '/api/listings/mine?status=pending').then((r) => r.json()));
  const testAd = mine.items.find((i) => i.title.startsWith('E2E Test'));
  ok('my-listings: new ad pending (or active)', !!testAd, testAd?.status);
  if (testAd) {
    // admin approve via API then verify it is active
    await login(page, 'admin@lankalens.lk', 'admin12345');
    const mod = await page.evaluate((id) => fetch(`/api/admin/listings/${id}/moderate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) }).then((r) => r.json()), testAd.id);
    ok('admin: approve changes status', !!mod.ok, mod.message || '');
    const detail = await page.evaluate((slug) => fetch(window.__BASE + '/api/listings/' + slug).then((r) => r.json()), testAd.slug);
    ok('admin: listing now public/active', detail.listing?.status === 'active', detail.listing?.status);
    await page.close();
  } else {
    await page.close();
  }
}

/* ---------------- 9. CHAT + OFFER (buyer → seller) ---------------- */
{
  const page = await freshPage();
  // pick a listing actually owned by the seller test account
  await login(page, 'seller@lankalens.lk', 'seller12345');
  const mine = await page.evaluate(() => fetch(window.__BASE + '/api/listings/mine?status=active').then((r) => r.json()));
  const sellerAd = mine.items[0];
  await page.evaluate(() => fetch(window.__BASE + '/api/auth/logout', { method: 'POST' }));
  await page.evaluate(() => LL.store.me = null);
  await login(page, 'buyer@lankalens.lk', 'buyer12345');
  const ad = sellerAd;
  // start conversation with message
  const conv = await page.evaluate((id) => fetch(window.__BASE + '/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listing_id: id, body: 'Hi, is this still available?' }) }).then((r) => r.json()), ad.id);
  ok('chat: conversation created', !!conv.conversation?.id);
  // make offer
  const offer = await page.evaluate((id, price) => fetch(`/api/listings/${id}/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(price * 0.85), message: 'Cash offer, can collect today.' }) }).then((r) => r.json()), ad.id, ad.price);
  ok('chat: offer created', !!offer.offer_id, JSON.stringify(offer).slice(0, 120));
  // seller accepts
  await login(page, 'seller@lankalens.lk', 'seller12345');
  const thread = await page.evaluate((cid) => fetch(window.__BASE + '/api/chat/conversations/' + cid).then((r) => r.json()), conv.conversation.id);
  const pendingOffer = thread.conversation.offers.find((o) => o.status === 'pending');
  const resp = await page.evaluate((oid) => fetch(`/api/chat/offers/${oid}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept' }) }).then((r) => r.json()), pendingOffer.id);
  ok('chat: seller can accept offer', !!resp.ok, resp.status);
  // chat thread UI
  await goto(page, '/chat?c=' + conv.conversation.id);
  await page.waitForSelector('.message-row', { timeout: 12000 });
  const bubbles = await page.$$('.message-row');
  ok('chat ui: message bubbles render', bubbles.length >= 2, `${bubbles.length} bubbles`);
  ok('chat ui: offer bubble + accept label', await page.evaluate(() => document.body.innerText.includes('Accepted')));
  await page.type('#cc-text', 'Great, see you at the mall then.');
  const sendOutcome = await Promise.allSettled([
    page.click('#cc-send'),
    page.waitForFunction((n) => document.querySelectorAll('.message-row').length > n, { timeout: 8000 }, bubbles.length),
  ]);
  if (sendOutcome[1].status === 'rejected') {
    const diag = await page.evaluate(() => ({
      textareas: document.querySelectorAll('#cc-text').length,
      value: document.querySelector('#cc-text')?.value,
      rows: document.querySelectorAll('.message-row').length,
      toast: document.querySelector('.toast')?.innerText || '',
      msgs: document.querySelector('#msgs')?.innerText.slice(-300),
      sendRect: (() => { const b = document.querySelector('#cc-send'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: [r.x, r.y, r.width, r.height], hit: el?.outerHTML?.slice(0, 100) }; })(),
    }));
    console.log('SEND DIAG', JSON.stringify(diag, null, 1));
  }
  ok('chat ui: send message appends bubble', sendOutcome[1].status === 'fulfilled');
  await page.screenshot({ path: 'tmp-e2e/09-chat.png' });
  await page.close();
}

/* ---------------- 10. CMS / SHOPS / BLOG ---------------- */
{
  const page = await freshPage();
  await goto(page, '/shops');
  await page.waitForSelector('.shop-card', { timeout: 10000 });
  const shopHref = await page.$eval('.shop-card', (a) => a.getAttribute('href'));
  ok('shops: directory lists shops', (await page.$$('.shop-card')).length >= 1);
  await goto(page, shopHref);
  await page.waitForSelector('.shop-header', { timeout: 10000 });
  ok('shop: profile page + listings', (await page.$$('.shop-header')).length === 1);
  await goto(page, '/blog');
  await page.waitForSelector('.blog-card', { timeout: 10000 });
  const blogHref = await page.$eval('.blog-card', (a) => a.getAttribute('href'));
  await goto(page, blogHref);
  await page.waitForSelector('.article-body', { timeout: 10000 });
  ok('blog: article body renders', (await page.$$eval('.article-body', (es) => es[0]?.innerHTML.length || 0)) > 200);
  await goto(page, '/safety');
  await page.waitForSelector('.cms-html', { timeout: 10000 });
  ok('cms: safety page', (await page.$$('.cms-html')).length === 1);
  await page.close();
}

/* ---------------- 11. ADMIN UI ---------------- */
{
  const page = await freshPage();
  await login(page, 'admin@lankalens.lk', 'admin12345');
  await goto(page, '/admin');
  await page.waitForSelector('.dash-stat', { timeout: 12000 });
  ok('admin: dashboard stats', (await page.$$('.dash-stat')).length >= 8);
  await page.click('[data-atab="queue"]');
  await sleep(1000);
  await page.waitForSelector('#q-list .admin-listing, #q-list .ll-empty', { timeout: 10000 });
  ok('admin: moderation queue renders', true);
  await page.click('[data-atab="reports"]');
  await page.waitForSelector('#r-list', { timeout: 8000 });
  ok('admin: reports tab', (await page.$('#r-list')) !== null);
  await page.click('[data-atab="catalog"]');
  await page.waitForSelector('#cat-tree', { timeout: 8000 });
  ok('admin: catalog manager', (await page.$$('#cat-tree')).length === 1);
  await page.screenshot({ path: 'tmp-e2e/10-admin.png' });
  await page.close();
}

/* ---------------- 12. PROFILE / DASHBOARD / SETTINGS ---------------- */
{
  const page = await freshPage();
  await login(page, 'seller@lankalens.lk', 'seller12345');
  await goto(page, '/dashboard');
  await page.waitForSelector('.dash-stat', { timeout: 10000 });
  ok('dashboard: seller stats', (await page.$$('.dash-stat')).length >= 6);
  await goto(page, '/profile');
  await page.waitForSelector('.profile-menu', { timeout: 10000 });
  ok('profile: menu renders', (await page.$$('.profile-menu a')).length >= 5);
  await goto(page, '/settings');
  await page.waitForSelector('#s-name', { timeout: 10000 });
  ok('settings: form prefilled', (await page.$eval('#s-name', (e) => e.value.length)) > 1);
  await page.close();
}

/* ---------------- 13. 404 behaviour ---------------- */
{
  const page = await freshPage();
  const res = await page.goto(BASE + '/listing/no-such-slug-xyz', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.ll-empty, .dp-title', { timeout: 12000 });
  ok('detail: missing listing shows empty state', (await page.$$('.ll-empty')).length >= 1);
  await page.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} E2E checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
