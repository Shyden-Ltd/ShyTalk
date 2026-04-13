/**
 * SDK-agnostic Firebase Auth state handler factory.
 * Returns a callback for onAuthStateChanged. Zero Firebase imports.
 */
export function createAuthStateHandler({ requireClaim, onAccessDenied, onReady }) {
  return async (user) => {
    if (!user) {
      onReady(null);
      return;
    }
    const tokenResult = await user.getIdTokenResult();
    if (requireClaim && tokenResult.claims[requireClaim] !== true) {
      if (onAccessDenied) {
        onAccessDenied({ reason: 'missing_claim', claim: requireClaim });
      }
      return;
    }
    onReady(user, tokenResult);
  };
}
