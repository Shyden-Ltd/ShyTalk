/**
 * The shared app methods — the layer that lets the corpus say "on the app".
 *
 * Every method is exercised through BOTH grammars against dumps in each
 * platform's real shape, because a method that only works on one platform is
 * exactly the defect this layer exists to remove.
 *
 * The dumps here are hand-built from the shape of the real captured fixtures
 * (`android-dump-picker.xml`, `ios-dump-signin.xml`) — captured DATA describing
 * screens the product renders, not a mocked collaborator. The device I/O is
 * supplied as plain functions so the assertions can be driven without a phone;
 * the grammar those assertions run against is proven against real device output
 * in `ui-grammar.unit.test.js`.
 */
const {
  ANDROID_GRAMMAR,
  IOS_GRAMMAR,
  createDumpQueries,
} = require('../../../scripts/drivers/ui-grammar');
const {
  createSharedAppMethods,
  SHARED_METHOD_NAMES,
} = require('../../../scripts/drivers/app-ui-methods');

/** Build an Android `<node>` with the given attributes. */
const anode = ({ tag = '', text = '', desc = '', enabled = true, bounds = '[0,0][100,100]' }) =>
  `<node index="0" text="${text}" resource-id="${tag ? `com.shyden.shytalk.local:id/${tag}` : ''}" class="android.view.View" content-desc="${desc}" enabled="${enabled}" bounds="${bounds}" hint="" />`;

/** Build an XCUITest element with the given attributes. */
const inode = ({
  type = 'Other',
  tag = '',
  label = '',
  value = '',
  enabled = true,
  x = 0,
  y = 0,
  width = 100,
  height = 100,
}) =>
  `<XCUIElementType${type} type="XCUIElementType${type}" name="${tag}" label="${label}" value="${value}" enabled="${enabled}" visible="true" x="${x}" y="${y}" width="${width}" height="${height}" index="0" traits="" >`;

/**
 * A driver pair over the same logical screen, described once per platform.
 *
 * `calls` records what the methods actually did, so an action test can assert
 * the RIGHT tag was tapped rather than merely that something returned true.
 */
function pair({ androidDump = '', iosDump = '', tapSucceedsFor = () => true, siblings = {} } = {}) {
  const make = (platform, grammar, dumpText) => {
    const calls = { taps: [], longPresses: [], typed: [], relaunched: 0, network: [] };
    const methods = createSharedAppMethods({
      platform,
      queries: createDumpQueries(grammar),
      uiDump: async () => dumpText,
      tapByTag: async (tag) => {
        calls.taps.push(tag);
        return tapSucceedsFor(tag);
      },
      tapAt: async (x, y) => {
        calls.taps.push(`@${x},${y}`);
        return true;
      },
      longPressAt: async (x, y, ms) => {
        calls.longPresses.push({ x, y, ms });
        return true;
      },
      typeText: async (t) => {
        calls.typed.push(t);
        return true;
      },
      relaunchApp: async () => {
        calls.relaunched += 1;
        return true;
      },
      dropNetwork: async (s) => {
        calls.network.push(s);
        return true;
      },
      sibling: (name) => siblings[name],
    });
    return { methods, calls };
  };
  return {
    android: make('android', ANDROID_GRAMMAR, androidDump),
    ios: make('ios', IOS_GRAMMAR, iosDump),
  };
}

/** Assert both platforms answer the same for the same logical screen. */
async function bothAnswer(p, method, args, expected) {
  await expect(p.android.methods[method](...args)).resolves.toEqual(expected);
  await expect(p.ios.methods[method](...args)).resolves.toEqual(expected);
}

describe('screen identification', () => {
  const inRoom = pair({
    androidDump: anode({ tag: 'room_seatGrid' }),
    iosDump: inode({ tag: 'room_seatGrid' }),
  });
  const notInRoom = pair({
    androidDump: anode({ tag: 'main_roomsTab' }),
    iosDump: inode({ tag: 'main_roomsTab' }),
  });

  test('a room is recognised from ANY of its anchors, on both phones', async () => {
    // Several anchors, because a partial render draws the toolbar before the
    // grid and a single-anchor check would call that "not in the room".
    for (const anchor of ['room_seatGrid', 'room_roomName', 'room_backButton']) {
      const p = pair({ androidDump: anode({ tag: anchor }), iosDump: inode({ tag: anchor }) });
      await bothAnswer(p, 'IsStillInRoom', ['Selma'], true);
    }
  });

  test('a screen that is not the room answers false, not true', async () => {
    await bothAnswer(notInRoom, 'IsStillInRoom', ['Selma'], false);
    await bothAnswer(notInRoom, 'IsNoLongerInVoiceRoom', ['Selma'], true);
  });

  test('a BLANK screen is not proof of having left the room', async () => {
    // The trap: `!inRoom` on an empty dump answers true, so a scenario asserting
    // someone was removed from a room passes against a screen that never
    // rendered.
    const blank = pair({ androidDump: '', iosDump: '' });
    await bothAnswer(blank, 'IsNoLongerInVoiceRoom', ['Selma'], false);
    await bothAnswer(blank, 'IsStillInRoom', ['Selma'], false);
  });

  test('a warning overlaid on the room is NOT "continuing normally"', async () => {
    // Both markers present. Checking only the room would call this normal, which
    // is the opposite of what the user is experiencing.
    const p = pair({
      androidDump: anode({ tag: 'room_seatGrid' }) + anode({ tag: 'warning_title' }),
      iosDump: inode({ tag: 'room_seatGrid' }) + inode({ tag: 'warning_title' }),
    });
    await bothAnswer(p, 'ContinuesNormallyInRoom', ['Selma'], false);
    await bothAnswer(inRoom, 'ContinuesNormallyInRoom', ['Selma'], true);
  });

  test('the warning REASON is checked, not just the warning screen', async () => {
    const right = pair({
      androidDump: anode({ tag: 'warning_title', text: 'Harassment' }),
      iosDump: inode({ tag: 'warning_title', label: 'Harassment' }),
    });
    await bothAnswer(right, 'ShowsWarningScreenWithReason', ['Selma', 'Harassment'], true);
    // A warning screen showing the WRONG reason is a real defect, and a
    // screen-only check would pass it.
    await bothAnswer(right, 'ShowsWarningScreenWithReason', ['Selma', 'Spam'], false);
  });

  test('a route is resolved from the corpus name, and an unknown one refuses', async () => {
    const p = pair({
      androidDump: anode({ tag: 'main_roomsTab' }),
      iosDump: inode({ tag: 'main_roomsTab' }),
    });
    await bothAnswer(p, 'ShowsRoute', ['the rooms list'], true);
    await bothAnswer(p, 'ShowsRoute', ['rooms'], true);
    // "I do not know how to check this" must never read as "checked, passed".
    await bothAnswer(p, 'ShowsRoute', ['the tarot screen'], false);
  });

  test('a deep-link path resolves through its longest matching prefix', async () => {
    const p = pair({
      androidDump: anode({ tag: 'profile_displayName' }),
      iosDump: inode({ tag: 'profile_displayName' }),
    });
    await bothAnswer(p, 'NavigatesToPath', ['Alice', '/profile/50000010'], true);
    // `/` is exact-only: as a prefix it would match every path and every
    // destination would look like the rooms list.
    await bothAnswer(p, 'NavigatesToPath', ['Alice', '/'], false);
  });
});

describe('arguments are checked, not ignored', () => {
  test('a user card is for THAT user', async () => {
    const p = pair({
      androidDump: anode({ tag: 'userCard_50000010' }),
      iosDump: inode({ tag: 'userCard_50000010' }),
    });
    await bothAnswer(p, 'ShowsUserCard', ['Selma', '50000010'], true);
    // The defect this replaces: a prefix check passed on the wrong user's card,
    // and on a card left open by an earlier step.
    await bothAnswer(p, 'ShowsUserCard', ['Selma', '50000099'], false);
  });

  test('a mic icon is checked by its LABEL, because the tag never changes', async () => {
    const muted = pair({
      androidDump: anode({ tag: 'room_micToggleButton', desc: 'Unmute' }),
      iosDump: inode({ tag: 'room_micToggleButton', label: 'Unmute' }),
    });
    await bothAnswer(muted, 'ShowsMicIconAs', ['Selma', 'muted'], true);
    // Tag-only would pass a muted mic as live — the state the scenario cares
    // about is precisely the one the tag cannot tell you.
    await bothAnswer(muted, 'ShowsMicIconAs', ['Selma', 'open'], false);
    await bothAnswer(muted, 'ShowsMicIconAs', ['Selma', 'nonsense'], false);
  });

  test('a gift wall entry names the gift AND the sender', async () => {
    const p = pair({
      androidDump:
        anode({ tag: 'giftWall_grid' }) + anode({ tag: 'giftWall_entry_crown_1', text: 'Alice' }),
      iosDump:
        inode({ tag: 'giftWall_grid' }) + inode({ tag: 'giftWall_entry_crown_1', label: 'Alice' }),
    });
    await bothAnswer(p, 'ShowsGiftFromSender', ['Selma', 'crown', 'Alice'], true);
    // Right gift, wrong sender — the attribution is the point of the wall.
    await bothAnswer(p, 'ShowsGiftFromSender', ['Selma', 'crown', 'Theo'], false);
    await bothAnswer(p, 'ShowsGiftFromSender', ['Selma', 'rose', 'Alice'], false);
  });

  test('an in-app gift notification names both people, on the toast itself', async () => {
    const p = pair({
      androidDump: anode({ tag: 'app_toast', text: 'Alice sent you a Crown' }),
      iosDump: inode({ tag: 'app_toast', label: 'Alice sent you a Crown' }),
    });
    await bothAnswer(p, 'ShowsInAppGiftNotification', ['Selma', 'Alice', 'Crown'], true);
    await bothAnswer(p, 'ShowsInAppGiftNotification', ['Selma', 'Theo', 'Crown'], false);
  });

  test('the toast text and the destination are BOTH required', async () => {
    // A toast with no navigation strands the user; navigation with no toast
    // leaves them wondering what happened. Either alone is a bug.
    const both = pair({
      androidDump:
        anode({ tag: 'app_toast', text: 'Room ended' }) + anode({ tag: 'main_roomsTab' }),
      iosDump: inode({ tag: 'app_toast', label: 'Room ended' }) + inode({ tag: 'main_roomsTab' }),
    });
    await bothAnswer(both, 'ShowsToastAndNavigates', ['Selma', 'Room ended', 'rooms'], true);

    const toastOnly = pair({
      androidDump: anode({ tag: 'app_toast', text: 'Room ended' }),
      iosDump: inode({ tag: 'app_toast', label: 'Room ended' }),
    });
    await bothAnswer(toastOnly, 'ShowsToastAndNavigates', ['Selma', 'Room ended', 'rooms'], false);

    const navOnly = pair({
      androidDump: anode({ tag: 'main_roomsTab' }),
      iosDump: inode({ tag: 'main_roomsTab' }),
    });
    await bothAnswer(navOnly, 'ShowsToastAndNavigates', ['Selma', 'Room ended', 'rooms'], false);
  });

  test('a count badge reads the named counter, not any number on screen', async () => {
    const p = pair({
      androidDump:
        anode({ tag: 'profile_count_followers', text: '3' }) +
        anode({ tag: 'profile_count_stalkers', text: '9' }),
      iosDump:
        inode({ tag: 'profile_count_followers', label: '3' }) +
        inode({ tag: 'profile_count_stalkers', label: '9' }),
    });
    await bothAnswer(p, 'ShowsCountBadge', ['Selma', 3, 'followers'], true);
    // 9 IS on screen — but on the other counter.
    await bothAnswer(p, 'ShowsCountBadge', ['Selma', 9, 'followers'], false);
    await bothAnswer(p, 'ShowsStalkersDelta', ['Selma', 9], true);
  });

  test('a disabled input is distinguished from an absent one', async () => {
    const disabled = pair({
      androidDump: anode({ tag: 'room_chatInput', enabled: false }),
      iosDump: inode({ tag: 'room_chatInput', enabled: false }),
    });
    await bothAnswer(disabled, 'DisablesInput', ['Selma', 'chat'], true);

    const enabled = pair({
      androidDump: anode({ tag: 'room_chatInput', enabled: true }),
      iosDump: inode({ tag: 'room_chatInput', enabled: true }),
    });
    await bothAnswer(enabled, 'DisablesInput', ['Selma', 'chat'], false);

    // An input that has vanished is a DIFFERENT bug from one that is locked.
    const absent = pair({ androidDump: anode({ tag: 'other' }), iosDump: inode({ tag: 'other' }) });
    await bothAnswer(absent, 'DisablesInput', ['Selma', 'chat'], false);
  });

  test('an admin row count is counted, not assumed from the list existing', async () => {
    const p = pair({
      androidDump:
        anode({ tag: 'reportReview_list' }) +
        anode({ tag: 'reportReview_listRow_1' }) +
        anode({ tag: 'reportReview_listRow_2' }),
      iosDump:
        inode({ tag: 'reportReview_list' }) +
        inode({ tag: 'reportReview_listRow_1' }) +
        inode({ tag: 'reportReview_listRow_2' }),
    });
    await bothAnswer(p, 'AdminShowsRowCountInTable', ['admin', 2, 'reports'], true);
    await bothAnswer(p, 'AdminShowsRowCountInTable', ['admin', 5, 'reports'], false);
  });

  test('an empty report queue is not a queue with a new report in it', async () => {
    const empty = pair({
      androidDump: anode({ tag: 'reportReview_list' }) + anode({ tag: 'reportReview_emptyState' }),
      iosDump: inode({ tag: 'reportReview_list' }) + inode({ tag: 'reportReview_emptyState' }),
    });
    await bothAnswer(empty, 'AdminShowsNewReportInQueue', ['admin'], false);
  });
});

describe('seats', () => {
  const seated = pair({
    androidDump:
      anode({ tag: 'room_seatGrid' }) +
      anode({ tag: 'seat_0', text: 'Tariq' }) +
      anode({ tag: 'seat_1', text: 'Selma', desc: 'muted' }),
    iosDump:
      inode({ tag: 'room_seatGrid' }) +
      inode({ tag: 'seat_0', label: 'Tariq' }) +
      inode({ tag: 'seat_1', label: 'Selma muted' }),
  });

  test('a named seat number must hold that person', async () => {
    await bothAnswer(seated, 'ShowsInSeatGrid', ['Alice', 'Selma', 1], true);
    // "Selma is seated somewhere" is a weaker claim than the corpus makes.
    await bothAnswer(seated, 'ShowsInSeatGrid', ['Alice', 'Selma', 0], false);
    await bothAnswer(seated, 'ShowsInSeatGrid', ['Alice', 'Selma'], true);
    await bothAnswer(seated, 'ShowsInSeatGrid', ['Alice', 'Theo'], false);
  });

  test('an indicator must be on THEIR seat', async () => {
    await expect(
      seated.ios.methods.ShowsSeatWithIndicator('Alice', 'Selma', 'muted'),
    ).resolves.toBe(true);
    // Tariq is seated but not muted — a grid-wide search would say he is.
    await expect(
      seated.ios.methods.ShowsSeatWithIndicator('Alice', 'Tariq', 'muted'),
    ).resolves.toBe(false);
  });

  test('a long-press targets the seat centre, by index or by occupant', async () => {
    const p = pair({
      androidDump: anode({ tag: 'seat_1', text: 'Selma', bounds: '[100,200][300,400]' }),
      iosDump: inode({ tag: 'seat_1', label: 'Selma', x: 100, y: 200, width: 200, height: 200 }),
    });
    await p.android.methods.LongPressSeat('1');
    await p.ios.methods.LongPressSeat('Selma');
    expect(p.android.calls.longPresses[0]).toMatchObject({ x: 200, y: 300 });
    expect(p.ios.calls.longPresses[0]).toMatchObject({ x: 200, y: 300 });
  });

  test('a long-press on a seat that is not there does nothing at all', async () => {
    // Falling through to a default coordinate would press some other control
    // and report success.
    const p = pair({ androidDump: anode({ tag: 'other' }), iosDump: inode({ tag: 'other' }) });
    await bothAnswer(p, 'LongPressSeat', ['9'], false);
    expect(p.ios.calls.longPresses).toHaveLength(0);
  });
});

describe('actions tap the right thing', () => {
  test('a tab is opened by the first candidate tag that works', async () => {
    const p = pair({ tapSucceedsFor: (tag) => tag === 'tab_rooms' });
    await bothAnswer(p, 'OpensTab', ['Selma', 'rooms'], true);
    expect(p.ios.calls.taps).toEqual(['main_roomsTab', 'rooms', 'tab_rooms']);
  });

  test('a tab that matches no candidate fails rather than reporting success', async () => {
    const p = pair({ tapSucceedsFor: () => false });
    await bothAnswer(p, 'OpensTab', ['Selma', 'rooms'], false);
  });

  test('a confirm dialog tries the specific buttons before the generic ones', async () => {
    const p = pair({ tapSucceedsFor: (tag) => tag === 'dialog_confirmButton' });
    await bothAnswer(p, 'ConfirmDialog', [], true);
    expect(p.ios.calls.taps[0]).toBe('room_endRoomConfirmButton');
    expect(p.ios.calls.taps).toContain('dialog_confirmButton');
  });

  test('a named room card is tapped by tag, and by geometry only as a fallback', async () => {
    const byTag = pair({ tapSucceedsFor: (tag) => tag === 'roomCard_tariq' });
    await bothAnswer(byTag, 'TapRoomCard', ['tariq'], true);
    expect(byTag.ios.calls.taps).toEqual(['roomCard_tariq']);
  });

  test('a named room card that is absent is NOT satisfied by some other card', async () => {
    // Tapping any card and reporting success is how a journey ends up in the
    // wrong room and then fails somewhere unrelated.
    const p = pair({
      androidDump: anode({ tag: 'roomCard_selma', text: 'Selma' }),
      iosDump: inode({ tag: 'roomCard_selma', label: 'Selma' }),
      tapSucceedsFor: () => false,
    });
    await bothAnswer(p, 'TapRoomCard', ['tariq'], false);
  });

  test('a search taps the field then types the term', async () => {
    const p = pair({ tapSucceedsFor: () => true });
    await bothAnswer(p, 'SearchIn', ['messages', 'Selma'], true);
    expect(p.ios.calls.taps).toEqual(['newMessage_searchField']);
    expect(p.ios.calls.typed).toEqual(['Selma']);
  });

  test('a search whose field never opened does NOT type into whatever has focus', async () => {
    const p = pair({ tapSucceedsFor: () => false });
    await bothAnswer(p, 'SearchIn', ['messages', 'Selma'], false);
    expect(p.ios.calls.typed).toEqual([]);
  });

  test('an unknown search screen refuses instead of falling back to the default', async () => {
    const p = pair({ tapSucceedsFor: () => true });
    await bothAnswer(p, 'SearchIn', ['tarot', 'Selma'], false);
    expect(p.ios.calls.taps).toEqual([]);
  });

  test('a network drop passes SECONDS through, and rejects nonsense', async () => {
    const p = pair();
    await bothAnswer(p, 'NetworkDropFor', ['Selma', 5], true);
    expect(p.ios.calls.network).toEqual([5]);
    await bothAnswer(p, 'NetworkDropFor', ['Selma', -1], false);
    await bothAnswer(p, 'NetworkDropFor', ['Selma', 'soon'], false);
  });
});

describe('composites use the platform’s own actions', () => {
  test('blocking opens the card then attempts the action', async () => {
    const seen = [];
    const siblings = {
      TapUserCard: async (...a) => {
        seen.push(['card', ...a]);
        return true;
      },
      AttemptAction: async (a) => {
        seen.push(['action', a]);
        return true;
      },
    };
    const p = pair({ siblings });
    await expect(p.ios.methods.AttemptBlock('Alice')).resolves.toBe(true);
    expect(seen).toEqual([
      ['card', null, 'Alice'],
      ['action', 'Block'],
    ]);
  });

  test('creating a room fails if the TITLE could not be typed', async () => {
    // A room created with the wrong name is not a success; the composite must
    // not sail past a failed field.
    const p = pair({
      tapSucceedsFor: () => true,
      siblings: { OpenScreen: async () => true, TypeText: async () => false },
    });
    await expect(p.ios.methods.CreateRoomComposite('Saturday Showcase')).resolves.toBe(false);
  });

  test('sending a message stops if the conversation never opened', async () => {
    const typed = [];
    const p = pair({
      siblings: {
        OpenConversation: async () => false,
        TypeIntoConversationInput: async (t) => {
          typed.push(t);
          return true;
        },
      },
    });
    await expect(p.ios.methods.SendMessageTo('Alice', 'hello')).resolves.toBe(false);
    expect(typed).toEqual([]);
  });
});

describe('a missing capability REFUSES — it never answers false', () => {
  // "The harness cannot do this" and "the product did the wrong thing" must not
  // arrive as the same answer: one is a gap to fix, the other is a defect to
  // file, and reporting the first as the second is how a matrix run gets
  // misread.
  const bare = createSharedAppMethods({
    platform: 'testphone',
    queries: createDumpQueries(IOS_GRAMMAR),
    uiDump: async () => inode({ tag: 'seat_1', label: 'Selma' }),
    tapByTag: async () => false,
  });

  test.each([
    ['LongPressSeat', ['1']],
    ['KillAndRelaunch', ['Selma']],
    ['NetworkDropFor', ['Selma', 3]],
  ])('%s throws, naming the platform and the missing capability', async (method, args) => {
    await expect(bare[method](...args)).rejects.toThrow(/testphone/);
    await expect(bare[method](...args)).rejects.toThrow(/HARNESS limitation/);
  });

  test('a composite whose sibling action is missing throws rather than failing quietly', async () => {
    await expect(bare.AttemptBlock('Alice')).rejects.toThrow(/TapUserCard/);
  });

  test('an authenticated call reports it cannot be OBSERVED, with a reason', async () => {
    // Not false: a host-issued request would carry a host token and prove
    // nothing about the app's session, so "cannot observe" is the true answer.
    await expect(bare.PerformAuthenticatedCall('/me')).resolves.toMatchObject({
      supported: false,
      why: expect.stringContaining('testphone'),
    });
  });
});

describe('blank arguments never match everything', () => {
  const p = pair({
    androidDump: anode({ tag: 'userCard_50000010', text: 'Alice' }),
    iosDump: inode({ tag: 'userCard_50000010', label: 'Alice' }),
  });

  // "shows the <noun> screen" resolved ONLY through NOUN_KIND_TAGS, a
  // single-tag map that had one entry. So every screen the corpus names but
  // that map does not — `suspension`, `legal acceptance` — answered false, and
  // the report said "Android UI does not show the suspension screen" about a
  // screen that was demonstrably on the device (proven by hand on the OnePlus:
  // "Account Suspended | Reason: Repeat harassment | …").
  //
  // SCREEN_MARKERS already exists for exactly this and lists SEVERAL anchors per
  // screen, which is the right shape — a toolbar can be drawn while the body is
  // still loading, and a single-anchor check would call that "not on screen".
  test.each([
    ['suspension', 'suspension_title'],
    ['suspension', 'suspension_submitAppealButton'],
    ['legal acceptance', 'legal_acceptTermsCheckbox'],
    ['legal acceptance', 'legal_continueButton'],
    ['warning', 'warning_acknowledgeButton'],
  ])('the %s screen is recognised by %s', async (noun, anchor) => {
    const p = pair({ androidDump: anode({ tag: anchor }), iosDump: inode({ tag: anchor }) });
    await bothAnswer(p, 'ShowsNamedKind', ['Raul', noun, 'screen'], true);
  });

  test('a named screen is NOT reported when none of its anchors is present', async () => {
    const p = pair({
      androidDump: anode({ tag: 'main_roomsTab' }),
      iosDump: inode({ tag: 'main_roomsTab' }),
    });
    await bothAnswer(p, 'ShowsNamedKind', ['Raul', 'suspension', 'screen'], false);
  });

  test('an unknown screen name still answers false rather than throwing', async () => {
    const p = pair({
      androidDump: anode({ tag: 'suspension_title' }),
      iosDump: inode({ tag: 'suspension_title' }),
    });
    await bothAnswer(p, 'ShowsNamedKind', ['Raul', 'nonexistent', 'screen'], false);
  });

  test.each([
    ['ShowsUserCard', ['Alice', '']],
    ['ShowsUserCard', ['Alice', null]],
    ['ShowsBanner', ['Alice', '   ']],
    ['ShowsMicIconAs', ['Alice', '']],
    ['ShowsInSeatGrid', ['Alice', '']],
    ['ShowsNamedKind', ['Alice', '', 'button']],
    ['ShowsRoute', ['']],
  ])('%s with %j answers false', async (method, args) => {
    await bothAnswer(p, method, args, false);
  });
});

describe('the shared surface itself', () => {
  test('names are exported unprefixed, so neither platform can own the list', () => {
    expect(SHARED_METHOD_NAMES).toContain('ShowsUserCard');
    expect(SHARED_METHOD_NAMES.some((n) => n.startsWith('android') || n.startsWith('ios'))).toBe(
      false,
    );
  });

  test('the factory refuses to build without the primitives it needs', () => {
    expect(() => createSharedAppMethods({})).toThrow(/queries/);
    expect(() => createSharedAppMethods({ queries: {} })).toThrow(/uiDump/);
    expect(() => createSharedAppMethods({ queries: {}, uiDump: async () => '' })).toThrow(
      /tapByTag/,
    );
  });
});
