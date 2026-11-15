import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AcceptRateLimiter,
  MetricsRegistry,
  findSilentClients,
  sanitizeReturnTo,
} from "@easyplane/server";

const SERVER_SRC = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../src",
);

function sourceFiles(directory: string, output: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, output);
    else if (entry.endsWith(".ts")) output.push(full);
  }
  return output;
}

describe("AcceptRateLimiter", () => {
  it("allows up to the limit inside one window and resets afterwards", () => {
    const limiter = new AcceptRateLimiter(2, 1_000);
    expect(limiter.allow("1.2.3.4", 0)).toBe(true);
    expect(limiter.allow("1.2.3.4", 100)).toBe(true);
    expect(limiter.allow("1.2.3.4", 200)).toBe(false);
    // A different source is independent.
    expect(limiter.allow("5.6.7.8", 200)).toBe(true);
    // New window.
    expect(limiter.allow("1.2.3.4", 1_001)).toBe(true);
  });

  it("keeps the key table bounded under a wide flood", () => {
    const limiter = new AcceptRateLimiter(5, 60_000, 100);
    for (let index = 0; index < 500; index += 1) {
      limiter.allow(`10.0.0.${index % 256}:${index}`, index);
    }
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("can be disabled with 0", () => {
    const limiter = new AcceptRateLimiter(0);
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.allow("same")).toBe(true);
    }
  });
});

describe("findSilentClients", () => {
  const client = (connectedAt: number, lastHeartbeatAt: number | null) => ({
    id: `${connectedAt}:${lastHeartbeatAt}`,
    isClosed: false,
    connectedAt,
    lastHeartbeatAt,
    close: () => undefined,
  });

  it("uses the connection time before the first heartbeat", () => {
    const candidates = [client(0, null), client(0, 9_000)];
    const silent = findSilentClients(candidates, 10_000, 5_000);
    expect(silent.map((entry) => entry.id)).toEqual(["0:null"]);
  });

  it("never reports closed clients", () => {
    const closed = { ...client(0, null), isClosed: true };
    expect(findSilentClients([closed], 100_000, 1_000)).toEqual([]);
  });
});

describe("sanitizeReturnTo", () => {
  it("keeps relative paths and rejects cross-origin tricks", () => {
    expect(sanitizeReturnTo("/networks/abc?tab=1")).toBe("/networks/abc?tab=1");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo("//evil.example")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example")).toBe("/");
    expect(sanitizeReturnTo("https://evil.example/")).toBe("/");
    expect(sanitizeReturnTo("/ok\nSet-Cookie: x")).toBe("/");
  });
});

describe("MetricsRegistry", () => {
  it("renders HELP/TYPE once per metric and escapes labels", () => {
    const metrics = new MetricsRegistry();
    metrics.inc("easyplane_test_total", { result: 'a"b' }, 2);
    metrics.set("easyplane_test_gauge", 3);
    const text = metrics.render();
    expect(text).toContain("# TYPE easyplane_test_total counter");
    expect(text).toContain('easyplane_test_total{result="a\\"b"} 2');
    expect(text).toContain("# TYPE easyplane_test_gauge gauge");
    expect(text).toContain("easyplane_test_gauge 3");
    expect(text.match(/# TYPE easyplane_test_total/g)).toHaveLength(1);
  });

  it("counters are additive across label sets", () => {
    const metrics = new MetricsRegistry();
    metrics.inc("easyplane_x_total", { status: "pushed" });
    metrics.inc("easyplane_x_total", { status: "pushed" });
    metrics.inc("easyplane_x_total", { status: "failed" });
    const text = metrics.render();
    expect(text).toContain('easyplane_x_total{status="pushed"} 2');
    expect(text).toContain('easyplane_x_total{status="failed"} 1');
  });
});

describe("secret hygiene in server sources", () => {
  it("never passes a secret, token or config body to a logger", () => {
    const forbidden =
      /\b(networkSecret|network_secret|userToken|csrfToken|credentialSecret|privateKey)\b|\b(token|secret):/;
    const offenders: string[] = [];
    for (const file of sourceFiles(SERVER_SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/logger\.(debug|info|warn|error)\(/.test(line)) return;
        if (forbidden.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
