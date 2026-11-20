"""Account management calls made with the device credential (see cloud/src/auth/agent-account.ts)."""
from __future__ import annotations

from .http import get_json, post_json


class AccountClient:
    def __init__(self, server: str, token: str) -> None:
        self.server, self.token = server.rstrip("/"), token

    def overview(self) -> dict:
        return get_json(f"{self.server}/api/agent/account", self.token)

    def create_token(self, name: str) -> dict:
        return post_json(f"{self.server}/api/agent/tokens", {"name": name}, self.token)

    def revoke_token(self, token_id: str) -> dict:
        return post_json(f"{self.server}/api/agent/tokens/revoke", {"id": token_id}, self.token)

    def revoke_app(self, client_id: str) -> dict:
        return post_json(f"{self.server}/api/agent/apps/revoke", {"client_id": client_id}, self.token)

    def revoke_agent(self, agent_id: str) -> dict:
        return post_json(f"{self.server}/api/agent/agents/revoke", {"id": agent_id}, self.token)
