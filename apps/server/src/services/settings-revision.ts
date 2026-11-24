import {
  insertRevision,
  listRevisions,
  updateDevice,
  type DbExecutor,
} from "../db/repositories.js";
import type { Device, Network } from "../db/schema.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import { cidrPrefix } from "../domain/ip.js";
import { nextRevisionNumber } from "../domain/revisions.js";

/**
 * Records a user-made change to a node's settings (hub ports, advertised
 * endpoints, WireGuard portal and clients, tags, DNS name) as a config
 * revision, so the device history shows every change next to config edits and
 * policy updates.
 *
 * Those settings live in dedicated columns and are merged into the pushed
 * config, so the revision snapshots the latest stored config unchanged; the
 * note says what happened. Devices that never had a revision (not yet
 * approved) are skipped: there is nothing to hang a history entry on.
 */
export async function recordSettingsRevision(
  db: DbExecutor,
  input: {
    actor: { orgId: string; userId: string };
    device: Pick<Device, "id">;
    network: Pick<Network, "id" | "ipv4Cidr" | "policyVersion">;
    note: string;
  },
): Promise<number | null> {
  const revisions = await listRevisions(db, input.device.id);
  const latest = revisions[0];
  if (!latest) return null;
  const config = normalizeDesiredConfig(latest.config, {
    networkLength: cidrPrefix(input.network.ipv4Cidr),
  });
  const revision = await insertRevision(db, {
    orgId: input.actor.orgId,
    networkId: input.network.id,
    deviceId: input.device.id,
    revision: nextRevisionNumber(
      revisions.map((entry) => ({ revision: entry.revision, config: entry.config })),
    ),
    config,
    note: input.note.slice(0, 500),
    source: "settings",
    policyVersion: latest.policyVersion ?? input.network.policyVersion,
    createdBy: input.actor.userId,
  });
  await updateDevice(db, input.device.id, { desiredRevision: revision.revision });
  return revision.revision;
}
