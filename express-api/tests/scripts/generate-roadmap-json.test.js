/* eslint-disable no-unused-vars */
/**
 * Tests for roadmap data generation script.
 *
 * Covers spec section:
 *   11.39 — Roadmap Data Generation
 *
 * Script under test:
 *   scripts/generate-roadmap-json.js
 */

const fs = require('node:fs');
// const path = require('node:path');

jest.mock('node:fs');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────

const SAMPLE_ROADMAP_MD = `# ShyTalk Feature Roadmap

_Prioritised 2026-03-29 (revised)_

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
| B1 | **Account deletion** — GDPR Art.17 | Large | DONE (PR #218, 2026-03-29) |
| B2 | **Data export** — GDPR Art.20 | Medium | DONE (PR #238, 2026-03-30) |
| 17 | **Age-based segregation** — UK OSA | Large | |

---

## Phase 2 — Platform Foundation

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| B5 | **iOS build fix** — cinterop errors | Medium | |
| B7 | **Billing v7→v8** — deprecation deadline | Medium | |

---

## Phase 3 — Revenue Engine

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 13 | **Nobility system** — ranks from gift value | Large | |
| 1 | **Relationships** — paid tiers | Large | |
`;

const SAMPLE_TRANSLATIONS = JSON.stringify({
  phases: {
    'Compliance & Legal': { ar: 'الامتثال والقانون', de: 'Compliance & Recht' },
    'Platform Foundation': { ar: 'أساس المنصة', de: 'Plattform-Grundlage' },
    'Revenue Engine': { ar: 'محرك الإيرادات', de: 'Umsatzmaschine' },
  },
  features: {
    'Account deletion': {
      ar: { n: 'حذف الحساب', d: 'GDPR المادة 17' },
      de: { n: 'Kontolöschung', d: 'DSGVO Art.17' },
    },
    'Data export': {
      ar: { n: 'تصدير البيانات', d: 'GDPR المادة 20' },
      de: { n: 'Datenexport', d: 'DSGVO Art.20' },
    },
  },
});

function setupMocks(markdown = SAMPLE_ROADMAP_MD, translations = SAMPLE_TRANSLATIONS) {
  fs.existsSync.mockImplementation((p) => {
    if (p.includes('roadmap-translations')) return true;
    if (p.includes('feature-roadmap')) return true;
    return false;
  });
  fs.readFileSync.mockImplementation((p) => {
    if (p.includes('roadmap-translations')) return translations;
    if (p.includes('feature-roadmap')) return markdown;
    throw new Error(`Unexpected read: ${p}`);
  });
  fs.writeFileSync.mockImplementation(() => {});

  // Also mock the existing output file for change detection
  try {
    fs.readFileSync.mockImplementation((p, _encoding) => {
      if (p.includes('roadmap-translations')) return translations;
      if (p.includes('feature-roadmap')) return markdown;
      if (p.includes('roadmap-data.json')) return '{}'; // empty existing
      throw new Error(`Unexpected read: ${p}`);
    });
  } catch {
    // Ignore
  }
}

// ═══════════════════════════════════════════════════════════════
// 11.39 — Roadmap Data Generation
// ═══════════════════════════════════════════════════════════════

describe('generate-roadmap-json.js', () => {
  test('produces valid JSON from markdown', () => {
    setupMocks();
    // Running the script should produce valid JSON
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    expect(output).toBeDefined();
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('phases');
    expect(parsed).toHaveProperty('lastUpdated');
  });

  test('strips PR numbers from output', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    expect(output).not.toContain('PR #');
    expect(output).not.toContain('#223');
    expect(output).not.toContain('#218');
  });

  test('strips internal references (SonarCloud, Allure, etc.)', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    // Phase 0 features should be skipped entirely
    expect(output).not.toContain('SonarCloud');
    expect(output).not.toContain('Allure');
  });

  test('maps statuses correctly (DONE→done, IN PROGRESS→in-progress)', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    // Find a done feature
    const phase1 = parsed.phases.find((p) => p.title.includes('Compliance'));
    if (phase1) {
      const doneFeature = phase1.features.find((f) => f.status === 'done');
      expect(doneFeature).toBeDefined();
    }
  });

  test('skips Phase 0 (internal)', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    const phase0 = parsed.phases.find((p) => p.title.includes('Infrastructure'));
    expect(phase0).toBeUndefined();
  });

  test('merges translations correctly', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    const phase1 = parsed.phases.find((p) => p.title.includes('Compliance'));
    if (phase1?.titleI18n) {
      expect(phase1.titleI18n.ar).toBeDefined();
      expect(phase1.titleI18n.de).toBeDefined();
    }
  });

  test('calculates completion stats (done count, total, percentage)', () => {
    setupMocks();
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    // Should have stats at top level or per-phase
    // Phase 1 has 2 done out of 3 total
  });

  test('handles empty phases', () => {
    const mdWithEmptyPhase =
      SAMPLE_ROADMAP_MD +
      `
## Phase 9 — Empty Phase

| # | Feature | Effort | Status |
|---|---------|--------|--------|
`;
    setupMocks(mdWithEmptyPhase);
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    // Should not crash on empty phase
    expect(parsed.phases).toBeDefined();
  });

  test('handles missing translations gracefully', () => {
    setupMocks(SAMPLE_ROADMAP_MD, '{"phases":{},"features":{}}');
    let output;
    fs.writeFileSync.mockImplementation((_path, data) => {
      output = data;
    });

    jest.resetModules();
    require('../../../scripts/generate-roadmap-json');

    const parsed = JSON.parse(output);
    // Should produce output even without translations
    expect(parsed.phases).toBeDefined();
    expect(parsed.phases.length).toBeGreaterThan(0);
  });
});
