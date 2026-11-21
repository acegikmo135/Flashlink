/** Outgoing mail. Two optional transports; with neither configured, requests are still stored and shown in the admin dashboard. */
import type { Env } from "../env";
import { randomToken } from "./crypto";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export type MailResult = { ok: true; via: "resend" | "cloudflare" } | { ok: false; via?: string; error: string };

/** Which transport is available (Resend wins if both are set). */
export function mailTransport(env: Env): "resend" | "cloudflare" | null {
  if (!env.MAIL_FROM) return null;
  if (env.RESEND_API_KEY) return "resend";
  if (env.SEND_EMAIL) return "cloudflare";
  return null;
}

const LINE_BREAKS = new RegExp("[\\r\\n\\u2028\\u2029]+", "g");

/** Header values must never contain line breaks (header injection). */
export function cleanHeader(s: string, max = 200): string {
  return s.replace(LINE_BREAKS, " ").trim().slice(0, max);
}

/** "Name <a@b.c>" → "a@b.c"; a bare address is returned unchanged. */
export function bareAddress(s: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s);
  return (m ? m[1] : s).trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
const encodeSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** A minimal RFC 5322 message (text only, base64 body) for the Cloudflare `send_email` binding. */
export function buildMime(o: { from: string; to: string; subject: string; text: string; replyTo?: string; messageId?: string }): string {
  const from = bareAddress(o.from);
  const domain = from.split("@")[1] ?? "localhost";
  const headers = [
    `From: ${cleanHeader(o.from)}`,
    `To: ${cleanHeader(o.to)}`,
    ...(o.replyTo ? [`Reply-To: ${cleanHeader(o.replyTo)}`] : []),
    `Subject: ${encodeSubject(cleanHeader(o.subject, 300))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${o.messageId ?? randomToken(12)}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(b64(o.text))}\r\n`;
}

export async function sendMail(env: Env, mail: Mail): Promise<MailResult> {
  const via = mailTransport(env);
  if (!via) return { ok: false, error: "Mail is not configured." };
  try {
    if (via === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: cleanHeader(mail.subject, 300), text: mail.text, html: mail.html, reply_to: mail.replyTo }),
      });
      if (!res.ok) return { ok: false, via, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true, via };
    }
    const { EmailMessage } = await import("cloudflare:email");
    const raw = buildMime({ from: env.MAIL_FROM!, to: mail.to, subject: mail.subject, text: mail.text, replyTo: mail.replyTo });
    await env.SEND_EMAIL!.send(new EmailMessage(bareAddress(env.MAIL_FROM!), mail.to, raw));
    return { ok: true, via };
  } catch (e) {
    return { ok: false, via, error: e instanceof Error ? e.message.slice(0, 200) : "send failed" };
  }
}
