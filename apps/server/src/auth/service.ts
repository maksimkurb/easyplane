import {
  consumeOidcLoginState,
  countAdmins,
  findIdentity,
  findUserByEmail,
  insertIdentity,
  insertOidcLoginState,
  insertUser,
  updateUser,
  type DbExecutor,
} from "../db/repositories.js";
import type { User } from "../db/schema.js";
import { mapIdentity } from "./claims.js";
import {
  OidcClient,
  createNonce,
  createPkcePair,
} from "./oidc.js";
import {
  type IssuedSession,
  SessionService,
} from "./session.js";
import { AuditService } from "../services/audit.js";
import { constantTimeEqual, randomToken } from "../security/crypto.js";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthServiceOptions {
  db: DbExecutor;
  orgId: string;
  oidc: OidcClient;
  sessions: SessionService;
  audit: AuditService;
  bootstrapToken: string | undefined;
  bootstrapReenable: boolean;
  /** How long an OIDC login state stays valid. */
  loginStateTtlMs?: number;
}

export interface CompletedLogin {
  user: User;
  session: IssuedSession;
  returnTo: string;
}

function sanitizeReturnTo(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export class AuthService {
  private readonly db: DbExecutor;
  private readonly orgId: string;
  private readonly oidc: OidcClient;
  private readonly sessions: SessionService;
  private readonly audit: AuditService;
  private readonly loginStateTtlMs: number;

  constructor(private readonly options: AuthServiceOptions) {
    this.db = options.db;
    this.orgId = options.orgId;
    this.oidc = options.oidc;
    this.sessions = options.sessions;
    this.audit = options.audit;
    this.loginStateTtlMs = options.loginStateTtlMs ?? 10 * 60_000;
  }

  async beginLogin(
    providerId: string,
    options: { redirectUri: string; returnTo?: string },
  ): Promise<{ url: string; state: string }> {
    if (!this.oidc.getProvider(providerId)) {
      throw new AuthError(`unknown provider: ${providerId}`, 404);
    }
    const pkce = createPkcePair();
    const state = randomToken(24);
    const nonce = createNonce();
    await insertOidcLoginState(this.db, {
      state,
      provider: providerId,
      codeVerifier: pkce.verifier,
      nonce,
      redirectUri: options.redirectUri,
      returnTo: sanitizeReturnTo(options.returnTo),
      expiresAt: new Date(Date.now() + this.loginStateTtlMs),
    });
    const url = await this.oidc.authorizationUrl(providerId, {
      redirectUri: options.redirectUri,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    });
    return { url, state };
  }

  async completeLogin(
    providerId: string,
    input: {
      code: string;
      state: string;
      redirectUri: string;
      ip: string;
      userAgent: string;
    },
  ): Promise<CompletedLogin> {
    const stateRow = await consumeOidcLoginState(
      this.db,
      input.state,
      new Date(),
    );
    if (!stateRow) {
      throw new AuthError("login state is unknown or expired", 400);
    }
    if (stateRow.provider !== providerId) {
      throw new AuthError("login state was issued for another provider", 400);
    }
    if (stateRow.redirectUri !== input.redirectUri) {
      throw new AuthError("redirect URI does not match the login state", 400);
    }

    const provider = this.oidc.getProvider(providerId);
    if (!provider) throw new AuthError(`unknown provider: ${providerId}`, 404);

    const exchanged = await this.oidc.exchangeCode(providerId, {
      code: input.code,
      redirectUri: stateRow.redirectUri,
      codeVerifier: stateRow.codeVerifier,
    });
    const nonce = exchanged.idTokenClaims.nonce;
    if (typeof nonce !== "string" || nonce !== stateRow.nonce) {
      throw new AuthError("id_token nonce mismatch", 400);
    }
    const subject = exchanged.idTokenClaims.sub;
    if (typeof subject !== "string" || subject === "") {
      throw new AuthError("id_token has no subject", 400);
    }

    const mapped = mapIdentity(provider, exchanged.claims);
    const user = await this.upsertUser({
      providerId,
      subject,
      mapped,
    });
    if (user.disabled) {
      throw new AuthError("user is disabled", 403);
    }

    const session = await this.sessions.issue({
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await this.audit.record({
      orgId: this.orgId,
      actorUserId: user.id,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      metadata: { provider: providerId, role: user.role },
    });
    return { user, session, returnTo: stateRow.returnTo };
  }

  private async upsertUser(input: {
    providerId: string;
    subject: string;
    mapped: ReturnType<typeof mapIdentity>;
  }): Promise<User> {
    const identity = await findIdentity(
      this.db,
      input.providerId,
      input.subject,
    );
    if (identity) {
      const user = await updateUser(this.db, identity.userId, {
        displayName: input.mapped.displayName,
        role: input.mapped.role,
        groups: input.mapped.groups,
        lastLoginAt: new Date(),
      });
      if (!user) throw new AuthError("linked user disappeared", 500);
      return user;
    }

    const byEmail = await findUserByEmail(this.db, this.orgId, input.mapped.email);
    if (byEmail) {
      await insertIdentity(this.db, {
        userId: byEmail.id,
        provider: input.providerId,
        subject: input.subject,
        email: input.mapped.email,
      });
      // A bootstrap admin who signs in through an IdP without group claims
      // keeps admin instead of being silently downgraded and locked out.
      const keepBootstrapAdmin =
        byEmail.bootstrap &&
        byEmail.role === "admin" &&
        input.mapped.groups.length === 0;
      const user = await updateUser(this.db, byEmail.id, {
        displayName: byEmail.displayName || input.mapped.displayName,
        role: keepBootstrapAdmin ? "admin" : input.mapped.role,
        groups: input.mapped.groups,
        lastLoginAt: new Date(),
      });
      if (!user) throw new AuthError("failed to update user", 500);
      return user;
    }

    const user = await insertUser(this.db, {
      orgId: this.orgId,
      email: input.mapped.email,
      displayName: input.mapped.displayName,
      role: input.mapped.role,
      groups: input.mapped.groups,
    });
    await insertIdentity(this.db, {
      userId: user.id,
      provider: input.providerId,
      subject: input.subject,
      email: input.mapped.email,
    });
    return user;
  }

  /** Break-glass bootstrap admin token (constant-time, disabled once an admin exists). */
  async bootstrap(input: {
    token: string;
    email: string;
    displayName?: string;
    ip: string;
    userAgent: string;
  }): Promise<CompletedLogin> {
    const configured = this.options.bootstrapToken;
    if (!configured) {
      throw new AuthError("bootstrap is not configured", 404);
    }
    if (!constantTimeEqual(configured, input.token)) {
      throw new AuthError("invalid bootstrap token", 403);
    }
    const admins = await countAdmins(this.db, this.orgId);
    if (admins > 0 && !this.options.bootstrapReenable) {
      throw new AuthError(
        "an admin already exists; bootstrap is disabled",
        403,
      );
    }

    const email = input.email.trim().toLowerCase();
    let user = await findUserByEmail(this.db, this.orgId, email);
    if (user) {
      if (user.disabled) throw new AuthError("user is disabled", 403);
      user = await updateUser(this.db, user.id, {
        role: "admin",
        bootstrap: true,
        lastLoginAt: new Date(),
      });
    } else {
      user = await insertUser(this.db, {
        orgId: this.orgId,
        email,
        displayName: input.displayName ?? email,
        role: "admin",
        bootstrap: true,
      });
    }
    if (!user) throw new AuthError("failed to create bootstrap admin", 500);

    const session = await this.sessions.issue({
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await this.audit.record({
      orgId: this.orgId,
      actorUserId: user.id,
      action: "auth.bootstrap",
      targetType: "user",
      targetId: user.id,
      metadata: { email },
    });
    return { user, session, returnTo: "/" };
  }

  async bootstrapAvailable(): Promise<boolean> {
    if (!this.options.bootstrapToken) return false;
    return (
      this.options.bootstrapReenable ||
      (await countAdmins(this.db, this.orgId)) === 0
    );
  }

  listProviders() {
    return this.oidc.listProviders();
  }
}
