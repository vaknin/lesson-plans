// Writes the picked voice takes into index.html as base64 data URIs (the CLIPS block).
// Reads tools/clips/takes.json  {"<line>": {"boy": {"file": "boy/<slug>.mp3", "ok": true, …}, "girl": {…}}}
//   and tools/clips/picks.json  {"<line>": "boy" | "girl"}
// and replaces everything between /* CLIPS:BEGIN … */ and /* CLIPS:END */ in index.html.
// The lines are the site's own VOICE_LINES (the plan's voice lines); a line with no pick or no file is listed and left out.
// Run: node tools/embed.mjs [--strict]   (--strict: exit 1 when any line is left out)
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const clipsDir = path.join(root, 'tools', 'clips');
const file = path.join(root, 'index.html');
const strict = process.argv.includes('--strict');
const readJSON = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const html = readFileSync(file, 'utf8');
// the site's line list: evaluate the LESSON block and VOICE_LINES from the page itself
const lessonSrc = /const LESSON = (\{[\s\S]*?\n\});/.exec(html)[1];
const linesSrc = /const VOICE_LINES = (L => \[[\s\S]*?\]\)\]);/.exec(html)[1];
const LINES = new Function(`const LESSON = ${lessonSrc}; return (${linesSrc})(LESSON);`)();

const takes = readJSON(path.join(clipsDir, 'takes.json'), {});
const picks = readJSON(path.join(clipsDir, 'picks.json'), {});
const out = [], missing = [], used = { boy: 0, girl: 0 };
for (const line of LINES) {
  const voice = picks[line];
  if (voice !== 'boy' && voice !== 'girl') { missing.push(`${line}  (no pick)`); continue; }
  const rel = takes[line]?.[voice]?.file || `${voice}/${slug(line)}.mp3`;
  const mp3 = path.join(clipsDir, 'takes', rel);
  if (!existsSync(mp3)) { missing.push(`${line}  (${voice}: ${rel} not found)`); continue; }
  out.push(`  ${JSON.stringify(line)}: "data:audio/mpeg;base64,${readFileSync(mp3).toString('base64')}"`);
  used[voice]++;
}
const extra = Object.keys(picks).filter(l => !LINES.includes(l));

const re = /\/\* CLIPS:BEGIN[^\n]*\n[\s\S]*?\/\* CLIPS:END \*\//;
if (!re.test(html)) { console.error('CLIPS markers not found in index.html'); process.exit(1); }
const block = `/* CLIPS:BEGIN – written by tools/embed.mjs from tools/clips/takes.json + picks.json (${used.boy} boy, ${used.girl} girl), do not edit by hand */\nconst CLIPS = {\n${out.join(',\n')}\n};\n/* CLIPS:END */`;
writeFileSync(file, html.replace(re, () => block));

console.log(`embedded ${out.length} / ${LINES.length} lines (${used.boy} boy, ${used.girl} girl), index.html ${(Buffer.byteLength(readFileSync(file)) / 1024).toFixed(0)} KB`);
if (missing.length) console.log(`left out ${missing.length}:\n  ` + missing.join('\n  '));
if (extra.length) console.log(`picks.json lines the site never says (ignored):\n  ` + extra.join('\n  '));
process.exit(strict && missing.length ? 1 : 0);
