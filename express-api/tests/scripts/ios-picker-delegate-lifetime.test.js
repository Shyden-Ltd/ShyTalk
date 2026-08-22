/**
 * An iOS picker delegate must be held by something the GC treats as a ROOT.
 *
 * `PHPickerViewController.delegate` is a WEAK property — the picker does not
 * keep its delegate alive. Both pickers tried to solve that from inside the
 * delegate:
 *
 *     private var selfRef: PickerDelegate? = this   // "prevent GC before callback"
 *
 * That is a self-referential CYCLE with no external root. Kotlin/Native's GC is
 * a tracing collector, so an unreachable cycle is exactly what it reclaims — the
 * comment describes an intention the code cannot deliver.
 *
 * Collected between presenting the picker and the person choosing a file,
 * `delegate` reads nil and `picker(_:didFinishPicking:)` never fires. Observed
 * on a real iPhone on 2026-08-22: the sheet stayed open, nothing was added, no
 * upload was attempted, and each retry stacked another picker until the app had
 * to be force-quit. It depends on GC timing, which is why it looked like
 * flakiness rather than a feature that does not work.
 *
 * `IosImagePicker` (avatars) is on `develop`, so this shipped.
 *
 * A Kotlin `object` IS a root, so the delegate is now held in a property on the
 * enclosing object for as long as the picker is on screen.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const PICKERS = [
  'shared/src/iosMain/kotlin/com/shyden/shytalk/util/IosMediaPicker.kt',
  'shared/src/iosMain/kotlin/com/shyden/shytalk/util/IosImagePicker.kt',
];

/** Code only — the KDoc deliberately quotes the broken pattern to explain it. */
const codeOf = (rel) =>
  fs
    .readFileSync(path.join(repoRoot, rel), 'utf8')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

describe.each(PICKERS)('%s', (file) => {
  const code = codeOf(file);

  test('does not try to keep itself alive with a self-reference', () => {
    // `= this` on a property of the same class is the shape that fails.
    const selfRefs = code
      .split('\n')
      .filter((l) => /private\s+var\s+\w+\s*:\s*\w*Delegate\?\s*=\s*this/.test(l));
    expect({ file, selfRefs }).toEqual({ file, selfRefs: [] });
  });

  test('holds the delegate on the enclosing object, which is a GC root', () => {
    expect(code).toMatch(/private\s+var\s+activeDelegate\s*:\s*\w*Delegate\?\s*=\s*null/);
    // Assigned BEFORE the picker is presented, or the window between the two is
    // the window the collector runs in.
    expect(code).toMatch(
      /activeDelegate\s*=\s*delegate[\s\S]{0,80}picker\.delegate\s*=\s*delegate/,
    );
  });

  test('releases it once the callback has finished', () => {
    // Otherwise one delegate per pick is retained for the life of the process.
    expect(code).toMatch(/activeDelegate\s*=\s*null/);
  });
});
