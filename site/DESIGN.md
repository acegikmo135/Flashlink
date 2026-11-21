# DESIGN — MCU Bridge landing page

**Subject:** a precision instrument that lets an AI flash real boards. **Audience:** makers and embedded developers who already use an AI chat. **Primary job:** get them to download the Windows app and add the MCP URL to their AI.

## Tokens (committed before code)

| Token | Value | Role |
|---|---|---|
| `ink` | `#07090D` | page ground |
| `panel` | `#0C1016` | one step up: frames, tables |
| `raised` | `#121923` | two steps up: copy buttons, hovered rows |
| `line` | `rgba(255,255,255,.08)` | every hairline |
| `text` | `#E9EDF3` | primary text |
| `steel` | `#8C98AA` | muted text (6.7:1 on ink) |
| `signal` | `#007AFF` | the only accent — sampled from the logo tile; status dots, the pipeline pulse, key data, focus ring |

Type: **Archivo Variable** (wght 700–800, wdth 112–125) for display — big, tight (-0.03em); **Inter Variable** for body (17px / 1.65, ≤ 64ch); **JetBrains Mono Variable** only for data (commands, tool names, status readouts, spec values). Scale: display clamp(44px, 7.6vw, 108px); h2 clamp(34px, 4.6vw, 60px); h3 22px; body 17px; data 14px.

Radius: 4px on controls, 10px on frames — two values, nowhere else. Shadows: none on panels (hairlines do the separating); the film frame gets one deep shadow.

Layout: 1200px column, 24px gutters, 144px vertical rhythm between sections, sections separated by a hairline and space. Left-aligned text throughout. 12-column grid; asymmetric splits (5/7 or 4/8).

Motion (GSAP + ScrollTrigger, one curve `cubic-bezier(0.22,1,0.36,1)` = `expo`-like): (1) the hero load-in, once; (2) the pipeline pulse, scrubbed on scroll; (3) quiet fade-rise reveals, once, 14px. Nothing else moves. `prefers-reduced-motion`: everything rests in its final state; the pulse sits on the last stage.

## Layout concept

```
┌ nav: logo · How it works · Toolset · Security · Quickstart ········ GitHub · Download ┐
│ Your AI,                                                                             │
│ hands on hardware.                                                                   │
│ subline (≤ 56ch)                    ┌───────────────────────────────────────────────┐│
│ [Download for Windows] [Watch]      │ ● AGENT CONNECTED · SHA-256 VERIFIED          ││
│                                     │  34 s film 16:9, machined frame, bleeds right ││
│                                     └───────────────────────────────────────────────┘│
│ ──── pipeline ───────────────────────────────────────────────────────────────────── │
│   AI chat ───●─── Cloud compile ──────── Your PC ──────────── Your board            │
│   readout      readout                    readout              readout                │
│ ──── any AI chat (Claude / ChatGPT / Gemini rows)  +  endpoint + claude mcp add ───── │
│ ──── toolset: 20 tools, 4 groups, mono spec table ───────────────────────────────── │
│ ──── boards: spec rows + the real dashboard screenshot ───────────────────────────── │
│ ──── security: engineer's spec sheet ─ honest closing line ──────────────────────── │
│ ──── the 21 s film (full width) ─────────────────────────────────────────────────── │
│ ──── quickstart: 3 steps ─────────────────────────────────────────────────────────── │
│ ──── FAQ (5, native <details>) ───────────────────────────────────────────────────── │
└ footer ──────────────────────────────────────────────────────────────────────────────┘
```

## Principles

1. **One memorable thing: the pipeline.** Everything else is quiet and disciplined.
2. **Show the real product.** Film, real dashboard screenshots (actual `web/dist`, dark theme, fictional placeholder data), real tool names, real commands. No fake UI built from divs, no stock or generated imagery.
3. **Structure is information.** Hairlines separate; tables carry specs; mono appears only where the content is data; no eyebrow over every section, no numbered markers except the quickstart (which is a real sequence).
4. **Every claim traceable to the repo.** Status of each board family is stated as it is (ESP32 verified on hardware; AVR and STM32 implemented, not yet confirmed on hardware).

## Plan review (against the generic default)

* *Draft 1* used a pill-shaped chip strip for the AIs and a three-up card row for Claude / ChatGPT / Gemini. **Revised:** hairline rows with different content per row (the connection method differs), no identical cards.
* *Draft 1* put a glowing blue radial behind the hero film. **Revised:** removed — a flat ground with a machined frame; the accent appears only as dots, pulse and data.
* *Draft 1* had icon-in-circle tool cards. **Revised:** mono spec table, no icons.
* *Draft 1* used a centred hero. **Revised:** left-aligned headline with the film offset right and bleeding past the column.
* Kept: Archivo wide display (distinct from Inter/Geist defaults), dark ink ground (specified by the brief).

## Honesty rules for this page

* The hero status bar uses readouts from the product's own vocabulary and does not claim a particular board was flashed.
* Dashboard images are real captures with placeholder data; the footer says so in one fine-print line.
* Claude / ChatGPT / Gemini: "Tested working" and nothing more.
