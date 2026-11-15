import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmptyTestDatabase, type TestDatabase } from "../support/database.js";

/**
 * The hub peer model migration keeps every peer URL that existed before it.
 * This test applies 0000 + 0001, seeds a network whose default config carries
 * the broadcast peer list plus a hand-edited per-device revision list, then
 * applies 0002 and checks the resulting raw entries and device defaults.
 */

const DRIZZLE = join(import.meta.dirname, "../../apps/server/drizzle");

function statements(file: string): string[] {
  return readFileSync(join(DRIZZLE, file), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function apply(database: TestDatabase, file: string): Promise<void> {
  for (const statement of statements(file)) {
    await database.pool.query(statement);
  }
}

const ORG = "10000000-0000-4000-8000-000000000001";
const NETWORK = "10000000-0000-4000-8000-000000000002";
const DEVICE_A = "10000000-0000-4000-8000-000000000003";
const DEVICE_B = "10000000-0000-4000-8000-000000000004";
const REVISION = "10000000-0000-4000-8000-000000000005";

describe("migration: legacy peerUrls become raw network peer entries", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createEmptyTestDatabase();
    await apply(database, "0000_init.sql");
    await apply(database, "0001_abnormal_wind_dancer.sql");

    await database.pool.query(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, 'Org', 'org')`,
      [ORG],
    );
    await database.pool.query(
      `INSERT INTO networks
        (id, org_id, name, network_name, secret_ciphertext, ipv4_cidr, default_config)
       VALUES ($1, $2, 'Lab', 'lab', 'ciphertext', '10.144.144.0/24', $3::jsonb)`,
      [
        NETWORK,
        ORG,
        JSON.stringify({
          noTun: true,
          // The list that used to be broadcast to every device.
          peerUrls: ["tcp://h-1.node.kurb.me:11010", "tcp://h-2.node.kurb.me:11010"],
        }),
      ],
    );
    for (const [id, machineId, hostname] of [
      [DEVICE_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "h-1"],
      [DEVICE_B, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "h-2"],
    ] as const) {
      await database.pool.query(
        `INSERT INTO devices (id, org_id, network_id, machine_id, hostname, state)
         VALUES ($1, $2, $3, $4, $5, 'approved')`,
        [id, ORG, NETWORK, machineId, hostname],
      );
    }
    // A hand-edited list on one revision, including a URL already in the
    // network default (must not be duplicated) and a new one (must be kept).
    await database.pool.query(
      `INSERT INTO config_revisions (id, org_id, network_id, device_id, revision, config, source)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb, 'manual')`,
      [
        REVISION,
        ORG,
        NETWORK,
        DEVICE_A,
        JSON.stringify({
          peerUrls: [
            "tcp://h-2.node.kurb.me:11010",
            "udp://relay.example.com:11010",
          ],
        }),
      ],
    );

    await apply(database, "0002_large_payback.sql");
  });

  afterAll(async () => {
    await database.drop();
  });

  it("keeps every URL as a raw entry in a deterministic order", async () => {
    const rows = await database.pool.query<{
      url: string;
      device_id: string | null;
      position: number;
    }>(
      `SELECT url, device_id, position FROM network_peers
       WHERE network_id = $1 ORDER BY position`,
      [NETWORK],
    );
    expect(rows.rows).toEqual([
      { url: "tcp://h-1.node.kurb.me:11010", device_id: null, position: 0 },
      { url: "tcp://h-2.node.kurb.me:11010", device_id: null, position: 1 },
      { url: "udp://relay.example.com:11010", device_id: null, position: 2 },
    ]);
  });

  it("starts devices without endpoints and not as hubs", async () => {
    const rows = await database.pool.query<{
      advertised_endpoints: string[];
      is_hub: boolean;
    }>(`SELECT advertised_endpoints, is_hub FROM devices WHERE id = $1`, [DEVICE_A]);
    expect(rows.rows[0]).toEqual({ advertised_endpoints: [], is_hub: false });
  });

  it("leaves the old JSON in place so a downgrade still sees it", async () => {
    const row = await database.pool.query<{ peerUrls: string[] }>(
      `SELECT default_config -> 'peerUrls' AS "peerUrls" FROM networks WHERE id = $1`,
      [NETWORK],
    );
    expect(row.rows[0]?.peerUrls).toEqual([
      "tcp://h-1.node.kurb.me:11010",
      "tcp://h-2.node.kurb.me:11010",
    ]);
  });

  it("allows a device-backed entry next to the raw ones", async () => {
    await database.pool.query(
      `INSERT INTO network_peers (org_id, network_id, device_id, url, position)
       VALUES ($1, $2, $3, NULL, 3)`,
      [ORG, NETWORK, DEVICE_A],
    );
    const rows = await database.pool.query<{ count: string }>(
      `SELECT count(*) FROM network_peers WHERE network_id = $1`,
      [NETWORK],
    );
    expect(rows.rows[0]?.count).toBe("4");
    // The partial unique index forbids a second device-backed row.
    await expect(
      database.pool.query(
        `INSERT INTO network_peers (org_id, network_id, device_id, url, position)
         VALUES ($1, $2, $3, NULL, 4)`,
        [ORG, NETWORK, DEVICE_A],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
