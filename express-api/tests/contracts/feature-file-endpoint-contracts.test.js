/**
 * Feature-file ↔ Endpoint contract pins.
 *
 * The journey-runner's .feature files MUST send body fields that match
 * the production endpoint's request shape. A `roomId=X` in a feature
 * file would silently fail against an endpoint that reads `roomName` —
 * the runner would issue a real HTTP POST with `{roomId:X}` and get a
 * 400. Per the 2026-05-29 j09 dispatch (manual-qa-cycle-1.md, finding
 * "LiveKit access token contains cohort claim matching the room"), this
 * drift was a real failure mode: the feature used `roomId=` but both
 * Android (`LiveKitTokenService.kt`) + iOS (`IosServices.kt`) production
 * clients send `roomName` to match `req.body.roomName` in
 * `express-api/src/routes/livekit.js`.
 *
 * This file scans every .feature in `journey-tests/` for
 * each endpoint pinned below, and asserts the body uses the production
 * field name. Add a pin here whenever a new endpoint becomes the subject
 * of a journey scenario.
 */
const fs = require('fs');
const path = require('path');

const FEATURE_DIR = path.join(__dirname, '..', '..', '..', 'journey-tests');

function readAllFeatures() {
  return fs
    .readdirSync(FEATURE_DIR)
    .filter((f) => f.endsWith('.feature'))
    .map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(FEATURE_DIR, f), 'utf8'),
    }));
}

function linesReferencing(endpointPath, features) {
  // Find every line that contains "POST(s)?  <endpointPath>"; capture the
  // file + line index so a failure points at the exact location.
  const hits = [];
  features.forEach(({ name, content }) => {
    content.split('\n').forEach((line, idx) => {
      if (!line.includes(endpointPath)) return;
      // Skip pure comment lines so a heading like "# scenario about
      // /api/livekit/token cohort claim" doesn't trip the matcher.
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) return;
      hits.push({ file: name, line: idx + 1, text: line });
    });
  });
  return hits;
}

describe('feature-file ↔ endpoint body-field contracts', () => {
  const features = readAllFeatures();

  test('feature corpus is non-empty (guards a future move/rename of journey-tests/)', () => {
    expect(features.length).toBeGreaterThan(0);
  });

  describe('/api/livekit/token — production clients send `roomName` (NOT roomId)', () => {
    // Sources of truth:
    //   - express-api/src/routes/livekit.js:35 — `const { roomName } = req.body || {}`
    //   - app/src/main/java/com/shyden/shytalk/data/remote/LiveKitTokenService.kt — `put("roomName", roomName)`
    //   - shared/src/iosMain/.../IosServices.kt — `"roomName" to JsonPrimitive(roomName)`
    const ENDPOINT = '/api/livekit/token';

    test('every feature line targeting the endpoint uses `roomName=` if it has a body', () => {
      const hits = linesReferencing(ENDPOINT, features);
      // Only consider lines that actually carry a `with <kv>` body; bare
      // `POST <path> as <Persona>` lines have no body and use bearer
      // auth alone (legitimate when the endpoint derives all state
      // from the JWT).
      const withBody = hits.filter((h) => h.text.includes(' with '));
      withBody.forEach((h) => {
        // Pin: must use `roomName=` (= sign, with optional surrounding quotes).
        // Prevents drift back to the failing `roomId=` shape from 2026-05-29.
        expect({ file: h.file, line: h.line, text: h.text }).toMatchObject({
          text: expect.stringContaining('roomName='),
        });
        // Negative pin: must NOT use the wrong field name.
        expect({ file: h.file, line: h.line, text: h.text }).not.toMatchObject({
          text: expect.stringMatching(/\broomId=/),
        });
      });
    });

    test('j09 has at least one scenario hitting this endpoint (regression guard — if someone moves the scenario, this test reminds them to add the new home)', () => {
      const j09 = features.find((f) => f.name === 'j09-voice-room-host.feature');
      expect(j09).toBeDefined();
      const hits = linesReferencing(ENDPOINT, [j09]);
      expect(hits.length).toBeGreaterThanOrEqual(2); // Alice (200) + Marcus (404)
    });
  });
});
