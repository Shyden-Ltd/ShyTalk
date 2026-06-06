#!/usr/bin/env node
/**
 * Generate gh-pages/index.html (the Allure test-report landing) from a
 * registry JSON.
 *
 * Pre-2026-05-03 the landing was a hand-maintained 233-line static HTML
 * file. Adding a new test suite (e.g. iOS E2E in commit 256921b329)
 * required a separate PR to edit the static markup, and the static
 * cards drifted from reality (badge counts and dates were never
 * refreshed). The registry-driven approach makes new-suite onboarding
 * a single-entry append to `scripts/allure-suites.json`.
 *
 * Usage: node scripts/generate-allure-landing.js
 *
 * Dynamic per-run badge data (test pass/fail counts, dates) is NOT
 * rendered here — that's a follow-up that would parse each suite's
 * Allure summary at workflow time. This generator only handles the
 * static "list of suites" structure that drifts on every new
 * platform.
 */

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, 'allure-suites.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'gh-pages', 'index.html');

const REQUIRED_SUITE_FIELDS = ['slug', 'displayName', 'icon', 'description'];

/**
 * HTML-escape so a typo in the registry (e.g. an `&` in a description)
 * doesn't break parsing or open an injection vector. Limited to the
 * five entity-substituted characters required by HTML5 — surrogate-pair
 * emoji in `icon` pass through untouched.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSuiteCard(suite) {
  for (const field of REQUIRED_SUITE_FIELDS) {
    if (!suite[field]) {
      throw new Error(
        `Suite registry entry is missing required field '${field}': ${JSON.stringify(suite)}`,
      );
    }
  }
  // The slug is interpolated into URL paths and is not user-facing
  // text, but it still gets escaped defensively in case a future
  // registry edit introduces a special character that could break
  // URL parsing.
  const slug = escapeHtml(suite.slug);
  const displayName = escapeHtml(suite.displayName);
  // Icons are emoji from a fixed registry; HTML-escaping is harmless
  // pass-through for valid emoji.
  const icon = escapeHtml(suite.icon);
  const description = escapeHtml(suite.description);
  return `    <div class="card">
      <div class="card-icon">${icon}</div>
      <h3>${displayName}</h3>
      <p class="card-desc">${description}</p>
      <div class="card-envs">
        <div class="env-row">
          <span class="env-label">PR Checks</span>
          <span class="badge no-data">No data yet</span>
          <a href="${slug}/pr/latest/" class="btn">View</a>
          <a href="${slug}/pr/runs/" class="btn btn-sm">History</a>
        </div>
        <div class="env-row">
          <span class="env-label">Deploy</span>
          <span class="badge no-data">No data yet</span>
          <a href="${slug}/deploy/latest/" class="btn">View</a>
          <a href="${slug}/deploy/runs/" class="btn btn-sm">History</a>
        </div>
      </div>
    </div>`;
}

function renderLanding(registry) {
  if (!registry || !Array.isArray(registry.suites)) {
    throw new Error(
      'Registry must have a `suites` array. Got: ' + JSON.stringify(registry),
    );
  }
  const cards = registry.suites.map(renderSuiteCard).join('\n\n');
  // CSS, hero copy, and the "How to read these reports" disclosure are
  // baked into the template here — they describe the landing's
  // overall purpose and don't change per-suite. If a future redesign
  // overhauls the styling, edit it here once.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShyTalk Test Reports</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121218;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .hero { text-align: center; padding: 3rem 1rem 2rem; }
    .hero h1 { color: #8b7fff; font-size: 2rem; margin-bottom: 0.5rem; }
    .hero p { color: #999; max-width: 600px; margin: 0 auto; line-height: 1.6; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem 2rem;
    }
    .card {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 1.5rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 24px rgba(139, 127, 255, 0.15);
    }
    .card-icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .card h3 { color: #fff; margin-bottom: 0.25rem; }
    .card-desc { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
    .card-envs { display: flex; flex-direction: column; gap: 0.75rem; }
    .env-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .env-label { font-size: 0.8rem; color: #aaa; min-width: 70px; }
    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;
      color: #fff; font-weight: 600;
    }
    .badge.no-data { background: #555; }
    .meta-date { font-size: 0.7rem; color: #666; }
    .btn {
      padding: 4px 12px; border-radius: 6px; font-size: 0.75rem;
      background: #8b7fff; color: #fff; text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #7a6ef0; }
    .btn-sm { background: #2a2a3e; }
    .btn-sm:hover { background: #3a3a5e; }
    .guide { max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; }
    .guide details { background: #1a1a2e; border-radius: 12px; padding: 1rem 1.5rem; }
    .guide summary { cursor: pointer; color: #8b7fff; font-weight: 600; font-size: 1.1rem; }
    .guide-content { margin-top: 1rem; line-height: 1.7; color: #bbb; }
    .guide-content h4 { color: #e0e0e0; margin: 1rem 0 0.5rem; }
    .guide-content ul { padding-left: 1.5rem; }
    .guide-content li { margin-bottom: 0.3rem; }
    footer { text-align: center; padding: 2rem 1rem; color: #555; font-size: 0.8rem; }
    footer a { color: #8b7fff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>ShyTalk Test Reports</h1>
    <p>We run thousands of automated tests across every platform to ensure ShyTalk is reliable, secure, and bug-free. Browse our latest test results below.</p>
  </div>

  <div class="cards">

${cards}
  </div>

  <div class="guide">
    <details>
      <summary>How to read these reports</summary>
      <div class="guide-content">
        <h4>What Allure reports show</h4>
        <p>Each report contains detailed test cases with steps, attachments (screenshots, traces), and trend graphs showing test stability over time.</p>
        <h4>What "No data yet" means</h4>
        <p>The suite hasn't published a report for that environment yet. Once a workflow run completes and uploads its Allure results, the badge updates with the latest pass/fail count and date.</p>
        <h4>PR Checks vs Deploy</h4>
        <ul>
          <li><strong>PR Checks</strong> — runs on every pull request to verify the change doesn't break tests.</li>
          <li><strong>Deploy</strong> — runs on the deployed dev/prod build to verify production-equivalent behaviour.</li>
        </ul>
      </div>
    </details>
  </div>

  <footer>
    <p>Generated by <a href="https://github.com/Shyden-Ltd/ShyTalk">ShyTalk</a> CI • Reports powered by <a href="https://allurereport.org/">Allure</a></p>
  </footer>
</body>
</html>`;
}

function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const html = renderLanding(registry);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  console.log(`Generated ${OUTPUT_PATH} from ${registry.suites.length} suite(s)`);
}

if (require.main === module) {
  main();
}

module.exports = { renderLanding, renderSuiteCard, escapeHtml };
