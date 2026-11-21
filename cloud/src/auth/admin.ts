/** Owner-only admin API (/api/web/admin/*) and the public invite-request endpoint. */
import type { Env } from "../env";
import { randomId, sha256Hex } from "../lib/crypto";
import { clientIp, errorJson, json } from "../lib/http";
import { cleanHeader, escapeHtml, mailTransport, sendMail } from "../lib/mail";
import { rateLimit } from "../lib/ratelimit";
import { createInvite } from "./invites";

const str = (v: unknown, max = 256) => (typeof v === "string" ? v.slice(0, max) : "");
const EMAIL_RE = /^[^@\s<>,;]{1,64}@[^@\s<>,;]{1,255}$/;

export function isAdminEmail(env: Env, email: string | undefined | null): boolean {
  return !!env.ADMIN_EMAIL && !!email && email.trim().toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase();
}

/** POST /api/web/invite-request — anyone can ask; the owner is notified by mail and approves from the dashboard. */
export async function handleInviteRequest(request: Request, env: Env, url: URL, b: Record<string, unknown> | null): Promise<Response> {
  if (!b) return errorJson(400, "BAD_REQUEST", "JSON body required.");
  const ok = () => json({ ok: true, message: "Request received. If it is approved you will get an invite code by email." });
  if (str(b.website)) return ok(); // honeypot: bots fill hidden fields
  const email = str(b.email, 320).trim().toLowerCase();
  const name = cleanHeader(str(b.name, 80));
  const message = str(b.message, 500).replace(/\r/g, "").trim();
  if (!EMAIL_RE.test(email)) return errorJson(400, "INVALID_EMAIL", "Enter a valid email address.");
  const ip = clientIp(request);
  if (!(await rateLimit(env, `invreq-ip:${ip}`, 4, 3600)) || !(await rateLimit(env, `invreq-mail:${email}`, 3, 86_400))) return errorJson(429, "RATE_LIMITED", "Too many requests. Try again later.");
  // Already registered, or already waiting? Answer the same way — don't reveal which, don't spam the owner.
  const known = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM users WHERE email = ?1) AS u, (SELECT COUNT(*) FROM invite_requests WHERE email = ?1 AND status = 'pending') AS p").bind(email).first<{ u: number; p: number }>();
  if (known && (known.u > 0 || known.p > 0)) return ok();

  const id = randomId("req", 9);
  let mailStatus = "not_configured";
  if (env.ADMIN_EMAIL && mailTransport(env)) {
    const link = `${url.origin}/dashboard/admin`;
    const text = `New invite request\n\nName: ${name || "(not given)"}\nEmail: ${email}\n\n${message || "(no message)"}\n\nReview and approve: ${link}\n`;
    const html = `<p><b>New invite request</b></p><p>Name: ${escapeHtml(name || "(not given)")}<br>Email: ${escapeHtml(email)}</p><p>${escapeHtml(message || "(no message)").replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(link)}">Review and approve</a></p>`;
    const r = await sendMail(env, { to: env.ADMIN_EMAIL, subject: `Flashlink invite request: ${name || email}`, text, html, replyTo: email });
    mailStatus = r.ok ? `sent:${r.via}` : `failed:${r.error}`.slice(0, 200);
  }
  await env.DB.prepare("INSERT INTO invite_requests (id, email, name, message, status, ip_hash, created_at, mail_status) VALUES (?1,?2,?3,?4,'pending',?5,?6,?7)")
    .bind(id, email, name || null, message || null, (await sha256Hex(ip)).slice(0, 16), Date.now(), mailStatus)
    .run();
  return ok();
}

async function inviteMail(env: Env, url: URL, to: string, code: string, expires: number | null): Promise<string> {
  if (!mailTransport(env)) return "not_configured";
  const link = `${url.origin}/signup`;
  const exp = expires ? `\nThe code is valid until ${new Date(expires).toUTCString()}.` : "";
  const text = `You're invited to Flashlink.\n\nYour invite code: ${code}\n\nCreate your account at ${link}${exp}\n`;
  const html = `<p>You're invited to Flashlink.</p><p>Your invite code:<br><b style="font-size:18px;letter-spacing:1px">${escapeHtml(code)}</b></p><p><a href="${escapeHtml(link)}">Create your account</a></p>${expires ? `<p>Valid until ${escapeHtml(new Date(expires).toUTCString())}.</p>` : ""}`;
  const r = await sendMail(env, { to, subject: "Your Flashlink invite code", text, html });
  return r.ok ? `sent:${r.via}` : `failed:${r.error}`.slice(0, 200);
}

/** Returns a Response for /api/web/admin/* (caller has already verified the user is the admin), else null. */
export async function handleAdmin(env: Env, url: URL, method: string, b: Record<string, unknown> | null): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/api/web/admin/overview" && method === "GET") {
    const [requests, invites, users, counts] = await Promise.all([
      env.DB.prepare("SELECT id, email, name, message, status, created_at, handled_at, invite_id, mail_status FROM invite_requests ORDER BY created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT id, code_hint, label, email, max_uses, uses, expires_at, created_at, revoked_at, request_id FROM invite_codes ORDER BY created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT u.id AS id, u.email AS email, u.created_at AS created_at, i.label AS invite_label FROM users u LEFT JOIN invite_codes i ON i.id = u.invite_id ORDER BY u.created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM invite_requests WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM invite_codes WHERE revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?1)) AS active_invites, (SELECT COUNT(*) FROM agents WHERE revoked_at IS NULL) AS agents, (SELECT COUNT(*) FROM jobs) AS jobs").bind(Date.now()).first(),
    ]);
    return json({
      ok: true,
      mail: { transport: mailTransport(env), admin_email_set: !!env.ADMIN_EMAIL, from_set: !!env.MAIL_FROM },
      master_code_set: !!env.SIGNUP_CODE,
      stats: counts,
      requests: requests.results,
      invites: invites.results,
      users: users.results,
    });
  }

  if (path === "/api/web/admin/invites" && method === "POST") {
    if (!b) return errorJson(400, "BAD_REQUEST", "JSON body required.");
    const email = str(b.email, 320).trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return errorJson(400, "INVALID_EMAIL", "Enter a valid email address.");
    const inv = await createInvite(env, { label: cleanHeader(str(b.label, 80)) || undefined, email: email || undefined, maxUses: Number(b.max_uses) || 1, expiresDays: Number(b.expires_days) || 0 });
    const mail = b.send_mail && email ? await inviteMail(env, url, email, inv.code, inv.expires_at) : "skipped";
    return json({ ok: true, id: inv.id, code: inv.code, expires_at: inv.expires_at, mail });
  }

  if (path === "/api/web/admin/invites/revoke" && method === "POST") {
    const res = await env.DB.prepare("UPDATE invite_codes SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL").bind(Date.now(), str(b?.id, 64)).run();
    return json({ ok: !!res.meta.changes });
  }

  if (path === "/api/web/admin/requests/decision" && method === "POST") {
    const id = str(b?.id, 64);
    const row = await env.DB.prepare("SELECT id, email, status FROM invite_requests WHERE id = ?1").bind(id).first<{ id: string; email: string; status: string }>();
    if (!row) return errorJson(404, "NOT_FOUND", "Unknown request.");
    if (row.status !== "pending") return errorJson(409, "HANDLED", `This request is already ${row.status}.`);
    if (b?.decision === "reject") {
      await env.DB.prepare("UPDATE invite_requests SET status = 'rejected', handled_at = ?1 WHERE id = ?2").bind(Date.now(), id).run();
      return json({ ok: true, status: "rejected" });
    }
    if (b?.decision !== "approve") return errorJson(400, "BAD_REQUEST", "decision must be approve or reject.");
    const inv = await createInvite(env, { label: row.email, email: row.email, maxUses: Number(b.max_uses) || 1, expiresDays: Number(b.expires_days) || 0, requestId: id });
    const mail = b.send_mail ? await inviteMail(env, url, row.email, inv.code, inv.expires_at) : "skipped";
    await env.DB.prepare("UPDATE invite_requests SET status = 'approved', handled_at = ?1, invite_id = ?2 WHERE id = ?3").bind(Date.now(), inv.id, id).run();
    return json({ ok: true, status: "approved", id: inv.id, code: inv.code, expires_at: inv.expires_at, mail });
  }

  if (path === "/api/web/admin/requests/delete" && method === "POST") {
    const res = await env.DB.prepare("DELETE FROM invite_requests WHERE id = ?1 AND status != 'pending'").bind(str(b?.id, 64)).run();
    return json({ ok: !!res.meta.changes });
  }

  return null;
}
