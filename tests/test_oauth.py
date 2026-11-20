"""OAuth 2.1 for MCP: exercised exactly like a connector (claude.ai) would, against the local Worker."""
import base64
import hashlib
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request

from conftest import BASE, Web, http

CALLBACK = "https://claude.ai/api/mcp/auth_callback"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def raw_get(path):
    op = urllib.request.build_opener(_NoRedirect)
    try:
        r = op.open(BASE + path)
        return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


def pkce():
    v = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("=")
    return v, c


def register(name="Claude", uris=None):
    s, b, _ = http("POST", BASE + "/oauth/register", json.dumps({"client_name": name, "redirect_uris": uris if uris is not None else [CALLBACK]}).encode(), {"Content-Type": "application/json"})
    return s, json.loads(b)


def token_req(**form):
    s, b, _ = http("POST", BASE + "/oauth/token", urllib.parse.urlencode(form).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    return s, json.loads(b)


def authorize(web, client_id, challenge, state="st4te", redirect=CALLBACK, approve=True, **extra):
    q = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect, "code_challenge": challenge, "code_challenge_method": "S256", "state": state, **extra}
    st, info = web.get("/api/web/oauth/authorize?" + urllib.parse.urlencode(q))
    assert st == 200 and info["status"] == "consent", (st, info)
    st, r = web.post("/api/web/oauth/decision", **info["fields"], decision="approve" if approve else "deny")
    assert st == 200, r
    u = urllib.parse.urlparse(r["redirect"])
    return urllib.parse.parse_qs(u.query), r["redirect"]


def mcp_status(access):
    s, b, _ = http("POST", BASE + "/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(), {"Authorization": "Bearer " + access, "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    return s


def test_discovery(stack):
    s, b, h = http("POST", BASE + "/mcp", b"{}", {"Content-Type": "application/json"})
    assert s == 401 and f'resource_metadata="{BASE}/.well-known/oauth-protected-resource"' in h["WWW-Authenticate"]
    s, b, _ = http("GET", BASE + "/.well-known/oauth-protected-resource")
    pr = json.loads(b)
    assert pr["resource"] == BASE + "/mcp" and pr["authorization_servers"] == [BASE]
    s, b, _ = http("GET", BASE + "/.well-known/oauth-authorization-server")
    md = json.loads(b)
    assert md["code_challenge_methods_supported"] == ["S256"] and md["registration_endpoint"].endswith("/oauth/register")
    assert "none" in md["token_endpoint_auth_methods_supported"]
    s, _, h = http("OPTIONS", BASE + "/oauth/token")
    assert s == 204 and h["Access-Control-Allow-Origin"] == "*"


def test_registration_validation(stack):
    s, c = register()
    assert s == 201 and c["client_id"].startswith("cli_") and c["token_endpoint_auth_method"] == "none"
    for bad in (["javascript:alert(1)"], ["http://evil.example/cb"], ["https://x.example/cb#frag"], [], ["data:text/html,x"], "https://x.example/cb"):
        s, r = register(uris=bad)
        assert s == 400 and r["error"] == "invalid_redirect_uri", bad
    assert register(uris=["http://127.0.0.1:33418/callback"])[0] == 201
    assert register(uris=["cursor://anysphere.cursor-retrieval/oauth/callback"])[0] == 201


def test_full_flow_pkce_refresh_rotation_and_revocation(stack):
    _, client = register("Test Connector")
    cid = client["client_id"]

    # not signed in -> bounced to login, and `next` preserves the authorize request
    v, ch = pkce()
    q = urllib.parse.urlencode({"response_type": "code", "client_id": cid, "redirect_uri": CALLBACK, "code_challenge": ch, "code_challenge_method": "S256", "state": "abc"})
    st, info = Web().get("/api/web/oauth/authorize?" + q)
    assert st == 200 and info["status"] == "login_required"

    # signed in -> consent -> code
    params, _ = authorize(stack.web, cid, ch, state="abc")
    assert params["state"] == ["abc"] and "code" in params
    code = params["code"][0]

    # wrong verifier fails and burns nothing else; code is single-use regardless
    v2, _ = pkce()
    s, r = token_req(grant_type="authorization_code", client_id=cid, code=code, redirect_uri=CALLBACK, code_verifier=v2)
    assert s == 400 and r["error"] == "invalid_grant"
    s, r = token_req(grant_type="authorization_code", client_id=cid, code=code, redirect_uri=CALLBACK, code_verifier=v)
    assert s == 400 and r["error"] == "invalid_grant", "code must be single-use even after a failed attempt"

    # happy path
    params, _ = authorize(stack.web, cid, ch)
    code = params["code"][0]
    s, r = token_req(grant_type="authorization_code", client_id=cid, code=code, redirect_uri="https://evil.example/cb", code_verifier=v)
    assert s == 400 and r["error"] == "invalid_grant"  # redirect mismatch (also burns the code)
    params, _ = authorize(stack.web, cid, ch)
    s, tok = token_req(grant_type="authorization_code", client_id=cid, code=params["code"][0], redirect_uri=CALLBACK, code_verifier=v)
    assert s == 200 and tok["token_type"] == "Bearer" and tok["access_token"].startswith("mcb_mcp_") and tok["refresh_token"].startswith("mcb_rt_") and tok["expires_in"] == 3600

    # the access token drives the real MCP endpoint
    assert mcp_status(tok["access_token"]) == 200

    # refresh rotates
    s, tok2 = token_req(grant_type="refresh_token", client_id=cid, refresh_token=tok["refresh_token"])
    assert s == 200 and tok2["access_token"] != tok["access_token"] and tok2["refresh_token"] != tok["refresh_token"]
    assert mcp_status(tok2["access_token"]) == 200

    # replaying the OLD refresh token = theft signal: whole grant revoked
    s, r = token_req(grant_type="refresh_token", client_id=cid, refresh_token=tok["refresh_token"])
    assert s == 400 and r["error"] == "invalid_grant" and "reuse" in r["error_description"]
    assert mcp_status(tok2["access_token"]) == 401
    assert token_req(grant_type="refresh_token", client_id=cid, refresh_token=tok2["refresh_token"])[0] == 400


def test_dashboard_lists_and_revokes_connected_app(stack):
    _, client = register("Revocable App")
    v, ch = pkce()
    params, _ = authorize(stack.web, client["client_id"], ch)
    s, tok = token_req(grant_type="authorization_code", client_id=client["client_id"], code=params["code"][0], redirect_uri=CALLBACK, code_verifier=v)
    assert s == 200 and mcp_status(tok["access_token"]) == 200
    st, ov = stack.web.get("/api/web/overview")
    assert any(a["name"] == "Revocable App" for a in ov["apps"])
    # OAuth tokens are not listed among manual tokens
    assert not any("OAuth" in t["name"] for t in ov["tokens"])
    st, _ = stack.web.post("/api/web/apps/revoke", client_id=client["client_id"])
    assert mcp_status(tok["access_token"]) == 401
    assert token_req(grant_type="refresh_token", client_id=client["client_id"], refresh_token=tok["refresh_token"])[0] == 400


def test_authorize_request_validation(stack):
    _, client = register("Strict")
    cid = client["client_id"]
    v, ch = pkce()
    base = {"response_type": "code", "client_id": cid, "redirect_uri": CALLBACK, "code_challenge": ch, "code_challenge_method": "S256", "state": "s"}
    info = lambda q: stack.web.get("/api/web/oauth/authorize?" + urllib.parse.urlencode(q))[1]  # noqa: E731
    # unregistered redirect / unknown client: an error is shown, never a redirect
    r = info({**base, "redirect_uri": "https://evil.example/cb"})
    assert r["status"] == "error"
    assert info({**base, "client_id": "cli_nope"})["status"] == "error"
    # PKCE missing / plain method -> redirect (to the registered URI) with an error
    for bad in ({"code_challenge": ""}, {"code_challenge_method": "plain"}):
        r = info({**base, **bad})
        assert r["status"] == "redirect" and "error=invalid_request" in r["url"] and r["url"].startswith(CALLBACK)
    r = info({**base, "resource": "https://other.example/mcp"})
    assert r["status"] == "redirect" and "error=invalid_target" in r["url"]
    # deny
    params, _ = authorize(stack.web, cid, ch, approve=False)
    assert params["error"] == ["access_denied"] and "code" not in params


def test_consent_decision_cannot_be_forged_or_cross_site(stack):
    _, client = register("Forge")
    v, ch = pkce()
    body = {"client_id": client["client_id"], "redirect_uri": CALLBACK, "code_challenge": ch, "decision": "approve"}
    # no session
    st, r = Web().post("/api/web/oauth/decision", **body)
    assert st == 401
    # a signed-in user's browser tricked cross-site must not approve anything
    st, r = stack.web.call("POST", "/api/web/oauth/decision", body, same_origin=False) if False else (None, None)
    req = urllib.request.Request(BASE + "/api/web/oauth/decision", json.dumps(body).encode(), {"Sec-Fetch-Site": "cross-site", "Content-Type": "application/json", "Cookie": "; ".join(f"{c.name}={c.value}" for c in stack.web.jar)})
    try:
        s = urllib.request.urlopen(req).status
    except urllib.error.HTTPError as e:
        s = e.code
    assert s == 403
    # tampering with hidden fields (redirect_uri swapped) is rejected on re-validation
    st, r = stack.web.post("/api/web/oauth/decision", client_id=client["client_id"], redirect_uri="https://evil.example/cb", state="x", code_challenge=ch, resource=BASE + "/mcp", decision="approve")
    assert st == 400


def test_token_endpoint_edge_cases(stack):
    assert token_req(grant_type="client_credentials", client_id="cli_x")[0] == 401  # unknown client first
    _, c = register("Edge")
    s, r = token_req(grant_type="client_credentials", client_id=c["client_id"])
    assert s == 400 and r["error"] == "unsupported_grant_type"
    s, r = token_req(grant_type="authorization_code", client_id=c["client_id"], code="x", code_verifier="short")
    assert s == 400 and r["error"] == "invalid_request"
    s, r = token_req(grant_type="refresh_token", client_id=c["client_id"], refresh_token="mcb_rt_bogus")
    assert s == 400 and r["error"] == "invalid_grant"


def test_clients_that_want_a_secret_get_one_and_must_use_it(stack):
    """Gemini/ChatGPT-style connectors register as confidential clients (client_secret_basic / _post)."""
    for method in ("client_secret_basic", "client_secret_post"):
        s, c = http_json_register(method)
        assert s == 201 and c["client_secret"].startswith("mcb_cs_") and c["token_endpoint_auth_method"] == method
        cid, secret = c["client_id"], c["client_secret"]
        v, ch = pkce()
        params, _ = authorize(stack.web, cid, ch)
        code = params["code"][0]
        form = dict(grant_type="authorization_code", client_id=cid, code=code, redirect_uri=CALLBACK, code_verifier=v)
        # no secret / wrong secret -> invalid_client (and the code is NOT consumed for a failed client authentication)
        assert token_req(**form)[0] == 401
        assert token_req(**form, client_secret="wrong")[0] == 401
        if method == "client_secret_post":
            s, tok = token_req(**form, client_secret=secret)
        else:
            cred = base64.b64encode(f"{cid}:{secret}".encode()).decode()
            s, b, _ = http("POST", BASE + "/oauth/token", urllib.parse.urlencode({k: v2 for k, v2 in form.items() if k != "client_id"}).encode(), {"Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + cred})
            tok = json.loads(b)
        assert s == 200 and tok["access_token"].startswith("mcb_mcp_"), (method, s, tok)
        assert mcp_status(tok["access_token"]) == 200
        # refresh also requires the secret
        assert token_req(grant_type="refresh_token", client_id=cid, refresh_token=tok["refresh_token"])[0] == 401
        assert token_req(grant_type="refresh_token", client_id=cid, refresh_token=tok["refresh_token"], client_secret=secret)[0] == 200
    s, md = 0, json.loads(http("GET", BASE + "/.well-known/oauth-authorization-server")[1])
    assert set(md["token_endpoint_auth_methods_supported"]) >= {"none", "client_secret_post", "client_secret_basic"}


def http_json_register(method):
    s, b, _ = http("POST", BASE + "/oauth/register", json.dumps({"client_name": "Secretive", "redirect_uris": [CALLBACK], "token_endpoint_auth_method": method}).encode(), {"Content-Type": "application/json"})
    return s, json.loads(b)


def test_many_redirect_uris_are_accepted_up_to_a_sane_limit(stack):
    many = [f"https://gemini.google.com/mcp/oauth/callback/{i}" for i in range(20)]
    assert register(uris=many)[0] == 201
    assert register(uris=[f"https://x.example/cb/{i}" for i in range(26)])[0] == 400
