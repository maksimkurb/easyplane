import type { DbExecutor } from "../db/repositories.js";
import {
  findInviteByTokenHash,
  getInvite,
  getNetworkById,
  insertInvite,
  listApprovedDevicesByRole,
  listInvites,
  revokeInvite,
} from "../db/repositories.js";
import type { Invite } from "../db/schema.js";
import { evaluateInvite } from "../domain/invite.js";
import { randomToken, sha256Hex } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import { conflict, invalid, notFound } from "./errors.js";

export type InviteStatus = "active" | "expired" | "exhausted" | "revoked";

export interface InviteDto {
  id: string;
  networkId: string;
  label: string;
  /** Role a new device enrolled with this invite gets (credentials mode). */
  role: "anchor" | "member";
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  reusable: boolean;
  remainingUses: number | null;
  status: InviteStatus;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function statusOf(
  invite: Invite,
  now: Date,
): { status: InviteStatus; reusable: boolean; remainingUses: number | null } {
  const evaluation = evaluateInvite(invite, now);
  let status: InviteStatus = "active";
  if (invite.revokedAt !== null) status = "revoked";
  else if (evaluation.rejection === "expired") status = "expired";
  else if (evaluation.rejection === "exhausted") status = "exhausted";
  return {
    status,
    reusable: evaluation.reusable,
    remainingUses: evaluation.remainingUses,
  };
}

function toDto(invite: Invite, now: Date): InviteDto {
  const { status, reusable, remainingUses } = statusOf(invite, now);
  return {
    id: invite.id,
    networkId: invite.networkId,
    label: invite.label,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    maxUses: invite.maxUses,
    uses: invite.uses,
    reusable,
    remainingUses,
    status,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    lastUsedAt: invite.lastUsedAt?.toISOString() ?? null,
  };
}

export class InviteService {
  constructor(
    private readonly db: DbExecutor,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    orgId: string;
    networkId: string;
    userId: string;
    label?: string;
    role?: "anchor" | "member";
    expiresInHours?: number | null;
    maxUses?: number | null;
  }): Promise<{ invite: InviteDto; token: string }> {
    const maxUses = input.maxUses ?? null;
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      invalid("maxUses must be a positive integer or null");
    }
    const expiresInHours =
      input.expiresInHours === undefined ? 24 : input.expiresInHours;
    if (expiresInHours !== null && (expiresInHours < 1 || expiresInHours > 8760)) {
      invalid("expiresInHours must be between 1 and 8760, or null");
    }

    const network = await getNetworkById(this.db, input.networkId);
    if (!network || network.orgId !== input.orgId) notFound("network not found");
    const role = input.role ?? "anchor";
    if (role === "member" && network.accessMode === "credentials") {
      const anchors = await listApprovedDevicesByRole(
        this.db,
        network.id,
        "anchor",
      );
      if (anchors.length === 0) {
        conflict(
          "this credentials network has no anchor yet: the first device must be an anchor " +
            "(it holds the network secret and publishes the trusted credential list)",
        );
      }
    }
    const token = randomToken(24);
    const invite = await insertInvite(this.db, {
      orgId: input.orgId,
      networkId: input.networkId,
      tokenHash: sha256Hex(token),
      label: input.label?.trim() ?? "",
      role,
      expiresAt:
        expiresInHours === null
          ? null
          : new Date(Date.now() + expiresInHours * 3_600_000),
      maxUses,
      createdBy: input.userId,
    });
    await this.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      action: "invite.created",
      targetType: "invite",
      targetId: invite.id,
      metadata: {
        networkId: input.networkId,
        role: invite.role,
        maxUses,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        label: invite.label,
      },
    });
    return { invite: toDto(invite, new Date()), token };
  }

  async list(orgId: string, networkId: string, now = new Date()): Promise<InviteDto[]> {
    const invites = await listInvites(this.db, networkId);
    return invites
      .filter((invite) => invite.orgId === orgId)
      .map((invite) => toDto(invite, now));
  }

  async revoke(orgId: string, userId: string, id: string): Promise<InviteDto> {
    const invite = await getInvite(this.db, orgId, id);
    if (!invite) notFound("invite not found");
    await revokeInvite(this.db, id, new Date());
    const updated = await getInvite(this.db, orgId, id);
    if (!updated) notFound("invite not found");
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "invite.revoked",
      targetType: "invite",
      targetId: id,
      metadata: { networkId: invite.networkId },
    });
    return toDto(updated, new Date());
  }

  /**
   * Resolves the config-server token carried in the URL/heartbeat to an invite.
   * Tokens are high-entropy and only their SHA-256 is stored.
   */
  async resolveToken(token: string): Promise<Invite | null> {
    const trimmed = token.trim();
    if (trimmed.length < 16 || trimmed.length > 256) return null;
    return (await findInviteByTokenHash(this.db, sha256Hex(trimmed))) ?? null;
  }
}
