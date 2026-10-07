"""Recharge intro soundtrack, synthesised and timed to the landing animation.

Every cue is placed on the same frame numbers as src/Intro.tsx (30 fps), so the
sound lands exactly on the motion: footsteps on the walker's steps, a whoosh as
the head lifts onto the pillow, a lullaby that climbs with the charge, a chime
when the bolt fills, and one pluck per letter of RECHARGE. Everything is
generated here (no samples or licensed music), in D major, warm and quiet.

Run: python3 sound/soundtrack.py  ->  public/sound/recharge-intro.wav
"""
import os
import wave

import numpy as np

SR = 48_000
FPS = 30
LENGTH = 12.0  # seconds; the reel is 360 frames
N = int(SR * LENGTH)
rng = np.random.default_rng(7)

# The animation's timeline (frames), mirrored from src/Intro.tsx.
T = dict(walk=(6, 62), climb=(60, 86), tuck=(80, 104), charge=(100, 162), bolt=(160, 172),
         morph=(176, 212), ring=(178, 210), letters=204, dot=240, intro_end=254, cycle=150)

def t(frame):
    return frame / FPS

def hz(note):
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave - 4)) / 12)

L = np.zeros(N)
R = np.zeros(N)

def place(signal, start, pan=0.0, gain=1.0):
    """Mix a mono signal in at `start` seconds with constant-power panning (-1 left, 1 right)."""
    i = int(start * SR)
    if i >= N:
        return
    s = signal[: N - i] * gain
    angle = (pan + 1) * np.pi / 4
    L[i:i + len(s)] += s * np.cos(angle)
    R[i:i + len(s)] += s * np.sin(angle)

def place_panned(signal, start, pans, gain=1.0):
    """Like place, with a pan value per sample (a moving source)."""
    i = int(start * SR)
    s = signal[: N - i] * gain
    angle = (pans[: len(s)] + 1) * np.pi / 4
    L[i:i + len(s)] += s * np.cos(angle)
    R[i:i + len(s)] += s * np.sin(angle)

def time(seconds):
    return np.arange(int(seconds * SR)) / SR

def adsr(n, attack, release, curve=1.0):
    env = np.ones(n)
    a, r = min(n, int(attack * SR)), min(n, int(release * SR))
    if a:
        env[:a] = np.linspace(0, 1, a) ** curve
    if r:
        env[n - r:] *= np.linspace(1, 0, r) ** curve
    return env

def spectral(signal, gain_fn):
    """Filter by shaping the spectrum: gain_fn(freqs) -> gains."""
    spec = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / SR)
    return np.fft.irfft(spec * gain_fn(freqs), len(signal))

def bandpass(f, centre, width):
    return np.exp(-0.5 * (np.log(np.maximum(f, 1) / centre) / width) ** 2)

def sweep_noise(seconds, centres, width=0.32):
    """Noise whose band centre moves through `centres` (block-wise overlap-add)."""
    n = int(seconds * SR)
    noise = rng.standard_normal(n + 4096)
    out = np.zeros(n + 4096)
    block, hop = 2048, 512
    win = np.hanning(block)
    for k, start in enumerate(range(0, n, hop)):
        pos = start / max(1, n)
        centre = np.interp(pos, np.linspace(0, 1, len(centres)), centres)
        seg = noise[start:start + block] * win
        out[start:start + block] += spectral(seg, lambda f: bandpass(f, centre, width) / (1 + (f / 3500) ** 2)) * win
    out = out[:n]
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-9) * 0.25

# --- A. Night pad: Dmaj9, slow and warm; brightens as the charge fills, resolves at the logo.
def pad_voice(freq, seconds, detune=0.18):
    x = time(seconds)
    v = sum(np.sin(2 * np.pi * (freq + d) * x + rng.uniform(0, 6.28)) for d in (-detune, 0, detune)) / 3
    v += 0.18 * np.sin(2 * np.pi * 2 * freq * x)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.21 * x + rng.uniform(0, 6.28))
    return v * trem

night = ["D3", "A3", "C#4", "E4", "F#4"]
dawn = ["D3", "A3", "D4", "F#4", "A4", "E5"]
night_len, dawn_start = t(T["morph"][0]) + 0.8, t(T["morph"][0])
for i, note in enumerate(night):
    v = pad_voice(hz(note), night_len) * adsr(int(night_len * SR), 1.6, 0.9, 1.4)
    place(v, 0, pan=(i - 2) * 0.22, gain=0.055)
# Upper voices rise in with the charge.
charge_s, charge_e = t(T["charge"][0]), t(T["charge"][1])
for i, note in enumerate(["A4", "C#5"]):
    seg = charge_e - charge_s + 0.9
    v = pad_voice(hz(note), seg) * np.linspace(0, 1, int(seg * SR)) ** 1.5 * adsr(int(seg * SR), 0.01, 0.7)
    place(v, charge_s, pan=(-0.4, 0.4)[i], gain=0.03)
dawn_len = LENGTH - dawn_start
for i, note in enumerate(dawn):
    n = int(dawn_len * SR)
    env = adsr(n, 0.9, 1.6, 1.3)
    v = pad_voice(hz(note), dawn_len) * env
    place(v, dawn_start, pan=(i - 2.5) * 0.2, gain=0.05)

# --- B. Footsteps, on the walker's stride (swing peaks every 7.5 frames), moving right to centre.
def footstep():
    x = time(0.18)
    pitch = 75 * np.exp(-x * 9) + 48
    thump = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-x * 26)
    click = spectral(rng.standard_normal(len(x)), lambda f: bandpass(f, 520, 0.35) / (1 + (f / 1500) ** 4)) * np.exp(-x * 70)
    click /= np.abs(click).max() + 1e-9
    return thump * 0.9 + click * 0.18
steps = [f for f in np.arange(3.75, T["walk"][1], 7.5) if f >= 9]
for k, f in enumerate(steps):
    stepping = 1 - np.clip((f - (T["walk"][1] - 12)) / 12, 0, 1)
    nearness = min(1, 0.45 + 0.18 * k)
    pan = 0.62 - 0.45 * (k / max(1, len(steps) - 1)) + (0.06 if k % 2 else -0.06)
    place(footstep(), t(f), pan=pan, gain=0.32 * nearness * (0.35 + 0.65 * stepping))

# --- C. Climbing into bed: an airy whoosh as the head arcs over to the pillow, plus a soft lift.
c0, c1 = t(T["climb"][0]), t(T["climb"][1])
whoosh = sweep_noise(c1 - c0 + 0.3, [380, 1200, 1700, 600])
whoosh *= np.sin(np.linspace(0, np.pi, len(whoosh))) ** 2
place_panned(whoosh, c0, np.linspace(0.25, -0.35, len(whoosh)), gain=0.22)

def bell(freq, seconds=1.8, partials=((1, 1), (2.0, 0.28), (3.0, 0.09), (4.2, 0.06)), decay=2.6):
    x = time(seconds)
    v = sum(a * np.sin(2 * np.pi * freq * r * x) * np.exp(-x * decay * (1 + 0.6 * (r - 1))) for r, a in partials)
    return v * adsr(len(x), 0.003, 0.05)
for k, note in enumerate(["D5", "F#5", "A5"]):
    place(bell(hz(note), 1.4), t(T["climb"][0] + 3 + k * 5), pan=0.2 - k * 0.2, gain=0.05)

# --- D. Tucking in: a soft fabric rustle as the blanket draws over.
k0, k1 = t(T["tuck"][0]), t(T["tuck"][1])
rustle = sweep_noise(k1 - k0, [1500, 2300, 1300], 0.4)
flutter = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * np.cumsum(rng.uniform(14, 30, len(rustle))) / SR))
rustle *= flutter * np.sin(np.linspace(0, np.pi, len(rustle))) ** 1.5
place(rustle, k0, pan=0.15, gain=0.09)

# --- E. Sleeping and charging: a music-box lullaby that climbs with the charge (8% -> 100%).
lullaby = [(102, "D5"), (109, "F#5"), (116, "A5"), (123, "F#5"), (130, "E5"), (137, "A5"), (144, "B5"), (151, "D6"), (157, "E6")]
for k, (f, note) in enumerate(lullaby):
    place(bell(hz(note), 1.6, decay=2.2), t(f), pan=(-0.25, 0.25)[k % 2], gain=0.085 + 0.004 * k)
# A soft charging riser underneath, gliding up an octave as the battery fills.
seg = charge_e - charge_s
x = time(seg)
glide = hz("D4") * 2 ** (np.linspace(0, 1, len(x)) ** 1.6)
riser = np.sin(2 * np.pi * np.cumsum(glide) / SR) + 0.3 * np.sin(2 * np.pi * np.cumsum(glide * 2) / SR)
riser *= np.linspace(0, 1, len(x)) ** 2 * adsr(len(x), 0.3, 0.08)
place(riser, charge_s, gain=0.03)
# The floating z's: three tiny rising blips while asleep.
def blip(freq):
    x = time(0.22)
    f = freq * (1 + 0.35 * x / 0.22)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 16) * adsr(len(x), 0.004, 0.03)
for i in range(3):
    place(blip(hz("A5") * (1 + 0.12 * i)), t(T["tuck"][1] + i * 9), pan=-0.35 + 0.15 * i, gain=0.04)

# --- F. The bolt: an electric sparkle as it draws, then the "fully charged" chime on its pulse.
b0, b1 = t(T["bolt"][0]), t(T["bolt"][1])
x = time(b1 - b0 + 0.1)
zap = np.sin(2 * np.pi * 1400 * x + 5 * np.exp(-x * 9) * np.sin(2 * np.pi * 3600 * x)) * np.exp(-x * 9)
crackle = np.where(rng.random(len(x)) > 0.9965, rng.uniform(-1, 1, len(x)), 0)
crackle = spectral(crackle, lambda f: bandpass(f, 3800, 0.35))
place(zap * 0.6 + crackle * 0.3, b0, pan=0.12, gain=0.06)
chime = sum(bell(hz(n), 3.2, partials=((1, 1), (2.76, 0.32), (5.4, 0.14), (8.93, 0.05)), decay=1.25) for n in ("D6", "F#6", "A6"))
place(chime, t(T["bolt"][1]), pan=0.1, gain=0.075)
x = time(0.5)
place(np.sin(2 * np.pi * 55 * x) * np.exp(-x * 7), t(T["bolt"][1]), gain=0.16)  # warm low thump under the pulse

# --- G. The scene settles into the logo: a warm swell, and the ring draws on a gentle rising tone.
m0, m1 = t(T["morph"][0]), t(T["morph"][1])
swell = sweep_noise(m1 - m0 + 0.2, [220, 600, 1300])
swell *= np.linspace(0, 1, len(swell)) ** 2.2 * adsr(len(swell), 0.01, 0.25)
place(swell, m0, gain=0.2)
r0, r1 = t(T["ring"][0]), t(T["ring"][1])
x = time(r1 - r0 + 0.6)
ring_f = hz("A3") * 2 ** np.clip(x / (r1 - r0), 0, 1)
ring = np.sin(2 * np.pi * np.cumsum(ring_f) / SR) * adsr(len(x), 0.3, 0.5) * 0.7
place_panned(ring, r0, np.sin(np.linspace(0, 2 * np.pi, len(ring))) * 0.3, gain=0.05)

# --- H. RECHARGE: one soft pluck per letter, rising left to right, then a pop for the full stop.
def pluck(freq):
    x = time(0.9)
    v = np.sin(2 * np.pi * freq * x) * np.exp(-x * 6) + 0.25 * np.sin(2 * np.pi * freq * 3.9 * x) * np.exp(-x * 22)
    return v * adsr(len(x), 0.002, 0.05)
scale = ["D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6"]
for i, note in enumerate(scale):
    place(pluck(hz(note)), t(T["letters"] + i * 4 + 2), pan=-0.55 + i * (1.1 / 7), gain=0.07)
x = time(0.12)
pop = np.sin(2 * np.pi * np.cumsum(900 * np.exp(-x * 25) + 380) / SR) * np.exp(-x * 40)
place(pop, t(T["dot"] + 1), pan=0.55, gain=0.14)
place(bell(hz("A6"), 2.4, decay=1.6), t(T["dot"] + 1), pan=0.45, gain=0.045)

# --- J. After the intro: the bolt's gentle pulse and the sleeper's z's, as on the site.
place(bell(hz("D6"), 2.0, decay=1.8), t(T["intro_end"]), pan=-0.3, gain=0.035)
for start in (T["intro_end"] + 30, T["intro_end"] + 84):
    for i in range(3):
        place(blip(hz("A5") * (1 + 0.12 * i)), t(start + i * 9), pan=-0.4 + 0.15 * i, gain=0.03)

# --- Master: a small warm room, gentle glue, peak at -1 dBFS, fade to silence by the last frame.
def reverb_ir(seconds=2.4, seed=0):
    g = np.random.default_rng(seed)
    x = time(seconds)
    ir = g.standard_normal(len(x)) * np.exp(-x * 6.9 / seconds)
    ir = spectral(ir, lambda f: 1 / (1 + (f / 4500) ** 2))
    ir[: int(0.018 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2))
def convolve(a, b):
    n = len(a) + len(b)
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, size) * np.fft.rfft(b, size), size)[: len(a)]
wetL, wetR = convolve(L, reverb_ir(seed=1)), convolve(R, reverb_ir(seed=2))
outL, outR = L + 0.32 * wetL, R + 0.32 * wetR
fade = np.ones(N)
fade[int(10.6 * SR):] = np.linspace(1, 0, N - int(10.6 * SR)) ** 1.5
outL, outR = outL * fade, outR * fade
peak = max(np.abs(outL).max(), np.abs(outR).max())
stereo = np.stack([outL, outR], axis=1) / peak * 10 ** (-3 / 20)

os.makedirs("public/sound", exist_ok=True)
raw = "public/sound/.recharge-intro-raw.wav"
with wave.open(raw, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())
# Gentle, consistent loudness for social playback: -16 LUFS integrated, true peak -1.5 dBTP.
import subprocess
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true",
                "-ar", str(SR), "-c:a", "pcm_s16le", "public/sound/recharge-intro.wav"], check=True)
os.remove(raw)
# A compressed copy for the website (the videos are rendered from the WAV master).
# MP3 plays in every browser, including builds without AAC.
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "public/sound/recharge-intro.wav", "-c:a", "libmp3lame", "-b:a", "192k",
                "public/sound/recharge-intro.mp3"], check=True)
print("public/sound/recharge-intro.wav and .mp3 written (-16 LUFS, -1.5 dBTP)")
