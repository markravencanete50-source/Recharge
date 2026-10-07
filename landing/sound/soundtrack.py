"""Recharge intro score, synthesised and locked to the landing animation.

Picture and sound share one timeline (src/timeline.json) on a 120 bpm grid: a beat
is 15 frames, a footstep 7.5. So every sound lands on the motion it belongs to:

  0-2 s    Heading home   a warm electric-piano groove; the footsteps are the hi-hats,
                          panned with the walker and closer with every step
  2 s      The bag drops by the bed on beat four
  2-3.5 s  Settling in    sheets, a sigh as they lie back, the blanket rustle,
                          and the lamp switch as the last snare: then the room goes quiet
  3.5-6 s  Recharging     a music-box arpeggio that climbs with the charge, one ping per
                          charging ripple (D, F#, A, C#) and a riser into...
  6 s      Fully charged  the tonic: bell, low boom and the full chord with the flash
  6.5-7.6 s               a harp run that travels round with the ring as it draws
  7.5-8.5 s RECHARGE.     one pluck per letter, left to right, and a pop for the full stop
  9 s ->   The logo idles an 8-second loop: the bolt's pulse chimes, the z's hum, and
                          the letters' wave plays back as a run of plucks

Output: one 26-second file. 0-9 s is the intro; from 9 s the loop repeats, and
17-25 s is one exact period, so the website can loop it with no gap or seam
(see src/main.tsx). The Instagram videos use the first 12 seconds.

Needs numpy and scipy.  Run: npm run soundtrack
"""
import json
import os
import subprocess
import wave

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d

SR = 48_000
TL = json.load(open(os.path.join(os.path.dirname(__file__), "..", "src", "timeline.json")))
FPS = TL["fps"]
BEAT = TL["beat"] / FPS  # 0.5 s
LOOP_START = TL["introEnd"] / FPS  # 9 s
LOOP = 2 * TL["cycle"] / FPS  # 8 s: two idle cycles (the letters wave every other one)
LENGTH = LOOP_START + 2 * LOOP + 1.0  # 26 s
N = int(SR * LENGTH)
rng = np.random.default_rng(7)

def f(frame):
    return frame / FPS

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
def midi(note):
    return NOTE[note[:-1]] + 12 * (int(note[-1]) + 1)
def hz(note):
    return 440.0 * 2 ** ((midi(note) - 69) / 12) if isinstance(note, str) else 440.0 * 2 ** ((note - 69) / 12)

def time(seconds):
    return np.arange(int(seconds * SR)) / SR

def env(n, attack=0.005, release=0.05):
    e = np.ones(n)
    a, r = min(n, int(attack * SR)), min(n, int(release * SR))
    if a:
        e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r:
        e[n - r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return e

# --- Buses -----------------------------------------------------------------------------
class Bus:
    def __init__(self, send):
        self.L, self.R, self.send = np.zeros(N), np.zeros(N), send
    def place(self, signal, start, pan=0.0, gain=1.0):
        """Mix a mono signal in at `start` seconds; pan -1 (left) .. 1 (right), constant power.
        `pan` may be an array (a moving source)."""
        i = int(round(start * SR))
        if i >= N or i < 0:
            return
        s = signal[: N - i] * gain
        angle = (np.asarray(pan if np.isscalar(pan) else pan[: len(s)]) + 1) * np.pi / 4
        self.L[i:i + len(s)] += s * np.cos(angle)
        self.R[i:i + len(s)] += s * np.sin(angle)

keys, pads, bass, drums, foley, chimes = (Bus(s) for s in (0.22, 0.38, 0.0, 0.08, 0.12, 0.42))

# --- Filters ---------------------------------------------------------------------------
def stft_filter(x, gain_fn, n=2048):
    """Time-varying filter: gain_fn(seconds[:, None], hz[None, :]) -> gains per frame and bin."""
    hop = n // 4
    xp = np.concatenate([np.zeros(n), x, np.zeros(n)])
    win = np.hanning(n + 1)[:-1]
    frames = 1 + (len(xp) - n) // hop
    out = np.zeros(len(xp))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    for start in range(0, frames, 256):
        idx = np.arange(start, min(frames, start + 256))
        seg = xp[idx[:, None] * hop + np.arange(n)[None, :]] * win
        spec = np.fft.rfft(seg, axis=1) * gain_fn(((idx * hop + n / 2 - n) / SR)[:, None], freqs[None, :])
        y = np.fft.irfft(spec, n, axis=1) * win
        for k, i in enumerate(idx):
            out[i * hop:i * hop + n] += y[k]
    return out[n:n + len(x)] / 1.5

def lowpass(fq, cutoff, resonance=0.0):
    ratio = np.maximum(fq, 1) / cutoff
    return 1 / np.sqrt(1 + ratio ** 4) * (1 + resonance * np.exp(-np.log2(ratio) ** 2 / 0.08))

def band(fq, centre, width=0.5):
    return np.exp(-0.5 * (np.log2(np.maximum(fq, 1) / centre) / width) ** 2)

def shaped_noise(seconds, gain_fn, seed=None):
    g = rng if seed is None else np.random.default_rng(seed)
    x = stft_filter(g.standard_normal(int(seconds * SR)), gain_fn, 1024)
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-9)

# --- Instruments -----------------------------------------------------------------------
def epiano(freq, dur, vel=0.7):
    """FM electric piano: a 1:1 body with a decaying index, plus a short metallic tine."""
    x = time(dur + 0.35)
    index = (0.5 + 1.6 * vel) * np.exp(-x * 4.5) + 0.2 * vel
    body = np.sin(2 * np.pi * freq * x + index * np.sin(2 * np.pi * freq * x))
    tine = np.sin(2 * np.pi * freq * 7 * x) * np.exp(-x * 45) * 0.16 * vel if freq * 7 < 14000 else 0
    amp = np.exp(-x * (0.9 + freq / 700))
    hold = np.where(x < dur, 1.0, np.exp(-(x - dur) * 14))
    return (body + tine) * amp * hold * env(len(x), 0.002, 0.02) * (0.4 + 0.6 * vel)

def saw(freq, seconds, phase=0.0):
    """Band-limited sawtooth (polyBLEP)."""
    dt = freq / SR
    p = (phase + dt * np.arange(int(seconds * SR))) % 1.0
    y = 2 * p - 1
    lo, hi = p < dt, p > 1 - dt
    t1, t2 = p[lo] / dt, (p[hi] - 1) / dt
    y[lo] -= t1 + t1 - t1 * t1 - 1
    y[hi] -= t2 * t2 + t2 + t2 + 1
    return y

def pad_chord(notes, start, dur, bus, gain, seed):
    g = np.random.default_rng(seed)
    for i, note in enumerate(notes):
        fr = hz(note)
        v = sum(saw(fr * 2 ** (c / 1200), dur + 1.2, g.random()) for c in (-9, 0, 8)) / 3
        v += 0.5 * np.sin(2 * np.pi * fr / 2 * np.arange(len(v)) / SR)  # a little body underneath
        e = env(len(v), 0.35, 1.1)
        bus.place(v * e, start, pan=(i / max(1, len(notes) - 1) - 0.5) * 0.7, gain=gain)

def bass_note(note, start, dur, gain=1.0):
    fr = hz(note)
    x = time(dur + 0.12)
    v = np.sin(2 * np.pi * fr * x) + 0.22 * np.sin(4 * np.pi * fr * x) + 0.06 * np.sin(6 * np.pi * fr * x)
    v = np.tanh(1.4 * v) / np.tanh(1.4)
    a = np.exp(-x * 1.4) * 0.6 + 0.4
    bass.place(v * a * env(len(x), 0.006, 0.1), start, gain=gain)

def string(freq, dur=2.2, bright=0.55, position=0.18):
    """Plucked string (harp-like): additive partials, the higher ones dying faster."""
    x = time(dur)
    out = np.zeros(len(x))
    for k in range(1, 40):
        if freq * k > 11000:
            break
        a = abs(np.sin(np.pi * k * position)) / k ** (2.2 - bright)
        out += a * np.sin(2 * np.pi * freq * k * (1 + 0.0004 * k * k) * x) * np.exp(-x * (1.1 + 0.05 * k * k * (freq / 440)))
    return out / 1.2 * env(len(x), 0.001, 0.05)

def musicbox(freq, dur=1.6):
    x = time(dur)
    v = np.sin(2 * np.pi * freq * x) * np.exp(-x * 2.6) + 0.35 * np.sin(2 * np.pi * freq * 3 * x) * np.exp(-x * 7)
    v += 0.18 * np.sin(2 * np.pi * freq * 5.4 * x) * np.exp(-x * 20)
    return v * env(len(x), 0.001, 0.05)

def bell(freq, dur=3.0, index=3.0, ratio=1.4, decay=1.3):
    x = time(dur)
    i = index * np.exp(-x * 2.5) + 0.3
    v = np.sin(2 * np.pi * freq * x + i * np.sin(2 * np.pi * freq * ratio * x)) * np.exp(-x * decay)
    v += 0.4 * np.sin(2 * np.pi * freq * 2 * x) * np.exp(-x * decay * 2)
    return v * env(len(x), 0.001, 0.1)

def kick(gain=1.0, seed=0):
    x = time(0.5)
    pitch = 46 + 80 * np.exp(-x * 30)
    v = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-x * 7.5)
    click = shaped_noise(0.01, lambda t, fq: lowpass(fq, 2500), seed) * 0.15
    v[: len(click)] += click * np.linspace(1, 0, len(click))
    return v * gain

def hat(open_=False, seed=0):
    d = 0.2 if open_ else 0.05
    v = shaped_noise(d, lambda t, fq: (fq > 6500) * band(fq, 9500, 0.8), seed)
    return v * np.exp(-time(d) * (14 if open_ else 70))

def rim(seed=0):
    x = time(0.12)
    v = shaped_noise(0.12, lambda t, fq: band(fq, 1900, 0.5), seed) * np.exp(-x * 55)
    return v * 0.7 + np.sin(2 * np.pi * 420 * x) * np.exp(-x * 60) * 0.5

def footstep(seed, weight=1.0):
    """A shoe on a wooden floor: heel, then the ball of the foot a moment later."""
    g = np.random.default_rng(seed)
    x = time(0.22)
    thud = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-x * 40)) / SR) * np.exp(-x * 32)
    heel = shaped_noise(0.22, lambda t, fq: band(fq, g.uniform(600, 900), 0.9) * lowpass(fq, 3000), seed) * np.exp(-x * 60)
    toe = shaped_noise(0.22, lambda t, fq: band(fq, g.uniform(1400, 2200), 0.8), seed + 1) * np.exp(-np.maximum(x - 0.045, 0) * 80) * (x > 0.045)
    return (thud * 0.9 * weight + heel * 0.35 + toe * 0.16) * g.uniform(0.85, 1.05)

def swell(seconds, centres, width=0.6, seed=None):
    """Noise whose band glides through `centres` over its length, faded in and out."""
    pos = np.linspace(0, seconds, len(centres))
    v = shaped_noise(seconds, lambda t, fq: band(fq, np.interp(t, pos, centres), width), seed)
    return v * np.sin(np.linspace(0, np.pi, len(v))) ** 2

# --- Where the walker is (mirrors src/Intro.tsx), for distance and panning -------------------
STEP = 2 * 116 * np.sin(np.radians(22))
SPEED = STEP / TL["stride"]
STOP = TL["walk"][1]
SLOW = STOP - 2 * TL["stride"]
def walker_x(frame):
    if frame <= SLOW:
        s = SPEED * frame
    else:
        u = min(frame, STOP) - SLOW
        s = SPEED * (SLOW + u - u * u / (2 * (STOP - SLOW)))
    return 340 + SPEED * (SLOW + (STOP - SLOW) / 2) - s
screen_pan = lambda x: float(np.clip((x - 177) / 900, -0.6, 0.7))

# =======================================================================================
# The intro (0-9 s)

# Chords: Gmaj9 (walking home) | F#m7 Bm7 (settling) | lamp off: Em9 A7sus4 A7 (night,
# charging) | D (fully charged) Gmaj9/D D (dawn and the logo).
chords = [
    (0.0, 2.0, ["G3", "B3", "D4", "F#4", "A4"]),
    (2.0, 1.0, ["F#3", "A3", "C#4", "E4"]),
    (3.0, 0.5, ["B3", "D4", "F#4", "A4"]),
    (3.5, 1.5, ["E3", "G3", "B3", "D4", "F#4"]),
    (5.0, 0.5, ["A3", "D4", "E4", "G4"]),
    (5.5, 0.5, ["A3", "C#4", "E4", "G4"]),
    (6.0, 1.0, ["D3", "A3", "C#4", "E4", "F#4", "A4"]),
    (7.0, 1.0, ["D3", "G3", "B3", "F#4", "A4"]),
    (8.0, 1.2, ["D3", "A3", "C#4", "E4", "F#4"]),
]
intro_pads = Bus(0)
for k, (start, dur, notes) in enumerate(chords):
    pad_chord(notes, start, dur, intro_pads, 0.05, k)
# Warm in the evening; the filter shuts with the lamp, opens as the charge rises, and is
# brightest at the flash.
cut_t = [0, 3.45, 3.56, 4.2, 6.0, 6.3, 9.5]
cut_v = [1700, 1900, 420, 600, 3200, 5200, 2600]
for side in ("L", "R"):
    filtered = stft_filter(getattr(intro_pads, side), lambda t, fq: lowpass(fq, np.interp(t, cut_t, cut_v), 0.6))
    getattr(pads, side)[:] += filtered

# Electric piano: the groove while walking in, silent at night, back for the dawn.
ep_hits = [
    (0.0, 0.6, ["B3", "D4", "F#4", "A4"], 0.7), (0.75, 0.45, ["B3", "D4", "F#4", "A4"], 0.5), (1.5, 0.4, ["A3", "D4", "F#4"], 0.55),
    (1.75, 0.2, ["B3", "D4", "G4"], 0.4),
    (2.0, 0.55, ["A3", "C#4", "E4"], 0.65), (2.75, 0.25, ["A3", "C#4", "E4"], 0.45), (3.0, 0.45, ["A3", "D4", "F#4"], 0.55),
    (6.0, 1.0, ["D4", "F#4", "A4", "C#5", "E5"], 0.8), (7.0, 0.95, ["D4", "G4", "B4", "F#5"], 0.6), (8.0, 1.4, ["D4", "F#4", "A4", "C#5", "E5"], 0.55),
]
for start, dur, notes, vel in ep_hits:
    for i, note in enumerate(notes):
        keys.place(epiano(hz(note), dur, vel), start + i * 0.006, pan=-0.25 + 0.5 * i / len(notes), gain=0.07)
# Over the walk, a short melody on top: the "heading home" hook.
for start, note, dur in [(0.25, "F#5", 0.2), (0.5, "A5", 0.25), (1.0, "E5", 0.2), (1.25, "D5", 0.4), (2.25, "C#5", 0.2), (2.5, "E5", 0.4)]:
    keys.place(epiano(hz(note), dur, 0.55), start, pan=0.15, gain=0.06)

for note, start, dur, g in [("G2", 0.0, 0.7, 1.0), ("G2", 0.75, 0.55, 0.8), ("D2", 1.5, 0.45, 0.9), ("F#2", 2.0, 0.7, 1.0), ("F#2", 2.75, 0.2, 0.7),
                            ("B1", 3.0, 0.45, 0.9), ("E2", 4.0, 0.9, 0.55), ("A1", 5.0, 0.95, 0.65), ("D2", 6.0, 0.95, 1.1),
                            ("D2", 7.0, 0.95, 0.9), ("D2", 8.0, 1.0, 0.9)]:
    bass_note(note, start, dur, 0.16 * g)

for start, g in [(0.0, 0.5), (0.75, 0.38), (2.0, 0.5), (2.75, 0.38), (6.0, 0.9), (8.0, 0.4)]:
    drums.place(kick(seed=int(start * 10)), start, gain=g * 0.5)
for start in (0.5, 1.5, 2.5):
    drums.place(rim(int(start * 10)), start, pan=0.1, gain=0.09)
for k, start in enumerate([2.25, 2.75, 3.25]):
    drums.place(hat(seed=40 + k), start, pan=0.3, gain=0.05)

# Footsteps on the walker's contacts, closer and more central with each step; the last
# one (feet together) is soft.
contacts = [k * TL["stride"] for k in range(7)] + [STOP]
for k, frame in enumerate(contacts):
    x = walker_x(frame)
    near = 1 - min(1.0, (x - 340) / 760)
    weight = 0.55 if frame == STOP else 1.0
    foley.place(footstep(100 + k, weight), f(frame), pan=screen_pan(x) + (0.04 if k % 2 else -0.04), gain=(0.16 + 0.2 * near) * weight)

# The bag lands by the bed on beat four.
x = time(0.35)
bag = np.sin(2 * np.pi * np.cumsum(55 + 50 * np.exp(-x * 30)) / SR) * np.exp(-x * 20)
bag += shaped_noise(0.35, lambda t, fq: band(fq, 450, 0.8), 11) * np.exp(-x * 25) * 0.4
foley.place(bag, f(STOP), pan=screen_pan(350), gain=0.3)

# Climbing on: the mattress gives, the sheets move.
foley.place(swell(0.5, [260, 520, 300], 0.7, 12), f(TL["climb"][0]) + 0.05, pan=0.2, gain=0.08)
foley.place(swell(0.45, [2400, 3600, 2200], 0.6, 13), f(TL["climb"][0]) + 0.12, pan=0.15, gain=0.035)
# Lying back: a long, contented breath out.
x = time(0.9)
breath = shaped_noise(0.9, lambda t, fq: (band(fq, 650, 0.45) + 0.7 * band(fq, 1150, 0.4) + 0.25 * band(fq, 2600, 0.5)), 14)
foley.place(breath * np.sin(np.pi * np.minimum(x / 0.9, 1)) ** 1.5 * np.exp(-x * 1.2), f(TL["lie"][0]) + 0.05, pan=-0.15, gain=0.05)
# The blanket.
x = time(f(TL["tuck"][1] - TL["tuck"][0]) + 0.15)
crinkle = shaped_noise(len(x) / SR, lambda t, fq: band(fq, 3000, 0.9), 15)
crinkle *= (0.5 + 0.5 * np.abs(np.sin(np.cumsum(np.random.default_rng(16).uniform(60, 190, len(x))) / SR * 2 * np.pi)))
foley.place(crinkle * np.sin(np.linspace(0, np.pi, len(x))) ** 1.2, f(TL["tuck"][0]), pan=np.linspace(-0.05, 0.3, len(x)), gain=0.045)

# The lamp switch, as the last snare of the groove.
x = time(0.08)
click = shaped_noise(0.08, lambda t, fq: band(fq, 4200, 0.7), 17) * np.exp(-x * 160) + np.sin(2 * np.pi * 1250 * x) * np.exp(-x * 90) * 0.4
foley.place(click, f(TL["lamp"]) - 0.012, pan=-0.55, gain=0.16)
foley.place(click * 0.6, f(TL["lamp"]) + 0.03, pan=-0.55, gain=0.12)

# Recharging: a music-box arpeggio climbing from D4 to D6 with the charge.
night = [(3.5, ["E", "G", "B", "D", "F#"]), (5.0, ["A", "D", "E", "G"]), (5.5, ["A", "C#", "E", "G"])]
def chord_tones(names):
    return sorted(m for m in range(50, 100) if any(m % 12 == NOTE[n] for n in names))
t0, t1 = f(TL["lamp"]) + 0.25, f(TL["flash"]) - 0.125
for k, start in enumerate(np.arange(t0, t1 + 1e-6, BEAT / 4)):
    names = [c for s, c in night if s <= start][-1]
    floor = np.interp(start, [t0, t1], [62, 86])
    tones = chord_tones(names)
    first = next(i for i, m in enumerate(tones) if m >= floor)
    note = tones[min(len(tones) - 1, first + k % 4)]
    level = np.interp(start, [t0, t1], [0.45, 1.0])
    chimes.place(musicbox(hz(note), 1.2), start, pan=(-0.3, 0.3)[k % 2], gain=0.05 * level)
# One ping per charging ripple, rising to the leading tone, plus a soft heartbeat underneath.
for frame, note in zip(TL["pulses"], ["D5", "F#5", "A5", "C#6"]):
    chimes.place(bell(hz(note), 2.0, index=1.6, ratio=2.0, decay=1.8), f(frame), pan=0.12, gain=0.07)
    x = time(0.3)
    bass.place(np.sin(2 * np.pi * 52 * x) * np.exp(-x * 14), f(frame), gain=0.2)
# The z's: a sleepy hum that rises with each z.
def hum(note):
    x = time(0.5)
    fr = hz(note) * (1 - 0.03 * x)
    v = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(fr) / SR)
    return v * np.sin(np.pi * np.minimum(x / 0.45, 1)) ** 2
for group in TL["zs"]:
    for i, note in enumerate(["B4", "D5", "F#5"]):
        chimes.place(hum(note), f(group + i * TL["stride"]), pan=-0.25 + 0.1 * i, gain=0.02)
# The riser into 100%.
rise = f(TL["flash"]) - 1.0
x = time(1.0)
riser = shaped_noise(1.0, lambda t, fq: band(fq, 700 * 2 ** (np.clip(t, 0, 1) * 3.3), 0.7), 18) * np.exp((x - 1) * 3.5)
foley.place(riser * env(len(x), 0.2, 0.01), rise, pan=np.linspace(-0.3, 0.3, len(x)), gain=0.07)

# 100%: the flash.
flash = f(TL["flash"])
x = time(1.4)
boom = np.sin(2 * np.pi * np.cumsum(42 + 70 * np.exp(-x * 9)) / SR) * np.exp(-x * 3)
bass.place(boom, flash, gain=0.36)
for note, pan in [("D6", -0.2), ("F#6", 0.2), ("A6", 0.0)]:
    chimes.place(bell(hz(note), 3.5, index=2.4, ratio=1.4, decay=1.0), flash, pan=pan, gain=0.05)
x = time(2.5)
crash = shaped_noise(2.5, lambda t, fq: (fq > 3500) * band(fq, 8000, 1.0), 19) * np.exp(-x * 2.2) * env(len(x), 0.004, 0.2)
drums.place(crash, flash, pan=0.15, gain=0.05)

# Dawn: a harp run that travels round with the ring as it draws (top, right, bottom, left).
run = ["A3", "B3", "D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6", "A6"]
r0, r1 = f(TL["ring"][0]), f(TL["ring"][1])
for i, note in enumerate(run):
    keys.place(string(hz(note), 2.0, 0.6), r0 + (r1 - r0) * i / len(run), pan=0.7 * np.sin(2 * np.pi * i / len(run)), gain=0.065)
foley.place(swell(1.3, [300, 900, 2200], 0.8, 20), f(TL["morph"][0]), gain=0.05)

# RECHARGE: a pluck as each letter lands, panned to where it sits; then the full stop.
letters = json.load(open(os.path.join(os.path.dirname(__file__), "..", "src", "letters.json")))
for i, note in enumerate(["A4", "D5", "E5", "F#5", "A5", "F#5", "E5", "A5"]):
    l = letters[i]
    pan = ((l["x"] + l["w"] / 2) / 1818 - 0.5) * 1.2
    keys.place(string(hz(note), 2.2, 0.7), f(TL["letters"] + i * TL["letterStep"]), pan=pan, gain=0.085)
dot = f(TL["dot"])
x = time(0.12)
pop = np.sin(2 * np.pi * np.cumsum(380 + 900 * np.exp(-x * 30)) / SR) * np.exp(-x * 40)
foley.place(pop, dot, pan=0.6, gain=0.13)
chimes.place(bell(hz("D6"), 3.0, index=1.5, ratio=2.0, decay=1.2), dot, pan=0.5, gain=0.06)
keys.place(string(hz("D5"), 2.5, 0.6), dot, pan=0.5, gain=0.06)
# COMING SOON: a faint sparkle as each letter appears.
text = "Coming soon"
for i, c in enumerate(text):
    if c == " ":
        continue
    start = f(TL["soon"][0] + (i / len(text)) * 0.85 * (TL["soon"][1] - TL["soon"][0]) + 2)
    chimes.place(musicbox(hz(["D7", "E7", "F#7", "A7", "B7"][i % 5]), 0.8), start, pan=-0.4 + 0.8 * i / len(text), gain=0.012)

# =======================================================================================
# The idle loop (8 s from 9 s): Dmaj9 | Bm9 | Gmaj9 | A6sus4, quiet enough to sit under the page.
def idle_loop(at):
    seed = 1000
    for k, (start, notes, root) in enumerate([(0, ["D3", "A3", "C#4", "E4", "F#4"], "D2"), (2, ["B3", "D4", "F#4", "A4", "C#5"], "B1"),
                                              (4, ["G3", "B3", "D4", "F#4", "A4"], "G1"), (6, ["A3", "D4", "E4", "F#4", "B4"], "A1")]):
        pad_chord(notes, at + start, 2.0, idle_pads, 0.038, seed + k)
        for hit, dur, vel in ((0, 0.7, 0.5), (0.75, 0.35, 0.35), (1.5, 0.4, 0.3)):
            for i, note in enumerate(notes[1:]):
                keys.place(epiano(hz(note), dur, vel), at + start + hit + i * 0.006, pan=-0.25 + 0.5 * i / 4, gain=0.05)
        bass_note(root, at + start, 1.3, 0.11)
        bass_note(root, at + start + 1.5, 0.4, 0.07)
        drums.place(kick(seed=seed + k), at + start, gain=0.16)
        drums.place(rim(seed + k), at + start + 1.0, pan=0.1, gain=0.05)
        for h in range(4):
            drums.place(hat(seed=seed + 10 * k + h), at + start + 0.25 + h * 0.5, pan=0.3, gain=0.03)
    # The bolt's pulse at the start of each cycle.
    for c, note in ((0, "D6"), (4, "B5")):
        chimes.place(bell(hz(note), 2.5, index=1.4, ratio=2.0, decay=1.5), at + c, pan=0.15, gain=0.045)
        for zgroup in TL["idleZs"]:
            for i, zn in enumerate(["B4", "D5", "F#5"]):
                chimes.place(hum(zn), at + c + f(zgroup + i * TL["stride"]), pan=-0.3 + 0.1 * i, gain=0.016)
    # The letters' wave (second cycle): a pluck as each letter peaks.
    for i, note in enumerate(["B4", "D5", "F#5", "A5", "B5", "A5", "F#5", "D5"]):
        l = letters[i]
        keys.place(string(hz(note), 1.8, 0.5), at + 4 + f(TL["beat"] + i * TL["letterStep"]), pan=((l["x"] + l["w"] / 2) / 1818 - 0.5) * 1.2, gain=0.045)

idle_pads = Bus(0)
for k in range(3):
    idle_loop(LOOP_START + k * LOOP)
for side in ("L", "R"):
    getattr(pads, side)[:] += stft_filter(getattr(idle_pads, side), lambda t, fq: lowpass(fq, 2300, 0.4))

# =======================================================================================
# Mix: a soft room reverb on the sends, gentle movement on the keys, then the master.
def reverb_ir(seconds, seed):
    g = np.random.default_rng(seed)
    x = time(seconds)
    ir = g.standard_normal(len(x)) * np.exp(-x * 6.9 / seconds)
    ir = stft_filter(ir, lambda t, fq: lowpass(fq, 5200 * np.exp(-np.maximum(t, 0) * 1.2) + 600), 1024)
    ir[: int(0.022 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2))
def convolve(a, b):
    n = len(a) + len(b)
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, size) * np.fft.rfft(b, size), size)[: len(a)]

wobble = 0.12 * np.sin(2 * np.pi * 4.0 * np.arange(N) / SR)  # tremolo pan, 4 Hz = eighth notes
keys.L, keys.R = keys.L * (1 - wobble), keys.R * (1 + wobble)
buses = (keys, pads, bass, drums, foley, chimes)
dryL, dryR = sum(b.L for b in buses), sum(b.R for b in buses)
sendL, sendR = sum(b.L * b.send for b in buses), sum(b.R * b.send for b in buses)
outL = dryL + 0.5 * convolve(sendL, reverb_ir(2.6, 1))
outR = dryR + 0.5 * convolve(sendR, reverb_ir(2.6, 2))
# Tidy the very low end.
outL, outR = (stft_filter(s, lambda t, fq: 1 / np.sqrt(1 + (32 / np.maximum(fq, 1)) ** 4)) for s in (outL, outR))

os.makedirs("public/sound", exist_ok=True)
def write(path, stereo):
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())

# Loudness: measure the intro, set it to -16 LUFS with one fixed gain, then a gentle peak
# limiter (local, so the loop stays an exact repeat).
stereo = np.stack([outL, outR], axis=1)
stereo /= np.abs(stereo).max()
probe = "public/sound/.probe.wav"
write(probe, stereo[: int(12 * SR)] * 0.5)
report = subprocess.run(["ffmpeg", "-hide_banner", "-i", probe, "-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
os.remove(probe)
measured = float(json.loads(report[report.rindex("{"):])["input_i"])
stereo *= 0.5 * 10 ** ((-16 - measured) / 20)
ceiling = 10 ** (-1.5 / 20)
# A peak envelope that never dips below the signal: an 8 ms running max, smoothed over 4 ms.
peak = uniform_filter1d(maximum_filter1d(np.abs(stereo).max(axis=1), int(0.008 * SR)), int(0.004 * SR))
stereo *= np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))[:, None]

write("public/sound/recharge.wav", stereo)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "public/sound/recharge.wav", "-c:a", "libmp3lame", "-b:a", "160k",
                "public/sound/recharge.mp3"], check=True)
a, b = int((LOOP_START + LOOP) * SR), int((LOOP_START + 2 * LOOP) * SR)
seam = np.abs(stereo[a:a + SR // 2] - stereo[b:b + SR // 2]).max()
print(f"public/sound/recharge.wav and .mp3 written: {LENGTH:.0f} s, intro {LOOP_START:.0f} s, loop {LOOP:.0f} s "
      f"(seam check {seam:.5f}, measured {measured:.1f} LUFS before gain)")
