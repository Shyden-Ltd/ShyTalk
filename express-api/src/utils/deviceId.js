/**
 * Device IDs are opaque, client-generated identifiers used directly as a
 * Firestore document id (`deviceBindings/{deviceId}`). Constrain them to a safe
 * charset + length so a value can never:
 *   - contain a `/` (which would redirect `db.doc(...)` onto a nested
 *     subcollection path rather than the intended flat document),
 *   - be whitespace-only or empty,
 *   - be a non-string that the template literal would silently stringify
 *     (`[object Object]`, comma-joined arrays, …).
 * Shared by every route that keys a Firestore doc on a client-supplied deviceId.
 */
const DEVICE_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

function isValidDeviceId(deviceId) {
  return typeof deviceId === 'string' && DEVICE_ID_RE.test(deviceId);
}

module.exports = { isValidDeviceId, DEVICE_ID_RE };
