// Writes the Fredoka + Rubik @font-face rules (base64 woff2) between /* FONTS:BEGIN … */ and /* FONTS:END */
// in index.html and plan.html. The faces come from a page that already embeds them (default: the nature-words lesson).
// Run: node tools/fonts.mjs [source.html]
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || path.join(root, '..', 'nature-words', 'index.html');
const faces = readFileSync(src, 'utf8').match(/@font-face\{font-family:"(?:Fredoka|Rubik)";[^}]*\}/g) || [];
const fams = faces.map(f => /font-family:"(\w+)"/.exec(f)[1]);
if (!fams.includes('Fredoka') || !fams.includes('Rubik')) { console.error(`no Fredoka + Rubik @font-face in ${src}`); process.exit(1); }

for (const name of ['index.html', 'plan.html']) {
  const file = path.join(root, name);
  const html = readFileSync(file, 'utf8');
  const re = /(\/\* FONTS:BEGIN[^\n]*\n)[\s\S]*?(\/\* FONTS:END \*\/)/;
  if (!re.test(html)) { console.error(`FONTS markers not found in ${name}`); process.exit(1); }
  writeFileSync(file, html.replace(re, (_, a, b) => a + faces.join('\n') + '\n' + b));
  console.log(`fonts: ${fams.join(' + ')} (${(faces.join('').length / 1024).toFixed(0)} KB) written into ${name}`);
}
