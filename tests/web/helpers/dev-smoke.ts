/**
 * Pure helpers for the dev-smoke suite (SHY-0178). No I/O, no env —
 * fully covered by tests/web/dev-smoke-helpers.spec.ts, which runs in
 * the LOCAL suites (dev-smoke.spec.ts itself only runs in
 * deploy-dev.yml's Dev Smoke job).
 */

/**
 * Extract the caller's Firebase uid from a decoded ID-token payload.
 *
 * Firebase ID tokens carry the uid as `user_id` (Firebase-specific)
 * plus the standard `sub`; `request.auth.uid` in firestore.rules is
 * exactly that value, so a room-create payload stamped from the SAME
 * token that authorizes the write can never desync from the rule's
 * `ownerFirebaseUid == request.auth.uid` comparison (SHY-0029).
 *
 * Only non-empty STRINGS are returned — a numeric/object claim must
 * never leak into a Firestore REST `stringValue`. No trimming: uids
 * never contain whitespace, and the rules-level comparison is the
 * arbiter, so the helper does not second-guess the token.
 */
export function deriveOwnerFirebaseUid(
  payload: Record<string, unknown>,
): string | undefined {
  for (const claim of [payload.user_id, payload.sub]) {
    if (typeof claim === "string" && claim !== "") return claim;
  }
  return undefined;
}

/**
 * Build the operator-facing diagnostic thrown when the smoke room
 * create is denied. Names EVERY precondition of the firestore.rules
 * rooms-create rule (auth-state gates included) so a future rule
 * tightening is diagnosable from the smoke-job log alone — the exact
 * drift SHY-0178 fixed had to be root-caused from a bare 403.
 */
export function buildRoomsCreateFailureHint(args: {
  roomName: string;
  status: number;
  bodyText: string;
  projectId: string;
}): string {
  return (
    `Firestore REST write to rooms/${args.roomName} failed ` +
    `(${args.status}): ${args.bodyText}. ` +
    `Verify FIREBASE_PROJECT_ID="${args.projectId}" matches the dev Firebase ` +
    `project, that the smoke account has \`uniqueId\` + \`cohort\` custom ` +
    `claims minted (run pm-lock-check or re-sign-in as the smoke user), ` +
    `that the smoke account is signed in and not banned (SHY-0150 ` +
    `isBanned() gate), and that the rooms-create rule still permits ` +
    `owner=self + ownerFirebaseUid=auth-uid + cohort=claim writes.`
  );
}
