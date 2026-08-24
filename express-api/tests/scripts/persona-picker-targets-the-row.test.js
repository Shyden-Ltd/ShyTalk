'use strict';

/**
 * The persona picker is driven by ROW, not by the email text inside it.
 *
 * Found on the real iPhone, 2026-08-24. Every journey needing Greta (P-12,
 * admin) failed identically — J-ADMIN, J04, J12 — while eight others passed.
 * What is special about P-12 is that reaching it requires SCROLLING; the
 * personas that passed sit above the fold.
 *
 * Two defects, and the second is why the first survived:
 *
 * 1. `selectPersonaByText` located the EMAIL LABEL and tapped its centre. A
 *    label inside a row is not necessarily hit-testable on iOS, so the tap fell
 *    through to the list and nothing was selected. The row carries a testTag —
 *    `persona_row_P-12` — and tapping THAT goes through the element API, which
 *    also gets SHY-0441's reachability check for free.
 *
 * 2. The step then "verified" the selection with
 *    `!byId(nodes, 'persona_picker_open')`. That tag belongs to the BUTTON on
 *    the SignIn screen that opens the picker — not to the picker — and iOS
 *    never surfaces it. The check was therefore VACUOUSLY TRUE on iOS: the step
 *    could not fail, and reported a pass for a tap that did nothing.
 *
 * The picker's own list is `persona_picker_list`, which both platforms do
 * surface, and its absence is what "the picker closed" actually means.
 */

const { personaRowTag, pickerIsOpen } = require('../../scripts/device-journey-runner');

describe('personaRowTag', () => {
  test('maps an email to the row the app tags', () => {
    expect(personaRowTag('admin@shytalk.dev')).toBe('persona_row_P-12');
  });

  test('maps the personas that were already passing, so nothing regresses', () => {
    expect(personaRowTag('adult-power@shytalk.dev')).toBe('persona_row_P-02');
    expect(personaRowTag('minor-power@shytalk.dev')).toBe('persona_row_P-04');
  });

  test('an unknown email throws rather than returning undefined', () => {
    // A tap on `persona_row_undefined` finds nothing and scrolls forever; the
    // failure would name the scroll, not the cause.
    expect(() => personaRowTag('nobody@shytalk.dev')).toThrow(/no seeded persona/i);
  });

  test('every seeded persona has a row tag', () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const missing = personas.filter((p) => !personaRowTag(p.email));
    expect(missing).toEqual([]);
  });
});

describe('pickerIsOpen', () => {
  const node = (id) => ({ id, center: { x: 1, y: 1 } });

  test('the picker is open when its LIST is on screen', () => {
    expect(pickerIsOpen([node('persona_picker_list'), node('persona_row_P-12')])).toBe(true);
  });

  test('the picker is closed when its list is gone', () => {
    expect(pickerIsOpen([node('main_roomsTab')])).toBe(false);
  });

  test('the button that OPENS the picker does not mean the picker is open', () => {
    // The exact confusion that made this check vacuous. Sitting on SignIn with
    // the button visible is the picker being CLOSED.
    expect(pickerIsOpen([node('persona_picker_open')])).toBe(false);
  });

  test('an empty screen is not an open picker', () => {
    expect(pickerIsOpen([])).toBe(false);
  });
});

describe('centreIsInside — a row must be inside its list, not merely in the tree', () => {
  const { centreIsInside } = require('../../scripts/device-journey-runner');

  // The real measurement from the iPhone, 2026-08-24.
  const list = { bounds: { x1: 74, y1: 258, x2: 346, y2: 658 } };
  const rowInside = { bounds: { x1: 74, y1: 300, x2: 346, y2: 353 }, center: { x: 210, y: 326 } };
  const rowBelow = { bounds: { x1: 74, y1: 735, x2: 346, y2: 788 }, center: { x: 210, y: 762 } };

  test('a row within the viewport is tappable', () => {
    expect(centreIsInside(list, rowInside)).toBe(true);
  });

  test('the admin row, 77pt below the list, is NOT', () => {
    // Tapping this lands on the sheet's dismiss scrim: the picker closes,
    // nothing is selected, and it reads as a failed sign-in.
    expect(centreIsInside(list, rowBelow)).toBe(false);
  });

  test('a row composed above the viewport is not tappable either', () => {
    const rowAbove = { bounds: { x1: 74, y1: 150, x2: 346, y2: 203 }, center: { x: 210, y: 176 } };
    expect(centreIsInside(list, rowAbove)).toBe(false);
  });

  test('a row exactly on the boundary counts as inside', () => {
    const onEdge = { bounds: { x1: 74, y1: 600, x2: 346, y2: 658 }, center: { x: 210, y: 658 } };
    expect(centreIsInside(list, onEdge)).toBe(true);
  });

  test('no list means no claim — false rather than a crash', () => {
    // The picker not being on screen must not read as "go ahead and tap".
    expect(centreIsInside(null, rowInside)).toBe(false);
    expect(centreIsInside({ bounds: null }, rowInside)).toBe(false);
  });

  test('a row with no centre is not tappable', () => {
    expect(centreIsInside(list, { bounds: list.bounds, center: null })).toBe(false);
    expect(centreIsInside(list, null)).toBe(false);
  });
});
