/**
 * SHY-0269 — every `secrets.X` referenced by CI must be a secret that
 * actually exists.
 *
 * Dev persona seeding was dead for ~18 days and nobody knew. The reusable
 * workflow `seed-dev-personas.yml` declared `PERSONAS_PASSWORD_DEV` as a
 * REQUIRED `workflow_call` secret; the repo secret had been renamed to
 * `DEV_QA_PERSONAS_PASSWORD` (SHY-0136) and every other workflow moved with
 * it. GitHub failed the call during secrets EVALUATION — before any step
 * exists — so the job produced zero steps and zero logs, and the reason
 * ("Secret PERSONAS_PASSWORD_DEV is required, but not provided while
 * calling") lived only in a check-run annotation nobody reads.
 *
 * The existing pin test could not catch it: it asserted the workflow
 * contained the literal string `PERSONAS_PASSWORD_DEV:`, which is exactly
 * the wrong name. A string-to-string pin has no ground truth — it pinned
 * the bug.
 *
 * `.github/known-secrets.yml` is that ground truth: the authoritative list
 * of secret names configured on the repository. Renaming a secret now has
 * to touch the inventory, and this test fails for any workflow left behind.
 *
 * Known limitation: the inventory is human-maintained (the Actions API
 * cannot be read from inside a workflow run). It cannot prove a listed
 * secret still exists — it proves the repo AGREES WITH ITSELF about the
 * name, which is the drift that actually bit.
 */

const { readFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const GITHUB_DIR = join(REPO_ROOT, '.github');
const INVENTORY_PATH = join(GITHUB_DIR, 'known-secrets.yml');

/** Recursively collect every .yml/.yaml under .github/workflows + .github/actions. */
function collectCiFiles() {
  const roots = [join(GITHUB_DIR, 'workflows'), join(GITHUB_DIR, 'actions')];
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(entry)) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
}

/**
 * Strip a YAML line comment without a backtracking regex. A `#` only opens
 * a comment at the start of a line or after whitespace, so `a#b` (a value)
 * survives while `a  # note` does not.
 */
function stripYamlComment(line) {
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  if (idx === 0) return '';
  return /\s/.test(line[idx - 1]) ? line.slice(0, idx) : line;
}

/**
 * Secret names referenced as `secrets.NAME` in the OPERATIONAL body of a CI
 * file. YAML comments are stripped first: prose like "resolve from the repo
 * secrets (secrets.X)" is documentation, not a reference, and counting it
 * makes the guard cry wolf on its own explanatory comments.
 */
function referencedSecrets(text) {
  const names = new Set();
  const re = /secrets\.([A-Z0-9_]+)/g;
  for (const rawLine of text.split('\n')) {
    const line = stripYamlComment(rawLine);
    let m;
    while ((m = re.exec(line)) !== null) names.add(m[1]);
  }
  return names;
}

/**
 * @param {'secrets'|'optional'} section
 * `secrets:` — names configured on the repository.
 * `optional:` — names a workflow may reference that are deliberately NOT
 *   configured, because the reference carries a documented `|| fallback`.
 *   Listing them separately keeps the strict check strict: an unlisted name
 *   is still a failure, but an intentional override is not misreported as
 *   drift.
 */
function inventoryNames(section = 'secrets') {
  const raw = readFileSync(INVENTORY_PATH, 'utf8');
  const start = raw.indexOf(`\n${section}:`);
  if (start === -1) return [];
  const rest = raw.slice(start + section.length + 2);
  const end = rest.search(/\n[a-z_]+:/);
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .map((line) => stripYamlComment(line).trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

describe('.github/known-secrets.yml — CI secret inventory', () => {
  test('the inventory file exists and lists at least the three known repo secrets', () => {
    const names = inventoryNames();
    expect(names).toEqual(expect.arrayContaining(['DEV_QA_PERSONAS_PASSWORD']));
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  test('the inventory has no duplicate entries', () => {
    const names = inventoryNames();
    expect(names).toHaveLength(new Set(names).size);
  });

  test('every secrets.X referenced by any workflow or action is in the inventory', () => {
    const inventory = new Set([...inventoryNames('secrets'), ...inventoryNames('optional')]);
    const offenders = [];

    for (const file of collectCiFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const name of referencedSecrets(text)) {
        // `secrets.GITHUB_TOKEN` is provided by Actions itself, and
        // `secrets.inherit` is syntax, not a secret name.
        if (name === 'GITHUB_TOKEN' || name === 'ACTIONS_RUNNER_DEBUG') continue;
        if (!inventory.has(name)) {
          offenders.push(`${file.replace(`${REPO_ROOT}/`, '')} → secrets.${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('every optional entry documents the fallback that makes its absence safe', () => {
    // An `optional:` entry without a stated fallback is just an unchecked
    // secret wearing a badge. The comment on its line has to say what
    // happens when it is absent.
    const raw = readFileSync(INVENTORY_PATH, 'utf8');
    for (const name of inventoryNames('optional')) {
      const line = raw.split('\n').find((l) => l.trim().startsWith(`- ${name}`)) || '';
      const context = raw.slice(
        Math.max(0, raw.indexOf(line) - 400),
        raw.indexOf(line) + line.length,
      );
      expect(context).toMatch(/fallback|falls back|\|\|/i);
    }
  });

  test('the extractor actually finds references (guard against a vacuous pass)', () => {
    const files = collectCiFiles();
    expect(files.length).toBeGreaterThan(5);
    const total = files.reduce((n, f) => n + referencedSecrets(readFileSync(f, 'utf8')).size, 0);
    expect(total).toBeGreaterThan(5);
  });
});
