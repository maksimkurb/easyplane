/** Pure revision arithmetic (unit-tested in test/unit/revisions.test.ts). */

export interface RevisionRecord {
  revision: number;
  config: Record<string, unknown>;
}

export function nextRevisionNumber(records: readonly RevisionRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.revision), 0) + 1;
}

export function latestRevision(
  records: readonly RevisionRecord[],
): RevisionRecord | null {
  let latest: RevisionRecord | null = null;
  for (const record of records) {
    if (latest === null || record.revision > latest.revision) latest = record;
  }
  return latest;
}

export interface RollbackPlan {
  revision: number;
  config: Record<string, unknown>;
  rollbackOfRevision: number;
}

/**
 * Rollback is append-only: it creates a new revision whose content is a copy of
 * the target revision. History therefore still shows what happened and when,
 * and `rollback_of_revision` points at the restored revision.
 */
export function planRollback(
  records: readonly RevisionRecord[],
  targetRevision: number,
): RollbackPlan {
  const target = records.find((record) => record.revision === targetRevision);
  if (!target) throw new Error(`revision ${targetRevision} does not exist`);
  return {
    revision: nextRevisionNumber(records),
    config: structuredClone(target.config),
    rollbackOfRevision: target.revision,
  };
}
