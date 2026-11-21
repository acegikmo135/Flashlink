"""Shared pieces for the HyperFrames scene generator."""

BASE_CSS = """
@font-face{font-family:"Geist";src:url('assets/fonts/geist.woff2') format('woff2');font-weight:100 900}
#root{position:absolute;inset:0;overflow:hidden;font-family:"Geist",sans-serif;color:#111;font-weight:600;letter-spacing:-.02em}
.abs{position:absolute}
.title{position:absolute;white-space:nowrap;line-height:1;font-size:108px;font-weight:600;letter-spacing:-.02em}
.shadow{box-shadow:0 30px 80px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.08)}
"""

CURSOR = (
    '<svg class="cursor" viewBox="0 0 48 56" width="64" height="75" style="position:absolute;left:0;top:0;opacity:0;z-index:40;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))">'
    '<path d="M4 3 L4 42 L15 32.5 L22 49 L30.5 45.5 L23.5 29.5 L38 29.5 Z" fill="#111" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/></svg>'
)

LOGO_GLYPH = (
    '<g transform="translate(3.50 0.65) scale(0.2375)">'
    '<path d="M104 204V108A48 48 0 0 1 200 108V204H168V108A16 16 0 0 0 136 108V204Z" fill="#3185FF"/>'
    '<path d="M40 204V108A48 48 0 0 1 136 108V204H104V108A16 16 0 0 0 72 108V204Z" fill="#F4F6F8"/></g>'
)

# top-down ESP32 dev board, drawn in a 660x250 box (origin top-left)
def board_svg(idp: str) -> str:
    pads_top = "".join(f'<rect x="{66 + i * 28}" y="8" width="14" height="14" rx="3" fill="#d4af37"/><circle cx="{73 + i * 28}" cy="15" r="3.2" fill="#15171c"/>' for i in range(19))
    pads_bot = "".join(f'<rect x="{66 + i * 28}" y="228" width="14" height="14" rx="3" fill="#d4af37"/><circle cx="{73 + i * 28}" cy="235" r="3.2" fill="#15171c"/>' for i in range(19))
    mean = "M24 52 h40 v14 h-40 v14 h40 v14 h-40 v14 h40 v14 h-40 v14 h40"
    return f"""
<g id="{idp}board">
  <rect x="0" y="0" width="640" height="250" rx="14" fill="#15171c" stroke="#2c3038" stroke-width="2"/>
  <rect x="4" y="4" width="632" height="242" rx="11" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
  {pads_top}{pads_bot}
  <rect x="22" y="40" width="238" height="170" rx="7" fill="#cfd4dc"/>
  <rect x="22" y="40" width="238" height="170" rx="7" fill="none" stroke="#e9edf2" stroke-width="2"/>
  <rect x="22" y="40" width="64" height="170" rx="7" fill="#121317"/>
  <path d="{mean}" transform="translate(4 -6)" fill="none" stroke="#b8963a" stroke-width="5" stroke-linejoin="round"/>
  <rect x="104" y="64" width="132" height="14" rx="3" fill="#a9afb9"/><rect x="104" y="92" width="96" height="14" rx="3" fill="#a9afb9"/>
  <rect x="104" y="150" width="120" height="30" rx="4" fill="#b9bfc9"/>
  <rect x="300" y="96" width="62" height="62" rx="5" fill="#0b0c0f"/><circle cx="312" cy="108" r="4" fill="#3b4150"/>
  <rect x="392" y="104" width="34" height="14" rx="3" fill="#3d342a"/><rect x="392" y="132" width="34" height="14" rx="3" fill="#3d342a"/>
  <rect x="460" y="46" width="38" height="38" rx="6" fill="#262a32"/><circle cx="479" cy="65" r="11" fill="#9aa1ad"/>
  <rect x="460" y="166" width="38" height="38" rx="6" fill="#262a32"/><circle cx="479" cy="185" r="11" fill="#9aa1ad"/>
  <rect x="528" y="116" width="22" height="12" rx="3" fill="#5b1d1d"/>
  <rect id="{idp}led" x="528" y="140" width="22" height="12" rx="3" fill="#1d2a3a"/>
  <rect x="606" y="82" width="62" height="86" rx="7" fill="#b3b9c3"/><rect x="618" y="96" width="38" height="58" rx="4" fill="#0e1014"/>
  <rect x="606" y="82" width="62" height="86" rx="7" fill="none" stroke="#e3e7ec" stroke-width="2"/>
</g>"""


def scene(sid: str, css: str, html: str, js: str, w: int = 1920, h: int = 1080) -> str:
    return f"""<template>
  <style>{BASE_CSS}{css}</style>
  <div id="root" data-composition-id="{sid}" data-width="{w}" data-height="{h}">
{html}
  </div>
  <script>
    window.__timelines = window.__timelines || {{}};
    const tl = gsap.timeline({{ paused: true }});
{js}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""


# helpers injected at the top of every scene script
JS_HELPERS = """
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];
    const split = (el, by) => { const t = el.textContent; el.textContent = ''; const out = [];
      if (by === 'word') { t.split(' ').forEach((w, i, a) => { const s = document.createElement('span'); s.style.display = 'inline-block'; s.textContent = w + (i < a.length - 1 ? '\\u00a0' : ''); el.appendChild(s); out.push(s); }); }
      else { [...t].forEach((c) => { const s = document.createElement('span'); s.style.display = 'inline-block'; s.innerHTML = c === ' ' ? '&nbsp;' : c; el.appendChild(s); out.push(s); }); }
      return out; };
    const typeTo = (el, str, at, dur) => { const o = { i: 0 }; tl.fromTo(o, { i: 0 }, { i: str.length, duration: dur, ease: 'none', onUpdate() { el.textContent = str.slice(0, Math.round(o.i)); } }, at); };
    const cursorPath = (sel, pts) => { /* pts: [[t,x,y],...] — each leg eased, one tween per leg */
      const c = $(sel); tl.set(c, { opacity: 1, x: pts[0][1], y: pts[0][2] }, pts[0][0]);
      for (let i = 1; i < pts.length; i++) tl.to(c, { x: pts[i][1], y: pts[i][2], duration: pts[i][0] - pts[i - 1][0], ease: 'power2.inOut' }, pts[i - 1][0]); };
    const click = (sel, at) => { tl.to(sel, { scale: .86, duration: .06, ease: 'power2.out', transformOrigin: '8% 6%' }, at); tl.to(sel, { scale: 1, duration: .14, ease: 'power2.out', transformOrigin: '8% 6%' }, at + .06); };
"""
