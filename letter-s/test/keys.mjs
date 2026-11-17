// Key test: walks the whole lesson from stage 1 with the keyboard only, as a teacher would: on every item it presses
// each letter in the legend, Space while the legend offers it, Enter, ← / →, then PgDn. Fails when a press does nothing
// silently, an enabled legend key does nothing, a greyed one acts, or a key other than PgDn/PgUp changes the stage.
// Every press is logged to /tmp/explore/log.txt with the legend before and after.
// Run: timeout 600 node keys.mjs [URL]   (default: ../index.html at fast speed; give https://kitah.co.il/letter-s/ for live)
import { chromium } from 'playwright';
import { readdirSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
const LOCAL = !process.argv[2];
const PAGE = process.argv[2] || 'file://' + path.resolve(path.dirname(new URL(import.meta.url).pathname), '../index.html') + '?fast=0.3';
const FROM = +(process.argv[3] || 1), TO = +(process.argv[4] || 12);
const base = path.join(homedir(), '.cache', 'ms-playwright');
const d = readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const SH = '/tmp/explore', LOG = SH + '/log.txt'; mkdirSync(SH, { recursive: true }); writeFileSync(LOG, '');
const bad = []; const log = s => appendFileSync(LOG, s + '\n');
page.on('console', m => { if (m.type() === 'error') { bad.push('console: ' + m.text()); log('   !!! console: ' + m.text()); } });
page.on('pageerror', e => { bad.push('pageerror: ' + e.message); log('   !!! pageerror: ' + e.message); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snap = () => page.evaluate(() => {
  const s = document.querySelector('#screen'), h = s.innerHTML;
  let x = 0; for (let i = 0; i < h.length; i++) x = (x * 31 + h.charCodeAt(i)) | 0;
  return { stage: s.dataset.stage, item: s.dataset.item, state: s.dataset.state, round: s.dataset.round, h: x,
    sp: window.__spoken.length, lastSp: window.__spoken.at(-1), fx: window.__sfx.length, lastFx: window.__sfx.at(-1),
    legend: [...document.querySelectorAll('#legend > span')].map(c => ({ k: c.dataset.k, t: c.textContent.trim(), off: c.classList.contains('off') })),
    nudge: document.querySelector('#legend').classList.contains('nudge'), title: document.querySelector('#stName')?.textContent };
});
const fmtL = l => l.map(c => (c.off ? '~' : '') + c.t).join(' | ');
let n = 0;
const W = LOCAL ? 0.5 : 1;
async function press(k, wait = 700) {
  wait *= W;
  const a = await snap();
  await page.keyboard.press(k); await sleep(wait);
  const b = await snap();
  const what = [];
  if (a.stage !== b.stage) what.push(`STAGE ${a.stage}→${b.stage}`);
  if (a.item !== b.item) what.push(`item ${a.item}→${b.item}`);
  if (a.state !== b.state) what.push(`state ${a.state}→${b.state}`);
  if (a.round !== b.round) what.push(`round ${a.round}→${b.round}`);
  if (b.sp > a.sp) what.push(`said "${b.lastSp}"`);
  if (b.fx > a.fx) what.push(`sfx ${b.fx - a.fx} (${b.lastFx})`);
  if (a.h !== b.h && !what.length) what.push('dom changed');
  if (b.nudge) what.push('NUDGE');
  const legKey = k === ' ' ? 'space' : k.toLowerCase();
  const chip = a.legend.find(c => c.k === legKey);
  const line = `${String(++n).padStart(3)} st${a.stage} it${a.item} ${a.state || ''} [${fmtL(a.legend)}]  ${k === ' ' ? 'Space' : k} → ${what.join(', ') || 'NOTHING'}   now [${fmtL(b.legend)}]`;
  log(line);
  const flag = m => { bad.push(m + ': ' + line); log('   ^^^ ' + m); };
  if (chip && !chip.off && (!what.length || what.join() === 'NUDGE')) flag('enabled key did nothing');
  if (chip && chip.off && what.some(w => w !== 'NUDGE')) flag('greyed key acted');
  if (!what.length) flag('silent press');
  if (a.stage !== b.stage && !/PageDown|PageUp/.test(k)) flag('stage changed');
  return b;
}
await page.goto(PAGE + (FROM > 1 ? '#' + FROM : ''));
await page.waitForFunction(() => document.querySelector('#screen')?.dataset.game);
await sleep(800);
for (let st = FROM; st <= TO; st++) {
  log(`===== stage ${st}: ${(await snap()).title}`);
  await page.screenshot({ path: `${SH}/${st}-start.png` });
  for (let guard = 0; guard < (st === 4 ? 10 : 30); guard++) {
    let s = await snap();
    for (const c of s.legend.filter(c => !['r', 'pgdn', 'space'].includes(c.k))) await press(c.k, 700);
    for (let i = 0; i < 4; i++) { s = await snap(); if (s.legend.find(c => c.k === 'space' && !c.off)) await press(' ', 800); }
    await press('Enter', 300);
    const before = await snap();
    const b = await press('ArrowRight', 900);
    if (b.item === before.item && b.state === before.state && b.round === before.round) { if (!b.nudge) bad.push(`→ at the end of stage ${st} gave no feedback`); break; }
    if (guard === 1) { await press('ArrowLeft', 700); await press('ArrowRight', 900); }
  }
  await page.screenshot({ path: `${SH}/${st}-end.png` });
  if (st < TO) await press('PageDown', 1200);
}
log('\n\nBAD:\n' + bad.join('\n'));
console.log(bad.join('\n') || 'ALL KEYS OK'); console.log(n, 'presses');
await browser.close();
process.exit(bad.length ? 1 : 0);
