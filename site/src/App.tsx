import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Cloud, Cpu, Download, Menu, MessageSquare, Monitor, Play, Plus, Search, X } from "lucide-react";
import { BOARDS, CONNECT, FAQ, FLASH_PARTS, JOB_STATES, LINKS, LINK_LABELS, MCP_CMD, MCP_URL, READOUTS, SECURITY, SETUP_CMD, STAGES, TOOLS, TRANSCRIPT } from "./data";
import { Bold, CopyButton, Terminal } from "./ui";
import { BoardArt } from "./board";

gsap.registerPlugin(ScrollTrigger);
gsap.defaults({ ease: "cubic-bezier(0.22, 1, 0.36, 1)" });
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ film lightbox (native dialog) */
function FilmDialog({ dlg }: { dlg: React.RefObject<HTMLDialogElement> }) {
  const vid = useRef<HTMLVideoElement>(null);
  return (
    <dialog ref={dlg} className="lightbox" aria-label="MCU Bridge launch film" onClose={() => vid.current?.pause()} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
      <div className="lightbox-bar"><span>Launch film · 34 s</span><button type="button" className="copy" onClick={() => dlg.current?.close()} aria-label="Close film"><X aria-hidden />Close</button></div>
      <video ref={vid} controls playsInline preload="none" poster="/media/launch-poster.jpg" aria-label="MCU Bridge launch film: an AI chat becomes firmware, which is flashed to a board whose LED blinks.">
        <source src="/media/launch-film.mp4" type="video/mp4" />
      </video>
    </dialog>
  );
}

/* ------------------------------------------------------------------ nav */
function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav" data-enter>
      <div className="wrap nav-inner">
        <a className="brand" href="#top" aria-label="MCU Bridge, top of page"><img src="/favicon.svg" alt="" width="28" height="28" />MCU Bridge</a>
        <nav id="primary-nav" className={`navlinks${open ? " open" : ""}`} aria-label="Primary" onClick={() => setOpen(false)}>
          <a href="#pipeline">How it works</a>
          <a href="#toolset">Toolset</a>
          <a href="#security">Security</a>
          <a href="#quickstart">Quickstart</a>
        </nav>
        <div className="navactions">
          <a className="btn gh" href={LINKS.github}>GitHub</a>
          <a className="btn btn-primary" href={LINKS.installer}><Download aria-hidden />Download</a>
          <button type="button" className="btn menu-btn" aria-expanded={open} aria-controls="primary-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero: the headline and a live flash-job instrument */
function Hero({ onWatch }: { onWatch: () => void }) {
  return (
    <section className="hero" id="top" aria-labelledby="h1">
      <div className="hero-grid-bg" aria-hidden="true" />
      <div className="wrap hero-wrap">
        <h1 id="h1" className="display">
          <span className="ln"><span>Your AI,</span></span>
          <span className="ln"><span>hands on hardware.</span></span>
        </h1>
        <div className="hero-grid">
          <div className="hero-copy">
            <p data-enter>Chat with Claude, ChatGPT or Gemini. It compiles in the cloud and flashes the board on your desk — no IDE, no cables swapped, no compile on your PC.</p>
            <div className="hero-cta" data-enter>
              <a className="btn btn-primary btn-lg" href={LINKS.installer}><Download aria-hidden />Download for Windows</a>
              <button type="button" className="btn btn-lg" onClick={onWatch}><Play aria-hidden />Watch the film</button>
            </div>
            <dl className="facts" data-enter>
              <div><dt>Boards</dt><dd>ESP32 family · Arduino Uno, Nano, Mega · STM32</dd></div>
              <div><dt>AI chats</dt><dd>Claude · ChatGPT · Gemini</dd></div>
              <div><dt>Your PC</dt><dd>Outbound WebSocket only. No open ports.</dd></div>
            </dl>
          </div>
          <figure className="frame hero-film" data-enter aria-label="A flash job as your AI sees it">
            <div className="statusbar">
              <span><i className="dot" />AGENT CONNECTED</span>
              <span>MCP <b>20 TOOLS</b></span>
              <span>SHA-256 <b>VERIFIED</b></span>
            </div>
            <div className="board-wrap"><BoardArt /></div>
            <div className="transcript" role="img" aria-label="Transcript of a flash job: compile_firmware returns ok with size 6264 bytes; flash_firmware streams the firmware to your PC; get_flash_job reports status completed, flash_confirmed true.">
              {TRANSCRIPT.map((l, i) => (
                <div className={`tl tl-${l.t}`} key={i} data-line aria-hidden="true">
                  <span className="mark">{l.t === "call" ? "›" : l.t === "ok" ? "✓" : " "}</span>
                  <span className="txt">{l.text}</span>
                </div>
              ))}
            </div>
            <ol className="rail" aria-label="Job lifecycle">
              {JOB_STATES.map((s, i) => (
                <li key={s} data-step={i}><i /><span>{s}</span></li>
              ))}
            </ol>
          </figure>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pipeline (the signature component) */
const PAYLOAD = ["prompt", "manifest", "firmware", "flash_confirmed"];
const ICONS = { chat: MessageSquare, cloud: Cloud, pc: Monitor, chip: Cpu };
function Pipeline() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current!;
    const stages = Array.from(el.querySelectorAll<HTMLElement>(".stage"));
    const setP = (p: number) => {
      el.style.setProperty("--p", String(p));
      const chip = el.querySelector<HTMLElement>(".chip");
      if (chip) chip.textContent = PAYLOAD[Math.min(PAYLOAD.length - 1, Math.round(p * (PAYLOAD.length - 1)))];
      stages.forEach((s, i) => s.classList.toggle("on", p >= i / (stages.length - 1) - 0.001));
    };
    if (reduced()) { setP(1); return; }
    setP(0);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({ trigger: el, start: "top 70%", end: "bottom 45%", scrub: 0.6, onUpdate: (s) => setP(s.progress) });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <section className="sec" id="pipeline" aria-labelledby="pipe-h">
      <div className="wrap">
        <div className="sec-head">
          <h2 id="pipe-h" className="h2" data-reveal>What happens between your chat and your board.</h2>
          <p className="lede" data-reveal>Nothing is compiled on your PC, and nothing is left behind in the cloud. Scroll: the signal travels the line, and each stage shows what it checks.</p>
        </div>
        <div className="pipe" ref={root}>
          <div className="pipe-track" aria-hidden="true"><div className="pipe-fill" /><div className="pipe-pulse"><span className="chip mono" /></div></div>
          {LINK_LABELS.map((l, i) => (
            <span className="link" key={l} aria-hidden="true" style={{ left: `calc(${i * 25 + 12.5}% + 36px)` }}>{l}</span>
          ))}
          {STAGES.map((s, i) => {
            const Icon = ICONS[s.icon];
            return (
              <div className="stage" key={s.title}>
                <div className="node"><Icon aria-hidden /></div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <dl className="readout">
                  {READOUTS[i].map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
                </dl>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ any AI chat: a working connect panel */
function Chats() {
  const [sel, setSel] = useState(CONNECT[0].id);
  const cur = CONNECT.find((c) => c.id === sel)!;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = CONNECT.length;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : -1;
    if (to >= 0) { e.preventDefault(); setSel(CONNECT[to].id); refs.current[to]?.focus(); }
  };
  return (
    <section className="sec" id="chats" aria-labelledby="chat-h">
      <div className="wrap">
        <div className="sec-head">
          <h2 id="chat-h" className="h2" data-reveal>Works in the AI chat you already use.</h2>
          <p className="lede" data-reveal>It is an MCP server, so any chat that can add a connector can use it, including from your phone.</p>
        </div>
        <div className="connect" data-reveal>
          <div className="tabs" role="tablist" aria-label="Choose your AI chat" aria-orientation="vertical">
            {CONNECT.map((c, i) => (
              <button key={c.id} ref={(el) => (refs.current[i] = el)} role="tab" id={`tab-${c.id}`} aria-selected={sel === c.id} aria-controls="connect-panel" tabIndex={sel === c.id ? 0 : -1} onClick={() => setSel(c.id)} onKeyDown={(e) => onKey(e, i)} className="tab">
                <span className="tab-name">{c.name}</span>
                <span className="tested"><i className="dot" />Tested working</span>
              </button>
            ))}
          </div>
          <div className="panel" role="tabpanel" id="connect-panel" aria-labelledby={`tab-${cur.id}`} tabIndex={0}>
            <p>{cur.how}</p>
            {cur.cmd ? (
              <Terminal title="Terminal" text={MCP_CMD} />
            ) : (
              <div className="term">
                <div className="term-bar"><span>MCP endpoint</span><CopyButton text={MCP_URL} label="Copy URL" /></div>
                <pre tabIndex={0} aria-label="MCP endpoint"><code>{MCP_URL}</code></pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ toolset with a real filter */
function Toolset() {
  const [q, setQ] = useState("");
  const total = TOOLS.reduce((n, g) => n + g.items.length, 0);
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase();
    return TOOLS.map((g) => ({ ...g, items: g.items.filter(([n, d]) => !k || n.includes(k) || d.toLowerCase().includes(k) || g.group.toLowerCase().includes(k)) })).filter((g) => g.items.length);
  }, [q]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <section className="sec" id="toolset" aria-labelledby="tool-h">
      <div className="wrap">
        <div className="sec-head">
          <h2 id="tool-h" className="h2" data-reveal>Twenty tools, grouped by what they do.</h2>
          <p className="lede" data-reveal>Strict schemas and structured output. Every failure comes back with a specific error code, so your AI can say what went wrong.</p>
        </div>
        <div className="filter" data-reveal>
          <label htmlFor="tool-q"><Search aria-hidden />Filter tools</label>
          <input id="tool-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="flash, serial, build…" autoComplete="off" spellCheck={false} />
          <span className="count" aria-live="polite">{shown} of {total}</span>
        </div>
        <div className="tools">
          {groups.map((g) => (
            <div className="tgroup" key={g.group} data-reveal>
              <h3>{g.group}<small>{g.note}</small></h3>
              <div>{g.items.map(([n, d]) => (<div className="tool" key={n}><code>{n}</code><span>{d}</span></div>))}</div>
            </div>
          ))}
          {shown === 0 && <p className="none">No tool matches “{q}”. Try “flash”, “serial” or “build”.</p>}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ boards + the real ESP32 flash layout */
function FlashMap() {
  const TOTAL = 0x150000;
  return (
    <div className="map" data-reveal>
      <div className="map-head"><h3>A blank ESP32 still boots.</h3><p>ESP32 builds are flashed as a complete image, laid out like this.</p></div>
      <div className="strip" role="img" aria-label="ESP32 flash layout from 0x0 to 0x150000: bootloader at 0x1000, partition table at 0x8000, boot_app0 at 0xe000, application at 0x10000.">
        {FLASH_PARTS.map((p, i) => (
          <i key={p.name} className={`seg seg-${i}`} style={{ left: `${(p.addr / TOTAL) * 100}%`, width: `${Math.max((p.size / TOTAL) * 100 * (i === 3 ? 0.97 : 1), 0.4)}%` }} />
        ))}
        <span className="ends mono"><b>0x0</b><b>0x150000</b></span>
      </div>
      <dl className="legend">
        {FLASH_PARTS.map((p, i) => (
          <div key={p.name}><dt><i className={`sw sw-${i}`} />{p.name}</dt><dd className="mono">0x{p.addr.toString(16)}</dd><dd className="mono">{p.label}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function Boards() {
  return (
    <section className="sec" id="boards" aria-labelledby="boards-h">
      <div className="wrap">
        <div className="sec-head">
          <h2 id="boards-h" className="h2" data-reveal>Boards it flashes today.</h2>
          <p className="lede" data-reveal>The right flasher is chosen for each board automatically, so an Arduino is never sent to esptool.</p>
        </div>
        <table className="btable" data-reveal>
          <thead><tr><th scope="col">Family</th><th scope="col">Boards</th><th scope="col">Flash tool</th><th scope="col">Status</th></tr></thead>
          <tbody>{BOARDS.map((b) => (<tr key={b.family}><td>{b.family}</td><td>{b.boards}</td><td className="d">{b.tool}</td><td className="s"><Bold text={b.status} /></td></tr>))}</tbody>
        </table>
        <FlashMap />
        <figure className="frame shot" data-reveal>
          <div className="statusbar" aria-hidden="true"><span><i className="dot" />DASHBOARD</span><span>DEVICES</span></div>
          <img src="/media/dashboard-devices.webp" width="1800" height="1012" loading="lazy" alt="The MCU Bridge web dashboard, Devices page, dark theme: three boards listed with port, family, state and remote-flashing permission. One board, named Desk ESP32, is flashing." />
        </figure>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ security */
function Security() {
  return (
    <section className="sec" id="security" aria-labelledby="sec-h">
      <div className="wrap">
        <div className="sec-head"><h2 id="sec-h" className="h2" data-reveal>Built so the AI can only flash.</h2></div>
        <div className="sec-sheet">
          <aside data-reveal>Flashing changes hardware, so the design assumes the AI side could be compromised. These are the controls in the shipped code.</aside>
          <dl className="rows">{SECURITY.map(([k, v]) => (<div className="row" key={k} data-reveal><dt>{k}</dt><dd>{v}</dd></div>))}</dl>
        </div>
        <p className="honest" data-reveal>A valid token can flash your boards — that is the product. Treat tokens like SSH keys; revoke freely.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the 21-second film */
function Brag() {
  return (
    <section className="sec" id="short" aria-labelledby="short-h">
      <div className="wrap">
        <div className="sec-head">
          <h2 id="short-h" className="h2" data-reveal>The 21-second version.</h2>
          <p className="lede" data-reveal>The whole idea, with sound on.</p>
        </div>
        <figure className="frame" data-reveal>
          <div className="statusbar" aria-hidden="true"><span><i className="dot" />FILM</span><span>21 S</span></div>
          <video controls preload="none" playsInline poster="/media/brag-poster.jpg" aria-label="MCU Bridge, 21-second cut: AI wrote the firmware, then asked you to flash it. MCU Bridge lets the AI flash it.">
            <source src="/media/brag-cut.mp4" type="video/mp4" />
          </video>
        </figure>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ quickstart, faq, footer */
function Quickstart() {
  return (
    <section className="sec" id="quickstart" aria-labelledby="qs-h">
      <div className="wrap">
        <div className="sec-head"><h2 id="qs-h" className="h2" data-reveal>Running in three steps.</h2></div>
        <div className="steps">
          <div className="step" data-reveal>
            <span className="n">1</span>
            <div className="t"><h3>Run the cloud.</h3><p>One script deploys the Worker to your free Cloudflare account and prints your URL and an invite code. Or use a hosted endpoint if its owner gives you an invite.</p></div>
            <div className="v"><Terminal title="Terminal" text={SETUP_CMD} /></div>
          </div>
          <div className="step" data-reveal>
            <span className="n">2</span>
            <div className="t"><h3>Install the Windows app and pair it.</h3><p>A per-user installer, no administrator rights. Open the pairing link it shows, sign in, compare the code and approve. The app then reconnects by itself.</p></div>
            <div className="v"><div><a className="btn btn-primary btn-lg" href={LINKS.installer}><Download aria-hidden />Download MCUBridge-Setup.exe</a></div></div>
          </div>
          <div className="step" data-reveal>
            <span className="n">3</span>
            <div className="t"><h3>Add the URL to your AI chat and say “flash my board.”</h3><p>Paste the endpoint into your chat's connectors, sign in once, plug in a board and ask. The Activity page records every flash.</p></div>
            <div className="v">
              <div className="term"><div className="term-bar"><span>MCP endpoint</span><CopyButton text={MCP_URL} label="Copy URL" /></div><pre tabIndex={0} aria-label="MCP endpoint"><code>{MCP_URL}</code></pre></div>
              <figure className="frame" style={{ margin: 0 }}>
                <div className="statusbar" aria-hidden="true"><span><i className="dot" />DASHBOARD</span><span>ACTIVITY</span></div>
                <img src="/media/dashboard-activity.webp" width="1440" height="640" loading="lazy" alt="The MCU Bridge web dashboard, Activity page, dark theme: a table of recent flashes, each marked Completed." />
              </figure>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="sec" id="faq" aria-labelledby="faq-h">
      <div className="wrap">
        <div className="sec-head"><h2 id="faq-h" className="h2" data-reveal>Questions.</h2></div>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <details key={q} data-reveal>
              <summary>{q}<Plus aria-hidden /></summary>
              <p>{i === 4 ? <>Yes. The cloud, the web dashboard and the Windows app are on <a href={LINKS.github}>GitHub</a>.</> : a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div><a className="brand" href="#top"><img src="/favicon.svg" alt="" width="28" height="28" />MCU Bridge</a><p className="lede">Your AI, hands on hardware.</p></div>
          <div><a href={LINKS.github}>GitHub</a><a href={LINKS.installer}>Download for Windows</a><a href={LINKS.maker}>manthank.com</a><span>Built by Manthan Kansagra.</span></div>
        </div>
        <small>Dashboard images are captures of the real web dashboard with placeholder data. The launch films are illustrated; the board in them is drawn.</small>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ motion: the load-in sequence, the pipeline pulse (above), quiet reveals */
function useMotion() {
  useLayoutEffect(() => {
    if (reduced()) return;
    const ctx = gsap.context(() => {
      gsap.set(".hero-copy [data-enter]", { y: 14 });
      gsap.set("[data-line]", { opacity: 1 });
      gsap.set("[data-line] .txt", { clipPath: "inset(0 100% 0 0)" });
      gsap.set(".rail li i", { scaleX: 0 });
      gsap.set(".rail li span", { opacity: 0.45 });
      const tl = gsap.timeline({ delay: 0.1 });
      tl.to(".nav[data-enter]", { opacity: 1, duration: 0.6 })
        .to(".hero h1 .ln > span", { y: 0, duration: 1.0, stagger: 0.12 }, 0.1)
        .to(".hero-copy [data-enter]", { opacity: 1, y: 0, duration: 0.8, stagger: 0.1 }, 0.55)
        .fromTo(".hero-film", { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 1.0 }, 0.5);
      // the instrument runs its job once: lines type, the rail fills to "completed"
      let at = 1.2;
      document.querySelectorAll<HTMLElement>("[data-line] .txt").forEach((el) => {
        const d = Math.min(1.1, 0.25 + (el.textContent?.length ?? 0) * 0.014);
        tl.to(el, { clipPath: "inset(0 0% 0 0)", duration: d, ease: "steps(" + Math.max(8, Math.round((el.textContent?.length ?? 8) / 1.4)) + ")" }, at);
        at += d + 0.18;
      });
      const total = at - 1.2;
      document.querySelectorAll<HTMLElement>(".rail li").forEach((li, i, all) => {
        const t = 1.5 + (total * (i + 1)) / all.length - 0.25;
        tl.to(li.querySelector("i"), { scaleX: 1, duration: 0.45 }, t).to(li.querySelector("span"), { opacity: 1, duration: 0.3 }, t);
      });
      tl.to("#board-led-on", { opacity: 1, duration: 0.25 }, 1.5 + total + 0.05);
      ScrollTrigger.batch("[data-reveal]", { start: "top 90%", once: true, onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.8, stagger: 0.07 }) });
    });
    return () => ctx.revert();
  }, []);
}

export function App() {
  const dlg = useRef<HTMLDialogElement>(null);
  useMotion();
  useEffect(() => { ScrollTrigger.refresh(); }, []);
  const watch = () => { dlg.current?.showModal(); void dlg.current?.querySelector("video")?.play(); };
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero onWatch={watch} />
        <Pipeline />
        <Chats />
        <Toolset />
        <Boards />
        <Security />
        <Brag />
        <Quickstart />
        <Faq />
      </main>
      <Footer />
      <FilmDialog dlg={dlg} />
    </>
  );
}
