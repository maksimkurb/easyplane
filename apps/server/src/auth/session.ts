import {
  createSession,
  deleteSession,
  findSession,
  touchSession,
  type DbExecutor,
  type SessionWithUser,
} from "../db/repositories.js";
import { constantTimeEqual, randomToken, sha256Hex } from "../security/crypto.js";

export const SESSION_COOKIE = "easyplane_session";
export const CSRF_COOKIE = "easyplane_csrf";

export interface SessionOptions {
  idleMs: number;
  absoluteMs: number;
  secureCookies: boolean;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  cookie: string;
  csrfCookie: string;
}

const TOUCH_INTERVAL_MS = 60_000;

/** PostgreSQL-backed browser sessions with rolling idle + absolute expiry. */
export class SessionService {
  constructor(
    private readonly db: DbExecutor,
    private readonly options: SessionOptions,
  ) {}

  private cookie(value: string, maxAgeSeconds: number, httpOnly: boolean): string {
    const parts = [
      `${httpOnly ? SESSION_COOKIE : CSRF_COOKIE}=${value}`,
      "Path=/",
      `Max-Age=${maxAgeSeconds}`,
      "SameSite=Lax",
    ];
    if (httpOnly) parts.push("HttpOnly");
    if (this.options.secureCookies) parts.push("Secure");
    return parts.join("; ");
  }

  async issue(values: {
    userId: string;
    ip: string;
    userAgent: string;
  }): Promise<IssuedSession> {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const now = Date.now();
    const expiresAt = new Date(
      Math.min(now + this.options.idleMs, now + this.options.absoluteMs),
    );
    await createSession(this.db, {
      userId: values.userId,
      tokenHash: sha256Hex(token),
      csrfToken,
      ip: values.ip,
      userAgent: values.userAgent,
      expiresAt,
    });
    const maxAge = Math.floor((expiresAt.getTime() - now) / 1000);
    return {
      token,
      csrfToken,
      expiresAt,
      cookie: this.cookie(token, maxAge, true),
      csrfCookie: this.cookie(csrfToken, maxAge, false),
    };
  }

  /** Resolves a cookie token; returns null for unknown/expired/idle sessions. */
  async resolve(token: string, now: Date = new Date()): Promise<SessionWithUser | null> {
    if (!token) return null;
    const found = await findSession(this.db, sha256Hex(token));
    if (!found) return null;
    const { session, user } = found;
    if (user.disabled) return null;
    if (session.expiresAt.getTime() <= now.getTime()) {
      await deleteSession(this.db, session.id);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > this.options.idleMs) {
      await deleteSession(this.db, session.id);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const absoluteCap = session.createdAt.getTime() + this.options.absoluteMs;
      const nextExpiry = new Date(
        Math.min(now.getTime() + this.options.idleMs, absoluteCap),
      );
      await touchSession(this.db, session.id, {
        lastSeenAt: now,
        expiresAt: nextExpiry,
      });
    }
    return found;
  }

  /** CSRF is bound to the session and compared in constant time. */
  verifyCsrf(session: { csrfToken: string }, header: string | undefined): boolean {
    if (!header) return false;
    return constantTimeEqual(session.csrfToken, header);
  }

  async destroy(token: string): Promise<void> {
    const found = await findSession(this.db, sha256Hex(token));
    if (found) await deleteSession(this.db, found.session.id);
  }

  clearCookies(): string[] {
    return [
      this.cookie("", 0, true),
      this.cookie("", 0, false),
    ];
  }
}
