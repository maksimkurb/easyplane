import { common, manage } from "@easyplane/proto";

import type { DeviceRole, NetworkAccessMode } from "../db/schema.js";

/**
 * EasyTier credential-mode semantics, derived from the pinned commit
 * (`credential_manager.rs`, `config/api_input.rs`, `peers/peer_ospf_route.rs`)
 * and verified against real clients in the Phase-1 spike (docs/CREDENTIALS.md).
 *
 * - A **member** config has `network_name` but **no** `network_secret`, plus
 *   `secure_mode.local_private_key` = the credential secret. `gen_config` then
 *   calls `NetworkIdentity::new_credential(network_name)` (name-only identity).
 * - An **anchor** config has the network secret and lists every active member
 *   in `managed_credentials`; that list is the credential trust root and is
 *   published over OSPF with an HMAC keyed by the network secret.
 * - `credential_secret` is base64 of the raw 32-byte X25519 private key.
 */

/** One credential as the compiler needs it (secret already decrypted). */
export interface CredentialMaterial {
  /** EasyTier `credential_id`. */
  credentialId: string;
  /** `base64(X25519 private key)`; never logged, never sent to members. */
  secret: string;
  /** `base64(X25519 public key)`; safe to show. */
  publicKey: string;
  groups: readonly string[];
  allowRelay: boolean;
  allowedProxyCidrs: readonly string[];
  /** Unix seconds. */
  expiryUnix: number;
  reusable: boolean;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/**
 * The `managed_credentials` list pushed to an anchor. Sorted by
 * `credential_id` so the compiled config is stable (no spurious repush/restart
 * when the database returns rows in another order).
 */
export function buildManagedCredentials(
  entries: readonly CredentialMaterial[],
): manage.ManagedCredentialConfig[] {
  return [...entries]
    .sort((left, right) =>
      left.credentialId.localeCompare(right.credentialId),
    )
    .map((entry) => ({
      credentialId: entry.credentialId,
      credentialSecret: entry.secret,
      groups: uniqueSorted(entry.groups),
      allowRelay: entry.allowRelay,
      allowedProxyCidrs: uniqueSorted(entry.allowedProxyCidrs),
      expiryUnix: BigInt(entry.expiryUnix),
      reusable: entry.reusable,
    }));
}

/**
 * `secure_mode` for a credential member: enabled, with the credential's
 * X25519 key. The client derives `local_public_key` itself; passing it is
 * harmless but unnecessary.
 */
export function buildMemberSecureMode(
  material: Pick<CredentialMaterial, "secret">,
): common.SecureModeConfig {
  return { enabled: true, localPrivateKey: material.secret };
}

/**
 * Semantic comparison of the managed credential list the client reports
 * against the desired one. Secrets are compared by presence only (they are
 * already ours); the grant, id and expiry decide drift, so revoke/renew is
 * pushed even when only the expiry moved.
 */
export function managedCredentialsMatch(
  remote: readonly manage.ManagedCredentialConfig[] | undefined,
  desired: readonly manage.ManagedCredentialConfig[],
): boolean {
  const left = remote ?? [];
  if (left.length !== desired.length) return false;
  const byId = new Map(left.map((entry) => [entry.credentialId, entry]));
  for (const entry of desired) {
    const found = byId.get(entry.credentialId);
    if (!found) return false;
    if (found.credentialSecret !== entry.credentialSecret) return false;
    if ((found.groups ?? []).join(",") !== entry.groups.join(",")) return false;
    if (Boolean(found.allowRelay) !== Boolean(entry.allowRelay)) return false;
    if (
      (found.allowedProxyCidrs ?? []).join(",") !==
      entry.allowedProxyCidrs.join(",")
    ) {
      return false;
    }
    if (BigInt(found.expiryUnix ?? 0) !== BigInt(entry.expiryUnix ?? 0)) {
      return false;
    }
    if ((found.reusable ?? true) !== entry.reusable) return false;
  }
  return true;
}

/**
 * Which role a device really has. In `shared_secret` mode every device holds
 * the secret, so the stored role is informational and the effective role is
 * always `anchor`.
 */
export function effectiveRole(
  accessMode: NetworkAccessMode,
  role: DeviceRole,
): DeviceRole {
  return accessMode === "credentials" ? role : "anchor";
}

/** Whether the device holds the network secret (i.e. can never be revoked). */
export function knowsNetworkSecret(
  accessMode: NetworkAccessMode,
  role: DeviceRole,
): boolean {
  return effectiveRole(accessMode, role) === "anchor";
}

/** Credential groups are EasyTier ACL group names; our tags map 1:1. */
export function credentialGroupsFromTags(tags: readonly string[]): string[] {
  return uniqueSorted(tags.filter((tag) => tag.length > 0 && tag.length <= 128));
}

/**
 * A credential is usable while `status = active` and `expiry > now`. Expiry is
 * enforced by the clients as well (the anchor's 1 s GC closes expired peers),
 * so the panel's status is informational after the fact.
 */
export function isCredentialUsable(
  credential: { status: string; expiry: Date | string },
  now: Date = new Date(),
): boolean {
  if (credential.status !== "active") return false;
  const expiry =
    credential.expiry instanceof Date
      ? credential.expiry
      : new Date(credential.expiry);
  return expiry.getTime() > now.getTime();
}

/** `active` while usable, otherwise `revoked` or `expired`. */
export function credentialStatusAt(
  credential: { status: string; expiry: Date | string },
  now: Date = new Date(),
): "active" | "revoked" | "expired" {
  if (credential.status === "revoked") return "revoked";
  return isCredentialUsable(credential, now) ? "active" : "expired";
}

/**
 * Default credential TTL. Credentials are renewed before they expire; a long
 * default keeps the anchor restarts caused by renewal rare (a renewal is a
 * full `RunNetworkInstance`, see docs/CREDENTIALS.md).
 */
export const DEFAULT_CREDENTIAL_TTL_DAYS = 90;

/** Renew when less than this fraction of the TTL remains. */
export const CREDENTIAL_RENEW_RATIO = 0.25;

export function credentialExpiry(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
