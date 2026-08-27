/**
 * Guard: "Contact support" must never be a control that does nothing.
 *
 * History, because the rule outlived two changes to the code:
 *
 *   SHY-0380 built the ticket queue.
 *   SHY-0384 REMOVED the button, because every call site passed the dismiss
 *     action, making the confirm button behaviourally identical to Cancel while
 *     the body text told people to use it.
 *   SHY-0385 RESTORED it, wired to the in-app support form.
 *   SHY-0387 turned that form into a PAGE, so a call site now NAVIGATES rather
 *     than showing a dialog.
 *
 * The rule was never "no button" and is not "there is a button". It is
 * **nothing inert**, which held true through both changes — so this file was
 * rewritten rather than deleted when the button came back.
 *
 * These are source guards because the defect lives in how a call site wires a
 * lambda, which no unit test of either side alone can see.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const KOTLIN_ROOTS = [path.join(REPO_ROOT, 'shared', 'src'), path.join(REPO_ROOT, 'app', 'src')];
const DIALOG = path.join(
  REPO_ROOT,
  'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/ageverification/AgeRestrictionDialog.kt',
);

function kotlinFiles() {
  const out = [];
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
      } else if (e.name.endsWith('.kt')) {
        out.push(p);
      }
    }
  };
  for (const r of KOTLIN_ROOTS) walk(r);
  return out;
}

/** Lines that are not comments — a comment must never satisfy or fail a guard. */
function codeLines(src) {
  return src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
}

/**
 * Every `onContactSupport = { … }` LAMBDA ASSIGNMENT, with its brace-matched body.
 *
 * Deliberately narrow. A first version matched any mention and produced two false
 * positives inside the dialog's own file: the comment explaining the wiring, and
 * `onClick = onContactSupport`, which is a USE of the parameter rather than a
 * call site supplying it. Comments are stripped, and the `=` must immediately
 * follow the identifier.
 */
function contactSupportCallSites() {
  const sites = [];
  for (const file of kotlinFiles()) {
    const src = codeLines(fs.readFileSync(file, 'utf-8')).join('\n');
    const assignment = /onContactSupport\s*=\s*\{/g;
    let m;
    while ((m = assignment.exec(src)) !== null) {
      const idx = m.index;
      const open = src.indexOf('{', idx);
      {
        let depth = 0;
        let end = open;
        for (; end < src.length; end++) {
          if (src[end] === '{') depth++;
          else if (src[end] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        sites.push({
          file: path.relative(REPO_ROOT, file),
          line: src.slice(0, idx).split('\n').length,
          body: src.slice(open + 1, end).trim(),
          src,
        });
      }
    }
  }
  return sites;
}

describe('contact support is never an inert control', () => {
  const sites = contactSupportCallSites();

  test('the scan finds call sites, so these guards cannot pass vacuously', () => {
    // A room and a private chat, at minimum. If this drops to zero the guards
    // below all pass while proving nothing.
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  test('a parameter USE is not mistaken for a call site', () => {
    // `onClick = onContactSupport` passes the lambda along; it does not supply
    // one. Counting it produced a false failure the first time this ran.
    const dialogSites = sites.filter((s) => s.file.endsWith('AgeRestrictionDialog.kt'));
    expect(dialogSites).toEqual([]);
  });

  test('no call site merely dismisses a dialog', () => {
    // The exact defect SHY-0384 removed: confirm wired to the dismiss action.
    const dismissOnly = sites.filter((s) => /^[\w.]*dismiss\w*\(\s*\)$/i.test(s.body));
    expect(dismissOnly.map((s) => `${s.file}:${s.line} -> { ${s.body} }`)).toEqual([]);
  });

  test('every call site leads to support', () => {
    // SHY-0387 moved the form from a DIALOG to a PAGE, so a call site no longer
    // shows `SupportFormDialog` — it navigates. The rule is unchanged and the
    // assertion follows the mechanism, which is the third time this file has
    // been rewritten rather than deleted: the rule is "nothing inert", not
    // "there is a dialog".
    const notReachingSupport = sites.filter(
      (s) => !/onNavigateToSupport|SupportSource\./.test(s.body),
    );

    expect(notReachingSupport.map((s) => `${s.file}:${s.line} -> { ${s.body} }`)).toEqual([]);
  });

  test('support never routes to a mailbox — there is not one', () => {
    // Operator, 2026-08-20: there is no support mailbox. A screen that opens a
    // mail composer is the same dead end as a button that does nothing.
    const offenders = sites.filter((s) => s.body.includes('openEmail'));
    expect(offenders.map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });
});

describe('the sub-eighteen dialog acts, rather than pretending to', () => {
  const source = fs.readFileSync(DIALOG, 'utf-8');
  const code = codeLines(source).join('\n');

  test('the dialog still has a sub-eighteen branch, so these guards are not vacuous', () => {
    expect(source).toContain('SubEighteen');
    expect(source).toContain('age_restriction_sub_eighteen_body');
  });

  test('its confirm action is not the dismiss action', () => {
    const start = code.indexOf('AgeRestrictionDialogState.SubEighteen ->');
    expect(start).toBeGreaterThan(-1);
    const branch = code.slice(start);
    const confirm = /confirmButton = \{[\s\S]*?onClick = ([^,\n]+)/.exec(branch);
    expect(confirm).not.toBeNull();
    expect(confirm[1].trim()).not.toBe('onDismiss');
  });

  test('the comment filter still catches a live reference', () => {
    // Guards the guard: without this, a broken filter would make the check above
    // read a comment and pass forever. SHY-0384's first version failed on the
    // very comment that documented it.
    expect(codeLines('  onClick = onDismiss,').length).toBe(1);
    expect(codeLines('  // onClick = onDismiss,').length).toBe(0);
  });
});
