import type { DbExecutor } from "../db/repositories.js";
import { insertAudit, listAudit } from "../db/repositories.js";

const SENSITIVE_KEY = /(secret|token|password|credential|authorization|private[_-]?key)/i;

/** Recursively drops secret-looking keys so audit rows can never leak them. */
export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditMetadata(entry, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      result[key] = sanitizeAuditMetadata(entry, depth + 1);
    }
    return result;
  }
  return value;
}

export interface AuditInput {
  orgId: string;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "device";
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly db: DbExecutor) {}

  async record(input: AuditInput): Promise<void> {
    await insertAudit(this.db, {
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "user",
      action: input.action,
      targetType: input.targetType ?? "",
      targetId: input.targetId ?? "",
      metadata: (sanitizeAuditMetadata(input.metadata ?? {}) as Record<
        string,
        unknown
      >),
    });
  }

  async list(orgId: string, limit: number) {
    return listAudit(this.db, orgId, limit);
  }
}
