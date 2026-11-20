import type { Env } from "../env";
import type { UserHub } from "../durable-objects/user-hub";

/**
 * Typed handle to a user's hub Durable Object. The generated RPC stub types
 * collapse to `never` for return values containing `unknown`, so we expose the
 * class' own method signatures instead (values are structured-cloned anyway).
 */
export function hubOf(env: Env, userId: string): UserHub {
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId)) as unknown as UserHub;
}
