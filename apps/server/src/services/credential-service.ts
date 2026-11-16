import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import type { DbExecutor } from "../db/repositories.js";
import {
  getCredentialByDevice,
  listApprovedDevicesByRole,
  listApprovedDevicesInNetwork,
  listCredentialsForNetwork,
  listPublishableCredentials,
  insertCredential,
  updateCredential,
} from "../db/repositories.js";
import { devices, type Credential, type Device, type Network, type NetworkAccessMode } from "../db/schema.js";
import {
  credentialGroupsFromTags,
  credentialStatusAt,
  effectiveRole,
  isCredentialUsable,
  type CredentialMaterial,
} from "../domain/credentials.js";
import {
  credentialPublicKey,
  generateCredentialKeypair,
} from "../security/credential-keys.js";
import type { SecretBox } from "../security/crypto.js";
import type { Logger } from "../logger.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { AuditService } from "./audit.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";

/** Browser-safe credential view. Never contains the secret or the private key. */
export interface CredentialDto {
  id: string;
  networkId: string;
  deviceId: string;
  credentialId: string;
  /** `base64(X25519 public key)`; the OSPF-published identity. */
  publicKey: string;
  groups: string[];
  allowRelay: boolean;
  allowedProxyCidrs: string[];
  reusable: boolean;
  expiry: string;
  status: "active" | "revoked" | "expired";
  revocationReason: string;
  revokedAt: string | null;
  createdAt: string;
}

function toDto(credential: Credential, now: Date): CredentialDto {
  return {
    id: credential.id,
    networkId: credential.networkId,
    deviceId: credential.deviceId,
    credentialId: credential.credentialId,
    publicKey: credential.publicKey,
    groups: credential.groups,
    allowRelay: credential.allowRelay,
    allowedProxyCidrs: credential.allowedProxyCidrs,
    reusable: credential.reusable,
    expiry: credential.expiry.toISOString(),
    status: credentialStatusAt(credential, now),
    revocationReason: credential.revocationReason,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    createdAt: credential.createdAt.toISOString(),
  };
}

export interface CredentialMigrationPlan {
  mode: NetworkAccessMode;
  targetMode: NetworkAccessMode;
  /** Approved devices that keep (or gain) the network secret. */
  anchors: Array<{ deviceId: string; hostname: string }>;
  /** Approved devices that would join with a credential. */
  members: Array<{
    deviceId: string;
    hostname: string;
    /** An active credential exists already (only on repeated previews). */
    hasCredential: boolean;
  }>;
  /** Devices that are not approved yet; their invite role decides later. */
  pendingDevices: Array<{
    deviceId: string;
    hostname: string;
    role: "anchor" | "member";
  }>;
  /** Devices whose credentials would be revoked by this change. */
  revokeCredentials: number;
  /** Devices that receive or lose the network secret. */
  gainSecret: number;
  loseSecret: number;
  warnings: string[];
  /** Whether the mode would actually change. */
  changes: boolean;
}

export interface CredentialServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  audit: AuditService;
  logger: Logger;
  realtime?: RealtimeHub;
  /** Credential lifetime (default 90 days). */
  ttlMs: number;
  /** Renew when less than this remains (default 14 days). */
  renewBeforeMs: number;
  /**
   * Called after a credential change with the network and, when only one
   * member's identity changed, that device. Wired to push anchors and the
   * affected member (kept as a callback to avoid a service cycle).
   */
  onCredentialsChanged: (
    networkId: string,
    reason: string,
    memberDeviceId?: string,
  ) => Promise<void> | void;
  now?: () => Date;
}

/**
 * Per-device EasyTier credentials (mode B, docs/CREDENTIALS.md).
 *
 * The service owns the credential lifecycle: issue on approval, renew before
 * expiry, revoke individually, and the guided access-mode migration. It never
 * returns a secret except to the push compiler, and it never writes one to the
 * audit log.
 */
export class CredentialService {
  constructor(private readonly options: CredentialServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async listForNetwork(networkId: string): Promise<CredentialDto[]> {
    const now = this.now();
    const rows = await listCredentialsForNetwork(this.options.db, networkId);
    return rows.map((row) => toDto(row, now));
  }

  async forDevice(deviceId: string): Promise<CredentialDto | null> {
    const row = await getCredentialByDevice(this.options.db, deviceId);
    return row ? toDto(row, this.now()) : null;
  }

  /** Credential status for a device DTO (no secret). */
  async statusForDevice(
    deviceId: string,
  ): Promise<CredentialDto | null> {
    return this.forDevice(deviceId);
  }

  /**
   * Active, unexpired credentials of a network as the anchor compiler needs
   * them (secret decrypted). Only called when building an anchor config.
   */
  async publishableMaterial(
    networkId: string,
  ): Promise<CredentialMaterial[]> {
    const now = this.now();
    const rows = await listPublishableCredentials(
      this.options.db,
      networkId,
      now,
    );
    return rows.map((row) => this.material(row));
  }

  /** The credential a member runs its own instance with, if usable. */
  async memberMaterial(deviceId: string): Promise<CredentialMaterial | null> {
    const row = await getCredentialByDevice(this.options.db, deviceId);
    if (!row || !isCredentialUsable(row, this.now())) return null;
    return this.material(row);
  }

  private material(row: Credential): CredentialMaterial {
    return {
      credentialId: row.credentialId,
      secret: this.options.secretBox.decrypt(row.secretCiphertext),
      publicKey: row.publicKey,
      groups: row.groups,
      allowRelay: row.allowRelay,
      allowedProxyCidrs: row.allowedProxyCidrs,
      expiryUnix: Math.floor(row.expiry.getTime() / 1000),
      reusable: row.reusable,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Issues (or re-issues) the credential of one member. A device keeps a
   * single row: an existing `revoked`/`expired` row is replaced, an existing
   * `active` row is returned unchanged unless `force`.
   */
  async issueForDevice(input: {
    network: Network;
    device: Device;
    userId: string | null;
    reason?: string;
    force?: boolean;
    tags?: string[];
  }): Promise<CredentialDto> {
    const { network, device } = input;
    if (network.accessMode !== "credentials") {
      invalid("this network does not use per-device credentials");
    }
    if (effectiveRole(network.accessMode, device.role) !== "member") {
      invalid("anchors hold the network secret and do not need a credential");
    }
    const now = this.now();
    const existing = await getCredentialByDevice(this.options.db, device.id);
    if (existing && !input.force && isCredentialUsable(existing, now)) {
      return toDto(existing, now);
    }
    const keypair = generateCredentialKeypair();
    const expiry = new Date(now.getTime() + this.options.ttlMs);
    const groups = credentialGroupsFromTags(input.tags ?? []);
    const createdBy = input.userId;
    const row = existing
      ? await updateCredential(this.options.db, existing.id, {
          credentialId: randomUUID(),
          secretCiphertext: this.options.secretBox.encrypt(keypair.secret),
          publicKey: keypair.publicKey,
          groups,
          allowRelay: true,
          allowedProxyCidrs: [],
          reusable: true,
          expiry,
          status: "active",
          revokedAt: null,
          revokedBy: null,
          revocationReason: "",
          createdBy,
        })
      : await insertCredential(this.options.db, {
          orgId: network.orgId,
          networkId: network.id,
          deviceId: device.id,
          credentialId: randomUUID(),
          secretCiphertext: this.options.secretBox.encrypt(keypair.secret),
          publicKey: keypair.publicKey,
          groups,
          allowRelay: true,
          allowedProxyCidrs: [],
          reusable: true,
          expiry,
          status: "active",
          createdBy,
        });
    if (!row) throw new AppError(500, "failed to store the credential");
    await this.options.audit.record({
      orgId: network.orgId,
      actorUserId: input.userId,
      actorType: input.userId ? "user" : "system",
      action: existing ? "credential.reissued" : "credential.issued",
      targetType: "device",
      targetId: device.id,
      metadata: {
        networkId: network.id,
        credentialId: row.credentialId,
        publicKeyFingerprint: fingerprint(row.publicKey),
        expiry: row.expiry.toISOString(),
        reason: input.reason ?? "device approved",
      },
    });
    await this.changed(network.id, "credential issued", device.id);
    return toDto(row, now);
  }

  /**
   * Revokes the credential of a device. The caller decides whether the device
   * is blocked/removed; this method only kills the key and repushes anchors.
   */
  async revokeForDevice(input: {
    orgId: string;
    userId: string | null;
    deviceId: string;
    reason: string;
  }): Promise<CredentialDto | null> {
    const row = await getCredentialByDevice(this.options.db, input.deviceId);
    if (!row) return null;
    if (row.status === "revoked") return toDto(row, this.now());
    const updated = await updateCredential(this.options.db, row.id, {
      status: "revoked",
      revokedAt: this.now(),
      revokedBy: input.userId,
      revocationReason: input.reason.slice(0, 200),
    });
    if (!updated) throw new AppError(500, "failed to revoke the credential");
    await this.options.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      actorType: input.userId ? "user" : "system",
      action: "credential.revoked",
      targetType: "device",
      targetId: input.deviceId,
      metadata: {
        networkId: row.networkId,
        credentialId: row.credentialId,
        publicKeyFingerprint: fingerprint(row.publicKey),
        reason: input.reason,
      },
    });
    await this.changed(row.networkId, "credential revoked");
    return toDto(updated, this.now());
  }

  /**
   * Keeps the credential's EasyTier ACL groups in sync with the device's tags.
   * Group names are accepted by EasyTier as peer groups, so `source_groups`
   * policy rules match a member without a group-secret proof.
   */
  async syncGroupsForDevice(
    deviceId: string,
    tags: readonly string[],
    userId: string | null,
    orgId: string,
  ): Promise<boolean> {
    const row = await getCredentialByDevice(this.options.db, deviceId);
    if (!row || row.status !== "active") return false;
    const groups = credentialGroupsFromTags(tags);
    if (
      groups.length === row.groups.length &&
      groups.every((group, index) => group === row.groups[index])
    ) {
      return false;
    }
    await updateCredential(this.options.db, row.id, { groups });
    await this.options.audit.record({
      orgId,
      actorUserId: userId,
      action: "credential.groups_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { networkId: row.networkId, groups },
    });
    await this.changed(row.networkId, "credential groups updated");
    return true;
  }

  /** Revokes every active credential of a network (mode switch / rotation). */
  async revokeAllForNetwork(input: {
    network: Network;
    userId: string | null;
    reason: string;
  }): Promise<number> {
    const rows = await listCredentialsForNetwork(
      this.options.db,
      input.network.id,
    );
    let revoked = 0;
    for (const row of rows) {
      if (row.status === "revoked") continue;
      await updateCredential(this.options.db, row.id, {
        status: "revoked",
        revokedAt: this.now(),
        revokedBy: input.userId,
        revocationReason: input.reason.slice(0, 200),
      });
      revoked += 1;
    }
    if (revoked > 0) {
      await this.options.audit.record({
        orgId: input.network.orgId,
        actorUserId: input.userId,
        actorType: input.userId ? "user" : "system",
        action: "credential.revoked_all",
        targetType: "network",
        targetId: input.network.id,
        metadata: { count: revoked, reason: input.reason },
      });
      await this.changed(input.network.id, "credentials revoked");
    }
    return revoked;
  }

  /**
   * Renews every credential that expires within the renewal window. Batched
   * per network so one anchor repush covers all renewed keys. Idempotent: a
   * second run inside the window after renewal finds nothing due.
   */
  async renewDue(): Promise<{
    renewed: number;
    networks: number;
  }> {
    const now = this.now();
    const before = new Date(now.getTime() + this.options.renewBeforeMs);
    const rows = await this.options.db.query.credentials.findMany({
      where: (table, { and, eq, gt, lt }) =>
        and(
          eq(table.status, "active"),
          gt(table.expiry, now),
          lt(table.expiry, before),
        ),
      orderBy: (table, { asc }) => [asc(table.networkId), asc(table.expiry)],
    });
    const byNetwork = new Map<string, Credential[]>();
    for (const row of rows) {
      const list = byNetwork.get(row.networkId) ?? [];
      list.push(row);
      byNetwork.set(row.networkId, list);
    }
    let renewed = 0;
    for (const [networkId, list] of byNetwork) {
      const expiry = new Date(now.getTime() + this.options.ttlMs);
      for (const row of list) {
        await updateCredential(this.options.db, row.id, { expiry });
        renewed += 1;
      }
      await this.options.audit.record({
        orgId: list[0]!.orgId,
        actorType: "system",
        action: "credential.renewed",
        targetType: "network",
        targetId: networkId,
        metadata: {
          count: list.length,
          credentialIds: list.map((row) => row.credentialId),
          expiry: expiry.toISOString(),
        },
      });
      await this.changed(networkId, "credentials renewed");
    }
    return { renewed, networks: byNetwork.size };
  }

  private async orgIdFor(networkId: string): Promise<string> {
    const row = await this.options.db.query.credentials.findFirst({
      where: (table, { eq }) => eq(table.networkId, networkId),
      columns: { orgId: true },
    });
    return row?.orgId ?? "";
  }

  private async changed(
    networkId: string,
    reason: string,
    memberDeviceId?: string,
  ): Promise<void> {
    const orgId = await this.orgIdFor(networkId);
    if (orgId !== "") {
      this.options.realtime?.publish({
        type: "network.updated",
        orgId,
        networkId,
        data: { networkId, reason: `credential:${reason}` },
      });
    }
    try {
      await this.options.onCredentialsChanged(networkId, reason, memberDeviceId);
    } catch (error) {
      this.options.logger.warn("credential change fan-out failed", {
        networkId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Guided migration
  // -------------------------------------------------------------------------

  async previewMigration(input: {
    network: Network;
    targetMode: NetworkAccessMode;
    anchorDeviceIds?: readonly string[];
  }): Promise<CredentialMigrationPlan> {
    const { network, targetMode } = input;
    const approved = await listApprovedDevicesInNetwork(
      this.options.db,
      network.id,
    );
    const pending = (
      await this.options.db.query.devices.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.networkId, network.id), eq(table.state, "pending")),
        orderBy: (table, { asc }) => [asc(table.hostname)],
      })
    ).map((device) => ({
      deviceId: device.id,
      hostname: device.dnsName ?? device.hostname,
      role: device.role,
    }));
    const credentials = await listCredentialsForNetwork(
      this.options.db,
      network.id,
    );
    const credentialByDevice = new Map(
      credentials.map((row) => [row.deviceId, row]),
    );

    if (targetMode === network.accessMode) {
      return {
        mode: network.accessMode,
        targetMode,
        anchors: [],
        members: [],
        pendingDevices: pending,
        revokeCredentials: 0,
        gainSecret: 0,
        loseSecret: 0,
        warnings: [],
        changes: false,
      };
    }

    let anchors: Device[];
    if (targetMode === "credentials") {
      const ids = new Set(input.anchorDeviceIds ?? []);
      anchors = approved.filter((device) => ids.has(device.id));
      if (approved.length > 0 && anchors.length === 0) {
        conflict(
          "choose at least one anchor: a credentials network needs a device that holds the network secret",
        );
      }
    } else {
      // Every approved device gains the secret again.
      anchors = approved;
    }
    const anchorIds = new Set(anchors.map((device) => device.id));
    const members = approved.filter((device) => !anchorIds.has(device.id));
    const warnings: string[] = [];
    if (targetMode === "credentials") {
      if (anchors.length === 1) {
        warnings.push("only_one_anchor");
      }
      if (network.useRendezvous) {
        warnings.push("rendezvous_needs_anchor");
      }
      const onlineAnchors = anchors.filter((device) => device.state === "approved");
      if (approved.length > 0 && onlineAnchors.length === 0) {
        warnings.push("no_anchor");
      }
      if (members.length === 0) warnings.push("no_members");
    } else {
      warnings.push("reverse_gives_everyone_the_secret");
      const revoked = credentials.filter((row) => row.status !== "revoked").length;
      if (revoked > 0) warnings.push("credentials_will_be_revoked");
    }
    return {
      mode: network.accessMode,
      targetMode,
      anchors: anchors.map((device) => ({
        deviceId: device.id,
        hostname: device.dnsName ?? device.hostname,
      })),
      members: members.map((device) => ({
        deviceId: device.id,
        hostname: device.dnsName ?? device.hostname,
        hasCredential: Boolean(
          credentialByDevice.get(device.id) &&
            isCredentialUsable(credentialByDevice.get(device.id)!, this.now()),
        ),
      })),
      pendingDevices: pending,
      revokeCredentials:
        targetMode === "shared_secret"
          ? credentials.filter((row) => row.status !== "revoked").length
          : 0,
      gainSecret: targetMode === "credentials" ? anchors.length : members.length,
      loseSecret: targetMode === "credentials" ? members.length : 0,
      warnings,
      changes: true,
    };
  }

  // -------------------------------------------------------------------------
  // Role changes
  // -------------------------------------------------------------------------

  /**
   * Changes one device's role in a credentials network.
   *
   * - member → anchor: the device starts receiving the network secret, which
   *   cannot be taken back. Its credential is revoked (it no longer needs the
   *   key) and anchors are repushed.
   * - anchor → member: refused unless `acknowledge` is set, because the device
   *   already knows the secret and stays able to join until the secret is
   *   rotated. The safe procedure is to rotate first (docs/CREDENTIALS.md).
   */
  async setRole(input: {
    network: Network;
    device: Device;
    userId: string;
    role: "anchor" | "member";
    acknowledge?: boolean;
  }): Promise<{ needsSecretRotation: boolean }> {
    const { network, device } = input;
    if (network.accessMode !== "credentials") {
      conflict(
        "roles only apply to credentials networks; in shared-secret mode every device holds the secret",
      );
    }
    const current = effectiveRole(network.accessMode, device.role);
    if (current === input.role) {
      return { needsSecretRotation: false };
    }
    const now = this.now();
    if (input.role === "member") {
      if (!input.acknowledge) {
        conflict(
          "this anchor already knows the network secret; removing its anchor role does not revoke it. " +
            "Rotate the network secret after the change (or acknowledge the risk).",
        );
      }
      await this.options.db
        .update(devices)
        .set({ role: "member", updatedAt: now })
        .where(eq(devices.id, device.id));
      await this.issueForDevice({
        network,
        device: { ...device, role: "member" },
        userId: input.userId,
        reason: "demoted from anchor",
        force: true,
      });
      await this.options.audit.record({
        orgId: network.orgId,
        actorUserId: input.userId,
        action: "device.role_changed",
        targetType: "device",
        targetId: device.id,
        metadata: {
          networkId: network.id,
          from: "anchor",
          to: "member",
          acknowledgedSecretStillKnown: true,
        },
      });
      await this.changed(network.id, "device demoted", device.id);
      return { needsSecretRotation: true };
    }

    // promote to anchor
    await this.options.db
      .update(devices)
      .set({ role: "anchor", updatedAt: now })
      .where(eq(devices.id, device.id));
    await this.revokeForDevice({
      orgId: network.orgId,
      userId: input.userId,
      deviceId: device.id,
      reason: "promoted to anchor; the network secret replaces the credential",
    });
    await this.options.audit.record({
      orgId: network.orgId,
      actorUserId: input.userId,
      action: "device.role_changed",
      targetType: "device",
      targetId: device.id,
      metadata: {
        networkId: network.id,
        from: "member",
        to: "anchor",
        note: "the device now holds the network secret; this is permanent",
      },
    });
    await this.changed(network.id, "device promoted", device.id);
    return { needsSecretRotation: false };
  }

  /** Counts used by the network page's access-mode card. */
  async anchorSummary(networkId: string): Promise<{
    anchors: number;
    members: number;
    activeCredentials: number;
    expiringSoon: number;
  }> {
    const now = this.now();
    const [anchors, members, credentials] = await Promise.all([
      listApprovedDevicesByRole(this.options.db, networkId, "anchor"),
      listApprovedDevicesByRole(this.options.db, networkId, "member"),
      listPublishableCredentials(this.options.db, networkId, now),
    ]);
    const soon = new Date(now.getTime() + this.options.renewBeforeMs);
    return {
      anchors: anchors.length,
      members: members.length,
      activeCredentials: credentials.length,
      expiringSoon: credentials.filter((row) => row.expiry < soon).length,
    };
  }
}

/**
 * Short fingerprint for audit/UI: the same SHA-256 prefix `easytier-core`
 * prints for a credential (`public_key_fingerprint`).
 */
export function fingerprint(publicKeyBase64: string): string {
  const raw = Buffer.from(publicKeyBase64, "base64");
  if (raw.length !== 32) return "";
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Derives the public key of a credential secret (used by import/tests). */
export function publicKeyOf(secret: string): string {
  return credentialPublicKey(secret);
}
