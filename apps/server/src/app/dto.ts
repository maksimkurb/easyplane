import type { Organisation, User } from "../db/schema.js";
import type { AuditEntry } from "../db/schema.js";

export function toUserDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    groups: user.groups,
    bootstrap: user.bootstrap,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function toOrganisationDto(organisation: Organisation) {
  return {
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
  };
}

export function toAuditDto(entry: AuditEntry) {
  return {
    id: entry.id,
    actorUserId: entry.actorUserId,
    actorType: entry.actorType,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Origin used for OIDC redirect URIs and invite commands.
 * `EASYPLANE_PUBLIC_URL` must match the browser-visible origin when set.
 */
export function publicBaseUrl(
  configured: string | undefined,
  request: { protocol: string; host: string },
): string {
  return configured ?? `${request.protocol}://${request.host}`;
}

/** Config-server base used in `easytier-core --config-server <base>/<token>`. */
export function configServerBaseUrl(
  configured: string | undefined,
  request: { protocol: string; host: string },
): string {
  if (configured) return configured;
  const scheme = request.protocol === "https" ? "wss" : "ws";
  return `${scheme}://${request.host}`;
}
