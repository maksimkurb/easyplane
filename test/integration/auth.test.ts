import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, loginWithMockIdp, authed, TEST_HOST, BOOTSTRAP_TOKEN, type TestApp } from "../support/app.js";

describe("authentication: break-glass bootstrap", () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp({ oidc: false });
  });

  afterAll(async () => {
    await test.stop();
  });

  it("rejects a wrong bootstrap token", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { host: TEST_HOST },
      payload: { token: "wrong", email: "root@example.com" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "auth_error" });
  });

  it("creates the first admin and a valid session", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { host: TEST_HOST },
      payload: {
        token: BOOTSTRAP_TOKEN,
        email: "root@example.com",
        displayName: "Root",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { role: "admin" } });

    const session = (response.cookies as Array<{ name: string; value: string }>).find(
      (cookie) => cookie.name === "easyplane_session",
    );
    const csrf = (response.cookies as Array<{ name: string; value: string }>).find(
      (cookie) => cookie.name === "easyplane_csrf",
    );
    expect(session).toBeDefined();
    expect(csrf).toBeDefined();

    const setCookie = response.headers["set-cookie"];
    const rawHeaders = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    const sessionHeader = rawHeaders.find((header) => header.startsWith("easyplane_session="));
    const csrfHeader = rawHeaders.find((header) => header.startsWith("easyplane_csrf="));
    expect(sessionHeader).toContain("HttpOnly");
    expect(sessionHeader).toContain("SameSite=Lax");
    expect(csrfHeader).not.toContain("HttpOnly");

    const me = await test.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        host: TEST_HOST,
        cookie: `easyplane_session=${session!.value}`,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: "root@example.com", role: "admin", bootstrap: true },
    });
  });

  it("disables the bootstrap token once an admin exists", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { host: TEST_HOST },
      payload: { token: BOOTSTRAP_TOKEN, email: "second@example.com" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/admin already exists/);

    const config = await test.app.inject({
      method: "GET",
      url: "/api/config",
      headers: { host: TEST_HOST },
    });
    expect(config.json()).toMatchObject({ bootstrapAvailable: false });
  });
});

describe("authentication: OIDC authorization code + PKCE", () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    await test.stop();
  });

  it("maps IdP groups to admin, member and viewer roles", async () => {
    const admin = await loginWithMockIdp(test, "admin");
    expect(admin.role).toBe("admin");
    const member = await loginWithMockIdp(test, "member");
    expect(member.role).toBe("member");
    const viewer = await loginWithMockIdp(test, "viewer");
    expect(viewer.role).toBe("viewer");
  });

  it("exposes only provider id and label publicly", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/auth/providers",
      headers: { host: TEST_HOST },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers: [{ id: "mock", label: "Mock SSO" }],
    });
  });

  it("rejects an unknown provider", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/auth/login/nope",
      headers: { host: TEST_HOST },
    });
    expect(response.statusCode).toBe(404);
  });

  it("requires a session for protected routes", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/networks",
      headers: { host: TEST_HOST },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("enforces CSRF on state-changing requests", async () => {
    const login = await loginWithMockIdp(test, "admin");
    const payload = { name: "csrf-test" };

    const without = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(login),
      payload,
    });
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ code: "invalid_csrf" });

    const wrong = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(login, { "x-csrf-token": "nope" }),
      payload,
    });
    expect(wrong.statusCode).toBe(403);

    const good = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(login, { "x-csrf-token": login.csrfToken }),
      payload,
    });
    expect(good.statusCode).toBe(201);
  });

  it("enforces roles server-side", async () => {
    const viewer = await loginWithMockIdp(test, "viewer");
    const member = await loginWithMockIdp(test, "member");

    const viewerCreate = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(viewer, { "x-csrf-token": viewer.csrfToken }),
      payload: { name: "nope" },
    });
    expect(viewerCreate.statusCode).toBe(403);

    const viewerRead = await test.app.inject({
      method: "GET",
      url: "/api/networks",
      headers: authed(viewer),
    });
    expect(viewerRead.statusCode).toBe(200);

    const viewerAudit = await test.app.inject({
      method: "GET",
      url: "/api/audit",
      headers: authed(viewer),
    });
    expect(viewerAudit.statusCode).toBe(403);

    const memberCreate = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: authed(member, { "x-csrf-token": member.csrfToken }),
      payload: { name: "member-network" },
    });
    expect(memberCreate.statusCode).toBe(403);

    const admin = await loginWithMockIdp(test, "admin");
    const adminAudit = await test.app.inject({
      method: "GET",
      url: "/api/audit",
      headers: authed(admin),
    });
    expect(adminAudit.statusCode).toBe(200);
    expect(
      (adminAudit.json() as Array<{ action: string }>).some(
        (entry) => entry.action === "auth.login",
      ),
    ).toBe(true);
  });

  it("logs out and invalidates the PG session", async () => {
    const login = await loginWithMockIdp(test, "member");
    const logout = await test.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: authed(login, { "x-csrf-token": login.csrfToken }),
    });
    expect(logout.statusCode).toBe(200);

    const me = await test.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: authed(login),
    });
    expect(me.statusCode).toBe(401);
  });
});
