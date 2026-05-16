#!/usr/bin/env node
/**
 * Generate a CSV of journey-test persona accounts for operator reference.
 *
 * Pairs with `provision-test-personas.js` — same persona registry, same
 * shared password. The CSV is for human reference (sign-in shortcuts,
 * journey debugging) and is never committed.
 *
 * Output goes to ~/.shytalk/dev-personas.csv with mode 0600. The output
 * path lives under the operator's home dir and outside the repo tree
 * so it can't accidentally be committed.
 *
 * Usage:
 *   export PERSONAS_PASSWORD=$(cat ~/.shytalk/dev-personas.env | cut -d= -f2)
 *   node scripts/personas-csv-export.js
 *
 * The password is read from the env var and never written to disk
 * except inside the CSV at the designated path (which is chmod 600).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { personas } = require('./provision-test-personas');

const pw = process.env.PERSONAS_PASSWORD;
if (!pw || pw.length < 20) {
  console.error('MISSING_ENV — set PERSONAS_PASSWORD (>=20 chars) before running.');
  process.exit(2);
}

const columns = [
  'persona_id',
  'uniqueId',
  'email',
  'password',
  'displayName',
  'userType',
  'cohort',
  'dateOfBirth',
  'locale',
  'ageVerified',
  'isAdmin',
  'shyCoins',
  'beans',
  'gcs',
  'follows',
  'notes',
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const lines = [columns.join(',')];

const notesById = {
  'P-01': 'EPHEMERAL — created fresh in j01 signup flow, not provisioned',
  'P-03': 'EPHEMERAL — created fresh in j02 signup flow, not provisioned',
  'P-06': 'Hayato — starts adult, admin flips to minor in j04 (force-refresh JWT required)',
  'P-19': 'SHYTALK_OFFICIAL bot — cohort-exempt, unblockable',
};

const ephemeral = [
  {
    id: 'P-01',
    uniqueId: '(allocated at signup)',
    email: '(ephemeral; pattern: adam-new-{ts}@shytalk.dev)',
    displayName: 'Adam (new adult)',
    userType: 'MEMBER',
    cohort: 'minor->adult (post age verification)',
    dob: '2004-01-01',
    locale: 'en',
    ageVerified: false,
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    follows: [],
  },
  {
    id: 'P-03',
    uniqueId: '(allocated at signup)',
    email: '(ephemeral; pattern: mia-new-{ts}@shytalk.dev)',
    displayName: 'Mia (new minor)',
    userType: 'MEMBER',
    cohort: 'minor',
    dob: '2010-08-20',
    locale: 'en',
    ageVerified: false,
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    follows: [],
  },
];

function renderRow(p, isEphemeral = false) {
  return [
    p.id,
    p.uniqueId,
    p.email,
    isEphemeral ? '(signup flow; password set during scenario)' : pw,
    p.displayName,
    p.userType,
    p.cohort,
    p.dob,
    p.locale,
    p.ageVerified,
    p.isAdmin ? 'true' : '',
    p.wallet?.shyCoins ?? '',
    p.wallet?.beans ?? '',
    p.wallet?.gcs ?? '',
    (p.follows || []).join(';'),
    notesById[p.id] || '',
  ]
    .map(csvEscape)
    .join(',');
}

lines.push(renderRow(ephemeral[0], true));
lines.push(renderRow(personas.find((p) => p.id === 'P-02')));
lines.push(renderRow(ephemeral[1], true));
for (const p of personas) {
  if (p.id === 'P-02') continue;
  lines.push(renderRow(p));
}

const outDir = path.join(os.homedir(), '.shytalk');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'dev-personas.csv');
fs.writeFileSync(outFile, lines.join('\n') + '\n', { mode: 0o600 });
fs.chmodSync(outFile, 0o600);

console.log('WROTE ' + outFile + ' (' + lines.length + ' lines, mode 0600)');
