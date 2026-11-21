/** A top-down ESP32 dev board drawn in SVG (monochrome steel; the only colour is the blue LED). */
export function BoardArt() {
  const pads = (y: number) => Array.from({ length: 19 }, (_, i) => <rect key={i} x={66 + i * 28} y={y} width="14" height="14" rx="3" className="b-pad" />);
  return (
    <svg className="board-art" viewBox="0 0 760 330" role="img" aria-label="Drawing of an ESP32 development board seen from above. Its LED lights when the flash job completes.">
      <defs>
        <pattern id="trace-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.035)" strokeWidth="1" /></pattern>
        <radialGradient id="led-pool" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#007aff" stopOpacity=".5" /><stop offset="1" stopColor="#007aff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="760" height="330" fill="url(#trace-grid)" />
      <g transform="translate(60 40)">
        <rect x="6" y="16" width="640" height="250" rx="14" fill="#000" opacity=".5" />
        <rect width="640" height="250" rx="14" className="b-pcb" />
        <rect x="4" y="4" width="632" height="242" rx="11" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="2" />
        {/* traces */}
        <g fill="none" stroke="#242b35" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M262 80 H300 V40 H640" /><path d="M262 100 H318 V62 H560" /><path d="M262 120 H330 V96" />
          <path d="M262 160 H318 V200 H560" /><path d="M262 180 H300 V220 H640" /><path d="M362 128 H520" /><path d="M362 148 H430 V190" />
        </g>
        {pads(8)}{pads(228)}
        <rect x="22" y="40" width="238" height="170" rx="7" className="b-mod" />
        <rect x="22" y="40" width="64" height="170" rx="7" fill="#0b0d11" />
        <path d="M24 52h40v14H24v14h40v14H24v14h40v14H24v14h40" transform="translate(4 -6)" fill="none" stroke="#5c6878" strokeWidth="5" strokeLinejoin="round" />
        <rect x="104" y="64" width="132" height="14" rx="3" fill="#aeb7c4" /><rect x="104" y="92" width="96" height="14" rx="3" fill="#aeb7c4" /><rect x="104" y="150" width="120" height="30" rx="4" fill="#bcc4cf" />
        <rect x="300" y="96" width="62" height="62" rx="5" fill="#07090d" stroke="#222a34" /><circle cx="312" cy="108" r="4" fill="#2c3440" />
        <rect x="392" y="104" width="34" height="14" rx="3" fill="#2d333c" /><rect x="392" y="132" width="34" height="14" rx="3" fill="#2d333c" />
        <rect x="460" y="46" width="38" height="38" rx="6" fill="#1a2028" /><circle cx="479" cy="65" r="11" fill="#7f8a99" />
        <rect x="460" y="166" width="38" height="38" rx="6" fill="#1a2028" /><circle cx="479" cy="185" r="11" fill="#7f8a99" />
        <rect x="528" y="116" width="22" height="12" rx="3" fill="#2a3039" />
        {/* the LED: off until the job completes */}
        <rect x="528" y="140" width="22" height="12" rx="3" fill="#18202b" />
        <g id="board-led-on" style={{ opacity: 0 }}>
          <circle cx="539" cy="146" r="70" fill="url(#led-pool)" />
          <rect x="526" y="138" width="26" height="16" rx="4" fill="#007aff" /><rect x="530" y="142" width="18" height="8" rx="2" fill="#cfe6ff" />
        </g>
        <rect x="606" y="82" width="62" height="86" rx="7" fill="#aab2bd" /><rect x="618" y="96" width="38" height="58" rx="4" fill="#07090d" />
      </g>
    </svg>
  );
}
