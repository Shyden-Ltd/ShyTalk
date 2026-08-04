/**
 * SHY-0275 — the iOS local build must reach the Mac, not the phone itself.
 *
 * Measured on a real iPhone 2026-08-04, built with `LOCAL_HOST=192.168.1.9`
 * passed to xcodebuild exactly as the working recipe documents:
 *
 *   [ShyTalk] DEBUG build — using Firebase Emulators (db=localhost:9000)
 *   I/KoinHelper: Firebase emulators: Firestore=localhost:8080,
 *                 Auth=localhost:9099, RTDB=localhost:9000
 *   D/PreviewWatermark: server health unknown -> false
 *
 * An iPhone has no `adb reverse` equivalent, so `localhost` IS the phone —
 * every backend call went to a port on the handset. `LOCAL_HOST` was ignored
 * because NOTHING READ IT: `Local.xcconfig` defines LOCAL_HOST /
 * LOCAL_API_BASE_URL / LOCAL_LIVEKIT_URL / LOCAL_FIREBASE_RTDB_URL and the
 * only other references in the repo are its own comments. The live values
 * were Swift/Kotlin literals.
 *
 * These are structural checks because the failure is SILENT and platform-only:
 * the build succeeds, installs, launches, and simply cannot talk to anything.
 * Nothing in CI would have caught it — CI never runs an iPhone against a local
 * stack — so a pin over the wiring is the only automated guard available.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const INFO_PLIST = read('iosApp/iosApp/Info.plist');
const LOCAL_XCCONFIG = read('iosApp/Configurations/Local.xcconfig');
const APP_ENVIRONMENT = read('iosApp/iosApp/AppEnvironment.swift');
const IOS_APP = read('iosApp/iosApp/iOSApp.swift');
const KOIN_HELPER = read('shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/KoinHelper.kt');
const LIVEKIT_BRIDGE = read('iosApp/iosApp/LiveKitBridge.swift');
const IOS_VOICE = read(
  'shared/src/iosMain/kotlin/com/shyden/shytalk/data/remote/IosLiveKitVoiceService.kt',
);

// Comment lines are not code. Several of these files legitimately DISCUSS
// `localhost` in prose (explaining this very bug), so a naive substring search
// would report on the explanation instead of on the behaviour.
// `#` opens a comment in shell and an xcconfig, but in Swift `#if` / `#endif`
// are COMPILE DIRECTIVES and are exactly what the security assertions below
// read. Stripping them would have made "the relaxation is inside #if DEBUG"
// unprovable — and, worse, silently so.
const stripComments = (src) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => !/^\s*#(?!if|endif|else|elseif)/.test(l))
    .join('\n');

describe('SHY-0275 — the local host reaches the iOS code that needs it', () => {
  test('the files under test are non-empty', () => {
    // Vacuous-pass guard: a renamed file would otherwise make every
    // "does not contain a literal" assertion below trivially true.
    for (const [name, src] of Object.entries({
      INFO_PLIST,
      LOCAL_XCCONFIG,
      APP_ENVIRONMENT,
      IOS_APP,
      KOIN_HELPER,
      LIVEKIT_BRIDGE,
      IOS_VOICE,
    })) {
      expect({ [name]: src.length > 0 }).toEqual({ [name]: true });
    }
  });

  test('Info.plist carries the LOCAL_HOST build setting into the bundle', () => {
    // This is the ONLY bridge from xcconfig to running code. Without it,
    // `LOCAL_HOST=` on the xcodebuild command line sets a value that no code
    // can ever observe — which is how the documented recipe appeared to be
    // followed while the app talked to itself.
    //
    // Mirrors the existing ShyTalkGit* keys, which use the same mechanism.
    expect(INFO_PLIST).toMatch(/<key>ShyTalkLocalHost<\/key>\s*<string>\$\(LOCAL_HOST\)<\/string>/);
  });

  test('Local.xcconfig still defines LOCAL_HOST for the plist to substitute', () => {
    expect(stripComments(LOCAL_XCCONFIG)).toMatch(/^LOCAL_HOST\s*=/m);
  });

  test('KoinHelper takes the emulator host as a parameter instead of fixing it', () => {
    // This one does not carry a URL literal — it wrote `val host = "localhost"`
    // and handed it to useEmulator() three times, which is why it needs its own
    // assertion rather than the URL pattern below. It produced the exact three
    // values the device console printed.
    const code = stripComments(KOIN_HELPER);
    expect(code).not.toMatch(/val\s+host\s*=\s*"localhost"/);
    expect(code).toMatch(/fun\s+configureFirebaseEmulators\s*\(\s*host\s*:/);
    // Proves the assertion above is not vacuous — it catches the original line.
    expect(/val\s+host\s*=\s*"localhost"/.test('    val host = "localhost"')).toBe(true);
  });

  test.each([
    ['AppEnvironment.swift (API base URL)', () => APP_ENVIRONMENT],
    ['iOSApp.swift (Firebase RTDB URL)', () => IOS_APP],
  ])('%s does not hard-code a localhost backend address', (_name, get) => {
    // The three sites the device console named, one per line of its output.
    // A literal here silently wins over anything the plist provides, because
    // it never consults the plist at all.
    //
    // `localhost` as a DEFAULT is fine and expected — what must not exist is a
    // backend URL built from the literal. So the pattern targets a scheme +
    // localhost + port, not the bare word.
    expect(stripComments(get())).not.toMatch(/["'](?:https?|ws):\/\/localhost:\d+/);
  });

  test('the localhost detector actually fires on the code it was written for', () => {
    // Guards the assertion above from being loosened into a no-op: these are
    // the three literals as they were ACTUALLY written before this story.
    const historical = [
      'static let localApiBaseUrl = "http://localhost:3000"',
      'options.databaseURL = "http://localhost:9000?ns=demo-shytalk"',
      'val liveKitUrl = "ws://localhost:7880"',
    ];
    for (const line of historical) {
      expect({ line, caught: /["'](?:https?|ws):\/\/localhost:\d+/.test(line) }).toEqual({
        line,
        caught: true,
      });
    }
    // And that a comment mentioning the same text is NOT treated as code.
    expect(stripComments('// tried http://localhost:3000 from real iPhones')).toBe('');
  });

  test('iOS has a local LiveKit URL to fall back to', () => {
    // express-api/src/routes/livekit.js deliberately omits `url` from the token
    // response when NODE_ENV === 'local', leaving the client to supply its own.
    // Android has BuildConfig.LIVEKIT_SERVER_URL; iOS had NOTHING, so it took
    // `response.url ?: ""` and tried to connect to the empty string.
    expect(stripComments(IOS_VOICE)).not.toMatch(/response\.url\s*\?:\s*""/);
    expect(stripComments(IOS_VOICE)).toMatch(/liveKitUrl/);
  });

  test('the LiveKit allow-list relaxation is confined to DEBUG builds', () => {
    // Cleartext ws:// to a private LAN address is required on a real device and
    // must NOT exist in a shipped binary — a minors-facing app must not accept
    // an unencrypted signalling channel (which carries the join token) from
    // anything on the network. `#if DEBUG` removes it at compile time.
    const code = stripComments(LIVEKIT_BRIDGE);
    expect(code).toMatch(/#if DEBUG/);
    // The private-LAN predicate must sit INSIDE a DEBUG guard, not beside it.
    const debugBlocks = [...code.matchAll(/#if DEBUG([\s\S]*?)#endif/g)].map((m) => m[1]);
    expect(debugBlocks.length).toBeGreaterThan(0);
    expect(debugBlocks.some((b) => /isPrivateLAN|privateLan/i.test(b))).toBe(true);
  });

  test('private-LAN membership is decided NUMERICALLY, never by string prefix', () => {
    // A `hasPrefix("172.")` check accepts 172.32.0.1, which is PUBLIC — the
    // 172.16/12 block stops at 172.31. A `hasPrefix("10.")` check accepts the
    // hostname 10.0.0.5.evil.com. Both are the classic way this goes wrong.
    const code = stripComments(LIVEKIT_BRIDGE);
    expect(code).not.toMatch(/hasPrefix\(\s*"(?:10|172|192)\./);
    // Numeric parse of the octets is the required shape. Deliberately does NOT
    // require the call to end right after the separator — `split` legitimately
    // takes `omittingEmptySubsequences:` too, and a pin that breaks on a valid
    // second argument is a pin that gets deleted.
    expect(code).toMatch(/split\(separator:\s*"\."|components\(separatedBy:\s*"\."/);
    expect(code).toMatch(/UInt8|Int\(/);
    // The 172.16/12 boundary must be expressed as a RANGE. `172` alone, or a
    // prefix test, wrongly accepts the public 172.32.x.
    expect(code).toMatch(/16\s*\.\.\.\s*31/);
  });

  test('a helper script builds iOS-local with a DETECTED address, not a committed one', () => {
    // This machine's LAN address changed three times across SHY-0273 alone. The
    // Android side already detects it in start.sh; iOS needs the same or the
    // recipe rots the moment the network changes.
    const helper = read('scripts/dev/ios-local-install.sh');
    expect(helper).toMatch(/route -n get default/);
    expect(helper).toMatch(/LOCAL_HOST=/);
    // And no committed literal address.
    expect(stripComments(helper)).not.toMatch(/LOCAL_HOST=\s*["']?\d{1,3}(?:\.\d{1,3}){3}/);
  });
});
