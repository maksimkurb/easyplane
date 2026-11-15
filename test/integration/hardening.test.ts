import { afterAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "../support/app.js";

const apps: TestApp[] = [];

afterAll(async () => {
  for (const app of apps.splice(0)) await app.stop();
});

describe("metrics endpoint", () => {
  it("is disabled without a token", async () => {
    const test = await createTestApp({ oidc: false });
    apps.push(test);
    const response = await test.app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(404);
  });

  it("requires the configured bearer token in constant time", async () => {
    const test = await createTestApp({
      oidc: false,
      env: { EASYPLANE_METRICS_TOKEN: "metrics-token-1234567890" },
    });
    apps.push(test);

    const anonymous = await test.app.inject({ method: "GET", url: "/metrics" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toBe("Bearer");

    const wrong = await test.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer nope-nope-nope-nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await test.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-token-1234567890" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/plain");
    expect(ok.body).toContain("# TYPE easyplane_info gauge");
    expect(ok.body).toContain("easyplane_database_up 1");
    expect(ok.body).toContain("easyplane_clients_connected 0");
    expect(ok.body).toContain("easyplane_sse_streams 0");
    expect(ok.body).not.toContain("secret");
  });
});

describe("API rate limit", () => {
  it("returns a structured 429 once the per-IP window is exceeded", async () => {
    const test = await createTestApp({
      oidc: false,
      env: { EASYPLANE_API_RATE_LIMIT_PER_MINUTE: "3" },
    });
    apps.push(test);

    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await test.app.inject({
        method: "GET",
        url: "/api/auth/providers",
      });
      statuses.push(response.statusCode);
      if (response.statusCode === 429) {
        const body = response.json() as { code: string; retryAfter?: number | string }
        expect(body.code).toBe("rate_limited");
        expect(body.retryAfter).toBeTruthy();
      }
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
