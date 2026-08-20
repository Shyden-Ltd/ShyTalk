/**
 * Guard for SHY-0384 — the age-restriction message must not offer a control
 * that does nothing, nor tell anyone to use one.
 *
 * The sub-eighteen dialog offered a "Contact support" button whose only effect
 * was closing the dialog: both call sites passed the dismiss action, and the
 * button itself ran `onDismiss(); onContactSupport()`. So the confirm button was
 * behaviourally identical to Cancel, on a screen whose body text told the person
 * to contact support.
 *
 * These are SOURCE guards because the defect lives in how a call site wires a
 * lambda and in what a translated string says — neither of which a unit test of
 * either side alone can see.
 *
 * SHY-0385 restores both the control and the sentence, pointing at a real
 * support form. When it does, these guards must be REPLACED, not deleted: the
 * rule is "nothing inert and nothing that instructs the impossible", which still
 * holds once the form exists.
 *
 * Locale scope is the 5 MVP locales (en, zh, id, vi, th). The other `values-*`
 * directories on disk are the retired set, not the work list — SHY-0194 owns
 * that sweep.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RES_ROOT = path.join(REPO_ROOT, 'shared', 'src', 'commonMain', 'composeResources');
const DIALOG = path.join(
  REPO_ROOT,
  'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/ageverification/AgeRestrictionDialog.kt',
);

/** en lives in the unsuffixed `values` directory. */
const MVP_LOCALES = [
  { id: 'en', dir: 'values' },
  { id: 'zh', dir: 'values-zh' },
  { id: 'id', dir: 'values-id' },
  { id: 'vi', dir: 'values-vi' },
  { id: 'th', dir: 'values-th' },
];

const BODY_KEY = 'age_restriction_sub_eighteen_body';

/**
 * How "contact support" reads in each MVP locale. Asserting on the RENDERED
 * text, not the key — a key can be present and say anything.
 */
const CONTACT_SUPPORT_PHRASES = {
  en: ['contact support'],
  zh: ['联系支持'],
  id: ['hubungi dukungan'],
  vi: ['liên hệ hỗ trợ'],
  th: ['ติดต่อฝ่ายสนับสนุน'],
};

function bodyFor(locale) {
  const file = path.join(RES_ROOT, locale.dir, 'strings.xml');
  const xml = fs.readFileSync(file, 'utf-8');
  const m = new RegExp(`<string name="${BODY_KEY}">([\\s\\S]*?)</string>`).exec(xml);
  return m ? m[1] : null;
}

describe('SHY-0384 — the age message does not tell anyone to contact support', () => {
  test('the body string exists in every MVP locale, so these guards are not vacuous', () => {
    for (const locale of MVP_LOCALES) {
      const body = bodyFor(locale);
      expect(`${locale.id}: ${body === null ? 'MISSING' : 'present'}`).toBe(
        `${locale.id}: present`,
      );
      expect(body.length).toBeGreaterThan(40);
    }
  });

  test('no MVP locale instructs contacting support', () => {
    const offenders = [];
    for (const locale of MVP_LOCALES) {
      const body = (bodyFor(locale) || '').toLowerCase();
      for (const phrase of CONTACT_SUPPORT_PHRASES[locale.id]) {
        if (body.includes(phrase.toLowerCase())) offenders.push(`${locale.id}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the phrase list is real — it still matches text that DOES say it', () => {
    // Without this, a typo in CONTACT_SUPPORT_PHRASES would make the guard above
    // pass forever while the copy still said "contact support".
    const samples = {
      en: 'please contact support about this',
      zh: '请联系支持以获取帮助',
      id: 'harap hubungi dukungan kami',
      vi: 'vui lòng liên hệ hỗ trợ ngay',
      th: 'โปรดติดต่อฝ่ายสนับสนุน',
    };
    for (const locale of MVP_LOCALES) {
      const matched = CONTACT_SUPPORT_PHRASES[locale.id].some((p) =>
        samples[locale.id].toLowerCase().includes(p.toLowerCase()),
      );
      expect(`${locale.id}: ${matched}`).toBe(`${locale.id}: true`);
    }
  });
});

/**
 * True when the source has a LIVE reference, ignoring comments. A comment that
 * explains why the wiring was removed must not fail the guard that checks it
 * was removed — otherwise the guard forbids documenting itself.
 */
function hasLiveReference(src) {
  return src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .some((l) => l.includes('onContactSupport'));
}

describe('SHY-0384 — the age dialog offers no inert control', () => {
  const source = fs.readFileSync(DIALOG, 'utf-8');

  test('the dialog still has a sub-eighteen branch, so these guards are not vacuous', () => {
    expect(source).toContain('SubEighteen');
    expect(source).toContain('age_restriction_sub_eighteen_body');
  });

  test('no contact-support wiring remains anywhere in the app', () => {
    const roots = [path.join(REPO_ROOT, 'shared', 'src'), path.join(REPO_ROOT, 'app', 'src')];
    const hits = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'build' || e.name === '.gradle') continue;
          walk(p);
        } else if (e.name.endsWith('.kt') && hasLiveReference(fs.readFileSync(p, 'utf-8'))) {
          hits.push(path.relative(REPO_ROOT, p));
        }
      }
    };
    for (const r of roots) walk(r);
    expect(hits).toEqual([]);
  });

  test('the comment filter still catches a live reference', () => {
    // Guards the guard: if hasLiveReference stopped matching, the check above
    // would pass forever no matter what the source said.
    expect(hasLiveReference('  onContactSupport = { foo() },')).toBe(true);
    expect(hasLiveReference('  // onContactSupport used to be here')).toBe(false);
  });

  test('the sub-eighteen dialog offers exactly one action, and it closes', () => {
    // Material3's AlertDialog REQUIRES a confirmButton, so the rule cannot be
    // "no button" -- it is "no INERT button". One action, wired to onDismiss,
    // is the honest shape: nothing to confirm, nothing to cancel.
    const start = source.indexOf('AgeRestrictionDialogState.SubEighteen ->');
    expect(start).toBeGreaterThan(-1);
    const branch = source.slice(start);

    const buttons = branch.match(/\b(confirmButton|dismissButton)\s*=/g) || [];
    expect(buttons).toEqual(['confirmButton =']);

    // The single action must actually close the dialog, not call a lambda the
    // caller can fill with a no-op -- which is precisely how this broke.
    const onClicks = branch.match(/onClick = [^,\n]+/g) || [];
    expect(onClicks).toEqual(['onClick = onDismiss']);
  });
});
