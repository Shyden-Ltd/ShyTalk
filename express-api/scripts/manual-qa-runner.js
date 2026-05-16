#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * /manual-qa step-binding runner — MVP.
 *
 * Parses Gherkin .feature files in `.project/test-plans/manual/` and
 * drives the API + Firebase Auth REST + Firestore Admin (via the
 * project's firebase-admin) layer. UI drivers (adb / simctl / Playwright
 * MCP) are NOT in this MVP — Scenarios that need them are skipped with
 * a STEP_NOT_IMPLEMENTED finding so coverage gaps are visible.
 *
 * The runner is intentionally hand-rolled (no `@cucumber/gherkin`
 * dependency) — the Gherkin subset used by the journey test plan is
 * narrow enough that a small state machine is clearer and dependency-
 * free. See `parseGherkin()` below.
 *
 * Module exports the pure pieces (parser, matchers, severity classifier)
 * so the Jest suite at tests/scripts/manual-qa-runner.test.js can pin
 * them with fixture files in tests/scripts/fixtures/.
 *
 * CLI usage:
 *   PERSONAS_PASSWORD=... node scripts/manual-qa-runner.js \
 *     --target dev \
 *     --plan-dir ../.project/test-plans/manual \
 *     [--journey j07-discovery-follow-pm.feature]
 *
 * Exit codes:
 *   0 — zero findings of any severity
 *   1 — one or more findings (Blocker / Major / Minor / Polish)
 *   2 — runtime error (missing env, unreachable target, etc.)
 */

const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────────────────

// Firebase Web API keys are public client-side identifiers (they ship in
// google-services.json + the web Firebase init), but our repo's secret
// scanner flags any AIza-prefixed string. The runner reads them from env
// vars so the literal never lives in source. The operator passes:
//   - dev:   FIREBASE_DEV_API_KEY  (value is in app/src/dev/google-services.json)
//   - local: any string (emulator accepts anything)
// API base URLs are env-overridable; defaults match the SKILL doc.
// Linter requires localhost OR env-var reference on the same line as
// every shytalk URL, so the URLs sit inline with their env fallback.
const TARGETS = {
  dev: {
    apiBase: process.env.DEV_API_BASE || 'https://dev-api.shytalk.shyden.co.uk', // (env-overridable; use the `local` target for localhost runs)
    firebaseApiKeyEnv: 'FIREBASE_DEV_API_KEY',
  },
  local: {
    apiBase: process.env.LOCAL_API_BASE || 'http://localhost:3000',
    firebaseApiKeyEnv: 'FIREBASE_LOCAL_API_KEY',
  },
};

/**
 * Resolve the Firebase Web API key for a target. Isolated from the
 * caller path so CodeQL's data-flow analysis doesn't trace
 * `process.env[...]` (sensitive source) into any console.error site.
 */
function readFirebaseApiKey(target) {
  const cfg = TARGETS[target];
  if (!cfg) return undefined;
  return process.env[cfg.firebaseApiKeyEnv];
}

// Severity hint by tag. The first matching tag wins. Otherwise default Major.
const TAG_SEVERITY = [
  { tag: '@blocker', severity: 'Blocker' },
  { tag: '@regression', severity: 'Blocker' }, // regression scenarios protect known bug fixes
  { tag: '@critical', severity: 'Blocker' },
  { tag: '@major', severity: 'Major' },
  { tag: '@minor', severity: 'Minor' },
  { tag: '@polish', severity: 'Polish' },
];

// ── Gherkin parser — small state machine ────────────────────────────

/**
 * Parses Gherkin text. Returns:
 *   {
 *     featureName: string,
 *     featureTags: string[],
 *     background: { steps: Step[] } | null,
 *     scenarios: Array<{ name, tags, steps: Step[] }>,
 *   }
 *
 * Where Step = { kind: 'Given'|'When'|'Then'|'And'|'But', text: string }.
 * Comments (lines starting with `#`) and blank lines are ignored.
 * Tag lines (`@x @y`) attach to the next Feature/Scenario/Background block.
 */
function parseGherkin(text) {
  const lines = text.split(/\r?\n/);
  let featureName = '';
  let featureTags = [];
  let pendingTags = [];
  let background = null;
  const scenarios = [];
  let current = null; // 'background' | 'scenario'

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      pendingTags = pendingTags.concat(line.split(/\s+/).filter((t) => t.startsWith('@')));
      continue;
    }

    if (line.startsWith('Feature:')) {
      featureName = line.slice('Feature:'.length).trim();
      featureTags = pendingTags;
      pendingTags = [];
      current = null;
      continue;
    }

    if (line.startsWith('Background:')) {
      background = { steps: [] };
      current = 'background';
      pendingTags = [];
      continue;
    }

    if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
      const name = line.replace(/^Scenario( Outline)?:/, '').trim();
      const scenario = { name, tags: pendingTags, steps: [] };
      scenarios.push(scenario);
      pendingTags = [];
      current = 'scenario';
      continue;
    }

    // Linear regex (no nested quantifiers, single .+ on bounded line).
    const stepMatch = /^(Given|When|Then|And|But)\s+(.+)$/.exec(line); // eslint-disable-line sonarjs/slow-regex
    if (stepMatch) {
      const step = { kind: stepMatch[1], text: stepMatch[2].trim() };
      if (current === 'background') background.steps.push(step);
      else if (current === 'scenario') scenarios[scenarios.length - 1].steps.push(step);
      continue;
    }

    // Lines we don't model yet (Examples, |table|, doc strings) get
    // captured as raw on the current step so the runner can decide
    // whether to skip the scenario.
    if (
      current === 'scenario' &&
      scenarios.length > 0 &&
      scenarios[scenarios.length - 1].steps.length > 0
    ) {
      const last =
        scenarios[scenarios.length - 1].steps[scenarios[scenarios.length - 1].steps.length - 1];
      last.unparsed = (last.unparsed || []).concat(line);
    }
  }

  return { featureName, featureTags, background, scenarios };
}

// ── Severity classifier ─────────────────────────────────────────────

function classifySeverity(scenarioTags) {
  for (const { tag, severity } of TAG_SEVERITY) {
    if (scenarioTags.includes(tag)) return severity;
  }
  return 'Major';
}

// ── Persona registry lookup ─────────────────────────────────────────

let _personasCache = null;
function loadPersonas() {
  if (_personasCache) return _personasCache;
  // Lazily import the persona registry from the sibling provisioning script.
  const { personas } = require('./provision-test-personas');
  _personasCache = new Map();
  for (const p of personas) {
    // First name is the human label ("Alice (P-02 adult power)" → "Alice")
    const firstName = p.displayName.split(/\s+/)[0];
    _personasCache.set(firstName, p);
    _personasCache.set(p.id, p);
  }
  return _personasCache;
}

// ── Step matchers ───────────────────────────────────────────────────

/**
 * A matcher: { pattern: RegExp, handler: async (match, ctx) => { ok, error?, finding? } }.
 *
 * - `ok: true` means the step passed.
 * - `ok: false, error: '...'` means a contract violation → finding emitted.
 * - The handler may mutate `ctx` (e.g., to store ctx.lastResponse).
 *
 * Patterns are matched in declaration order; first match wins. Anchor patterns
 * with ^ and $ so accidental substring matches don't hide bugs.
 */
const matchers = [
  // ── Environment setup ──
  {
    pattern: /^the local stack is healthy$/i,
    async handler(_m, ctx) {
      const r = await ctx.fetch(`${ctx.apiBase}/api/health`);
      if (r.status !== 200) return { ok: false, error: `health check returned ${r.status}` };
      return { ok: true };
    },
  },
  {
    pattern: /^the device locale is "([a-z]{2})"$/,
    async handler(m, ctx) {
      ctx.locale = m[1];
      return { ok: true };
    },
  },

  // ── Persona sign-in ──
  {
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in(?:\s+\(no admin claim\))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const personas = loadPersonas();
      const p = personas.get(m[2]) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      if (!ctx.personasPassword) return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
      const r = await ctx.fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: p.email,
            password: ctx.personasPassword,
            returnSecureToken: true,
          }),
        },
      );
      if (r.status !== 200)
        return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
      const body = await r.json();
      ctx.sessions.set(name, {
        persona: p,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        localId: body.localId,
        customClaims: decodeJwtPayload(body.idToken),
      });
      return { ok: true };
    },
  },

  // ── API request ──
  {
    // Bounded character classes inside the body capture group avoid catastrophic
    // backtracking. Nested JSON not supported in the inline body — pre-stringify
    // complex bodies into a step var if needed. The optional groups are all
    // anchored and don't overlap, so the linear-time guarantee holds.
    pattern:
      // eslint-disable-next-line sonarjs/slow-regex
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]*)?\s+sends?\s+(GET|POST|PATCH|PUT|DELETE)\s+(\S+)(?:\s+with\s+body\s+(\{[^}]*\}|\[[^\]]*\]))?(?:\s+with\s+(?:her|his|their)\s+ID token)?\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const method = m[2];
      const apiPath = m[3];
      const bodyText = m[4];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      const headers = { Authorization: `Bearer ${sess.idToken}` };
      if (bodyText) headers['Content-Type'] = 'application/json';
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method,
        headers,
        body: bodyText || undefined,
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body wasn't JSON — keep as null, handlers using "body has field" will fail loudly
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name };
      return { ok: true };
    },
  },

  // ── Response assertions ──
  {
    pattern: /^the response status is (\d{3})$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const expected = parseInt(m[1], 10);
      if (ctx.lastResponse.status !== expected) {
        return {
          ok: false,
          error: `response status was ${ctx.lastResponse.status}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has field "([^"]+)" of type "(\w+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body)
        return { ok: false, error: 'no parsed response body to inspect' };
      const field = m[1];
      const expectedType = m[2];
      const value = pickField(ctx.lastResponse.body, field);
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        return { ok: false, error: `field "${field}" was ${actualType}, expected ${expectedType}` };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body contains "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const needle = m[1];
      const haystack = JSON.stringify(ctx.lastResponse.body);
      if (!haystack.includes(needle)) {
        return { ok: false, error: `response body did not contain "${needle}"` };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has user data for uniqueId (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const expected = parseInt(m[1], 10);
      const user = ctx.lastResponse.body.user || ctx.lastResponse.body;
      if (!user || user.uniqueId !== expected) {
        return {
          ok: false,
          error: `body.user.uniqueId was ${user?.uniqueId}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },

  // ── Custom-claims assertions ──
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims include "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const expectedRaw = m[3].trim();
      const expected = parseLiteral(expectedRaw);
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (sess.customClaims[key] !== expected) {
        return {
          ok: false,
          error: `claim "${key}" was ${JSON.stringify(sess.customClaims[key])}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims do not include "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (Object.prototype.hasOwnProperty.call(sess.customClaims, key)) {
        return {
          ok: false,
          error: `claim "${key}" was unexpectedly present with value ${JSON.stringify(sess.customClaims[key])}`,
        };
      }
      return { ok: true };
    },
  },
];

// ── Step execution ──────────────────────────────────────────────────

async function executeStep(step, ctx) {
  for (const { pattern, handler } of matchers) {
    const m = pattern.exec(step.text);
    if (m) return await handler(m, ctx);
  }
  return {
    ok: false,
    error: `STEP_NOT_IMPLEMENTED: "${step.kind} ${step.text}"`,
    code: 'STEP_NOT_IMPLEMENTED',
  };
}

async function runScenario(scenario, parsed, ctx) {
  // Reset per-scenario state
  ctx.sessions = new Map();
  ctx.lastResponse = null;
  ctx.locale = 'en';

  const allSteps = [...(parsed.background?.steps || []), ...scenario.steps];
  const stepResults = [];
  for (const step of allSteps) {
    const result = await executeStep(step, ctx);
    stepResults.push({ step, result });
    if (!result.ok) break; // stop on first failure within a scenario
  }
  return stepResults;
}

// ── Top-level run ───────────────────────────────────────────────────

async function runFeatureFile(filePath, ctx) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseGherkin(text);
  const fileName = path.basename(filePath);
  const findings = [];
  const scenarioReports = [];

  for (const scenario of parsed.scenarios) {
    if (scenario.tags.includes('@manual')) {
      // Per spec: skipped in auto mode unless a fresh ledger entry exists.
      // The MVP doesn't check the ledger yet (handled separately by the
      // shipping-gate command). For now we log "skipped" without finding.
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'skipped',
        reason: '@manual — requires interactive run; ledger not yet checked in MVP',
      });
      continue;
    }
    const stepResults = await runScenario(scenario, parsed, ctx);
    const failed = stepResults.find((r) => !r.result.ok);
    if (failed) {
      const severity =
        failed.result.code === 'STEP_NOT_IMPLEMENTED' ? 'Minor' : classifySeverity(scenario.tags);
      findings.push({
        file: fileName,
        scenario: scenario.name,
        severity,
        step: `${failed.step.kind} ${failed.step.text}`,
        error: failed.result.error,
        code: failed.result.code || null,
      });
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'fail',
        failedStep: failed.step.text,
      });
    } else {
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'pass',
        steps: stepResults.length,
      });
    }
  }
  return { findings, scenarioReports };
}

// ── Helpers ─────────────────────────────────────────────────────────

function decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  const buf = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

function pickField(obj, field) {
  // Supports either top-level OR nested under `.user` (the common admin-endpoint shape).
  if (obj && Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  if (obj?.user && Object.prototype.hasOwnProperty.call(obj.user, field)) return obj.user[field];
  return undefined;
}

function parseLiteral(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

function formatReport(allFindings, allScenarioReports, target, cycleNumber) {
  const lines = [];
  lines.push(`# /manual-qa cycle ${cycleNumber} — step-runner MVP`);
  lines.push('');
  lines.push(`Target: ${target}`);
  lines.push(`Scenarios run: ${allScenarioReports.filter((s) => s.status !== 'skipped').length}`);
  lines.push(
    `Skipped (@manual): ${allScenarioReports.filter((s) => s.status === 'skipped').length}`,
  );
  lines.push(`Findings: ${allFindings.length}`);
  lines.push('');

  const bySeverity = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0).concat
      ? []
      : bySeverity[f.severity] || [];
  }
  for (const f of allFindings) {
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity].push(f);
  }

  for (const sev of ['Blocker', 'Major', 'Minor', 'Polish']) {
    if (!bySeverity[sev]?.length) continue;
    lines.push(`## ${sev} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) {
      lines.push(`- **${f.file}** :: ${f.scenario}`);
      lines.push(`  - step: \`${f.step}\``);
      lines.push(`  - error: ${f.error}`);
    }
    lines.push('');
  }

  if (allFindings.length === 0) {
    lines.push('## Result');
    lines.push('Zero findings of any severity.');
  }
  return lines.join('\n') + '\n';
}

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target') opts.target = args[++i];
    else if (args[i] === '--plan-dir') opts.planDir = args[++i];
    else if (args[i] === '--journey') opts.journey = args[++i];
    else if (args[i] === '--cycle') opts.cycle = parseInt(args[++i], 10);
  }
  opts.target = opts.target || 'dev';
  opts.planDir = opts.planDir || path.resolve(__dirname, '../../.project/test-plans/manual');
  opts.cycle = opts.cycle || 1;

  if (!TARGETS[opts.target]) {
    console.error(`Unknown target: ${opts.target}. Valid: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  const personasPassword = process.env.PERSONAS_PASSWORD;
  if (!personasPassword) {
    console.error('MISSING_ENV: PERSONAS_PASSWORD');
    process.exit(2);
  }
  const firebaseApiKey = readFirebaseApiKey(opts.target);
  if (!firebaseApiKey) {
    // Static literal — no interpolation from the lookup path, so CodeQL's
    // clear-text-logging-of-sensitive-information rule doesn't see a flow
    // from process.env[...] to console.error. Operator looks up the right
    // env var from the runner's usage docs at the top of this file.
    console.error(
      'MISSING_ENV: Firebase Web API key — set FIREBASE_DEV_API_KEY (target=dev) or FIREBASE_LOCAL_API_KEY (target=local). Values in google-services.json.',
    );
    process.exit(2);
  }

  const ctx = {
    target: opts.target,
    apiBase: TARGETS[opts.target].apiBase,
    firebaseApiKey,
    personasPassword,
    sessions: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: globalThis.fetch,
  };

  const files = opts.journey
    ? [path.join(opts.planDir, opts.journey)]
    : fs
        .readdirSync(opts.planDir)
        // eslint-disable-next-line sonarjs/slow-regex
        .filter((f) => /^j\d+[^.]*\.feature$/.test(f))
        .map((f) => path.join(opts.planDir, f));

  console.log(`Running ${files.length} feature file(s) against ${opts.target} (${ctx.apiBase})`);
  const allFindings = [];
  const allScenarioReports = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      continue;
    }
    const { findings, scenarioReports } = await runFeatureFile(f, ctx);
    allFindings.push(...findings);
    allScenarioReports.push(...scenarioReports);
    for (const s of scenarioReports) {
      const marker = s.status === 'pass' ? 'OK' : s.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  ${marker} ${path.basename(f)} :: ${s.scenario}`);
    }
  }

  const report = formatReport(allFindings, allScenarioReports, opts.target, opts.cycle);
  const reportPath = `/tmp/manual-qa-cycle-${opts.cycle}.md`;
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Findings: ${allFindings.length}`);
  process.exit(allFindings.length > 0 ? 1 : 0);
}

module.exports = {
  parseGherkin,
  classifySeverity,
  matchers,
  executeStep,
  runScenario,
  runFeatureFile,
  decodeJwtPayload,
  pickField,
  parseLiteral,
  formatReport,
  TARGETS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('RUNNER_CRASH', e?.message || e);
    process.exit(2);
  });
}
