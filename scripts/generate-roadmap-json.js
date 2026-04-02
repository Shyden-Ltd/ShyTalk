#!/usr/bin/env node
/**
 * Generate public/roadmap-data.json from the internal roadmap markdown.
 *
 * Parses .project/plans/2026-03-29-feature-roadmap.md and produces a
 * user-friendly JSON file with no internal details (PR numbers, file
 * paths, issue counts).
 *
 * Usage: node scripts/generate-roadmap-json.js
 * Called automatically by deploy workflows before deploying public/.
 */

const fs = require('node:fs');
const path = require('node:path');

const TRANSLATIONS_PATH = path.join(__dirname, 'roadmap-translations.json');
const translations = fs.existsSync(TRANSLATIONS_PATH)
  ? JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, 'utf-8'))
  : { phases: {}, features: {} };

const ROADMAP_PATH = path.join(
  __dirname,
  '..',
  '.project',
  'plans',
  '2026-03-29-feature-roadmap.md',
);
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'roadmap-data.json');

// Phase status mapping — determines the badge shown on the public page
const PHASE_STATUS = {
  0: 'active',
  1: 'active',
  2: 'soon',
  3: 'planned',
  4: 'planned',
  5: 'planned',
  6: 'planned',
  7: 'planned',
  8: 'planned',
};

// Phases to hide from the public (internal tooling)
const SKIP_PHASES = new Set([0]);

// Features to hide from public (internal tooling keywords)
const HIDE_KEYWORDS = [
  'SonarCloud',
  'Allure report',
  'OnPush CLI',
  'Legal docs:',
  'ktlint',
];

// User-friendly phase titles (override the markdown headings)
const PHASE_TITLES = {
  0: 'Infrastructure',
  1: 'Safety & Compliance',
  2: 'Platform & iOS',
  3: 'Revenue & Status',
  4: 'Social & Discovery',
  5: 'Quality of Life',
  6: 'Website & Presence',
  7: 'Entertainment',
  8: 'Support & Feedback',
};

function extractFeatureName(text) {
  const match = text.match(/\*\*(.+?)\*\*/);
  if (match) return match[1].split(' — ')[0].split(' -- ')[0].trim();
  return text.split(' — ')[0].split(' -- ')[0].trim();
}

function extractDescription(text) {
  const match = text.match(/\*\*.+?\*\*\s*[—–-]\s*(.+)/);
  if (!match) return '';
  let desc = match[1];
  // Strip internal references
  desc = desc.replace(/\s*See `[^`]+`\.?\s*/g, '');
  desc = desc.replace(/\s*PR\s*#\d+[^,|]*/g, '');
  desc = desc.replace(/\s*\d+\+?\s*issues[^,|]*/g, '');
  desc = desc.replace(/\s*must be clean[^,|]*/g, '');
  desc = desc.replace(/[.,\s]+$/, '');
  return desc.trim();
}

function parseStatus(status) {
  if (!status || !status.trim()) return 'planned';
  const s = status.trim().toUpperCase();
  if (s.startsWith('DONE')) return 'done';
  if (s.startsWith('IN PROGRESS')) return 'in-progress';
  if (s === 'NEXT') return 'next';
  return 'planned';
}

function shouldHide(name) {
  return HIDE_KEYWORDS.some((kw) => name.includes(kw));
}

function parseRoadmap(md) {
  const phases = [];
  let currentPhase = null;
  let inTable = false;

  for (const line of md.split('\n')) {
    const trimmed = line.trim();

    // Detect phase heading
    const phaseMatch = trimmed.match(/^## Phase (\d+)/);
    if (phaseMatch) {
      if (currentPhase) phases.push(currentPhase);
      const num = Number.parseInt(phaseMatch[1], 10);
      currentPhase = { num, features: [] };
      inTable = false;
      continue;
    }

    // Detect table header
    if (trimmed.match(/^\|\s*#\s*\|/) && currentPhase) {
      inTable = true;
      continue;
    }

    // Skip table separator
    if (trimmed.match(/^\|[-|]+\|$/) && inTable) continue;

    // Parse table row
    if (inTable && trimmed.startsWith('|') && currentPhase) {
      const cols = trimmed
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length >= 2) {
        const featureText = cols[1];
        const name = extractFeatureName(featureText);
        const desc = extractDescription(featureText);
        const status = cols.length >= 4 ? cols[3] : '';

        if (!shouldHide(name)) {
          currentPhase.features.push({
            name,
            description: desc,
            status: parseStatus(status),
          });
        }
      }
      continue;
    }

    // End of table
    if (inTable && !trimmed.startsWith('|')) inTable = false;

    // Stop at backlog
    if (trimmed.match(/^## Existing Backlog/)) break;
  }
  if (currentPhase) phases.push(currentPhase);

  return phases;
}

// Export for testing
module.exports = { parseRoadmap, SKIP_PHASES, PHASE_STATUS, PHASE_TITLES };

// ── Main ──

if (!fs.existsSync(ROADMAP_PATH)) {
  console.log(`Roadmap source not found at ${ROADMAP_PATH} — skipping generation`);
  if (require.main === module) process.exit(0);
} else {
const md = fs.readFileSync(ROADMAP_PATH, 'utf-8');
const parsed = parseRoadmap(md);

const output = {
  lastUpdated: new Date().toISOString().split('T')[0],
  phases: parsed
    .filter((p) => !SKIP_PHASES.has(p.num))
    .filter((p) => p.features.length > 0)
    .map((p) => {
      const phaseTitle = PHASE_TITLES[p.num] || `Phase ${p.num}`;
      return {
        title: phaseTitle,
        titleI18n: translations.phases[phaseTitle] || {},
        status: PHASE_STATUS[p.num] || 'planned',
        features: p.features.map((f) => {
          const ft = translations.features[f.name] || {};
          return { ...f, i18n: ft };
        }),
      };
    }),
};

const newJson = JSON.stringify(output, null, 2) + '\n';

// Skip write if nothing changed (compare features, ignore lastUpdated)
if (fs.existsSync(OUTPUT_PATH)) {
  const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
  const existingWithoutDate = { ...existing, lastUpdated: '' };
  const newWithoutDate = { ...output, lastUpdated: '' };
  if (JSON.stringify(existingWithoutDate) === JSON.stringify(newWithoutDate)) {
    console.log('Roadmap unchanged — skipping write');
    if (require.main === module) process.exit(0);
  }
}

fs.writeFileSync(OUTPUT_PATH, newJson);
console.log(
  `Generated ${OUTPUT_PATH} — ${output.phases.length} phases, ${output.phases.reduce((sum, p) => sum + p.features.length, 0)} features`,
);

} // end else (ROADMAP_PATH exists)
