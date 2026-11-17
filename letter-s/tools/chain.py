# letter-s voice chain: OmniVoice child ref -> Chatterbox clone -> Whisper check -> slow + loudness.
# The refs are child voices designed with OmniVoice (letter-b's tools/takes.py ref): ref-boy.wav is letter-b's
# boy (VOICE "male, child, american accent"), ref-girl.wav the same design as a girl ("female, child, american
# accent", REF_SEED=4). In the 2026-11-17 comparison, Kokoro refs (af_heart/am_puck) and Maya1 ("8 year old"
# descriptions) came out at adult pitch or weak; these child refs measured 240-350 Hz, and Aviv picked this chain.
# Every line is taken by both voices.
#   venv-cb/bin/python chain.py gen      normal pace, from W/ref-{boy,girl}.wav into W/raw/ and W/takes.json
#   venv-cb/bin/python chain.py finish   SLOWER (27%) longer with Rubber Band R3 (the rubberband CLI's -3 engine,
#     pitch kept), -16 LUFS, mp3 in W/takes/{boy,girl}/ and W/takes-final.json
# Not daily-chapter's "Chatterbox slow" (cloning from a slowed reference): on these 1-6 word lines the pace did
# not follow (refs 1.2x and 1.4x longer gave the 1.2 run's takes a median 0.93-1.03x, spread 0.53-1.76x, 6 of 44
# in range) and Whisper retakes rose (9 at normal pace, 20 on the 1.2 refs). Never ffmpeg's rubberband filter or atempo.
import json, os, re, subprocess, sys, time
from pathlib import Path

W = Path(os.environ.get("W", Path.home() / "lesson-letter-s"))
OUT = W / "raw"
MAN = W / "takes.json"
TTS = Path.home() / "tts-test"
PY = {"fw": TTS / "venv-fw/bin/python"}
SR = 24_000
VOICES = ("boy", "girl")
EXAGGERATION, CFG = 0.8, 0.3
SLOWER = 1.27  # clip length vs the model's normal pace: Aviv, 2026-11-17, after 15% was "still a bit too fast"
TRIES = 4
HOMOPHONES = {"see": "sea"}
REPEAT, GAP = 3, 12
LINES = ["snake", "scissors", "star", "sad", "school", "stop",
         "Is it a snake?", "Is it scissors?", "Is it a star?", "Is it sad?", "Is it a school?", "Is it stop?",
         "Yes, it is!", "No, it isn't!",
         "It's a snake.", "It's a star.", "It's a school.",
         "Hello, class! Let's learn the letter S.", "Today, the letter S, like snake!", "What is it?", "What's missing?",
         "Great job! Bye-bye, S words!"]
if os.environ.get("LINES"):  # a JSON list of lines, for a sample run
    LINES = json.loads(os.environ["LINES"])


def norm(text):
    return [HOMOPHONES.get(w, w) for w in re.sub(r"[^a-z0-9 ]+", "", text.lower().replace("-", " ")).split()]


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def cmd_hear():
    import numpy as np
    from faster_whisper import WhisperModel
    w = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4)
    for path in sys.stdin:
        pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", path.strip(), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                             capture_output=True, check=True).stdout
        segs, _ = w.transcribe(np.frombuffer(pcm, np.float32), language="en", beam_size=5)
        print(json.dumps(" ".join(s.text for s in segs).strip()), flush=True)


def _energy(a):
    import numpy as np
    fr = SR // 100
    e = np.array([np.sqrt(np.mean(a[i:i + fr] ** 2)) for i in range(0, len(a) - fr, fr)])
    return fr, np.where(e > e.max() * 10 ** (-40 / 20))[0]


def trim(a):
    fr, on = _energy(a)
    m = SR * 40 // 1000
    return a[max(on[0] * fr - m, 0):min((on[-1] + 1) * fr + m, len(a))]


def islands(a):
    fr, on = _energy(a)
    runs, s0, prev = [], on[0], on[0]
    for i in on[1:]:
        if i - prev > GAP:
            runs.append((s0, prev)); s0 = i
        prev = i
    runs.append((s0, prev))
    m = SR * 40 // 1000
    return [a[max(s * fr - m, 0):min((e_ + 1) * fr + m, len(a))] for s, e_ in runs if (e_ - s + 1) * 10 >= 150]


def cmd_gen():
    import torch, soundfile as sf
    import perth; perth.PerthImplicitWatermarker = perth.DummyWatermarker
    from chatterbox.tts import ChatterboxTTS
    torch.set_num_threads(int(os.environ.get("THREADS", "8")))
    man = json.loads(MAN.read_text()) if MAN.exists() else {}
    m = ChatterboxTTS.from_pretrained(device="cpu")
    ear = subprocess.Popen([str(PY["fw"]), "-I", __file__, "hear"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def hear(path):
        ear.stdin.write(str(path) + "\n"); ear.stdin.flush()
        return json.loads(ear.stdout.readline())

    def say(line, voice, seed):
        torch.manual_seed(seed)
        with torch.inference_mode():
            return m.generate(line, audio_prompt_path=str(W / f"ref-{voice}.wav"), exaggeration=EXAGGERATION, cfg_weight=CFG)[0].numpy()

    t_all = time.time()
    for text in LINES:
        for voice in VOICES:
            if voice in man.get(text, {}):
                continue
            (OUT / voice).mkdir(parents=True, exist_ok=True)
            out = OUT / voice / f"{slug(text)}.wav"
            line = text if text[-1:] in ".!?" else text + "."
            ok, got, seed = False, "", 0
            t0 = time.time()
            for seed in range(1, TRIES + 1):
                a = say(line, voice, seed)
                sf.write(out, trim(a), SR)
                got = hear(out)
                ok = norm(got) == norm(text)
                print(f"{voice} {text!r} seed {seed}: heard {got!r} {'ok' if ok else 'RETAKE'}", flush=True)
                if ok:
                    break
            if not ok and len(text.split()) == 1:
                for rep in range(1, TRIES + 1):
                    a = say(" ".join([line] * REPEAT), voice, 100 + rep)
                    heard = []
                    for piece in islands(a):
                        sf.write(out, piece, SR)
                        got = hear(out)
                        heard.append(got)
                        if norm(got) == norm(text):
                            ok = True
                            break
                    print(f"{voice} {text!r} repeat seed {100 + rep}: heard {heard} {'ok' if ok else 'RETAKE'}", flush=True)
                    if ok:
                        seed = 100 + rep
                        break
            man.setdefault(text, {})[voice] = {"file": f"{voice}/{slug(text)}.mp3", "ok": ok, "heard": got, "seed": seed,
                                               "secs": round(time.time() - t0)}
            MAN.write_text(json.dumps(man, indent=1) + "\n")
    ear.stdin.close()
    print(f"ALL DONE {time.time() - t_all:.0f} s", flush=True)


def cmd_finish():
    import tempfile
    base, final = json.loads(MAN.read_text()), {}
    for text in LINES:
        for voice in VOICES:
            mp3 = W / "takes" / voice / f"{slug(text)}.mp3"
            mp3.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory() as d:
                subprocess.run(["rubberband", "-q", "-3", "--time", str(SLOWER), str(OUT / voice / f"{slug(text)}.wav"),
                                f"{d}/rb.wav"], check=True, capture_output=True)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{d}/rb.wav", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                                "-ac", "1", "-ar", "24000", "-b:a", "64k", str(mp3)], check=True)
            final.setdefault(text, {})[voice] = {**base[text][voice], "file": f"{voice}/{slug(text)}.mp3"}
    (W / "takes-final.json").write_text(json.dumps(final, indent=1) + "\n")
    print(f"finished {len(LINES) * len(VOICES)} takes", flush=True)


{"hear": cmd_hear, "gen": cmd_gen, "finish": cmd_finish}[sys.argv[1]]()
