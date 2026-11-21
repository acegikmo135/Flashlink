import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<number>();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    setDone(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setDone(false), 1800);
  };
  return (
    <button type="button" className={`copy${done ? " done" : ""}`} onClick={copy} aria-label={done ? "Copied" : `${label} to clipboard`}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}

export function Terminal({ title, text, prompt = true, id }: { title: string; text: string; prompt?: boolean; id?: string }) {
  return (
    <div className="term" id={id}>
      <div className="term-bar"><span>{title}</span><CopyButton text={text} /></div>
      <pre tabIndex={0} aria-label={title}><code>{text.split("\n").map((l, i) => (
        <span key={i}>{prompt && <span className="p">$ </span>}{l}{"\n"}</span>
      ))}</code></pre>
    </div>
  );
}

export function Bold({ text }: { text: string }) {
  return <>{text.split("**").map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}
