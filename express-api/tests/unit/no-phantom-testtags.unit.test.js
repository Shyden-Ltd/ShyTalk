/**
 * A driver may not look for a testTag the product never renders.
 *
 * Operator 2026-08-01: "viewing a screen isn't enough, you need to test the
 * functionalities behave as expected" / "there's definitely gaps in the app
 * testing... you need to find and fill them".
 *
 * THE FAILURE MODE. `androidCreateRoomComposite` tapped `rooms_create` and then
 * `room_confirmCreate`. Neither string appears anywhere in `shared/src`. The
 * product renders `main_createRoomFab` and `createRoom_confirmButton`. So the
 * taps missed, the room was never created, and every room-creation scenario was
 * recorded as a PRODUCT defect — for years of runs, pointing at the app.
 *
 * This is the exact mirror of the phantom FIELD problem closed this morning:
 *   - a phantom field is WRITTEN and nothing reads it  → the scenario asserts
 *     nothing and passes.
 *   - a phantom tag is READ and nothing renders it     → the scenario fails and
 *     blames the product.
 * One manufactures false confidence, the other manufactures false defects.
 * Both come from the harness inventing a name and never checking.
 *
 * THE RULE IS DELIBERATELY WEAK, as with the field registry: a tag is fine if
 * it appears ANYWHERE in the product's rendered tags. That cannot false-positive
 * on a real tag, needs no curated list, and does not go stale as screens grow.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const DRIVERS = path.join(REPO, 'express-api/scripts/drivers');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(build|node_modules|\.git)$/.test(e.name)) continue;
      walk(p, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Every testTag / accessibility identifier the product actually renders. */
let cached = null;
function productTags() {
  if (cached) return cached;
  const tags = new Set();
  for (const f of walk(path.join(REPO, 'shared/src'), ['.kt'])) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/testTag\("([^"]+)"\)/g)) {
      // `roomList_roomCard_${room.roomId}` — the interpolation is per-instance;
      // the stable part is what a driver can match on.
      tags.add(m[1].replace(/\$\{[^}]*\}/g, '').replace(/\$\w+/g, ''));
    }
  }
  for (const f of walk(path.join(REPO, 'iosApp'), ['.swift'])) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/accessibilityIdentifier\s*=\s*"([^"]+)"/g))
      tags.add(m[1]);
  }
  cached = tags;
  return tags;
}

/**
 * Tags a driver TAPS or WAITS FOR by exact name.
 *
 * Only the call-by-name forms, never a regex fragment: extracting an identifier
 * out of `resource-id="(?:[^"]*:id\/)?roomList_roomCard_[^"]*"` produced
 * `roomCard_` in a first attempt at this check and reported a perfectly correct
 * tag as phantom. A guard that cries wolf gets deleted.
 */
function tagsUsedByName() {
  const found = new Map();
  const CALLS =
    /(?:androidTapByTag|iosTapByTag|webTapByTag|waitForTag|xcuiIdentifierPresent)\(\s*'([^']+)'/g;
  for (const f of walk(DRIVERS, ['.js'])) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALLS)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(path.basename(f));
    }
  }
  return found;
}

/** A driver tag is present if the product renders it, or a tag starting with it. */
function renderedByProduct(tag) {
  const tags = productTags();
  if (tags.has(tag)) return true;
  for (const p of tags) if (p.startsWith(tag) || tag.startsWith(p)) return true;
  return false;
}

/**
 * FROZEN 2026-08-01. May only SHRINK.
 *
 * Each is a tag a driver taps that the product does not render. Two different
 * causes, and they need different fixes — which is why they are listed rather
 * than silently allowed:
 *
 *   - the FEATURE is not instrumented: the screen exists but has no testTag, so
 *     the fix is to add one to the Compose source.
 *   - the FEATURE does not exist: the scenario is describing something unbuilt,
 *     and the honest fix is `@unimplemented` or deleting the step.
 *
 * Either way the current state is a scenario that fails and blames the product.
 */
const KNOWN_PHANTOM_TAGS = [
  'debug_forceRefreshJwt',
  'followedPicker',
  'debug_performAuthedCall',
  'gift_open',
  'gift_send',
  'idUpload_gallery',
  'participantsList_',
  'permission_allow_foreground_only_button',
  'pm_confirmEdit',
  'roomClosedSummary_',
  'rooms_refresh',
  'signin_signUpLink',
  'signup_dobPicker',
  'toast_',
  'wallet_retryPurchase',
];

describe('the scan is real', () => {
  it('reads a substantial product tag inventory', () => {
    // A vacuous scan would make every tag look phantom, or none.
    expect(productTags().size).toBeGreaterThan(100);
  });

  it('finds tags the drivers tap by name', () => {
    expect(tagsUsedByName().size).toBeGreaterThan(20);
  });

  it('recognises a real product tag as present', () => {
    expect(renderedByProduct('main_createRoomFab')).toBe(true);
    expect(renderedByProduct('createRoom_confirmButton')).toBe(true);
    expect(renderedByProduct('privateChat_messageInput')).toBe(true);
  });

  it('recognises an invented tag as absent', () => {
    // The four that were actually in the drivers until today.
    expect(renderedByProduct('rooms_create')).toBe(false);
    expect(renderedByProduct('room_confirmCreate')).toBe(false);
    expect(renderedByProduct('pm_sendButton')).toBe(false);
    expect(renderedByProduct('pm_messageInput')).toBe(false);
  });

  it('does not flag an interpolated tag as phantom', () => {
    // `roomList_roomCard_${room.roomId}` is rendered per room; a driver
    // matching the stable prefix is correct, and an earlier version of this
    // check called it phantom.
    expect(renderedByProduct('roomList_roomCard_')).toBe(true);
  });
});

describe('the phantom-tag debt may only shrink', () => {
  it('no NEW driver tag is absent from the product', () => {
    const offenders = [...tagsUsedByName().entries()]
      .filter(([tag]) => !renderedByProduct(tag))
      .filter(([tag]) => !KNOWN_PHANTOM_TAGS.includes(tag))
      .map(([tag, files]) => `${tag} (${[...files].join(', ')})`)
      .sort();
    // Named in the failure, with the fix: use the tag the product renders, or
    // add a testTag to the screen.
    expect({ tagsTheProductNeverRenders: offenders }).toEqual({ tagsTheProductNeverRenders: [] });
  });

  it('the frozen list contains nothing already fixed', () => {
    const used = tagsUsedByName();
    const stale = KNOWN_PHANTOM_TAGS.filter((t) => !used.has(t) || renderedByProduct(t));
    expect({ alreadyFixedButStillListed: stale }).toEqual({ alreadyFixedButStillListed: [] });
  });
});
