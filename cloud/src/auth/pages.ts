/** Server-rendered HTML for the (deliberately tiny) account / pairing web UI. */

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
:root{color-scheme:dark;--bg:#0b0b0c;--panel:#111113;--line:#222226;--line2:#2c2c31;--fg:#e8e8ea;--mut:#8b8b93;--dim:#5b5b63;--acc:#f2f2f3;--ok:#9be3b0;--err:#f08a8a}
@media (prefers-color-scheme:light){:root:not([data-force-dark]){--bg:#f6f6f7;--panel:#fff;--line:#e3e3e6;--line2:#d4d4d9;--fg:#141416;--mut:#64646d;--dim:#9a9aa3;--acc:#000;--ok:#1d7a3a;--err:#b42323;color-scheme:light}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.55 "Segoe UI Variable Text","Segoe UI",Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:56px 24px 80px}
header.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px;font-size:13px}
.brand{font-weight:600;letter-spacing:.02em}.brand i{display:inline-block;width:8px;height:8px;border:1.5px solid var(--fg);margin-right:9px;transform:translateY(0)}
a{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:3px}a:hover{text-decoration-color:var(--fg)}
h1{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px}h2{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:44px 0 12px}
p{color:var(--mut);margin:0 0 16px}
.card{border:1px solid var(--line);background:var(--panel);padding:20px 22px}
.row{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.row .meta{color:var(--mut);font-size:12px}
label{display:block;font-size:12px;color:var(--mut);margin:14px 0 6px}
input[type=text],input[type=email],input[type=password]{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line2);padding:9px 11px;font:inherit;outline:none;border-radius:2px}
input:focus{border-color:var(--mut)}
button{background:var(--acc);color:var(--bg);border:1px solid var(--acc);padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;border-radius:2px}
button.ghost{background:transparent;color:var(--fg);border-color:var(--line2);font-weight:500}button.ghost:hover{border-color:var(--mut)}
button.danger{background:transparent;color:var(--err);border-color:var(--line2);font-weight:500;padding:5px 11px;font-size:12px}
code,pre,.mono{font-family:"Cascadia Mono","JetBrains Mono",Consolas,ui-monospace,monospace;font-size:12.5px}
pre{background:var(--bg);border:1px solid var(--line);padding:14px 16px;overflow:auto;margin:10px 0 0;white-space:pre-wrap;word-break:break-all;color:var(--fg)}
.code{font-family:"Cascadia Mono",Consolas,ui-monospace,monospace;font-size:30px;letter-spacing:.18em;text-align:center;padding:22px 0;border:1px solid var(--line2);margin:18px 0;background:var(--bg)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dim);margin-right:8px}.dot.on{background:var(--ok)}
.err{color:var(--err);border:1px solid var(--line2);padding:10px 12px;margin-bottom:16px;font-size:13px}.ok{color:var(--ok)}
.actions{display:flex;gap:10px;margin-top:20px}form.inline{display:inline;margin:0}
`;

export function layout(title: string, body: string, opts: { user?: string | null } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · MCU Bridge</title><style>${CSS}</style></head><body><main>
<header class="top"><span class="brand"><i></i>MCU BRIDGE</span><span class="meta" style="color:var(--mut)">${
    opts.user ? `${esc(opts.user)} · <form class="inline" method="post" action="/logout"><button class="ghost" style="padding:3px 10px;font-size:12px">Sign out</button></form>` : ""
  }</span></header>${body}</main></body></html>`;
}

export function authPage(kind: "login" | "signup", opts: { error?: string; next?: string; email?: string } = {}): string {
  const signup = kind === "signup";
  return layout(
    signup ? "Create account" : "Sign in",
    `<h1>${signup ? "Create your account" : "Sign in"}</h1>
<p>${signup ? "An invite code is required. It was printed once by the setup script." : "Authenticate to manage your desktop agents and MCP tokens."}</p>
<div class="card">${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
<form method="post" action="/${kind}">
<input type="hidden" name="next" value="${esc(opts.next ?? "")}">
<label for="email">Email</label><input id="email" type="email" name="email" required autocomplete="username" value="${esc(opts.email ?? "")}">
<label for="password">Password${signup ? " (min. 10 characters)" : ""}</label><input id="password" type="password" name="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? "new-password" : "current-password"}">
${signup ? `<label for="invite">Invite code</label><input id="invite" type="text" name="invite" required autocomplete="off" spellcheck="false">` : ""}
<div class="actions"><button type="submit">${signup ? "Create account" : "Sign in"}</button></div></form></div>
<p style="margin-top:18px;font-size:13px">${signup ? `Have an account? <a href="/login${opts.next ? "?next=" + encodeURIComponent(opts.next) : ""}">Sign in</a>` : `No account yet? <a href="/signup${opts.next ? "?next=" + encodeURIComponent(opts.next) : ""}">Create one</a>`}</p>`,
  );
}

export function pairPage(opts: { user: string; code: string; deviceName: string; platform: string; error?: string }): string {
  return layout(
    "Pair desktop",
    `<h1>Connect a desktop app</h1>
<p>MCU Bridge on <b style="color:var(--fg)">${esc(opts.deviceName)}</b> (${esc(opts.platform)}) wants to link to <b style="color:var(--fg)">${esc(opts.user)}</b>.</p>
<div class="card">${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
<p style="margin:0">Confirm this code matches the one shown in the desktop app:</p>
<div class="code">${esc(opts.code)}</div>
<p style="font-size:13px">Only approve if you started this on your own computer. The desktop app will be able to flash microcontrollers on your behalf, and you can revoke it at any time.</p>
<form method="post" action="/pair/decision"><input type="hidden" name="code" value="${esc(opts.code)}">
<div class="actions"><button name="decision" value="approve">Approve</button><button class="ghost" name="decision" value="deny">Deny</button></div></form></div>`,
    { user: opts.user },
  );
}

export function simplePage(title: string, message: string, user?: string | null): string {
  return layout(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`, { user });
}

export function consentPage(o: { user: string; clientName: string; redirectHost: string; fields: Record<string, string> }): string {
  const hidden = Object.entries(o.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return layout(
    "Authorize",
    `<h1>Authorize ${esc(o.clientName)}</h1>
<p>Signed in as <b style="color:var(--fg)">${esc(o.user)}</b>. <b style="color:var(--fg)">${esc(o.clientName)}</b> (redirects to <span class="mono">${esc(o.redirectHost)}</span>) is asking to use your MCU Bridge account.</p>
<div class="card"><p style="margin:0 0 6px"><b style="color:var(--fg)">It will be able to:</b></p>
<div class="row"><span>List your connected microcontrollers and read their status</span></div>
<div class="row"><span>Flash, verify and reset boards you have allowed in the desktop app</span></div>
<div class="row"><span>Read serial output and boot logs</span></div>
<p style="font-size:13px;margin:14px 0 0">It can never run commands or access files on your PC. You can revoke access at any time from the dashboard (Connected apps). Only approve if you just added this connector yourself.</p>
<form method="post" action="/oauth/authorize/decision">${hidden}<div class="actions"><button name="decision" value="approve">Allow access</button><button class="ghost" name="decision" value="deny">Cancel</button></div></form></div>`,
    { user: o.user },
  );
}

/** Interstitial that hands control back to the client (a CSP-safe alternative to a form-post redirect). */
export function redirectPage(to: string): string {
  return layout(
    "Returning to app",
    `<meta http-equiv="refresh" content="0;url=${esc(to)}"><h1>Returning to the application…</h1><p>If nothing happens, <a href="${esc(to)}">continue</a>. You can close this tab afterwards.</p>`,
  );
}

export interface DashboardData {
  email: string;
  origin: string;
  agents: { id: string; name: string; platform: string; created_at: number; last_seen_at: number | null; online: boolean; devices: number }[];
  tokens: { id: string; name: string; created_at: number; last_used_at: number | null }[];
  apps?: { client_id: string; name: string; since: number }[];
  newToken?: string;
  error?: string;
}

const ago = (t: number | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function dashboardPage(d: DashboardData): string {
  const agents = d.agents.length
    ? d.agents
        .map(
          (a) => `<div class="row"><div><span class="dot ${a.online ? "on" : ""}"></span><b>${esc(a.name)}</b><div class="meta">${esc(a.platform)} · ${a.online ? `online · ${a.devices} device${a.devices === 1 ? "" : "s"}` : `offline · last seen ${ago(a.last_seen_at)}`}</div></div>
<form method="post" action="/dashboard/agents/revoke" onsubmit="return confirm('Revoke this desktop app? It will be disconnected immediately.')"><input type="hidden" name="id" value="${esc(a.id)}"><button class="danger">Revoke</button></form></div>`,
        )
        .join("")
    : `<p style="margin:0">No desktop app paired yet. Start MCU Bridge on your PC — it shows a pairing link and QR code.</p>`;
  const tokens = d.tokens.length
    ? d.tokens
        .map(
          (t) => `<div class="row"><div><b>${esc(t.name)}</b><div class="meta">created ${ago(t.created_at)} · last used ${ago(t.last_used_at)}</div></div>
<form method="post" action="/dashboard/tokens/revoke"><input type="hidden" name="id" value="${esc(t.id)}"><button class="danger">Revoke</button></form></div>`,
        )
        .join("")
    : `<p style="margin:0">No MCP tokens yet.</p>`;
  const tokenBlock = d.newToken
    ? `<div class="card" style="margin-top:16px"><b class="ok">New token — copy it now, it is shown only once.</b>
<pre>${esc(d.newToken)}</pre>
<p style="margin:14px 0 0;font-size:13px">Add it to Claude Code:</p>
<pre>claude mcp add --transport http mcu-bridge ${esc(d.origin)}/mcp \\
  --header "Authorization: Bearer ${esc(d.newToken)}"</pre></div>`
    : "";
  return layout(
    "Dashboard",
    `<h1>Dashboard</h1><p>Desktop agents and MCP access for ${esc(d.email)}.</p>
${d.error ? `<div class="err">${esc(d.error)}</div>` : ""}
<h2>Desktop apps</h2><div class="card">${agents}</div>
<h2>MCP access tokens</h2><div class="card">${tokens}
<form method="post" action="/dashboard/tokens" style="margin-top:14px;display:flex;gap:10px;align-items:flex-end"><div style="flex:1"><label for="tn" style="margin-top:0">New token name</label><input id="tn" type="text" name="name" value="Claude Code" maxlength="48" required></div><button>Create token</button></form></div>
${tokenBlock}
<h2>Connected apps (OAuth)</h2><div class="card">${
      d.apps?.length
        ? d.apps.map((a) => `<div class="row"><div><b>${esc(a.name)}</b><div class="meta">connected ${ago(a.since)}</div></div><form method="post" action="/dashboard/apps/revoke" onsubmit="return confirm('Disconnect this app?')"><input type="hidden" name="client_id" value="${esc(a.client_id)}"><button class="danger">Disconnect</button></form></div>`).join("")
        : `<p style="margin:0">No connected apps. Add <span class="mono">${esc(d.origin)}/mcp</span> as a custom connector in claude.ai and approve the sign-in.</p>`
    }</div>
<h2>MCP endpoint</h2><div class="card"><pre>${esc(d.origin)}/mcp</pre><p style="margin:12px 0 0;font-size:13px">Streamable HTTP · authenticate with <span class="mono">Authorization: Bearer &lt;token&gt;</span>. Claude Code Cloud also needs <span class="mono">${esc(new URL(d.origin).host)}</span> in its environment's allowed network hosts so it can upload firmware.</p></div>`,
    { user: d.email },
  );
}

export function landingPage(): string {
  return layout(
    "Home",
    `<h1>MCU Bridge</h1><p>Cloud-to-desktop firmware flashing for AI coding agents. Firmware is compiled in the cloud and streamed straight to your PC — never stored.</p>
<div class="actions" style="margin-top:0"><a href="/login"><button>Sign in</button></a><a href="/signup"><button class="ghost">Create account</button></a></div>
<h2>Endpoints</h2><div class="card"><div class="row"><span class="mono">/mcp</span><span class="meta">MCP · Streamable HTTP</span></div><div class="row"><span class="mono">/api/agent/ws</span><span class="meta">Desktop agent · WSS</span></div><div class="row"><span class="mono">/health</span><span class="meta">Status</span></div></div>`,
  );
}
