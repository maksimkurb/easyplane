import { describe, expect, it } from "vitest";

import { resolveClientEndpoint } from "@easyplane/server";

describe("resolveClientEndpoint", () => {
  const raw =
    "[Peer]\nEndpoint = 0.0.0.0:11013 # replace wildcard with the public address\nPersistentKeepalive = 25\n";

  it("substitutes the public host and drops the comment", () => {
    expect(resolveClientEndpoint(raw, "203.0.113.7")).toBe(
      "[Peer]\nEndpoint = 203.0.113.7:11013\nPersistentKeepalive = 25\n",
    );
  });

  it("still drops the comment when no public host is known", () => {
    expect(resolveClientEndpoint(raw, null)).toContain("Endpoint = 0.0.0.0:11013\n");
  });

  it("leaves a concrete endpoint alone", () => {
    expect(resolveClientEndpoint("Endpoint = 198.51.100.1:51820", "203.0.113.7")).toBe(
      "Endpoint = 198.51.100.1:51820",
    );
  });
});

describe("pickClientHost", () => {
  it("prefers a domain, then an advertised address, then a public IP", async () => {
    const { pickClientHost } = await import("@easyplane/server")
    expect(pickClientHost(["tcp://1.1.1.1:1", "udp://vpn.example.com:2"], ["9.9.9.9"])).toBe("vpn.example.com")
    expect(pickClientHost(["tcp://1.1.1.1:1"], ["9.9.9.9"])).toBe("1.1.1.1")
    expect(pickClientHost([], ["9.9.9.9"])).toBe("9.9.9.9")
    expect(pickClientHost([], [])).toBeNull()
  })
})
