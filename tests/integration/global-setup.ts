import type { FullConfig } from "@playwright/test";
import { request as pwRequest } from "@playwright/test";

/**
 * Integration test global-setup.
 *
 * Probes that the local stack is up and ready before tests run.
 * The stack is brought up by `bash local/start.sh` (locally) or a
 * CI-side step that calls the same composite actions used by
 * `playwright-tests.yml` (Docker + Firebase emulators + Express).
 *
 * Strategy:
 *   - Locally: assume the stack is already up. If any probe fails,
 *     throw with a clear "run bash local/start.sh first" message.
 *   - CI: same — but the workflow step ensures the stack is up
 *     before this setup runs, so probes always succeed.
 *
 * We do NOT spin up the stack from inside this setup because:
 *   1. start.sh has its own polling loops that would race with ours.
 *   2. A failed start.sh should fail the workflow, not be hidden
 *      behind a "trying to start" message in setup output.
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`.
 */

const PROBE_TIMEOUT_MS = 5_000;

interface ProbeTarget {
  name: string;
  url: string;
  /** Optional check on the response — if it returns a string, that's a failure reason. */
  check?: (status: number, body: string) => string | null;
}

const PROBES: ProbeTarget[] = [
  {
    name: "Express API",
    url: "http://localhost:3000/api/health",
    check: (status, body) => {
      if (status !== 200) return `expected 200, got ${status}`;
      try {
        const json = JSON.parse(body);
        if (json.ok !== true) return `body.ok must be true, got ${JSON.stringify(json)}`;
      } catch {
        return `body must be JSON, got: ${body.slice(0, 200)}`;
      }
      return null;
    },
  },
  {
    name: "Firebase Emulator UI",
    url: "http://localhost:4000",
    check: (status) => (status === 200 ? null : `expected 200, got ${status}`),
  },
  {
    name: "MinIO (R2 mock)",
    url: "http://localhost:9002/minio/health/live",
    check: (status) => (status === 200 ? null : `expected 200, got ${status}`),
  },
];

async function probe(api: ReturnType<typeof pwRequest.newContext> extends Promise<infer T> ? T : never, target: ProbeTarget): Promise<string | null> {
  try {
    const res = await api.get(target.url, { timeout: PROBE_TIMEOUT_MS });
    const body = await res.text();
    if (target.check) {
      const err = target.check(res.status(), body);
      if (err) return `${target.name}: ${err}`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${target.name}: ${msg}`;
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const api = await pwRequest.newContext();
  try {
    const results = await Promise.all(PROBES.map((p) => probe(api, p)));
    const failures = results.filter((r): r is string => r !== null);

    if (failures.length > 0) {
      const message = [
        "",
        "Integration test stack is not ready. Probes that failed:",
        ...failures.map((f) => `  - ${f}`),
        "",
        "If running locally, start the stack with:",
        "  bash local/start.sh",
        "  cd express-api && npm run local",
        "",
        "If running in CI, the workflow step that brings up the stack",
        "either failed or hadn't completed before tests started.",
        "",
      ].join("\n");
      throw new Error(message);
    }
  } finally {
    await api.dispose();
  }
}
