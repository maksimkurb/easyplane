import type { OidcProviderConfig } from "../env.js";
import type { UserRole } from "../db/schema.js";

/** Claims as returned by an ID token or the userinfo endpoint. */
export type Claims = Record<string, unknown>;

export function getStringClaim(claims: Claims, name: string): string | undefined {
  const value = claims[name];
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Groups may be an array or a single space/comma separated string. */
export function getGroups(claims: Claims, claimName: string): string[] {
  const value = claims[claimName];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

export function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}

export interface MappedIdentity {
  role: UserRole;
  email: string;
  displayName: string;
  groups: string[];
}

/**
 * Maps OIDC claims to a local identity.
 *
 * - `admin` when any group matches `adminGroups` (admin wins over member),
 * - `member` when any group matches `memberGroups`,
 * - `defaultRole` (viewer by default) otherwise.
 * A non-empty `allowedEmailDomains` rejects other domains outright.
 */
export function mapIdentity(
  provider: OidcProviderConfig,
  claims: Claims,
): MappedIdentity {
  const email = getStringClaim(claims, provider.emailClaim);
  if (!email) {
    throw new Error(`identity has no "${provider.emailClaim}" claim`);
  }
  if (provider.allowedEmailDomains.length > 0) {
    const domain = emailDomain(email);
    const allowed = provider.allowedEmailDomains.some(
      (candidate) => candidate.toLowerCase() === domain,
    );
    if (!allowed) {
      throw new Error(`email domain is not allowed for provider ${provider.id}`);
    }
  }

  const groups = getGroups(claims, provider.roleClaim);
  const groupSet = new Set(groups);
  let role: UserRole = provider.defaultRole;
  if (provider.adminGroups.some((group) => groupSet.has(group))) {
    role = "admin";
  } else if (provider.memberGroups.some((group) => groupSet.has(group))) {
    role = "member";
  }

  const displayName =
    getStringClaim(claims, provider.nameClaim) ??
    getStringClaim(claims, "preferred_username") ??
    email;

  return { role, email: email.toLowerCase(), displayName, groups };
}
