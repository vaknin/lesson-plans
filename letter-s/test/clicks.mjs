// Click test: a teacher clicks a button (top bar, agenda, on-screen controls), then keeps using the keyboard.
// Fails when a key repeats the click, a click leaves the legend stale, or a timer keeps running behind another screen.
// Run: timeout 120 node clicks.mjs [URL]   (default: ../index.html; give https://kitah.co.il/letter-s/ for live)
import { chromium } from 'playwright';
import { readdirSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
const URL = process.argv[2] || 'file://' + path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname), '../index.html');
const base = path.join(homedir(), '.cache', 'ms-playwright');
const d = readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ds = () => page.evaluate(() => ({ ...document.querySelector('#screen').dataset }));
const leg = () => page.evaluate(() => document.querySelector('#legend').textContent.replace(/\s+/g, ' '));
const sp = () => page.evaluate(() => window.__spoken.length);
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
async function at(st) { await page.goto('about:blank'); await page.goto(URL + '#' + st); await page.waitForFunction(() => document.querySelector('#screen')?.dataset.game); await sleep(600); }

await at(1);
await page.click('#nextBtn'); await sleep(500); ok((await ds()).stage === '2', 'top-bar > opens stage 2');
await page.keyboard.press(' '); await sleep(300); ok((await ds()).stage === '2' && (await ds()).state === 'asked', `Space after clicking > stays on 2 and asks (${JSON.stringify(await ds())})`);
await page.keyboard.press(' '); await sleep(300); ok((await ds()).state === 'answered', 'second Space answers');
await page.click('#prevBtn'); await sleep(400); ok((await ds()).stage === '1', 'top-bar < back to 1');
await page.keyboard.press('Enter'); await sleep(300); ok((await ds()).stage === '1', 'Enter after clicking < does not press it again');
await page.click('#agenda > :nth-child(3)'); await sleep(400); ok(+(await ds()).stage > 1, `agenda icon 3 opens a stage (${(await ds()).stage})`);
await page.keyboard.press('Enter'); await sleep(300); const s0 = (await ds()).stage; await page.keyboard.press(' '); await sleep(300); ok((await ds()).stage === s0, 'Space/Enter after an agenda click stay');

await at(4);
const n0 = await sp(); await page.click('.spkc'); await sleep(300); ok(await sp() === n0 + 1, 'stop me: speaker click plays');
await page.keyboard.press(' '); await sleep(300); ok(await sp() === n0 + 2, 'stop me: Space after the speaker click plays once (not twice)');

await at(10);
await page.click('#pk'); await sleep(900); ok((await ds()).state === 'peeking', 'peek: play button uncovers');
ok(/pause/.test(await leg()), `peek: legend says pause after the click (${await leg()})`);
await page.keyboard.press(' '); await sleep(300); ok((await ds()).state === 'paused', 'peek: Space after clicking play pauses (once)');
await page.click('#all'); await sleep(600); ok((await ds()).state === 'revealed', 'peek: eye button shows all');
ok(/~?/.test(await leg()) && await page.evaluate(() => document.querySelector('#legend [data-k="y"]').classList.contains('off')), 'peek: Y greyed after the eye click');

await at(11);
await page.click('#heb'); await sleep(300); ok((await ds()).state === 'hebrew', 'mime: Hebrew button');
await page.keyboard.press(' '); await sleep(300); ok((await ds()).state === 'rules', 'mime: Space after the Hebrew click toggles once');
await page.keyboard.press('ArrowRight'); await sleep(400);
await page.click('.track[data-half="0"]'); await sleep(500); ok((await ds()).state === 'running', 'mime: clicking the track starts');
ok(/pause/.test(await leg()), `mime: legend says pause (${await leg()})`);
await page.keyboard.press('x'); await sleep(400); ok((await ds()).state === 'swap', 'mime: X swaps once started');
await page.keyboard.press('ArrowLeft'); await sleep(300); await sleep(3500); ok((await ds()).state === 'rules' || (await ds()).state === 'hebrew', `mime: ← to the rules, no timer runs on (${(await ds()).state})`);

await at(12);
await page.click('.bank .btn[data-word="star"]'); await sleep(300); ok((await ds()).item === '1', 'chain: word click adds');
await page.keyboard.press(' '); await sleep(300); ok((await ds()).item === '2', 'chain: Space after a word click adds one');
await page.keyboard.press('c'); await sleep(300); ok((await ds()).item === '0', 'chain: C new row');

await at(7);
await page.click('.wopt:nth-child(2)'); await sleep(300); await page.keyboard.press(' '); await sleep(300); ok((await ds()).state === 'revealed', 'which: Space after clicking a word reveals');

// digits and the menu
await at(1);
await page.keyboard.press('5'); await sleep(900); ok((await ds()).stage === '5', 'key 5 opens stage 5');
await page.keyboard.press('1'); await page.keyboard.press('1'); await sleep(400); ok((await ds()).stage === '11', 'keys 1 1 open stage 11');
await page.keyboard.press('m'); await sleep(300); await page.keyboard.press(' '); await page.keyboard.press('ArrowRight'); await sleep(300); ok((await ds()).stage === '11' && (await ds()).state === 'rules', 'menu open: Space/→ do nothing behind it');
await page.keyboard.press('Escape');
ok(!errs.length, 'no page errors ' + errs.join(' | '));
console.log(fails ? fails + ' FAILED' : 'ALL OK');
await browser.close();
process.exit(fails ? 1 : 0);
