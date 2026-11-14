import { randomBytes } from "node:crypto";

import type { DbExecutor } from "../db/repositories.js";
import {
  deleteNetwork,
  getNetwork,
  insertNetwork,
  listNetworks,
  networkDeviceCounts,
  updateNetwork,
  usedVirtualIps,
} from "../db/repositories.js";
import type { Network } from "../db/schema.js";
import { parseCidr } from "../domain/ip.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import {
  generateNetworkSecret,
  slugify,
} from "../security/crypto.js";
import type { SecretBox } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";

export interface NetworkDto {
  id: string;
  name: string;
  networkName: string;
  ipv4Cidr: string;
  defaultConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deviceCounts: { pending: number; approved: number; blocked: number };
}

function toDto(
  network: Network,
  counts: { pending: number; approved: number; blocked: number },
): NetworkDto {
  return {
    id: network.id,
    name: network.name,
    networkName: network.networkName,
    ipv4Cidr: network.ipv4Cidr,
    defaultConfig: network.defaultConfig,
    createdAt: network.createdAt.toISOString(),
    updatedAt: network.updatedAt.toISOString(),
    deviceCounts: counts,
  };
}

export class NetworkService {
  constructor(
    private readonly db: DbExecutor,
    private readonly secretBox: SecretBox,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    orgId: string;
    userId: string;
    name: string;
    ipv4Cidr?: string;
    defaultConfig?: Record<string, unknown>;
  }): Promise<NetworkDto> {
    const name = input.name.trim();
    if (name.length < 1) invalid("network name is required");
    const ipv4Cidr = input.ipv4Cidr ?? "10.144.144.0/24";
    try {
      parseCidr(ipv4Cidr);
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid CIDR");
    }
    const defaults = normalizeDesiredConfig(input.defaultConfig ?? {});
    const base = slugify(name) || "network";
    const networkName = `${base}-${randomBytes(3).toString("hex")}`;
    const secret = generateNetworkSecret();
    const network = await insertNetwork(this.db, {
      orgId: input.orgId,
      name,
      networkName,
      secretCiphertext: this.secretBox.encrypt(secret),
      ipv4Cidr,
      defaultConfig: defaults,
      createdBy: input.userId,
    });
    await this.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      action: "network.created",
      targetType: "network",
      targetId: network.id,
      metadata: { name, networkName, ipv4Cidr },
    });
    return toDto(network, { pending: 0, approved: 0, blocked: 0 });
  }

  async list(orgId: string): Promise<NetworkDto[]> {
    const networks = await listNetworks(this.db, orgId);
    return Promise.all(
      networks.map(async (network) =>
        toDto(network, await networkDeviceCounts(this.db, network.id)),
      ),
    );
  }

  async get(orgId: string, id: string): Promise<NetworkDto> {
    const network = await getNetwork(this.db, orgId, id);
    if (!network) notFound("network not found");
    return toDto(network, await networkDeviceCounts(this.db, network.id));
  }

  async requireNetwork(orgId: string, id: string): Promise<Network> {
    const network = await getNetwork(this.db, orgId, id);
    if (!network) notFound("network not found");
    return network;
  }

  /** Admin-only: returns the plaintext secret and records the reveal. */
  async revealSecret(orgId: string, userId: string, id: string): Promise<string> {
    const network = await this.requireNetwork(orgId, id);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.secret_revealed",
      targetType: "network",
      targetId: id,
    });
    return this.secretBox.decrypt(network.secretCiphertext);
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    values: { name?: string; ipv4Cidr?: string },
  ): Promise<NetworkDto> {
    const network = await this.requireNetwork(orgId, id);
    if (values.ipv4Cidr !== undefined && values.ipv4Cidr !== network.ipv4Cidr) {
      const used = await usedVirtualIps(this.db, id);
      const cidr = parseCidr(values.ipv4Cidr);
      const base = BigInt(cidr.base);
      for (const ip of used) {
        const parts = ip.split(".").map(Number);
        if (parts.length !== 4) continue;
        const value =
          ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
        if (value < base || value >= base + BigInt(cidr.size)) {
          conflict(
            "the new CIDR does not contain every address already allocated in this network",
          );
        }
      }
    }
    const updated = await updateNetwork(this.db, id, {
      ...(values.name !== undefined ? { name: values.name.trim() } : {}),
      ...(values.ipv4Cidr !== undefined ? { ipv4Cidr: values.ipv4Cidr } : {}),
    });
    if (!updated) notFound("network not found");
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.updated",
      targetType: "network",
      targetId: id,
      metadata: { changed: Object.keys(values) },
    });
    return toDto(updated, await networkDeviceCounts(this.db, id));
  }

  async delete(orgId: string, userId: string, id: string): Promise<void> {
    const network = await this.requireNetwork(orgId, id);
    await deleteNetwork(this.db, id);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.deleted",
      targetType: "network",
      targetId: id,
      metadata: { name: network.name },
    });
  }

  async regenerateSecret(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<string> {
    const network = await this.requireNetwork(orgId, id);
    const secret = generateNetworkSecret();
    const updated = await updateNetwork(this.db, id, {
      secretCiphertext: this.secretBox.encrypt(secret),
    });
    if (!updated) throw new AppError(500, "failed to update network");
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.secret_rotated",
      targetType: "network",
      targetId: id,
      metadata: { networkName: network.networkName },
    });
    return secret;
  }
}
