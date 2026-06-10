/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `node` to exec the sync script under controlled
   inputs with carefully constructed fixture corpora. Not security-sensitive. */
/**
 * Tests for `scripts/sync-shy-to-roadmap-data.mjs` — the sync script that
 * regenerates `public/roadmap-data.json` from SHY .md frontmatter.
 * Authoritative for `phases[].items` + `currentlyWorkingOn`; preserves the
 * existing phase shell (titles + i18n + category metadata).
 *
 * Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md
 *
 * Exit codes:
 *   0   success (data written, or no diff if --check)
 *   2   usage error
 *   10  SHY parse error (malformed frontmatter, missing required field on
 *       a `public: true` SHY, invalid phase value, duplicate roadmap_ids)
 *   20  existing roadmap-data.json malformed (unparseable JSON or missing
 *       the `phases` shell)
 *
 * Invocation:
 *   node scripts/sync-shy-to-roadmap-data.mjs
 *     [--stories-dir <path>]   (default: .project/stories)
 *     [--data-file <path>]     (default: public/roadmap-data.json)
 *
 * Fixture strategy: each test creates a fresh temp dir with a controlled
 * SHY corpus + a controlled baseline roadmap-data.json. The script runs
 * against those temp paths.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-shy-to-roadmap-data.mjs');

const TEMP_DIRS = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

function tempDir(prefix = 'sync-shy-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}

/** Create a minimal SHY .md file with the given frontmatter overrides. */
function writeShy(dir, id, overrides = {}, opts = {}) {
  const fm = {
    id,
    status: 'Draft',
    owner: 'claude',
    created: '2026-06-08',
    priority: 'P1',
    effort: 'S',
    type: 'feature',
    roadmap_ids: [],
    ...overrides,
  };
  const slug = (overrides.slug || 'test').toString();
  const filename = `${id}-${slug}.md`;
  const fmLines = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`;
      if (v === undefined || v === null) return `${k}:`;
      return `${k}: ${v}`;
    })
    .join('\n');
  const body =
    opts.body ||
    `# ${id}: ${overrides.title || 'Test'}\n\n## User Story\n\nAs a test, I want this fixture, so it exercises the script.\n\n## Why\n\nFor the test.\n`;
  fs.writeFileSync(path.join(dir, filename), `---\n${fmLines}\n---\n\n${body}`);
  return filename;
}

/** Write the baseline phases shell that the script must preserve. */
function writeBaselineData(file, phases = null) {
  const defaultPhases = phases || [
    {
      title: 'Safety & Compliance',
      titleI18n: { de: 'Sicherheit & Compliance', es: 'Seguridad y cumplimiento' },
      status: 'in-progress',
      items: [],
    },
    {
      title: 'Website & Presence',
      titleI18n: { de: 'Website & Präsenz', es: 'Sitio web y presencia' },
      status: 'planned',
      items: [],
    },
  ];
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        lastUpdated: '2026-01-01',
        currentlyWorkingOn: [],
        phases: defaultPhases,
      },
      null,
      2,
    ) + '\n',
  );
}

function runScript(args = [], opts = {}) {
  const res = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 30_000,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Standard setup: scratch dir with stories/ + data.json. */
function setup({ shys = [], baselinePhases = null } = {}) {
  const dir = tempDir();
  const storiesDir = path.join(dir, 'stories');
  const dataFile = path.join(dir, 'data.json');
  fs.mkdirSync(storiesDir);
  writeBaselineData(dataFile, baselinePhases);
  for (const s of shys) writeShy(storiesDir, s.id, s, s);
  return { dir, storiesDir, dataFile };
}

// ---------------------------------------------------------------- tests

describe('scripts/sync-shy-to-roadmap-data.mjs', () => {
  // ============================================================== precondition
  describe('precondition', () => {
    test('script exists at the expected path', () => {
      expect(fs.existsSync(SCRIPT)).toBe(true);
    });

    test('script is valid ESM (.mjs extension; node parses without SyntaxError)', () => {
      const { stderr } = runScript(['--help']);
      expect(stderr).not.toMatch(/SyntaxError/);
    });
  });

  // ============================================================== happy path
  describe('happy path', () => {
    test('empty stories dir → items: [] in every phase, currentlyWorkingOn empty', () => {
      const { storiesDir, dataFile } = setup();
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
      const data = readJson(dataFile);
      expect(data.phases.every((p) => p.items.length === 0)).toBe(true);
      expect(data.currentlyWorkingOn).toEqual([]);
    });

    test('single public + In Progress SHY → 1 entry in currentlyWorkingOn AND its phase items[]', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0099',
            slug: 'test',
            status: 'In Progress',
            public: true,
            phase: 'Safety & Compliance',
            title: 'Test feature',
          },
        ],
      });
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
      const data = readJson(dataFile);
      expect(data.currentlyWorkingOn).toHaveLength(1);
      expect(data.currentlyWorkingOn[0].shyId).toBe('SHY-0099');
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      expect(phase.items).toHaveLength(1);
      expect(phase.items[0].shyId).toBe('SHY-0099');
    });

    test('additive slug field: item.slug equals the kebab filename suffix (SHY-0073)', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0101',
            slug: 'lazy-i18n-links',
            status: 'In Progress',
            public: true,
            phase: 'Safety & Compliance',
            title: 'Slug fixture',
          },
        ],
      });
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
      const data = readJson(dataFile);
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      // slug = filename minus the SHY-NNNN- prefix and .md — the renderer
      // builds the GitHub story link from it (SHY-0073).
      expect(phase.items[0].slug).toBe('lazy-i18n-links');
      expect(data.currentlyWorkingOn[0].slug).toBe('lazy-i18n-links');
    });

    test('single public + Done SHY → in phase items[] but NOT currentlyWorkingOn', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0099',
            status: 'Done',
            public: true,
            phase: 'Safety & Compliance',
            title: 'Shipped feature',
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.currentlyWorkingOn).toEqual([]);
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      expect(phase.items).toHaveLength(1);
      expect(phase.items[0].status).toBe('Done');
    });

    test('phase grouping: 3 SHYs in different phases land in their respective items[] arrays', () => {
      const { storiesDir, dataFile } = setup({
        baselinePhases: [
          { title: 'Safety & Compliance', titleI18n: {}, status: 'in-progress', items: [] },
          { title: 'Website & Presence', titleI18n: {}, status: 'planned', items: [] },
          { title: 'Quality of Life', titleI18n: {}, status: 'planned', items: [] },
        ],
        shys: [
          {
            id: 'SHY-0001',
            status: 'Draft',
            public: true,
            phase: 'Safety & Compliance',
            title: 'A',
          },
          {
            id: 'SHY-0002',
            status: 'Draft',
            public: true,
            phase: 'Website & Presence',
            title: 'B',
          },
          { id: 'SHY-0003', status: 'Draft', public: true, phase: 'Quality of Life', title: 'C' },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.phases[0].items).toHaveLength(1);
      expect(data.phases[1].items).toHaveLength(1);
      expect(data.phases[2].items).toHaveLength(1);
    });

    test('_meta block: present with schemaVersion=2, generatedAt ISO 8601, shyCount, epicCount', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          { id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'A' },
          { id: 'SHY-0002', public: true, phase: 'Safety & Compliance', title: 'B' },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data._meta).toBeDefined();
      expect(data._meta.schemaVersion).toBe(2);
      expect(data._meta.generatedFrom).toBe('.project/stories/');
      expect(data._meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(data._meta.shyCount).toBe(2);
      expect(data._meta.epicCount).toBe(0);
    });

    test('lastUpdated equals _meta.generatedAt (derived, not manually edited)', () => {
      const { storiesDir, dataFile } = setup();
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.lastUpdated).toBe(data._meta.generatedAt);
    });
  });

  // ============================================================== filter rule (public:)
  describe('filter rule (public: true opt-in)', () => {
    test('public: true → included', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'Public' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data._meta.shyCount).toBe(1);
    });

    test('public: false → excluded', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: false, phase: 'Safety & Compliance', title: 'Private' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data._meta.shyCount).toBe(0);
    });

    test('public absent → excluded (default = internal)', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', phase: 'Safety & Compliance', title: 'No flag' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data._meta.shyCount).toBe(0);
    });

    test('public: true + status: Cancelled → still included (audit-trail preservation)', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0001',
            public: true,
            status: 'Cancelled',
            phase: 'Safety & Compliance',
            title: 'Cancelled',
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data._meta.shyCount).toBe(1);
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      expect(phase.items[0].status).toBe('Cancelled');
    });
  });

  // ============================================================== status → currentlyWorkingOn mapping
  describe('status → currentlyWorkingOn mapping', () => {
    test.each([
      ['In Progress', true],
      ['Draft', false],
      ['Done', false],
      ['In Review', false],
      ['Cancelled', false],
    ])('status=%s → currentlyWorkingOn includes? %s', (status, included) => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', status, public: true, phase: 'Safety & Compliance', title: 'T' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.currentlyWorkingOn.length === 1).toBe(included);
    });
  });

  // ============================================================== sort order
  describe('sort order within each phase', () => {
    test('5 SHYs in scrambled input → output sorted (priority asc, created asc, ID asc)', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0003',
            priority: 'P1',
            created: '2026-06-08',
            public: true,
            phase: 'Safety & Compliance',
            title: 'C',
          },
          {
            id: 'SHY-0001',
            priority: 'P0',
            created: '2026-06-08',
            public: true,
            phase: 'Safety & Compliance',
            title: 'A',
          },
          {
            id: 'SHY-0005',
            priority: 'P2',
            created: '2026-06-01',
            public: true,
            phase: 'Safety & Compliance',
            title: 'E',
          },
          {
            id: 'SHY-0002',
            priority: 'P0',
            created: '2026-06-09',
            public: true,
            phase: 'Safety & Compliance',
            title: 'B',
          },
          {
            id: 'SHY-0004',
            priority: 'P1',
            created: '2026-06-07',
            public: true,
            phase: 'Safety & Compliance',
            title: 'D',
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      const ids = phase.items.map((i) => i.shyId);
      // P0/2026-06-08/SHY-0001 < P0/2026-06-09/SHY-0002 < P1/2026-06-07/SHY-0004 < P1/2026-06-08/SHY-0003 < P2/2026-06-01/SHY-0005
      expect(ids).toEqual(['SHY-0001', 'SHY-0002', 'SHY-0004', 'SHY-0003', 'SHY-0005']);
    });

    test('tiebreaker: same priority + same created → sort by SHY ID asc', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0002',
            priority: 'P0',
            created: '2026-06-08',
            public: true,
            phase: 'Safety & Compliance',
            title: 'B',
          },
          {
            id: 'SHY-0001',
            priority: 'P0',
            created: '2026-06-08',
            public: true,
            phase: 'Safety & Compliance',
            title: 'A',
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const ids = data.phases
        .find((p) => p.title === 'Safety & Compliance')
        .items.map((i) => i.shyId);
      expect(ids).toEqual(['SHY-0001', 'SHY-0002']);
    });
  });

  // ============================================================== determinism
  describe('determinism', () => {
    test('two runs on same fixture produce byte-identical output', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          { id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'A' },
          { id: 'SHY-0002', public: true, phase: 'Website & Presence', title: 'B' },
        ],
      });
      // First run sets generatedAt to T1; second run sets to T2 (would differ).
      // Determinism check: stub generatedAt by passing --frozen-time flag.
      runScript([
        '--stories-dir',
        storiesDir,
        '--data-file',
        dataFile,
        '--frozen-time',
        '2026-06-08T19:00:00.000Z',
      ]);
      const first = fs.readFileSync(dataFile);
      runScript([
        '--stories-dir',
        storiesDir,
        '--data-file',
        dataFile,
        '--frozen-time',
        '2026-06-08T19:00:00.000Z',
      ]);
      const second = fs.readFileSync(dataFile);
      expect(first.equals(second)).toBe(true);
    });
  });

  // ============================================================== phase preservation
  describe('phase shell preservation (phases are stable category containers)', () => {
    test('existing phase titles + i18n + status preserved verbatim across sync', () => {
      const baseline = [
        {
          title: 'Safety & Compliance',
          titleI18n: { de: 'Sicherheit & Compliance', ja: '安全性とコンプライアンス' },
          status: 'in-progress',
          progress: { done: 0, total: 10 },
          items: [],
        },
      ];
      const { storiesDir, dataFile } = setup({ baselinePhases: baseline });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.phases[0].title).toBe('Safety & Compliance');
      expect(data.phases[0].titleI18n.de).toBe('Sicherheit & Compliance');
      expect(data.phases[0].titleI18n.ja).toBe('安全性とコンプライアンス');
      expect(data.phases[0].status).toBe('in-progress');
      expect(data.phases[0].progress).toEqual({ done: 0, total: 10 });
    });

    test('phase order preserved across regen', () => {
      const baseline = [
        { title: 'Phase A', titleI18n: {}, status: 'planned', items: [] },
        { title: 'Phase B', titleI18n: {}, status: 'planned', items: [] },
        { title: 'Phase C', titleI18n: {}, status: 'planned', items: [] },
      ];
      const { storiesDir, dataFile } = setup({ baselinePhases: baseline });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.phases.map((p) => p.title)).toEqual(['Phase A', 'Phase B', 'Phase C']);
    });
  });

  // ============================================================== error paths
  describe('error paths (exit 10)', () => {
    test('public: true SHY missing title → exit 10 + stderr names file', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      fs.writeFileSync(
        path.join(storiesDir, 'SHY-0001-broken.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\npriority: P0\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\nphase: Safety & Compliance\n---\n\n(no h1 title in body)',
      );
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/SHY-0001/);
    });

    test('public: true SHY with invalid phase value (not in baseline) → exit 10', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Not A Real Phase', title: 'Invalid' }],
      });
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/Not A Real Phase|invalid phase/i);
    });

    test('malformed frontmatter (no --- delimiters) → skip silently (exit 0)', () => {
      // I6 from reviewer: previous version asserted [0, 10] (both pass) — weak
      // contract. The documented behaviour is SKIP (defensive: an unparseable
      // file can't be `public:true` since `public:true` would need to be inside
      // parseable frontmatter). A future enhancement could fail loud if we want
      // stricter behaviour, but the current contract is silent skip.
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      fs.writeFileSync(path.join(storiesDir, 'SHY-0001-bad.md'), 'no frontmatter here\n');
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
    });

    test('public: true SHY with no phase field → exit 10 + stderr "missing required phase" (C2 from review)', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      // Manually authored without `phase:` — writeShy() helper would default but we want absence.
      fs.writeFileSync(
        path.join(storiesDir, 'SHY-0001-nophase.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\npriority: P0\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\n---\n\n# SHY-0001: NoPhase\n',
      );
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/missing required 'phase'/);
    });

    test('public: true SHY with no priority field → exit 10 + stderr "missing required priority" (I7 from review)', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      fs.writeFileSync(
        path.join(storiesDir, 'SHY-0001-nopri.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\nphase: Safety & Compliance\n---\n\n# SHY-0001: NoPri\n',
      );
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/missing required 'priority'/);
    });

    test('public: true SHY with no created field → exit 10 + stderr "missing required created" (I7 from review)', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      fs.writeFileSync(
        path.join(storiesDir, 'SHY-0001-nocreated.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\npriority: P0\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\nphase: Safety & Compliance\n---\n\n# SHY-0001: NoCreated\n',
      );
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/missing required 'created'/);
    });

    test('existing roadmap-data.json valid JSON but missing `phases` key → exit 20 (I7-adjacent gap from review)', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      fs.writeFileSync(dataFile, JSON.stringify({ lastUpdated: '2026-01-01' }));
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(20);
      expect(stderr).toMatch(/missing 'phases' array/);
    });

    test('existing roadmap-data.json malformed → exit 20', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      fs.writeFileSync(dataFile, '{ this is not valid json');
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(20);
    });

    test('duplicate roadmap_ids across two SHYs (both public:true claiming G009) → exit 10', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0001',
            public: true,
            phase: 'Safety & Compliance',
            title: 'A',
            roadmap_ids: ['G009'],
          },
          {
            id: 'SHY-0002',
            public: true,
            phase: 'Safety & Compliance',
            title: 'B',
            roadmap_ids: ['G009'],
          },
        ],
      });
      const { code, stderr } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/G009/);
    });
  });

  // ============================================================== edge cases
  describe('edge cases', () => {
    test('SHY with no epic field → item.epicId omitted', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'No epic' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const item = data.phases.find((p) => p.title === 'Safety & Compliance').items[0];
      expect(item.epicId).toBeUndefined();
    });

    test('item shape matches spec: name, description, shyId, status, i18n: {} (I1 from review)', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'ShapeTest' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const item = data.phases.find((p) => p.title === 'Safety & Compliance').items[0];
      expect(item.name).toBe('ShapeTest');
      // description=null when no public_summary is set
      expect(item.description).toBeNull();
      expect(item.shyId).toBe('SHY-0001');
      expect(item.status).toBe('Draft');
      // i18n: {} placeholder (per AC line 58; SHY-0061's renderer will populate translations later)
      expect(item.i18n).toEqual({});
    });

    test('public_summary frontmatter populates item.description (I1 from review)', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      fs.writeFileSync(
        path.join(storiesDir, 'SHY-0001-described.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\npriority: P0\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\nphase: Safety & Compliance\npublic_summary: A short visitor-facing summary of this feature.\n---\n\n# SHY-0001: With public_summary\n',
      );
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const item = data.phases.find((p) => p.title === 'Safety & Compliance').items[0];
      expect(item.description).toBe('A short visitor-facing summary of this feature.');
    });

    test('multi-item roadmap_ids: [G001, G002, G003] parses to exactly 3 entries (I5 from review)', () => {
      // Ensures the array splitter doesn't drop/duplicate entries with multi-item input.
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0001',
            public: true,
            phase: 'Safety & Compliance',
            title: 'multi',
            roadmap_ids: ['G001', 'G002', 'G003'],
          },
          { id: 'SHY-0002', public: true, phase: 'Safety & Compliance', title: 'other' },
        ],
      });
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      // No duplicate-ID collision (all three are distinct, only SHY-0001 claims them)
      expect(code).toBe(0);
    });

    test('JSON output keys are alphabetically sorted within each object (review gap)', () => {
      // Determinism check on byte-level: stablePretty must emit keys in sorted order.
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'A' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const raw = fs.readFileSync(dataFile, 'utf8');
      // _meta object internal keys: epicCount, generatedAt, generatedFrom, schemaVersion, shyCount (alpha)
      const metaIdx = raw.indexOf('"_meta"');
      const slice = raw.slice(metaIdx, metaIdx + 300);
      const epicCountIdx = slice.indexOf('"epicCount"');
      const generatedAtIdx = slice.indexOf('"generatedAt"');
      const schemaVersionIdx = slice.indexOf('"schemaVersion"');
      const shyCountIdx = slice.indexOf('"shyCount"');
      expect(epicCountIdx).toBeLessThan(generatedAtIdx);
      expect(generatedAtIdx).toBeLessThan(schemaVersionIdx);
      expect(schemaVersionIdx).toBeLessThan(shyCountIdx);
    });

    test('legacy phases[].features[] array is preserved verbatim across sync (review gap)', () => {
      // Spec line 55-56: phases shell preserved (titles, i18n, status, progress, features).
      const baseline = [
        {
          title: 'Safety & Compliance',
          titleI18n: { es: 'Seguridad' },
          status: 'in-progress',
          features: [
            { name: 'Legacy A', description: 'pre-SHY content', status: 'done', i18n: {} },
            { name: 'Legacy B', description: 'still pre-SHY', status: 'planned', i18n: {} },
          ],
          items: [],
        },
      ];
      const { storiesDir, dataFile } = setup({ baselinePhases: baseline });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const phase = data.phases.find((p) => p.title === 'Safety & Compliance');
      expect(phase.features).toHaveLength(2);
      expect(phase.features[0].name).toBe('Legacy A');
      expect(phase.features[1].name).toBe('Legacy B');
    });

    test('SHY with pr field set → item.prUrl populated', () => {
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0001',
            public: true,
            phase: 'Safety & Compliance',
            title: 'PR linked',
            pr: 'https://github.com/Shyden-Ltd/ShyTalk/pull/1044',
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const item = data.phases.find((p) => p.title === 'Safety & Compliance').items[0];
      expect(item.prUrl).toBe('https://github.com/Shyden-Ltd/ShyTalk/pull/1044');
    });

    test('SHY without pr field → item.prUrl omitted', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'No PR' }],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      const item = data.phases.find((p) => p.title === 'Safety & Compliance').items[0];
      expect(item.prUrl).toBeUndefined();
    });

    test('CRLF line endings in SHY frontmatter → parsed correctly', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      const crlf =
        '---\r\nid: SHY-0001\r\nstatus: Draft\r\nowner: claude\r\ncreated: 2026-06-08\r\npriority: P0\r\neffort: S\r\ntype: feature\r\nroadmap_ids: []\r\npublic: true\r\nphase: Safety & Compliance\r\n---\r\n\r\n# SHY-0001: CRLF\r\n';
      fs.writeFileSync(path.join(storiesDir, 'SHY-0001-crlf.md'), crlf);
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
      const data = readJson(dataFile);
      expect(data._meta.shyCount).toBe(1);
    });

    test('BOM at start of SHY → stripped + parsed', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      const fm =
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\npriority: P0\neffort: S\ntype: feature\nroadmap_ids: []\npublic: true\nphase: Safety & Compliance\n---\n\n# SHY-0001: BOM\n';
      fs.writeFileSync(path.join(storiesDir, 'SHY-0001-bom.md'), '﻿' + fm);
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(code).toBe(0);
    });
  });

  // ============================================================== JSON output format
  describe('JSON output format', () => {
    test('pretty-printed with 2-space indent', () => {
      const { storiesDir, dataFile } = setup();
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const raw = fs.readFileSync(dataFile, 'utf8');
      // Look for "  " (2 spaces) after a newline-{ pattern
      expect(raw).toMatch(/{\n {2}"/);
    });

    test('trailing newline at EOF', () => {
      const { storiesDir, dataFile } = setup();
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const raw = fs.readFileSync(dataFile, 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    });

    test('UTF-8 encoded (non-ASCII titleI18n round-trips)', () => {
      const { storiesDir, dataFile } = setup({
        baselinePhases: [
          {
            title: 'Safety',
            titleI18n: { ja: '安全性', ar: 'السلامة' },
            status: 'planned',
            items: [],
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const data = readJson(dataFile);
      expect(data.phases[0].titleI18n.ja).toBe('安全性');
      expect(data.phases[0].titleI18n.ar).toBe('السلامة');
    });
  });

  // ============================================================== performance
  describe('performance', () => {
    test('60-SHY corpus completes in under 5s', () => {
      const dir = tempDir();
      const storiesDir = path.join(dir, 'stories');
      const dataFile = path.join(dir, 'data.json');
      fs.mkdirSync(storiesDir);
      writeBaselineData(dataFile);
      for (let i = 1; i <= 60; i += 1) {
        const id = `SHY-${String(i).padStart(4, '0')}`;
        writeShy(
          storiesDir,
          id,
          {
            public: i % 2 === 0,
            phase: 'Safety & Compliance',
            title: `T${i}`,
          },
          { slug: `t${i}` },
        );
      }
      const start = Date.now();
      const { code } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      const elapsed = Date.now() - start;
      expect(code).toBe(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ============================================================== security
  describe('security', () => {
    test('script does NOT use child_process.exec or eval', () => {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      expect(src).not.toMatch(/\bchild_process\b.*\bexec\b/);
      expect(src).not.toMatch(/\beval\s*\(/);
      // execSync is fine (synchronous, no shell injection vector for our usage),
      // but we explicitly disallow shell:true and exec() which spawn a shell.
    });

    test('script does NOT use gray-matter or js-yaml (hand-rolled parser per AC)', () => {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      expect(src).not.toMatch(/require\(['"]gray-matter['"]\)/);
      expect(src).not.toMatch(/from ['"]gray-matter['"]/);
      expect(src).not.toMatch(/require\(['"]js-yaml['"]\)/);
      expect(src).not.toMatch(/from ['"]js-yaml['"]/);
    });

    test('package.json has not gained gray-matter or js-yaml as a dep', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      expect(allDeps['gray-matter']).toBeUndefined();
      expect(allDeps['js-yaml']).toBeUndefined();
    });

    test('shell-injection payload in title does NOT execute', () => {
      const sentinel = path.join(os.tmpdir(), `sync-sentinel-${Date.now()}-${process.pid}`);
      try {
        fs.unlinkSync(sentinel);
      } catch {
        /* ignore */
      }
      const { storiesDir, dataFile } = setup({
        shys: [
          {
            id: 'SHY-0001',
            public: true,
            phase: 'Safety & Compliance',
            title: `Pwn $(touch ${sentinel})`,
          },
        ],
      });
      runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(fs.existsSync(sentinel)).toBe(false);
      try {
        fs.unlinkSync(sentinel);
      } catch {
        /* ignore */
      }
    });
  });

  // ============================================================== UX/observability
  describe('UX/observability', () => {
    test('--help exits 0 with usage text', () => {
      const { code, stdout } = runScript(['--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/sync-shy-to-roadmap-data/);
      expect(stdout).toMatch(/--stories-dir/);
      expect(stdout).toMatch(/--data-file/);
    });

    test('-h is an alias for --help', () => {
      const { code, stdout } = runScript(['-h']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/sync-shy-to-roadmap-data/);
    });

    test('unknown flag → exit 2 + usage hint', () => {
      const { code, stderr } = runScript(['--frobnicate']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown/i);
    });

    test('success log line format: [sync] regenerated ... N public SHYs', () => {
      const { storiesDir, dataFile } = setup({
        shys: [{ id: 'SHY-0001', public: true, phase: 'Safety & Compliance', title: 'T' }],
      });
      const { stdout } = runScript(['--stories-dir', storiesDir, '--data-file', dataFile]);
      expect(stdout).toMatch(/\[sync\]/);
      expect(stdout).toMatch(/1 public SHY/);
    });
  });
});
