import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAdmin, handleInviteRequest, isAdminEmail } from "../src/auth/admin";
import { canonicalCode, claimInvite, createInvite, generateInviteCode, releaseInvite } from "../src/auth/invites";
import type { Env } from "../src/env";
import { bareAddress, buildMime, cleanHeader, escapeHtml, mailTransport } from "../src/lib/mail";
import { fakeD1 } from "./helpers/d1";

const mkEnv = (extra: Partial<Env> = {}): Env => ({ DB: fakeD1(), SIGNUP_CODE: "master-code", JOB_SIGNING_KEY: "k", ...extra }) as unknown as Env;
const URLO = new URL("https://flash.example/api/web/invite-request");
const req = (ip = "1.1.1.1") => new Request(URLO, { method: "POST", headers: { "cf-connecting-ip": ip } });
afterEach(() => vi.restoreAllMocks());

describe("invite codes", () => {
  it("generates FLASH-XXXX-XXXX-XXXX from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) expect(generateInviteCode()).toMatch(/^FLASH-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(generateInviteCode()).not.toBe(generateInviteCode());
  });
  it("ignores case, dashes and spaces when typed", () => {
    expect(canonicalCode(" flash-abcd 2345-6789 ")).toBe("FLASHABCD23456789");
  });
  it("single-use codes work once; releasing gives the seat back", async () => {
    const env = mkEnv();
    const { code } = await createInvite(env, { label: "x", maxUses: 1 });
    const id = await claimInvite(env, code.toLowerCase().replace(/-/g, " "));
    expect(id).toBeTruthy();
    expect(await claimInvite(env, code)).toBeNull();
    await releaseInvite(env, id!);
    expect(await claimInvite(env, code)).toBeTruthy();
  });
  it("multi-use codes stop at max_uses", async () => {
    const env = mkEnv();
    const { code } = await createInvite(env, { maxUses: 2 });
    expect(await claimInvite(env, code)).toBeTruthy();
    expect(await claimInvite(env, code)).toBeTruthy();
    expect(await claimInvite(env, code)).toBeNull();
  });
  it("rejects unknown, expired and revoked codes", async () => {
    const env = mkEnv();
    expect(await claimInvite(env, "FLASH-AAAA-BBBB-CCCC")).toBeNull();
    const exp = await createInvite(env, { maxUses: 1, expiresDays: 1 });
    await env.DB.prepare("UPDATE invite_codes SET expires_at = 1 WHERE id = ?1").bind(exp.id).run();
    expect(await claimInvite(env, exp.code)).toBeNull();
    const rev = await createInvite(env, { maxUses: 1 });
    await handleAdmin(env, new URL("https://x/api/web/admin/invites/revoke"), "POST", { id: rev.id });
    expect(await claimInvite(env, rev.code)).toBeNull();
  });
  it("never stores the code itself", async () => {
    const env = mkEnv();
    const { code } = await createInvite(env, { maxUses: 1 });
    const rows = await env.DB.prepare("SELECT * FROM invite_codes").all();
    expect(JSON.stringify(rows.results)).not.toContain(code);
    expect(JSON.stringify(rows.results)).not.toContain(canonicalCode(code));
  });
});

describe("mail helpers", () => {
  it("strips line breaks from headers (no header injection)", () => {
    expect(cleanHeader("a\r\nBcc: evil@x.com")).toBe("a Bcc: evil@x.com");
    const mime = buildMime({ from: "F <a@b.co>", to: "x@y.z\r\nBcc: evil@x.com", subject: "hi\nBcc: e@x.com", text: "body" });
    expect(mime.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });
  it("parses sender addresses and escapes html", () => {
    expect(bareAddress("Flashlink <invite@d.co>")).toBe("invite@d.co");
    expect(bareAddress("invite@d.co")).toBe("invite@d.co");
    expect(escapeHtml(`<b onclick="x">&'`)).toBe("&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;");
  });
  it("picks a transport only when MAIL_FROM is set", () => {
    expect(mailTransport(mkEnv())).toBeNull();
    expect(mailTransport(mkEnv({ MAIL_FROM: "a@b.co" }))).toBeNull();
    expect(mailTransport(mkEnv({ MAIL_FROM: "a@b.co", RESEND_API_KEY: "k" }))).toBe("resend");
  });
});

describe("invite requests", () => {
  it("stores the request and mails the owner (Resend)", async () => {
    const env = mkEnv({ ADMIN_EMAIL: "owner@x.co", MAIL_FROM: "Flashlink <invite@x.co>", RESEND_API_KEY: "rk" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await handleInviteRequest(req(), env, URLO, { email: "Ada@Example.com", name: "Ada", message: "I build robots" });
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.to).toEqual(["owner@x.co"]);
    expect(sent.reply_to).toBe("ada@example.com");
    expect(sent.text).toContain("I build robots");
    const row = await env.DB.prepare("SELECT email, status, mail_status FROM invite_requests").first<{ email: string; status: string; mail_status: string }>();
    expect(row).toMatchObject({ email: "ada@example.com", status: "pending", mail_status: "sent:resend" });
  });
  it("still stores the request when mail is not configured", async () => {
    const env = mkEnv();
    await handleInviteRequest(req(), env, URLO, { email: "b@example.com" });
    expect(await env.DB.prepare("SELECT mail_status FROM invite_requests").first()).toMatchObject({ mail_status: "not_configured" });
  });
  it("records a failed send without failing the request", async () => {
    const env = mkEnv({ ADMIN_EMAIL: "o@x.co", MAIL_FROM: "a@x.co", RESEND_API_KEY: "rk" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const r = await handleInviteRequest(req(), env, URLO, { email: "c@example.com" });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT mail_status FROM invite_requests").first<{ mail_status: string }>();
    expect(row!.mail_status).toMatch(/^failed:Resend 403/);
  });
  it("validates, dedupes pending requests, ignores the honeypot and rate limits", async () => {
    const env = mkEnv();
    expect((await handleInviteRequest(req(), env, URLO, { email: "not-an-email" })).status).toBe(400);
    await handleInviteRequest(req(), env, URLO, { email: "d@example.com" });
    await handleInviteRequest(req("2.2.2.2"), env, URLO, { email: "d@example.com" });
    await handleInviteRequest(req("3.3.3.3"), env, URLO, { email: "bot@example.com", website: "http://spam" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM invite_requests").first<{ n: number }>())!.n).toBe(1);
    for (let i = 0; i < 4; i++) await handleInviteRequest(req("9.9.9.9"), env, URLO, { email: `u${i}@example.com` });
    expect((await handleInviteRequest(req("9.9.9.9"), env, URLO, { email: "u9@example.com" })).status).toBe(429);
  });
});

describe("admin", () => {
  it("only the ADMIN_EMAIL account is admin (case-insensitive)", () => {
    expect(isAdminEmail(mkEnv({ ADMIN_EMAIL: "Owner@X.co" }), "owner@x.CO")).toBe(true);
    expect(isAdminEmail(mkEnv({ ADMIN_EMAIL: "owner@x.co" }), "other@x.co")).toBe(false);
    expect(isAdminEmail(mkEnv(), "owner@x.co")).toBe(false);
  });
  it("approve creates a code, marks the request and can email it; reject just closes it", async () => {
    const env = mkEnv({ ADMIN_EMAIL: "o@x.co", MAIL_FROM: "a@x.co", RESEND_API_KEY: "rk" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await handleInviteRequest(req(), env, URLO, { email: "e@example.com" });
    await handleInviteRequest(req("4.4.4.4"), env, URLO, { email: "f@example.com" });
    const { requests } = (await (await handleAdmin(env, new URL("https://flash.example/api/web/admin/overview"), "GET", null))!.json()) as { requests: { id: string; email: string }[] };
    const [e, f] = [requests.find((r) => r.email === "e@example.com")!, requests.find((r) => r.email === "f@example.com")!];
    fetchMock.mockClear();
    const ok = (await (await handleAdmin(env, new URL("https://flash.example/api/web/admin/requests/decision"), "POST", { id: e.id, decision: "approve", send_mail: true, max_uses: 1, expires_days: 7 }))!.json()) as { code: string; mail: string };
    expect(ok.code).toMatch(/^FLASH-/);
    expect(ok.mail).toBe("sent:resend");
    const mailed = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(mailed.to).toEqual(["e@example.com"]);
    expect(mailed.text).toContain(ok.code);
    expect(await claimInvite(env, ok.code)).toBeTruthy();
    const again = await handleAdmin(env, new URL("https://x/api/web/admin/requests/decision"), "POST", { id: e.id, decision: "reject" });
    expect(again!.status).toBe(409);
    await handleAdmin(env, new URL("https://x/api/web/admin/requests/decision"), "POST", { id: f.id, decision: "reject" });
    expect(await env.DB.prepare("SELECT status FROM invite_requests WHERE id = ?1").bind(f.id).first()).toMatchObject({ status: "rejected" });
  });
  it("manual invites return the code once and list without it", async () => {
    const env = mkEnv();
    const made = (await (await handleAdmin(env, new URL("https://x/api/web/admin/invites"), "POST", { label: "Workshop", max_uses: 25, expires_days: 30 }))!.json()) as { code: string };
    const overview = await (await handleAdmin(env, new URL("https://x/api/web/admin/overview"), "GET", null))!.text();
    expect(overview).toContain("Workshop");
    expect(overview).not.toContain(made.code);
    expect(overview).toContain(made.code.slice(-4));
  });
});
