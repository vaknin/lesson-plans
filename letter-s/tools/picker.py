import base64, html, json, sys
from pathlib import Path

D = Path(sys.argv[1])  # repo tools/
takes = json.loads((D / "clips/takes.json").read_text())
rows = []
for i, (line, v) in enumerate(takes.items()):
    default = "boy" if i % 2 == 0 else "girl"
    cells = []
    for who in ("boy", "girl"):
        t = v[who]
        b64 = base64.b64encode((D / "clips/takes" / t["file"]).read_bytes()).decode()
        bad = "" if t["ok"] else f' bad" title="Whisper heard: {html.escape(t["heard"])}'
        note = "" if t["ok"] else f'<small>heard: “{html.escape(t["heard"])}”</small>'
        cells.append(f'<td><button class="play{bad}" data-src="data:audio/mpeg;base64,{b64}">{who.capitalize()} ▶</button>{note}</td>')
        cells.append(f'<td><label><input type="radio" name="r{i}" value="{who}"{" checked" if who == default else ""}> {who}</label></td>')
    rows.append(f'<tr data-line="{html.escape(line)}"><td class="t">{html.escape(line)}</td>{"".join(cells)}</tr>')

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Letter S: pick the voices</title>
<style>
body{{font:22px system-ui,sans-serif;margin:24px;background:#fbfaf5}}
table{{border-collapse:collapse;width:100%}} td{{padding:10px;border-bottom:1px solid #ddd;vertical-align:middle}}
.t{{font-size:26px;font-weight:600}} button{{font-size:22px;padding:8px 18px;border-radius:10px;border:2px solid #4a7;background:#efe;cursor:pointer}}
button.bad{{border-color:#c00;background:#fdd;color:#c00}} small{{display:block;color:#c00;font-size:16px}}
input[type=radio]{{transform:scale(1.6);margin-right:8px}} #copy{{margin:20px 0;font-size:26px}}
textarea{{width:100%;height:220px;font:16px monospace}}
</style></head><body>
<h1>Letter S: pick one voice per line</h1>
<p>Play both takes, choose boy or girl, then press <b>Copy picks</b> and send the text. Red = Whisper misheard that take.</p>
<table>{''.join(rows)}</table>
<button id="copy">Copy picks</button><textarea id="out" readonly></textarea>
<script>
const audio = new Audio();
document.querySelectorAll('button.play').forEach(b => b.onclick = () => {{ audio.src = b.dataset.src; audio.play(); }});
document.getElementById('copy').onclick = () => {{
  const picks = {{}};
  document.querySelectorAll('tr[data-line]').forEach(tr => picks[tr.dataset.line] = tr.querySelector('input:checked').value);
  const txt = JSON.stringify(picks, null, 1);
  document.getElementById('out').value = txt;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {{}});
}};
</script></body></html>
"""
(D / "picker.html").write_text(page)
print("picker", len(page))
