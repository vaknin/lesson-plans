// Smoke test: file:// with touch emulated. Visits every stage and every item with the teacher's keys,
// drives each game (taps, timers), screenshots each step into design/screens/, and fails on:
// console errors, empty buttons, buttons under 48 px / overlapping / closer than 8 px, anything readable spilling
// off screen, a picture inside a box of another word, phase names or emoji on the kids' screen, Hebrew without
// dir=rtl lang=he, a timer marker leaving its track or moving right→left, ArrowRight not advancing, fonts not loaded,
// any microphone request, a spoken line that isn't one of the plan's voice lines, the stage list not matching the plan.
// Then a 1920×1080 pass (hd-*.png) and the teacher's plan page (plan-*.png).
// Clip misses (a spoken line with no clip in CLIPS) are reported; with --require-clips they fail the run.
// Run: cd test && npm install && timeout 120 node smoke.mjs [--require-clips]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { homedir } from 'os';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const REQUIRE_CLIPS = process.argv.includes('--require-clips');
const SHOTS = path.join(root, 'design', 'screens');
mkdirSync(SHOTS, { recursive: true });
// only this test's own shots are replaced; anything else in the folder stays
for (const f of readdirSync(SHOTS)) if (/^\d\d[a-z]?-.*\.png$|^plan-.*\.png$|^hd-.*\.png$/.test(f)) rmSync(path.join(SHOTS, f));

function headlessShell() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(homedir(), '.cache', 'ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) { const p = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'); if (existsSync(p)) return p; }
  return undefined;
}

// notes/lesson-design.md: the 14 stages [name, net min, LP min] and the 22 voice lines
const PLAN_STAGES = [
  ['Good morning', 1, 2], ['Snake reveal', 1, 2], ["Sam's story: meet the words", 3.5, 4], ['Stop me when…', 2, 3],
  ["What's missing?", 2, 3], ['Read with me', 1.5, 2], ['Which word?', 2, 3], ['Build the word', 2, 2],
  ['Is it a…?', 2, 3], ['Hiss when you hear S!', 2, 2], ['Peek!', 2, 3], ['Read and match', 2, 3],
  ['Guess my mime (pairs)', 5, 5], ['Snake chain', 2, 3]
];
const PLAN_LINES = [
  'snake', 'scissors', 'star', 'sad', 'school', 'stop',
  'Is it a snake?', 'Is it scissors?', 'Is it a star?', 'Is it sad?', 'Is it a school?', 'Is it stop?',
  'Yes, it is!', "No, it isn't!", "It's a snake.", "It's a star.", "It's a school.",
  "Hello, class! Let's learn the letter S.", 'Today, the letter S, like snake!', 'What is it?', "What's missing?", 'Great job! Bye-bye, S words!'
];
const PRAISE_N = 14;

let failures = 0; const warnings = [], spokenAll = [], missesAll = [];
const fail = m => { failures++; console.log('  FAIL', m); };
const ok = (c, m) => { if (!c) fail(m); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// static checks on the source
const SRC = readFileSync(path.join(root, 'index.html'), 'utf8');
ok(!/["']Page(Up|Down)["']\s*\)/.test(SRC.replace(/\[[^\]]*"PageUp"[^\]]*\]\.includes\(k\)/, '')) && !/k\s*===\s*["']Page(Up|Down)/.test(SRC), 'a PageUp/PageDown handler exists (clicker duplicates)');
ok(!/getUserMedia|SpeechRecognition/.test(SRC), 'microphone / speech recognition code in index.html');
ok(!/<img\b|\.jpe?g|\.png|\.webp/i.test(SRC.replace(/\/\* CLIPS:BEGIN[\s\S]*?CLIPS:END \*\//, '').replace(/\/\* FONTS:BEGIN[\s\S]*?FONTS:END \*\//, '')), 'raster images in index.html (inline SVG only)');

const browser = await chromium.launch({ executablePath: headlessShell(), args: ['--autoplay-policy=no-user-gesture-required'] });
let context, page;
async function newPage(w, h) {
  if (context) { await collect(); await context.close(); }
  context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__mic = 0;
    const md = navigator.mediaDevices;
    if (md) { md.getUserMedia = () => { window.__mic++; return Promise.reject(new Error('microphone blocked by the test')); }; }
    window.__spoken = []; window.__misses = [];
  });
  page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') fail('console error: ' + m.text()); });
  page.on('pageerror', e => fail('page error: ' + e.message));
}

const INDEX = pathToFileURL(path.join(root, 'index.html')).href;
const FAST = 0.04, FAST_TIMER = 0.025;   // the pair game's 2 × 1:45 run at 2.6 s each
async function collect() {
  if (!page || !page.url().startsWith('file:')) return;
  const r = await page.evaluate(() => ({ s: window.__spoken || [], m: window.__misses || [], mic: window.__mic || 0 })).catch(() => ({ s: [], m: [], mic: 0 }));
  spokenAll.push(...r.s); missesAll.push(...r.m);
  if (r.mic) fail(`microphone requested ${r.mic}×`);
}
let lastLoad = 0;
async function load(stage, fast = FAST) {
  if (process.env.PROFILE) { const t = Date.now(); if (lastLoad) console.log(`  ${((t - lastLoad) / 1000).toFixed(1)} s before loading stage ${stage}`); lastLoad = t; }
  await collect();
  await page.goto('about:blank');   // a new document every time (a hash-only change would keep the old page)
  await page.goto(`${INDEX}?fast=${fast}#${stage}`);
  await page.waitForFunction(() => document.querySelector('#screen')?.dataset.game, null, { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(150);
}
const sig = () => page.evaluate(() => { const d = document.querySelector('#screen').dataset; return [d.stage, d.item, d.state, d.round].join('|'); });
const ds = () => page.evaluate(() => ({ ...document.querySelector('#screen').dataset }));
const key = async (k, wait = 120) => { await page.keyboard.press(k); await sleep(wait); };
const tap = async (sel, wait = 150) => { await page.tap(sel); await sleep(wait); };
const count = sel => page.evaluate(s => document.querySelectorAll(s).length, sel);
const waitFor = async (fn, what, ms = 8000, arg) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 30 }); return true; }
  catch { fail('timed out waiting for ' + what); return false; }
};

// ---------- the layout audit run on every screenshot ----------
async function audit(name) {
  const probs = await page.evaluate(() => {
    const out = [], W = innerWidth, Hh = innerHeight;
    const vis = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getBoundingClientRect().width > 0;
    const lbl = el => (el.getAttribute('aria-label') || el.textContent.trim() || el.className).slice(0, 30);
    const onTop = b => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || y < 0 || x > W || y > Hh) return true; const e = document.elementFromPoint(x, y), ov = e && e.closest('#menu,.eyes,.swapban,#tx'); return !ov || ov.contains(b); };
    const btns = [...document.querySelectorAll('button')].filter(vis).filter(onTop);
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 47.5) out.push(`button "${lbl(b)}" is ${r.width.toFixed(0)}x${r.height.toFixed(0)} (< 48 px)`);
      const icon = [...b.querySelectorAll('svg')].some(s => { const q = s.getBoundingClientRect(); return q.width > 6 && q.height > 6; });
      if (!b.textContent.trim() && !icon) out.push(`empty button "${b.className}"`);
      if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > Hh + 1) out.push(`button "${lbl(b)}" is off screen`);
    }
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i].getBoundingClientRect(), c = btns[j].getBoundingClientRect();
      if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
      const gx = Math.max(c.left - a.right, a.left - c.right), gy = Math.max(c.top - a.bottom, a.top - c.bottom), gap = Math.max(gx, gy);
      if (gap < 0) out.push(`buttons overlap: "${lbl(btns[i])}" and "${lbl(btns[j])}"`);
      else if (gap < 7.5) out.push(`buttons ${gap.toFixed(1)} px apart (< 8): "${lbl(btns[i])}" and "${lbl(btns[j])}"`);
    }
    // a word picture never sits in the box of another word; a written label always matches its picture
    for (const p of document.querySelectorAll('.pic[data-pic]')) {
      const id = p.dataset.pic, box = p.closest('[data-word]');
      if (box && box.dataset.word !== id) out.push(`picture "${id}" sits in the box of "${box.dataset.word}"`);
      const pw = p.parentElement.querySelector(':scope > .pw');
      if (pw && pw.textContent.trim().toLowerCase() !== id) out.push(`picture "${id}" labelled "${pw.textContent.trim()}"`);
      if (vis(p)) { const s = p.querySelector('svg'), q = s && s.getBoundingClientRect(); if (!q || q.width < 20 || q.height < 20) out.push(`picture "${id}" is empty or squashed`); }
    }
    // nothing readable spills off the screen
    for (const el of document.querySelectorAll('#screen .he,#screen .bub,#screen .card,#screen .pcard,#screen .btn,.track,.chain,.bank,#agenda,#stageTitle,.bye h1,.tiles,.slots,.wopts,.grid6,.tiles6,.chunk,.strip')) {
      if (!vis(el) || el.closest('.cover,.segs')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > Hh + 1) out.push(`"${el.className || el.id}" spills off screen (${r.left.toFixed(0)},${r.top.toFixed(0)} – ${r.right.toFixed(0)},${r.bottom.toFixed(0)})`);
    }
    // the snake chain may scroll inside its own box, never out of the screen
    for (const el of document.querySelectorAll('.chainwrap')) { const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > W + 1) out.push('the snake chain spills off screen'); }
    for (const el of document.querySelectorAll('.he')) if (el.getAttribute('dir') !== 'rtl' || el.getAttribute('lang') !== 'he') out.push('Hebrew line without dir=rtl lang=he');
    // timer markers stay inside their tracks
    for (const t of document.querySelectorAll('.track')) { const r = t.getBoundingClientRect(), m = t.querySelector('.mk')?.getBoundingClientRect(); if (m && (m.left < r.left - 1 || m.right > r.right + 1)) out.push('timer marker outside its track'); }
    const txt = document.body.innerText;
    for (const w of ['Repetition', 'Recognition', 'Reproduction']) if (txt.includes(w)) out.push(`phase name "${w}" on the kids' screen`);
    if (/\p{Extended_Pictographic}/u.test(txt.replace(/[©®™↔←→↑↓]/g, ''))) out.push(`emoji on the kids' screen: ${txt.match(/\p{Extended_Pictographic}/u)}`);
    return out;
  });
  for (const p of [...new Set(probs)]) fail(`${name}: ${p}`);
}
let shotN = 0, shotMs = 0, prefix = '';
async function shot(label) {
  const d = await ds(), t0 = Date.now();
  const name = `${prefix}${String(d.stage).padStart(2, '0')}-${slug(d.game)}-${String(d.item ?? 0).padStart(2, '0')}${label ? '-' + slug(label) : ''}`;
  // let entrance animations finish so the audit sees the resting layout; loops are skipped
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity && !a.effect?.target?.closest?.('#confetti,.track,.burst,.swapban')).map(a => a.finished.catch(() => {}))),
    new Promise(r => setTimeout(r, 1500))]));
  await page.waitForFunction(() => !document.querySelector('#tx')?.innerHTML, null, { timeout: 3000 }).catch(() => {});
  await audit(name);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  shotN++; shotMs += Date.now() - t0;
  if (process.env.PROFILE && Date.now() - t0 > 600) console.log(`  slow shot ${name}: ${Date.now() - t0} ms`);
  return name;
}
// press → and check it advanced (an item, a step or a stage)
async function right(where) {
  const a = await sig(); await key('ArrowRight', 180); const b = await sig();
  ok(a !== b, `ArrowRight did not advance at ${where} (${a})`);
  return b;
}
async function rightToNextStage(st) {
  await key('ArrowRight', 220);
  ok((await ds()).stage === String(st + 1), `ArrowRight at the end of stage ${st} did not open stage ${st + 1}`);
}

// ---------- the walk through all 14 stages (used at 1366×768 and again at 1920×1080) ----------
async function walk(full) {
  // 1 Good morning
  await load(1); await shot();
  await key(' '); if (full) await shot('bounce');
  await rightToNextStage(1);

  // 2 Snake reveal
  await load(2); await shot('slide');
  await waitFor(() => document.querySelector('#screen').dataset.state === 'asked', '"What is it?"');
  await shot('asked');
  await key('Enter'); ok((await ds()).state === 'answered', 'Enter did not answer "It\'s a snake!"'); await shot('answered');
  await right('reveal 0'); await key(' '); await shot('letter-s');
  await right('reveal 1'); await shot('goal-agenda');
  await rightToNextStage(2);

  // 3 Sam's story
  await load(3);
  for (let i = 0; i < 7; i++) {
    ok((await ds()).item === String(i), `story: expected line ${i + 1}`);
    await shot();
    if (i < 6) {
      await key(' ', 200);
      if (i === 0 || full) { await key('Enter'); await key('Enter'); await key('Enter'); ok((await ds()).state === 'repeat2', 'Enter did not step Everybody → Girls → Boys'); if (i === 0) await shot('everybody-girls-boys'); }
    }
    if (i < 6) await right('story ' + i);
  }
  await rightToNextStage(3);

  // 4 Stop me when…
  await load(4);
  { const d = await ds(); ok(d.round === '0' && d.state === 'ready', 'stop me: not ready at round 1'); }
  ok(await count('.stopme .hint') === 1, 'stop me: round 1 has no hint'); await shot('ready');
  for (let r = 0; r < 5; r++) {
    let guard = 0;
    for (;;) {
      await key('ArrowLeft', 90);
      const cur = await page.evaluate(() => document.querySelector('.stopme .pcard.big')?.dataset.word);
      if (cur === (await ds()).target || ++guard > 40) break;
    }
    ok(guard <= 40, 'stop me: the target never came');
    if (r <= 1 || full) await shot(`round-${r + 1}-target`);
    const b0 = +((await ds()).burst || 0);
    await key(' '); ok(+((await ds()).burst || 0) === b0, 'stop me: Space fired the STOP burst (only S / Enter should)');
    await key(r % 2 ? 'Enter' : 's', 60);
    if (r === 0) await page.screenshot({ path: path.join(SHOTS, '04-stopme-burst.png') });
    await waitFor(() => document.querySelector('#screen').dataset.state === 'stopped', 'the STOP to land');
    if (r === 0) await shot('stopped');
    if (r === 1) ok(await count('.stopme .hint') === 0, 'stop me: later rounds still show the hint');
    if (r < 4) { await key('ArrowLeft', 150); ok((await ds()).round === String(r + 1), 'stop me: ← after the target did not start the next round'); }
  }
  await rightToNextStage(4);

  // 5 What's missing?
  await load(5);
  for (let r = 0; r < 5; r++) {
    if (r === 0 || full) await shot('look');
    await key(' ', 200); ok((await ds()).state === 'closed', 'missing: Space did not close the eyes');
    const op = await page.evaluate(() => getComputedStyle(document.querySelector('.eyes')).backgroundColor);
    ok(!/rgba\(.*, 0?\.\d+\)$/.test(op), `missing: the close-your-eyes cover is see-through (${op})`);
    ok(await count('.grid6 .hole') === 0, 'missing: the gap shows while the eyes are closed');
    if (r === 0) await shot('closed');
    await key(' ', 200);
    const d = await ds();
    ok(d.state === 'open' && await count(`.grid6 .slot[data-word="${d.target}"] .pcard`) === 0 && await count('.grid6 .pcard') === 5, 'missing: the picture did not vanish');
    if (r <= 1 || full) await shot('missing');
    await key(' ', 200); ok((await ds()).state === 'revealed', 'missing: not revealed');
    await key(' ', 150);
    if (r === 0 || full) await shot('revealed');
    if (r < 4) await right('missing ' + r);
  }
  await rightToNextStage(5);

  // 6 Read with me
  await load(6);
  for (let i = 0; i < 6; i++) { await shot(); await key(' '); if (i < 5) await right('read ' + i); }
  await rightToNextStage(6);

  // 7 Which word?
  await load(7);
  for (let i = 0; i < 6; i++) {
    const d = await ds();
    ok((d.silent === '1') === (i >= 4), `which: item ${i + 1} silent flag wrong`);
    if (i >= 4) ok(await count('.wopt.sel .pointer') === 1, 'which: the silent item has no pointing hand');
    await shot(i >= 4 ? 'silent' : 'voice');
    await key(' ', 200); ok((await ds()).state === 'revealed', 'which: Space did not show the answer');
    ok(await page.evaluate(() => document.querySelector('.wopt.right')?.dataset.word === document.querySelector('#screen').dataset.target), 'which: the wrong word is marked right');
    if (i === 0 || i === 4 || full) await shot('answer');
    if (i < 5) await right('which ' + i);
  }
  await rightToNextStage(7);

  // 8 Build the word
  await load(8);
  for (let i = 0; i < 3; i++) {
    await shot();
    const w = (await ds()).word;
    const extra = await page.evaluate(w => [...document.querySelectorAll('.tiles .tile')].find(b => !w.includes(b.dataset.c))?.dataset.k, w);
    const wr0 = +((await ds()).wrong || 0);
    await tap(`.tiles .tile[data-k="${extra}"]`); ok(+((await ds()).wrong || 0) === wr0 + 1 && await count('.slots .slot1.f') === 0, 'build: a wrong letter was not refused');
    for (let n = 0; n < w.length; n++) {
      if (n === 1) { await key(' '); continue; }   // Space places the next letter
      const k = await page.evaluate(([w, n]) => [...document.querySelectorAll('.tiles .tile:not(.used)')].find(b => b.dataset.c === w[n]).dataset.k, [w, n]);
      await tap(`.tiles .tile[data-k="${k}"]`);
      if (n === 1 && i === 0) await shot('half');
    }
    ok((await ds()).state === 'done', `build: "${w}" not finished`);
    await shot('done');
    if (i < 2) await right('build ' + i);
  }
  await rightToNextStage(8);

  // 9 Is it a…?
  await load(9);
  for (let i = 0; i < 6; i++) {
    if (i <= 1 || full) await shot('asked');
    await key(' ', 160);
    const d = await ds();
    ok(d.state === 'answered' && await page.evaluate(a => document.querySelector(`.bub.lit[data-a]`)?.dataset.a === a, d.answer), 'is it: the right answer is not lit');
    if (i <= 1 || full) await shot('answered');
    if (i === 0) { const l = d.left; await key('Enter', 300); ok((await ds()).left !== l, 'is it: Enter did not swap the halves'); await shot('swapped'); }
    if (i < 5) await right('isit ' + i);
  }
  await rightToNextStage(9);

  // 10 Hiss when you hear S!
  await load(10);
  for (let i = 0; i < 7; i++) {
    await shot();
    ok(await count('#screen .hw') === 0, 'hiss: the S words are highlighted (they must not be)');
    await key(' ', 120); ok((await ds()).hisses === '1', 'hiss: Space did not hiss');
    if (i === 0) await shot('hissed');
    if (i < 6) await right('hiss ' + i);
  }
  await rightToNextStage(10);

  // 11 Peek!
  await load(11);
  for (let i = 0; i < 6; i++) {
    if (i === 0 || full) await shot('covered');
    await key(' ');
    await waitFor(() => +document.querySelector('#screen').dataset.open >= 4, 'the picture to start uncovering');
    await key(' '); ok((await ds()).state === 'paused', 'peek: Space did not pause');
    if (i <= 1 || full) await shot('peeking');
    if (i === 0) { await tap('.peek .bub.no'); await tap('.peek .bub.yes', 200); await waitFor(() => document.querySelector('#screen').dataset.state === 'revealed', 'Yes to reveal the picture'); }
    else await key('Enter', 200);
    ok((await ds()).open === '25', 'peek: not all uncovered');
    if (i <= 1 || full) await shot('revealed');
    if (i < 5) await right('peek ' + i);
  }
  await rightToNextStage(11);

  // 12 Read and match
  await load(12);
  for (let i = 0; i < 3; i++) { await shot('echo'); await key(' ', 200); if (i === 0) await shot('echo-read'); await right('match ' + i); }
  await shot('chunk'); await key(' '); await key(' '); await key(' '); await shot('chunk-lit');
  ok(await page.evaluate(() => [...document.querySelectorAll('.chunk .bub')].every(b => b.querySelector(':scope > span'))), 'match: chunk text not wrapped (flex splits the S)');
  await right('match 3');
  { const d = await ds(); ok(d.state === 'a' && await count('.pics3 .pcard') === 3, 'match (a): not 3 pictures');
    ok(await page.evaluate(() => !document.querySelector('.match .sent .hw') && !/[?]$/.test(document.querySelector('.match .sent')?.textContent.trim() || '')), 'match (a): sentence markup unexpected');
    await shot('a');
    await key(' ', 200); ok(await page.evaluate(a => document.querySelector('.pics3 .pcard.right')?.dataset.word === a, d.answer), 'match (a): the right picture was not shown'); await shot('a-answer'); }
  await right('match 4');
  await shot('b');
  await tap('.choice[data-word="star"]'); ok((await ds()).state === 'b', 'match (b): "star" filled the gap');
  await tap('.choice[data-word="school"]', 250); ok((await ds()).state === 'filled', 'match (b): "school" did not fill the gap');
  await shot('b-filled');
  await rightToNextStage(12);

  // 13 Guess my mime
  await load(13, FAST_TIMER);
  await shot('rules');
  await key('Enter'); ok((await ds()).state === 'hebrew', 'mime: Enter did not show the Hebrew rules'); await shot('rules-hebrew');
  await key('Enter'); await right('mime rules');
  ok(await count('.tiles6 .pcard') === 6, 'mime: not 6 pictures'); await shot('ready');
  const mk = () => page.evaluate(() => [...document.querySelectorAll('.track')].map(t => t.querySelector('.mk').getBoundingClientRect().left - t.getBoundingClientRect().left));
  const m0 = await mk();
  await key(' ');
  await sleep(1200); const m1 = await mk();
  ok(m1[0] > m0[0] + 20, `mime: the half-1 marker did not move left→right (${m0[0].toFixed(0)} → ${m1[0].toFixed(0)})`);
  await key(' '); ok((await ds()).state === 'paused', 'mime: Space did not pause'); await shot('half1-running');
  await key(' ');
  await waitFor(() => document.querySelector('#screen').dataset.state === 'swap', 'the swap bell', 9000);
  await page.screenshot({ path: path.join(SHOTS, `${prefix}13-mime-01-swap.png`) });
  await waitFor(() => document.querySelector('#screen').dataset.state === 'running' && document.querySelector('#screen').dataset.half === '1', 'half 2 to start by itself', 4000);
  await sleep(1000); const m2 = await mk();
  ok(m2[1] > m0[1] + 20 && m2[0] >= m1[0], 'mime: the half-2 marker did not move left→right');
  await shot('half2-running');
  await waitFor(() => document.querySelector('#screen').dataset.state === 'done', 'time\'s up', 9000);
  await sleep(150 + 2600 * FAST); await shot('done');
  // a tapped picture sets the prompts to its own question (the teacher's demo)
  for (const id of ['snake', 'scissors', 'star', 'sad', 'school', 'stop']) {
    await tap(`.tiles6 .pcard[data-word="${id}"]`); await tap('#qh', 80);
    ok(await page.evaluate(id => document.querySelector('#qh').dataset.say === LESSON.questions[id] && document.querySelector('#qe').textContent.toLowerCase() === id + '?', id), `mime: tapping "${id}" did not set its prompts`);
  }
  await shot('prompts-stop');
  await rightToNextStage(13);

  // 14 Snake chain
  await load(14);
  await shot('empty');
  await tap('.bank .btn[data-word="star"]'); ok(await count('.segs .seg') === 1, 'chain: tapping a word did not grow the snake');
  ok(await page.evaluate(() => [...document.querySelectorAll('.bank .btn')].every(b => b.querySelector(':scope > span'))), 'chain: bank button text not wrapped (flex splits the S)');
  for (let n = 1; n < 6; n++) { await key(' ', 140); if (n === 2) await shot('three'); }
  ok(await count('.segs .seg') === 6, 'chain: the snake did not reach 6 words');
  await sleep(900 * FAST + 200); await shot('full');
  ok((await page.evaluate(() => window.__sfx)).includes('hiss'), 'chain: no hiss at the end');
  await key(' ', 200); await shot('learn');
  await key(' ', 200); ok((await ds()).state === 'answer', 'chain: Space did not show the answer'); await shot('answer');
  for (let t = 1; t <= 7; t++) await key(' ', 90);
  ok((await ds()).state === 'ticked7', 'chain: the agenda was not ticked 7 times');
  ok(await page.evaluate(() => [...document.querySelectorAll('#agenda > *')].every(a => /done/.test(a.className))), 'chain: the top agenda is not all ticked');
  await shot('ticked');
  await key(' ', 300); ok((await ds()).state === 'bye', 'chain: no goodbye'); await shot('bye');
}

// ---------- 0. fonts, stage list, keys, menu ----------
await newPage(1366, 768);
await load(1);
const fontInfo = await page.evaluate(async () => { await document.fonts.ready; return { status: document.fonts.status, faces: [...document.fonts].map(f => [f.family.replace(/"/g, ''), f.status]) }; });
ok(fontInfo.status === 'loaded', `document.fonts.status is ${fontInfo.status}`);
for (const fam of ['Fredoka', 'Rubik']) ok(fontInfo.faces.some(([f, s]) => f === fam && s === 'loaded'), `${fam} not loaded (${JSON.stringify(fontInfo.faces)})`);
const siteStages = await page.evaluate(() => STAGES.map(s => [s.name, s.net, s.lp]));
ok(JSON.stringify(siteStages) === JSON.stringify(PLAN_STAGES), `site stages differ from the plan:\n    ${JSON.stringify(siteStages)}`);
ok(siteStages.reduce((t, s) => t + s[1], 0) === 30, 'site net minutes do not sum to 30');
ok(siteStages.reduce((t, s) => t + s[2], 0) === 40, 'site LP minutes do not sum to 40');
const siteLines = await page.evaluate(() => VOICE_LINES(LESSON));
ok(JSON.stringify([...siteLines].sort()) === JSON.stringify([...PLAN_LINES].sort()), `site voice lines differ from the plan: ${JSON.stringify(siteLines)}`);
const html = await page.evaluate(() => ({ tr: document.documentElement.getAttribute('translate'), cls: document.documentElement.className, meta: !!document.querySelector('meta[name=google][content=notranslate]'), ext: [...document.querySelectorAll('link[href],script[src],img[src]')].length }));
ok(html.tr === 'no' && /notranslate/.test(html.cls) && html.meta, 'translate="no" / notranslate class / google notranslate meta missing');
ok(html.ext === 0, 'external resources linked');
await key('9'); ok((await ds()).stage === '9', 'key 9 did not open stage 9');
await key('1', 60); await key('2', 250); ok((await ds()).stage === '12', 'keys 1 2 did not open stage 12');
await key('1', 60); await key('4', 250); ok((await ds()).stage === '14', 'keys 1 4 did not open stage 14');
await key('1', 900); ok((await ds()).stage === '1', 'key 1 alone did not open stage 1');
{ await key('3', 250); const a = await sig(); await key('PageDown'); await key('PageUp'); ok(a === await sig(), 'PageUp/PageDown changed something (no duplicate keys)'); }
// the Stop/Look stamp on a stage change
await key('4', 40); ok(/Stop/.test(await page.evaluate(() => document.querySelector('#tx').textContent)), 'no "Stop!" stamp on a stage change');
await sleep(400);
// the top-bar buttons by touch
await key('1', 900); await tap('#nextBtn', 250); ok((await ds()).stage === '2', 'the top-bar Next did not advance');
await tap('#prevBtn', 250); ok((await ds()).stage === '1', 'the top-bar Back did not go back');
await key('m'); ok(await page.isVisible('#menu'), 'M did not open the menu');
await audit('menu'); await page.screenshot({ path: path.join(SHOTS, '00-menu.png') });
await tap('#testSound', 600);
await tap('.mstage:nth-child(7)', 300); ok((await ds()).stage === '7' && !(await page.isVisible('#menu')), 'menu: tapping stage 7 did not open it');
await key('m'); await tap('#closeMenu'); ok(!(await page.isVisible('#menu')), 'Close did not close the menu');

// ---------- 1. every stage and item at 1366×768 ----------
await walk(true);

// ---------- 2. the key screens again at 1920×1080 (projector full HD): same audit, hd-*.png ----------
await newPage(1920, 1080);
prefix = 'hd-';
const SP6 = Array(6).fill(' ');
const HD = {
  1: [], 2: ['wait:asked', 'Enter', 'shot:answered', 'ArrowRight', 'ArrowRight', 'shot:goal'], 3: [' ', 'Enter', 'shot:everybody'], 4: ['ArrowLeft', 'shot:run'],
  5: [' ', ' ', 'shot:missing', ' ', 'shot:revealed'], 6: [], 7: [' ', 'shot:answer', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'shot:silent'],
  8: [' ', ' ', 'shot:half'], 9: [' ', 'shot:answered'], 10: [' ', 'shot:hissed'], 11: ['Enter', 'shot:revealed'],
  12: ['ArrowRight', 'ArrowRight', 'ArrowRight', 'shot:chunk', 'ArrowRight', 'shot:a', 'ArrowRight', 'shot:b'],
  13: ['Enter', 'shot:hebrew', 'ArrowRight', 'shot:game'],
  14: [...SP6, 'shot:full', ' ', ' ', 'shot:answer', ...SP6, ' ', ' ', 'shot:bye']
};
for (let s = 1; s <= 14; s++) {
  await load(s); await shot();
  for (const st of HD[s]) {
    if (st.startsWith('shot:')) await shot(st.slice(5));
    else if (st.startsWith('wait:')) await waitFor(v => document.querySelector('#screen').dataset.state === v, st, 4000, st.slice(5));
    else await key(st, 200);
  }
}
ok((await ds()).state === 'bye', 'hd: the chain did not reach goodbye');
prefix = '';

// ---------- 3. the teacher's plan page ----------
await newPage(1366, 768);
await page.goto(pathToFileURL(path.join(root, 'plan.html')).href);
await page.evaluate(() => document.fonts.ready);
const plan = await page.evaluate(() => ({
  status: document.fonts.status, faces: [...document.fonts].map(f => [f.family.replace(/"/g, ''), f.status]),
  rows: [...document.querySelectorAll('.stage[data-stage]')].map(s => [s.querySelector('h3').textContent.replace(/’/g, "'"), +s.dataset.net, +s.dataset.lp]),
  timeline: [...document.querySelectorAll('#timeline tbody tr')].map(r => [r.children[1].textContent.replace(/’/g, "'"), +r.children[3].textContent, +r.children[4].textContent]),
  praise: document.querySelectorAll('.stage .praise').length,
  tx: document.querySelectorAll('.stage .tx').length,
  per: [...document.querySelectorAll('.stage[data-stage]')].map(s => ['Teacher does and says', 'Kids do', 'Rest of the class', 'Easier / harder', 'Praise'].every(l => [...s.querySelectorAll('.lbl')].some(x => x.textContent === l)) && s.querySelector('.chip.who')),
  objective: document.querySelector('#objective')?.textContent || '',
  late: document.querySelectorAll('#late li').length, clock: /8 minutes before the bell/.test(document.querySelector('#clockRule')?.textContent || ''),
  fix: /Is it scissors\?/.test(document.body.textContent),
  tr: document.documentElement.getAttribute('translate'),
  emoji: /\p{Extended_Pictographic}/u.test(document.body.innerText.replace(/[©®™↔←→↑↓]/g, '')),
  phases: ['Repetition', 'Recognition', 'Reproduction'].every(w => document.body.textContent.includes(w))
}));
ok(JSON.stringify(plan.rows) === JSON.stringify(PLAN_STAGES), `plan.html stage cards differ from the plan:\n    ${JSON.stringify(plan.rows)}`);
ok(JSON.stringify(plan.timeline) === JSON.stringify(PLAN_STAGES), `plan.html timeline differs from the plan:\n    ${JSON.stringify(plan.timeline)}`);
ok(plan.praise === PRAISE_N, `plan.html: ${plan.praise} praise lines (want one per stage)`);
ok(plan.tx === 13, `plan.html: ${plan.tx} transition lines (want 13)`);
plan.per.forEach((p, k) => ok(p, `plan.html stage ${k + 1}: missing a section (teacher / kids / rest / easier-harder / praise / interaction)`));
ok(/recognise and say 6 words that begin with S/.test(plan.objective), 'plan.html: objective missing');
ok(plan.late === 5 && plan.clock, 'plan.html: running-late list or clock rule missing');
ok(plan.fix, 'plan.html: the "Is it scissors?" fix is missing');
ok(plan.tr === 'no', 'plan.html: translate="no" missing');
ok(!plan.emoji, 'plan.html: emoji');
ok(plan.phases, 'plan.html: the phase names are missing');
ok(plan.status === 'loaded' && ['Fredoka', 'Rubik'].every(f => plan.faces.some(([n, s]) => n === f && s === 'loaded')), 'plan.html fonts not loaded');
await page.screenshot({ path: path.join(SHOTS, 'plan-top.png') });
await page.evaluate(() => document.querySelector('#s3').scrollIntoView({ behavior: 'instant' })); await sleep(200);
await page.screenshot({ path: path.join(SHOTS, 'plan-stage3.png') });
await page.evaluate(() => document.querySelector('#s13').scrollIntoView({ behavior: 'instant' })); await sleep(200);
await page.screenshot({ path: path.join(SHOTS, 'plan-stage13.png') });
await page.screenshot({ path: path.join(SHOTS, 'plan-full.png'), fullPage: true });

// ---------- result ----------
await collect();
const bad = [...new Set(spokenAll.filter(l => !PLAN_LINES.includes(l)))];
ok(!bad.length, `spoken lines that are not in the plan's voice lines: ${JSON.stringify(bad)}`);
const never = PLAN_LINES.filter(l => !spokenAll.includes(l));
if (never.length) warnings.push(`voice lines never spoken in this run: ${never.join(' | ')}`);
const misses = [...new Set(missesAll)];
console.log(`\n${shotN} screenshots (${(shotMs / 1000).toFixed(0)} s) in design/screens · ${spokenAll.length} lines spoken, ${new Set(spokenAll).size} different`);
console.log(`clip misses: ${misses.length} line(s) spoken with no clip${misses.length ? ':\n  ' + misses.join('\n  ') : ''}`);
if (REQUIRE_CLIPS && misses.length) fail(`${misses.length} clip misses (--require-clips)`);
if (warnings.length) console.log('warnings:\n  ' + warnings.join('\n  '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
