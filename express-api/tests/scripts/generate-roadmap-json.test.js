/**
 * Tests for roadmap data generation script.
 *
 * Covers spec section:
 *   11.39 — Roadmap Data Generation
 *
 * Tests parseRoadmap() and computePhaseStatus() directly
 * rather than running the full script with fs mocks.
 */

const {
  parseRoadmap,
  SKIP_PHASES,
  PHASE_TITLES,
  computePhaseStatus,
} = require('../../../scripts/generate-roadmap-json');

// ─── Sample data ───────────────────────────────────────────────

const SAMPLE_MD = `# ShyTalk Feature Roadmap

---

## Phase 0 — Infrastructure & Code Health (do first)

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 36 | **Fix all SonarCloud issues on main** — 500+ issues | Medium | DONE (PR #223, 2026-03-30) |
| 37 | **Allure report directory structure** | Medium | DONE (PR #241, 2026-03-31) |

---

## Phase 1 — Compliance & Legal (non-negotiable)

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| B1 | **Account deletion** — GDPR Art.17, Google Play & Apple requirement | Large | DONE (PR #218, 2026-03-29) |
| B2 | **Data export** — GDPR Art.20 data portability | Medium | DONE (PR #238, 2026-03-30) |
| 17 | **Age-based segregation** — UK OSA, adults/minors must not interact | Large | IN PROGRESS (design phase) |
| B3 | **Room message reporting** — UK OSA, report mechanism on every UGC screen | Small | |

---

## Phase 2 — Platform Foundation

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| B5 | **iOS build fix** — cinterop errors | Medium | DONE (PRs #312-316, 2026-04-22) |
| B6 | **iOS app** — full feature parity | XL | IN PROGRESS |
| B7 | **Billing v7→v8** — deprecation deadline | Medium | |

---

## Phase 3 — Revenue Engine

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 13 | **Nobility system** — ranks from gift value | Large | |
| 1 | **Relationships** — paid tiers | Large | |
`;

// ─── parseRoadmap tests ────────────────────────────────────────

describe('parseRoadmap', () => {
  const phases = parseRoadmap(SAMPLE_MD);

  test('parses all phases from markdown', () => {
    expect(phases.length).toBe(4); // Phase 0, 1, 2, 3
  });

  test('extracts feature names correctly', () => {
    const phase1 = phases.find((p) => p.num === 1);
    const names = phase1.features.map((f) => f.name);
    expect(names).toContain('Account deletion');
    expect(names).toContain('Data export');
    expect(names).toContain('Age-based segregation');
    expect(names).toContain('Room message reporting');
  });

  test('maps DONE status to done', () => {
    const phase1 = phases.find((p) => p.num === 1);
    const acctDel = phase1.features.find((f) => f.name === 'Account deletion');
    expect(acctDel.status).toBe('done');
  });

  test('maps IN PROGRESS status to in-progress', () => {
    const phase1 = phases.find((p) => p.num === 1);
    const ageSeg = phase1.features.find((f) => f.name === 'Age-based segregation');
    expect(ageSeg.status).toBe('in-progress');
  });

  test('maps empty status to planned', () => {
    const phase1 = phases.find((p) => p.num === 1);
    const roomReport = phase1.features.find((f) => f.name === 'Room message reporting');
    expect(roomReport.status).toBe('planned');
  });

  test('strips PR numbers from descriptions', () => {
    const phase2 = phases.find((p) => p.num === 2);
    const iosFix = phase2.features.find((f) => f.name === 'iOS build fix');
    expect(iosFix.description).not.toContain('PR #');
    expect(iosFix.description).not.toContain('#312');
  });

  test('hides internal features (SonarCloud, Allure) via keyword filter', () => {
    const phase0 = phases.find((p) => p.num === 0);
    expect(phase0).toBeDefined();
    // SonarCloud and Allure are filtered by HIDE_KEYWORDS in parseRoadmap
    const names = phase0.features.map((f) => f.name);
    expect(names).not.toContain('Fix all SonarCloud issues on main');
    expect(names).not.toContain('Allure report directory structure');
  });
});

// ─── SKIP_PHASES / filtering tests ─────────────────────────────

describe('phase filtering', () => {
  test('Phase 0 is in SKIP_PHASES (hidden from public)', () => {
    expect(SKIP_PHASES.has(0)).toBe(true);
  });

  test('Phase 1 is not in SKIP_PHASES', () => {
    expect(SKIP_PHASES.has(1)).toBe(false);
  });

  test('filtered output excludes Phase 0', () => {
    const phases = parseRoadmap(SAMPLE_MD);
    const visible = phases.filter((p) => !SKIP_PHASES.has(p.num));
    expect(visible.length).toBe(3); // Phase 1, 2, 3
    expect(visible.every((p) => p.num !== 0)).toBe(true);
  });
});

// ─── computePhaseStatus tests ──────────────────────────────────

describe('computePhaseStatus', () => {
  test('all done → complete', () => {
    const result = computePhaseStatus([{ status: 'done' }, { status: 'done' }, { status: 'done' }]);
    expect(result.label).toBe('complete');
    expect(result.done).toBe(3);
    expect(result.total).toBe(3);
  });

  test('mix of done and in-progress → in-progress', () => {
    const result = computePhaseStatus([
      { status: 'done' },
      { status: 'in-progress' },
      { status: 'planned' },
    ]);
    expect(result.label).toBe('in-progress');
    expect(result.done).toBe(1);
    expect(result.total).toBe(3);
  });

  test('only in-progress, no done → in-progress', () => {
    const result = computePhaseStatus([{ status: 'in-progress' }, { status: 'planned' }]);
    expect(result.label).toBe('in-progress');
    expect(result.done).toBe(0);
    expect(result.total).toBe(2);
  });

  test('next status counts as in-progress', () => {
    const result = computePhaseStatus([{ status: 'next' }, { status: 'planned' }]);
    expect(result.label).toBe('in-progress');
  });

  test('all planned → planned', () => {
    const result = computePhaseStatus([{ status: 'planned' }, { status: 'planned' }]);
    expect(result.label).toBe('planned');
    expect(result.done).toBe(0);
    expect(result.total).toBe(2);
  });

  test('empty features → planned with 0/0', () => {
    const result = computePhaseStatus([]);
    expect(result.label).toBe('planned');
    expect(result.done).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ─── Integration: full pipeline ────────────────────────────────

describe('full pipeline integration', () => {
  test('produces correct phase structure with progress', () => {
    const phases = parseRoadmap(SAMPLE_MD);
    const visible = phases
      .filter((p) => !SKIP_PHASES.has(p.num))
      .filter((p) => p.features.length > 0)
      .map((p) => {
        const { label, done, total } = computePhaseStatus(p.features);
        return {
          title: PHASE_TITLES[p.num] || `Phase ${p.num}`,
          status: label,
          progress: { done, total },
          featureCount: p.features.length,
        };
      });

    expect(visible.length).toBe(3);

    // Phase 1: 2 done, 1 in-progress, 1 planned → in-progress
    const phase1 = visible.find((p) => p.title.includes('Compliance'));
    expect(phase1.status).toBe('in-progress');
    expect(phase1.progress.done).toBe(2);
    expect(phase1.progress.total).toBe(4);

    // Phase 2: 1 done, 1 in-progress, 1 planned → in-progress
    const phase2 = visible.find((p) => p.title.includes('Platform'));
    expect(phase2.status).toBe('in-progress');
    expect(phase2.progress.done).toBe(1);
    expect(phase2.progress.total).toBe(3);

    // Phase 3: all planned
    const phase3 = visible.find((p) => p.title.includes('Revenue'));
    expect(phase3.status).toBe('planned');
    expect(phase3.progress.done).toBe(0);
  });

  test('currentlyWorkingOn collects in-progress items', () => {
    const phases = parseRoadmap(SAMPLE_MD);
    const visible = phases
      .filter((p) => !SKIP_PHASES.has(p.num))
      .filter((p) => p.features.length > 0);

    const currentlyWorkingOn = [];
    for (const phase of visible) {
      const phaseTitle = PHASE_TITLES[phase.num] || `Phase ${phase.num}`;
      for (const feature of phase.features) {
        if (feature.status === 'in-progress') {
          currentlyWorkingOn.push({ name: feature.name, phase: phaseTitle });
        }
      }
    }

    expect(currentlyWorkingOn.length).toBe(2);
    expect(currentlyWorkingOn[0].name).toBe('Age-based segregation');
    expect(currentlyWorkingOn[1].name).toBe('iOS app');
  });
});
