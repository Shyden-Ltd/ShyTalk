import { randomUUID } from 'node:crypto';

const API_BASE = process.env.API_BASE_URL!;

/**
 * A collision-resistant id suffix.
 *
 * `Math.random()` is flagged by sonarjs/pseudo-random, and warnings are
 * failures in this repo — but the real reason to prefer this is that these ids
 * are written into a SHARED emulator that parallel workers also write to, so a
 * weak generator is a genuine collision risk, not just a lint complaint.
 */
function randomSuffix(): string {
  return randomUUID().slice(0, 8);
}
const TEST_API_KEY = process.env.TEST_API_KEY || 'local-test-key';

/**
 * Write a real `logs` document straight into Firestore, in the exact shape
 * `express-api/src/utils/logger.js` `buildLogDoc` produces.
 *
 * The log-filter tests used to guard their assertions on
 * `if (rowCount > 0)`, which meant that whenever the table happened to be
 * empty — a fresh emulator, a throttled logger, a circuit-breaker trip — the
 * filter under test was never checked and the test still reported green.
 * Seeding removes the "happened to be" entirely.
 *
 * `timestamp` is derived from `Date.now()` at call time; a literal would pass
 * on the day it was written and rot afterwards.
 */
export async function seedLog(fields: {
  testRunId: string;
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  source?: string;
  message: string;
  userId?: string;
  sessionTraceId?: string;
}): Promise<{ id: string; sessionTraceId: string }> {
  const id = `e2e-log-${Date.now()}-${randomSuffix()}`;
  // `sessionTraceId`, NOT `traceId` — that is the name in logger.js's
  // PASSTHROUGH_FIELDS, and the admin trace filter reads exactly that field.
  const sessionTraceId = fields.sessionTraceId ?? `e2e-trace-${randomSuffix()}`;
  const doc: Record<string, unknown> = {
    id,
    timestamp: new Date().toISOString(),
    level: fields.level ?? 'error',
    source: fields.source ?? 'express-api',
    message: fields.message,
    sessionTraceId,
    _testRun: fields.testRunId,
  };
  if (fields.userId) doc.userId = fields.userId;

  const res = await fetch(`${API_BASE}/api/test/write/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`seedLog failed: ${res.status} ${await res.text()}`);
  return { id, sessionTraceId };
}

/**
 * Write a real `adminAuditLog` document.
 *
 * Audit rows only ever appear as a side effect of an admin ACTION, so the
 * audit-log specs could not arrange them and instead skipped themselves with
 * "No entries" whenever the table was empty — leaving CSV export and row
 * structure unverified. Field names mirror what
 * `public/admin/js/tabs/audit-log.js` reads.
 */
export async function seedAuditEntry(fields: {
  testRunId: string;
  adminName?: string;
  actionType?: string;
  targetType?: string;
  target?: string;
  timestamp?: number;
}): Promise<{ id: string }> {
  const id = `e2e-audit-${Date.now()}-${randomSuffix()}`;
  const res = await fetch(`${API_BASE}/api/test/write/adminAuditLog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify({
      id,
      adminName: fields.adminName ?? 'e2e-admin',
      actionType: fields.actionType ?? 'approve',
      targetType: fields.targetType ?? 'suggestion',
      target: fields.target ?? id,
      // Derived from now() at call time — a literal would pass on the day it
      // was written and rot thereafter.
      timestamp: fields.timestamp ?? Date.now(),
      createdAt: fields.timestamp ?? Date.now(),
      _testRun: fields.testRunId,
    }),
  });
  if (!res.ok) throw new Error(`seedAuditEntry failed: ${res.status} ${await res.text()}`);
  return { id };
}
