"""Synthesise the film's music on a 120 bpm grid (every hit lands on a beat counted from frame 0) and mix it with the sound effects.

usage: python tools/make_music.py out/sfx.wav out/mix.wav
Key: C major.  Bars from beat 8:  C | G | Am | F  (repeats).  Sections follow the storyboard:
  beats 0-7   sparse (drone + shaker)        beats 24-30 groove + snare build
  beats 8-23  full groove                     beats 31-36 stripped (kick on LED blinks) + riser
  beats 37-41 chord stab, sparkle, pad, fade out
"""
import sys
import wave

import numpy as np
from numpy.fft import irfft, rfft, rfftfreq

SR = 44100
BPM = 120
BEAT = 60 / BPM
TOTAL_BEATS = 42
DUR = TOTAL_BEATS * BEAT
N = int((DUR + 2.0) * SR)
rng = np.random.default_rng(11)
M = np.zeros(N)      # drums (not ducked)
H = np.zeros(N)      # harmonic bus (ducked by the kick)


def add(bus, sig, t, gain=1.0):
    i = int(t * SR)
    n = min(len(sig), N - i)
    if n > 0 and i >= 0:
        bus[i:i + n] += sig[:n] * gain


def lp(x, fc, order=4):
    X = rfft(x)
    f = rfftfreq(len(x), 1 / SR)
    return irfft(X / (1 + (f / fc) ** order), len(x))


def hp(x, fc):
    return x - lp(x, fc, 2)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def kick(t, g=1.0):
    n = int(.32 * SR)
    tt = np.arange(n) / SR
    f = 46 + 110 * np.exp(-tt * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9) * (1 - np.exp(-tt * 900))
    add(M, x, t, .95 * g)
    add(M, rng.standard_normal(int(.006 * SR)) * .25, t, g)


def clap(t, g=1.0):
    for k, off in enumerate([0, .011, .022, .034]):
        n = int((.12 if k == 3 else .02) * SR)
        x = rng.standard_normal(n)
        x = hp(lp(x, 3800, 2), 900) * np.exp(-np.arange(n) / SR * (22 if k == 3 else 90))
        add(M, x, t + off, .32 * g)


def hat(t, g=1.0, open_=False):
    n = int((.16 if open_ else .035) * SR)
    x = hp(rng.standard_normal(n), 6500) * np.exp(-np.arange(n) / SR * (14 if open_ else 80))
    add(M, x, t, .13 * g)


def shaker(t, g=1.0):
    n = int(.05 * SR)
    x = hp(rng.standard_normal(n), 4500) * np.sin(np.pi * np.arange(n) / n) ** 2
    add(M, x, t, .10 * g)


def bass(t, midi_n, d=.22, g=1.0):
    n = int(d * SR)
    tt = np.arange(n) / SR
    f = midi(midi_n)
    x = np.sin(2 * np.pi * f * tt) + .45 * np.sin(2 * np.pi * 2 * f * tt) + .18 * np.sin(2 * np.pi * 3 * f * tt)
    x *= np.minimum(1, tt / .004) * np.exp(-tt * 5.5)
    add(H, x, t, .5 * g)


def pluck(t, midi_n, g=1.0, d=.45):
    n = int(d * SR)
    tt = np.arange(n) / SR
    f = midi(midi_n)
    x = sum(a * np.sin(2 * np.pi * f * k * tt) * np.exp(-tt * dec) for k, a, dec in [(1, 1, 6), (2, .5, 9), (3, .3, 12), (4, .15, 16)])
    x *= np.minimum(1, tt / .002)
    add(H, x, t, .17 * g)


def pad(t, notes, d, g=1.0):
    n = int(d * SR)
    tt = np.arange(n) / SR
    x = np.zeros(n)
    for m in notes:
        f = midi(m)
        for det in (-.07, 0, .07):
            ph = 2 * np.pi * f * (1 + det * .01) * tt
            x += (2 * ((ph / (2 * np.pi)) % 1) - 1) * .12   # detuned saws
    x = lp(x, 1400, 2)
    env = np.minimum(1, tt / .35) * np.minimum(1, (d - tt) / .6)
    add(H, x * env, t, .45 * g)


def stab(t, notes, g=1.0):
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    x = np.zeros(n)
    for m in notes:
        f = midi(m)
        for k, a in [(1, 1), (2, .45), (3, .25), (5, .12)]:
            x += a * np.sin(2 * np.pi * f * k * tt)
    x = lp(x, 5200, 2) * np.exp(-tt * 2.6) * np.minimum(1, tt / .002)
    add(H, x * .13, t, g)


def riser(t, d, g=.6):
    n = int(d * SR)
    tt = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 400) * (tt / d) ** 2.4
    x += np.sin(2 * np.pi * np.cumsum(np.geomspace(200, 1800, n)) / SR) * (tt / d) ** 2 * .35
    add(M, x * np.minimum(1, (d - tt) / .02), t, g * .5)


def snare(t, g=1.0):
    n = int(.2 * SR)
    tt = np.arange(n) / SR
    x = hp(lp(rng.standard_normal(n), 7000, 2), 700) * np.exp(-tt * 28) * .5 + np.sin(2 * np.pi * 185 * tt) * np.exp(-tt * 24) * .3
    add(M, x, t, g * .8)


CH = {"C": ([36, 43, 48, 52, 55, 60], [60, 64, 67, 72, 76]), "G": ([31, 38, 43, 47, 50, 55], [59, 62, 67, 71, 74]), "Am": ([33, 40, 45, 48, 52, 57], [57, 60, 64, 69, 72]), "F": ([29, 36, 41, 45, 48, 53], [57, 60, 65, 69, 72])}
PROG = ["C", "G", "Am", "F"]


def bar_chord(beat):
    if beat < 8:
        return "C"
    if beat >= 37:
        return "C"
    return PROG[((beat - 8) // 4) % 4]


ARP = {"C": [60, 64, 67, 72, 67, 64, 72, 76], "G": [59, 62, 67, 71, 67, 62, 71, 74], "Am": [57, 60, 64, 69, 64, 60, 69, 72], "F": [60, 65, 69, 72, 69, 65, 72, 77]}
ROOT = {"C": 36, "G": 31, "Am": 33, "F": 29}

# ---- arrangement (every event is on the grid: t = beat * BEAT, 8ths = beat + .5) ----
for b in range(0, TOTAL_BEATS):
    t = b * BEAT
    ch = bar_chord(b)
    sec = "intro" if b < 8 else "groove" if b < 31 else "strip" if b < 37 else "outro"
    if sec == "intro":
        if b in (0, 1):
            kick(t, .6)
        if b >= 2:
            shaker(t)
            shaker(t + BEAT / 2, .6)
        if b % 4 == 0:
            pad(t, CH["C"][1][:3], 4 * BEAT, .45)
    elif sec in ("groove",):
        kick(t, 1.0)
        hat(t + BEAT / 2, 1.0)
        if b % 2 == 1:
            clap(t)
        if b >= 12:
            hat(t, .5)
        for k in range(2):
            bass(t + k * BEAT / 2, ROOT[ch] + (12 if k and b % 2 else 0), .22)
        if b >= 12:
            for k in range(2):
                pluck(t + k * BEAT / 2, ARP[ch][((b % 4) * 2 + k) % 8], 1.0)
        if (b - 8) % 4 == 0:
            pad(t, CH[ch][1][:4], 4 * BEAT, .8)
        if b in (29, 30):
            for k in range(4):
                snare(t + k * BEAT / 4, .35 + .12 * (b - 29) + .06 * k)
    elif sec == "strip":
        if b in (32, 33, 34, 35):  # the LED blinks
            kick(t, .9)
        if (b - 32) % 4 == 0 or b == 31:
            pad(t, CH["Am"][1][:4], 4 * BEAT, .7)
        bass(t, ROOT["Am"], .4, .7) if b in (32, 34) else None
        if b == 31:
            riser(t, 5 * BEAT, .7)
    else:
        if b == 37:
            kick(t, 1.0)
            clap(t, .9)
            stab(t, [60, 64, 67, 71, 76], 1.0)
            stab(t, [48, 55], .8)
            pad(t, CH["C"][1], 5 * BEAT, .8)
        if b >= 38:
            for k in range(2):
                pluck(t + k * BEAT / 2, ARP["C"][((b - 37) * 2 + k) % 8] + 12, .55)
        if b in (39, 40):
            hat(t + BEAT / 2, .6)
            kick(t, .55)

# ---- sidechain: the harmonic bus ducks on every kick (beats 8-36 + the hit at 37) ----
duck = np.ones(N)
ts = np.arange(N) / SR
for b in list(range(8, 31)) + [32, 33, 34, 35, 37]:
    t0 = b * BEAT
    i0 = int(t0 * SR)
    seg = min(int(.4 * SR), N - i0)
    duck[i0:i0 + seg] *= 1 - .5 * np.exp(-np.arange(seg) / SR * 9)
H *= duck

music = M + H
music = np.tanh(music * 1.3) / np.tanh(1.3)
music *= .85

# ---- mix with the sound effects ----
def readwav(p):
    with wave.open(p) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, w.getnchannels()).astype(np.float64) / 32768
    return a


sfx = readwav(sys.argv[1] if len(sys.argv) > 1 else "out/sfx.wav")
n = max(len(sfx), N)
out = np.zeros((n, 2))
out[:len(sfx)] += sfx * 0.78
out[:N, 0] += music * .62
out[:N, 1] += music * .62
out = np.tanh(out * 1.1)
fade = np.ones(n)
fl = int(1.0 * SR)
end = int(DUR * SR)
fade[end - fl:end] = np.linspace(1, 0, fl)
fade[end:] = 0
out *= fade[:, None]
out = out[:end + int(.2 * SR)]
out = out / (np.max(np.abs(out)) + 1e-9) * .89
dst = sys.argv[2] if len(sys.argv) > 2 else "out/mix.wav"
with wave.open(dst, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", dst, f"{len(out) / SR:.1f}s")
