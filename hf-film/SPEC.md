# SPEC — "11:42 pm" (storyline A)

GOAL: the viewer believes, and can say afterwards, "I tell my AI to blink the LED and it blinks the board on my desk."
OUTPUT: HyperFrames, 1920×1080, 30 fps. TIME: 62 s × 30 = 1860 frames. BPM 120 → 15 frames per beat, 60 per bar (compute each beat from its index).

LOOK
- Grounds: bench mat #dcd9d2 (flat, 1 px grid #cfccc5 every 60 px); brand blue #007aff (solid, never a gradient); white #ffffff for the chat world. Ink #111111. Green #34c759 only on the verified check. Board PCB #15171c, module silver #c9ced6, LED #4aa3ff.
- Type: Geist (the product's own UI font, shipped as assets/fonts/geist.woff2), weight 600, tracking −2%. Title 108 px (10% of frame height) one line at a time; quiet lines 40 px; UI text never below 28 px after any push.
- Medium: a workbench seen from above; the product is shown as its own real UI, 1.6–2.2× real size, on its ground. Shadows: 0 30px 80px rgba(0,0,0,.22), one per object. No glow except the LED's own light pool (220 px, 35%).
OBJECTS (drawn, no real source exists): ESP32 dev board (black PCB, silver shield module with antenna meander, two header rows of gold pads, micro-USB, EN/BOOT buttons, blue LED), laptop from above, phone with lock screen, USB cable, mug.
MOTION: arrivals `expo.out`/`power4.out` 0.5–0.8 s; camera `power2.inOut` 0.5 s; accelerating exits `power3.in`; springs only on position/scale, damping ≈0.8; exits 45% of entrances; titles land dead still; titles vary entrance (per-word blur, whole-line blur, per-letter).
TRANSITIONS (each caused by an object): iris from the laptop screen · colour flood to blue · whip · chip grows into the next ground · result card carried into the dashboard · click-driven match cut · zoom through the check · blur swap · dip cut.

SHOTS
1. 0–5.0 bench (hook): board dead, phone "11:42 PM", title "11:42 pm." (0.4) then "Demo at 9." (2.0); slow 6% push; camera dives into the laptop screen from 4.1.
2. 5.0–11.0 old way: real error strings in a plain terminal; title "Flashing fails. Again."; sound near silence.
3. 11.0–15.0 reveal: blue flood from the terminal; wordmark "MCU Bridge" per-letter; line "Let your AI flash it."
4. 15.0–23.0 name it: real web app, cursor clicks the board name and types "Desk ESP32"; title "Name your board."
5. 23.0–29.0 ask: chat world (white); prompt typed; reply + tool chip; title "Then just ask."
6. 29.0–34.0 compile: the chip grows to the blue ground; real compile_firmware response, row by row; title "Compiled in the cloud."
7. 34.0–40.0 flash: result card carried into the real dashboard; flashing → Ready (real capture); title "Streamed to your PC."
8. 40.0–45.0 verify: cursor clicks Activity (real capture); new row Completed; title "Verified, never assumed."
9. 45.0–52.0 payoff: zoom through the check to the bench; the LED blinks 3× on beats; no title until the third blink.
10. 52.0–55.0 claim: "Your AI, hands on hardware."
11. 55.0–62.0 end card: cursor clicks the mark, a fill rises; wordmark wipes in; CTA "Add it to your AI as a connector" + URL; hold 3 s.

BANNED (defaults + this film): dark void with small floating things; glow/particles; blue/purple gradients; glass cards; cream+serif+italic accent+mono labels+pills; everything centred; everything fading up; titles that drift after landing; corner labels/HUD; three cards in a row; docked logo; click rings; bounce on UI; invented UI/numbers; "Introducing"; "seamless/effortless/in seconds".
QA: frames 0.0, 3.0, 8.0, 12.0, 19.0, 26.0, 31.0, 37.0, 42.0, 48.5, 53.0, 59.0 + every seam (−0.2…+0.2 s).
