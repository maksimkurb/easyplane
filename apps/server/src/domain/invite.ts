/** Pure invite usability rules (unit-tested in test/unit/invite.test.ts). */

export interface InviteRules {
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  revokedAt: Date | null;
}

export type InviteRejection = "revoked" | "expired" | "exhausted";

export interface InviteEvaluation {
  /** May this invite create a *new* device? */
  canCreateDevice: boolean;
  /** May an already-registered device present this token again? */
  canReconnectDevice: boolean;
  rejection: InviteRejection | null;
  /** True when the invite has an unlimited use count. */
  reusable: boolean;
  remainingUses: number | null;
}

export function evaluateInvite(
  invite: InviteRules,
  now: Date = new Date(),
): InviteEvaluation {
  const reusable = invite.maxUses === null;
  const remainingUses =
    invite.maxUses === null ? null : Math.max(0, invite.maxUses - invite.uses);

  let rejection: InviteRejection | null = null;
  if (invite.revokedAt !== null) rejection = "revoked";
  else if (invite.expiresAt !== null && invite.expiresAt.getTime() <= now.getTime()) {
    rejection = "expired";
  } else if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    rejection = "exhausted";
  }

  return {
    canCreateDevice: rejection === null,
    // A revoked/expired/exhausted invite never admits new devices, but the
    // token is the only credential an already-approved device has, so it keeps
    // working for that device (revoking does not silently kick the fleet).
    canReconnectDevice: true,
    rejection,
    reusable,
    remainingUses,
  };
}
