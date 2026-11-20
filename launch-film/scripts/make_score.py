"""Minimal ambient score for the Remotion film: soft piano arpeggios + low pad at 60 bpm (every cut is on a beat),
two soft UI clicks on the real capture's actions and one low pulse on the end card. Deterministic (seeded). -> public/score.wav"""
import wave

import numpy as np
from numpy.fft import irfft, rfft, rfftfreq

SR = 44100
DUR = 61
N = int((DUR + 2) * SR)
rng = np.random.default_rng(3)
L = np.zeros(N)
R = np.zeros(N)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def put(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    n = min(len(sig), N - i)
    if n <= 0 or i < 0:
        return
    L[i:i + n] += sig[:n] * gain * np.cos((pan + 1) * np.pi / 4)
    R[i:i + n] += sig[:n] * gain * np.sin((pan + 1) * np.pi / 4)


def lp(x, fc, order=2):
    X = rfft(x)
    f = rfftfreq(len(x), 1 / SR)
    return irfft(X / (1 + (f / fc) ** (2 * order)), len(x))


def piano(n, d=3.2, vel=.7, bright=1.0):
    t = np.arange(int(d * SR)) / SR
    f = midi(n)
    x = np.zeros_like(t)
    for k, a, dec in [(1, 1.0, 1.1), (2, .55, 1.6), (3, .32, 2.2), (4, .2, 3.0), (5, .1, 4.0), (6, .06, 5.0)]:
        det = 1 + (k * k) * 0.00004 * (1 if k % 2 else -1)
        x += a * np.sin(2 * np.pi * f * k * det * t + k) * np.exp(-dec * t * (1 + (f / 800) * .6))
    hammer = rng.standard_normal(len(t)) * np.exp(-t * 90) * .05
    x = (x + hammer) * np.minimum(1, t / .003) * vel
    return lp(x, 2600 * bright + 500)


_IR = None


def reverb(sig, mix=.35, tail=2.6):
    global _IR
    if _IR is None:
        n = int(tail * SR)
        ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 6.5, n))
        _IR = lp(ir, 3000)
    n = len(sig) + len(_IR)
    o = irfft(rfft(sig, n) * rfft(_IR, n), n)
    o /= np.max(np.abs(o)) + 1e-9
    out = np.zeros(n)
    out[:len(sig)] += sig * (1 - mix)
    out += o * mix * (np.max(np.abs(sig)) + 1e-9)
    return out


# bars of 4 beats at 60 bpm (4 s each): Cmaj7 | Am7 | Fmaj7 | G6
BARS = [
    ([48, 55], [64, 67, 71, 72, 71, 67, 64, 67]),   # Cmaj7: C3+G3 under E G B C B G E G
    ([45, 52], [64, 67, 69, 72, 69, 67, 64, 67]),   # Am7
    ([41, 48], [65, 67, 69, 72, 69, 67, 65, 67]),   # Fmaj7
    ([43, 50], [62, 67, 71, 74, 71, 67, 62, 67]),   # G6
]
bus = np.zeros(N)
nbars = int(DUR // 4) + 1
for b in range(nbars):
    t0 = b * 4.0
    bass, arp = BARS[b % 4]
    sparse = b < 1                      # first bar is just the bass: the cold open is quiet
    lvl = min(1.0, .45 + b * .06)       # builds slowly, never loud
    for j, nb in enumerate(bass):
        x = piano(nb, 4.2, .55 * lvl, .6)
        s = np.zeros(N)
        i = int((t0 + j * .02) * SR)
        s[i:i + len(x)] = x[:max(0, min(len(x), N - i))]
        bus += s
    if sparse:
        continue
    for k, nb in enumerate(arp):
        tt = t0 + k * .5                 # eighth notes (two per beat)
        if (b >= 3 and k % 2 == 1) or (b < 3 and k % 4 == 3):
            pass
        vel = (.34 + .12 * (k % 2 == 0)) * lvl
        x = piano(nb, 2.4, vel, 1.0)
        i = int(tt * SR)
        n = min(len(x), N - i)
        if n > 0:
            bus[i:i + n] += x[:n] * (1 if k % 2 == 0 else .8)

# pad (low, very quiet), 8 s → 56 s
tt = np.arange(N) / SR
pad = np.zeros(N)
for fm in (48, 55, 60, 64):
    pad += np.sin(2 * np.pi * midi(fm) * tt) * .05
pad *= np.clip((tt - 8) / 6, 0, 1) * np.clip((58 - tt) / 4, 0, 1)
pad *= .6 + .4 * np.sin(2 * np.pi * tt / 16)
bus += lp(pad, 900)

wet = reverb(bus[: int(DUR * SR)], .38, 2.4)
m = np.zeros(N)
m[: len(wet)] = wet[:N]
L += m * .9
R += m * .9

# soft UI clicks on the real capture's actions (rename click, flash state flips to ready)
def click(t, g=1.0):
    n = int(.05 * SR)
    tt_ = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 1500 * tt_) * .6 + rng.standard_normal(n) * .25) * np.exp(-tt_ * 90)
    x = lp(x, 4500)
    put(x * .22 * g, t, .05)
click(21.05)
click(25.42, .8)
# gentle low pulse as the end card lands
n = int(3.2 * SR)
tt_ = np.arange(n) / SR
put(np.sin(2 * np.pi * np.cumsum(55 + 30 * np.exp(-tt_ * 3)) / SR) * np.exp(-tt_ * 1.1) * .22, 56.0)

out = np.stack([L, R], 1)
out = np.tanh(out * 1.2)
fade = np.ones(N)
f0, f1 = int(.8 * SR), int(2.0 * SR)
fade[:f0] = np.linspace(0, 1, f0)
end = int(DUR * SR)
fade[end - f1:end] = np.linspace(1, 0, f1)
fade[end:] = 0
out *= fade[:, None]
out = out[:end]
out = out / (np.max(np.abs(out)) + 1e-9) * .8
with wave.open("public/score.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote public/score.wav", DUR, "s")
