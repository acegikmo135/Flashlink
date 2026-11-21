# Flashlink — five new logos (Logo Forge)

Hand-built SVG, one idea each, five different strategies. Every file is **filled paths only** (wordmarks are outlined, no font dependency).
Colour: ink `#07090D`, paper `#F4F6F8`, electric blue `#3185FF` (max. 2 colours per mark, one accent).

| Logo | Strategy | Idea (≤5 words) | Score |
|---|---|---|---|
| **Split** | Negative space | One disc, cut by a flash. | 42/50 |
| **Pin F** | Letterform from the brand's object | F made of pins, ending in light. | 41/50 |
| **Signal** | System / abstract (pixel) | Matter dissolving into signal. | 41/50 |
| **Trace** | Abstract gesture | Signal becomes a bolt of copper. | 37/50 |
| **FL Bridge** | Ligature / system wordmark | Two letters, one link. | 37/50 |

Trace and FL Bridge are below the skill's 40/50 winner gate; they are delivered because five directions were requested, with their weak points noted below.

## Files (per logo folder)

`flashlink-<logo>-{icon,primary,stacked,wordmark}` × `{ ,-on-dark,-mono-black,-mono-white}.svg`, `-icon-currentColor.svg`,
`-icon-sm.svg` (+ `-icon-sm-mono-black.svg`) where a heavier small-size variant is needed (Trace, Split, FL Bridge, Signal — use below 32 px),
`-construction.svg`, `-app-icon.svg`, and `png/` (icon 1024/512/256/64/48/32/16, app icon 1024, construction).

`boards/` holds the presentation boards. `_source/` regenerates everything
(`node build.mjs out && node export.mjs && node board.mjs`; needs `@resvg/resvg-js opentype.js @fontsource/geist @fontsource/geist-mono`, the Inter Display OTF and Playwright).

## Rationale and known weak points

* **Split** — a solid disc divided by a stepped 45° cut; the gap is the bolt. Strongest silhouette; reads at 16 px. Risk: bolt-in-circle is close to generic "power" icons; the offset two-piece cut is what makes it ownable. Wordmark: Inter Display Medium, the i's dot becomes a blue 45° diamond.
* **Pin F** — three header pins form the F (round heads, flat foot where it plugs into the board) with the confirming LED beside the top arm. Best small-size behaviour. Risk: a rounded F plus a dot is close to generic; the flat foot and the pin vocabulary carry the ownability. Wordmark: Geist Mono caps, the I is a blue pin.
* **Signal** — a pixel F: solid stem, arms shrinking into blue dots. Matches the Geist Pixel type on the site. The wordmark is built from a 5×7 pixel grid. Risk: pixel styling is of its era (timelessness 3).
* **Trace** — a PCB trace drawn as a lightning step: hollow ring (signal) to solid pad (hardware). Risk: thin and tall; it needs the `-icon-sm` below 32 px and is the least ownable silhouette ("bolt on a stick").
* **FL Bridge** — the f's crossbar runs on to the l. The first version read as a capital A, so the f was shortened and the l made taller. The ligature works best as the logotype (it *is* the primary); the icon alone is only adequate at small sizes.

## Not done / unverified

* The competitor line-up test was not run (no competitor marks were collected): Ownability scores are judgement, not evidence.
* Favicons are rendered at 16/32/48 px from the SVGs but were not viewed inside real browser tabs.
* The board has no merch (tee/tote) mock.
