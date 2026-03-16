/**
 * Auth routes — OTP, PIN, biometric authentication.
 *
 * POST   /api/auth/otp/send              → Send OTP code to email
 * POST   /api/auth/otp/verify            → Verify OTP code, return custom token
 * POST   /api/auth/pin/setup             → Create/replace PIN hash (auth required)
 * POST   /api/auth/pin/verify            → Verify PIN, return custom token
 * POST   /api/auth/pin/reset             → Reset PIN + clear lockout (auth required)
 * POST   /api/auth/biometric/register    → Store biometric public key (auth required)
 * POST   /api/auth/biometric/verify      → Verify biometric signature, return custom token
 * GET    /api/auth/biometric/challenge   → Get challenge nonce
 * DELETE /api/auth/biometric/:deviceId   → Revoke biometric key (auth required)
 */

const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db, auth } = require('../utils/firebase');
const { sendEmail } = require('../utils/email');
const {
  buildOtpEmail,
  buildLockoutEmail: _buildLockoutEmail,
  buildResetEmail: _buildResetEmail,
} = require('../utils/email-templates');
const log = require('../utils/log');
const { authMiddleware } = require('../middleware/auth');
const { sensitiveLimiter } = require('../middleware/rateLimit');

const BCRYPT_ROUNDS = 10;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 3;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DAILY_EMAIL_CAP = 100;
const DAILY_EMAIL_WARN = 80;
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Simple email format check
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
// OTP Routes
// ═══════════════════════════════════════════════════════════════════

// POST /api/auth/otp/send
router.post('/auth/otp/send', sensitiveLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const emailLower = email.toLowerCase().trim();

    // Per-email rate limit (5 per hour, fixed window from firstRequestAt)
    const otpRef = db.doc(`otpCodes/${emailLower}`);
    const otpDoc = await otpRef.get();

    if (otpDoc.exists) {
      const data = otpDoc.data();
      const windowElapsed = Date.now() - (data.firstRequestAt || 0) > OTP_RATE_WINDOW_MS;

      if (!windowElapsed && (data.requestCount || 0) >= OTP_MAX_REQUESTS_PER_HOUR) {
        return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
      }
    }

    // Global daily email cap
    const metricsRef = db.doc('emailMetrics/daily');
    const metricsDoc = await metricsRef.get();
    if (metricsDoc.exists) {
      const metrics = metricsDoc.data();
      if (metrics.date === today() && metrics.count >= DAILY_EMAIL_CAP) {
        return res.status(429).json({
          error: 'daily_limit',
          message: 'Too many requests. Try again tomorrow or use Google/Apple sign-in.',
        });
      }
    }

    // Generate and hash OTP
    const code = generateOtp();
    const hashedCode = await bcrypt.hash(code, BCRYPT_ROUNDS);

    // Determine rate limit fields
    let requestCount = 1;
    let firstRequestAt = Date.now();
    if (otpDoc.exists) {
      const data = otpDoc.data();
      const windowElapsed = Date.now() - (data.firstRequestAt || 0) > OTP_RATE_WINDOW_MS;
      if (!windowElapsed) {
        requestCount = (data.requestCount || 0) + 1;
        firstRequestAt = data.firstRequestAt;
      }
    }

    // Store OTP
    await otpRef.set({
      hashedCode,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
      requestCount,
      firstRequestAt,
    });

    // Update daily metrics
    const metricsData = metricsDoc.exists ? metricsDoc.data() : null;
    const todayStr = today();
    const currentCount = metricsData && metricsData.date === todayStr ? metricsData.count : 0;
    await metricsRef.set({ count: currentCount + 1, date: todayStr });

    if (currentCount + 1 >= DAILY_EMAIL_WARN) {
      log.warn(`Daily email count at ${currentCount + 1}/${DAILY_EMAIL_CAP}`);
    }

    // Send email
    const template = buildOtpEmail(code);
    await sendEmail(emailLower, template.subject, template.html);

    res.json({ message: 'OTP sent' });
  } catch (err) {
    log.error('OTP send failed', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/otp/verify
router.post('/auth/otp/verify', sensitiveLimiter, async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!code) return res.status(400).json({ error: 'code required' });

    const emailLower = email.toLowerCase().trim();
    const otpRef = db.doc(`otpCodes/${emailLower}`);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
      return res.status(404).json({ error: 'No OTP found. Request a new one.' });
    }

    const data = otpDoc.data();

    // Check expiry
    if (Date.now() > data.expiresAt) {
      await otpRef.delete();
      return res.status(410).json({ error: 'Code expired. Request a new one.' });
    }

    // Check max attempts
    if (data.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }

    // Verify code
    const isValid = await bcrypt.compare(code, data.hashedCode);
    if (!isValid) {
      await otpRef.update({ attempts: data.attempts + 1 });
      return res.status(401).json({ error: 'Invalid code' });
    }

    // OTP is valid — clean up
    await otpRef.delete();

    // Get or create Firebase user for this email
    let firebaseUid;
    try {
      const userRecord = await auth.getUserByEmail(emailLower);
      // Prevent OTP bypass for Google/Apple accounts — they must use their provider
      const providers = (userRecord.providerData || []).map((p) => p.providerId);
      const hasPasswordOrEmail = providers.includes('password') || providers.length === 0;
      const isOtpOnlyOrNew = hasPasswordOrEmail || providers.includes('email');
      if (
        !isOtpOnlyOrNew &&
        (providers.includes('google.com') || providers.includes('apple.com'))
      ) {
        return res.status(403).json({
          error:
            'This email is linked to a Google or Apple account. Please sign in with that provider.',
        });
      }
      firebaseUid = userRecord.uid;
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        const newUser = await auth.createUser({ email: emailLower });
        firebaseUid = newUser.uid;
      } else {
        throw err;
      }
    }

    // Issue custom token
    const customToken = await auth.createCustomToken(firebaseUid);
    res.json({ customToken });
  } catch (err) {
    log.error('OTP verify failed', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PIN Routes
// ═══════════════════════════════════════════════════════════════════

// POST /api/auth/pin/setup (auth required)
router.post('/auth/pin/setup', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body || {};
    const uniqueId = req.auth?.uniqueId;
    if (!uniqueId) return res.status(401).json({ error: 'Authentication required' });

    if (!pin || typeof pin !== 'string' || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be numeric' });
    }
    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      return res
        .status(400)
        .json({ error: `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits` });
    }

    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    const userRef = db.doc(`users/${uniqueId}`);
    await userRef.update({
      pinHash,
      pinSetAt: Date.now(),
      pinAttempts: 0,
      pinLockedUntil: null,
      pinLockoutCount: 0,
    });

    res.json({ message: 'PIN set', pinHash });
  } catch (err) {
    log.error('PIN setup failed', err);
    res.status(500).json({ error: 'Failed to set PIN' });
  }
});

// POST /api/auth/pin/verify
router.post('/auth/pin/verify', sensitiveLimiter, async (req, res) => {
  try {
    const { uniqueId, deviceId, pin } = req.body || {};
    if (!uniqueId || !deviceId || !pin) {
      return res.status(400).json({ error: 'uniqueId, deviceId, and pin required' });
    }

    const userRef = db.doc(`users/${uniqueId}`);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userDoc.data();

    // Check lockout
    if (user.pinLockedUntil && Date.now() < user.pinLockedUntil) {
      const response = {
        error: 'Account locked',
        locked: true,
        lockedUntil: user.pinLockedUntil,
        attemptsRemaining: 0,
      };
      if ((user.pinLockoutCount || 0) >= 2) {
        response.requiresReauth = true;
      }
      return res.status(423).json(response);
    }

    // If lockout expired, reset attempts
    let currentAttempts = user.pinAttempts || 0;
    if (user.pinLockedUntil && Date.now() >= user.pinLockedUntil) {
      currentAttempts = 0;
    }

    // Verify PIN
    if (!user.pinHash) {
      return res.status(404).json({ error: 'No PIN set' });
    }

    const isValid = await bcrypt.compare(pin, user.pinHash);
    if (!isValid) {
      const newAttempts = currentAttempts + 1;
      const updates = { pinAttempts: newAttempts };

      if (newAttempts >= PIN_MAX_ATTEMPTS) {
        const lockoutCount = (user.pinLockoutCount || 0) + 1;
        updates.pinLockedUntil = Date.now() + PIN_LOCKOUT_MS;
        updates.pinLockoutCount = lockoutCount;

        const response = {
          error: 'Account locked',
          locked: true,
          lockedUntil: updates.pinLockedUntil,
          attemptsRemaining: 0,
        };
        if (lockoutCount >= 2) {
          response.requiresReauth = true;
        }

        await userRef.update(updates);
        return res.status(423).json(response);
      }

      await userRef.update(updates);
      return res.status(401).json({
        error: 'Wrong PIN',
        attemptsRemaining: PIN_MAX_ATTEMPTS - newAttempts,
      });
    }

    // PIN is valid — reset attempts
    await userRef.update({
      pinAttempts: 0,
      pinLockedUntil: null,
    });

    // Get Firebase UID for custom token
    const firebaseUid = user.firebaseUid;
    if (!firebaseUid) {
      return res.status(500).json({ error: 'No Firebase UID for user' });
    }

    const customToken = await auth.createCustomToken(firebaseUid);
    res.json({ customToken });
  } catch (err) {
    log.error('PIN verify failed', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/pin/reset (auth required)
router.post('/auth/pin/reset', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body || {};
    const uniqueId = req.auth?.uniqueId;
    if (!uniqueId) return res.status(401).json({ error: 'Authentication required' });

    if (!pin || typeof pin !== 'string' || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be numeric' });
    }
    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      return res
        .status(400)
        .json({ error: `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits` });
    }

    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    const userRef = db.doc(`users/${uniqueId}`);
    await userRef.update({
      pinHash,
      pinSetAt: Date.now(),
      pinAttempts: 0,
      pinLockedUntil: null,
      pinLockoutCount: 0,
    });

    res.json({ message: 'PIN reset' });
  } catch (err) {
    log.error('PIN reset failed', err);
    res.status(500).json({ error: 'Failed to reset PIN' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Biometric Routes
// ═══════════════════════════════════════════════════════════════════

// In-memory challenge store with TTL (60s expiry)
const challenges = new Map();

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [key, val] of challenges) {
    if (now > val.expiresAt) challenges.delete(key);
  }
}

// POST /api/auth/biometric/register (auth required)
router.post('/auth/biometric/register', authMiddleware, async (req, res) => {
  try {
    const { publicKey, deviceId } = req.body || {};
    const uniqueId = req.auth?.uniqueId;
    if (!uniqueId) return res.status(401).json({ error: 'Authentication required' });
    if (!publicKey || !deviceId) {
      return res.status(400).json({ error: 'publicKey and deviceId required' });
    }

    const keyRef = db.doc(`biometricKeys/${uniqueId}:${deviceId}`);
    await keyRef.set({
      publicKey,
      createdAt: Date.now(),
    });

    res.json({ message: 'Biometric registered' });
  } catch (err) {
    log.error('Biometric register failed', err);
    res.status(500).json({ error: 'Failed to register biometric' });
  }
});

// GET /api/auth/biometric/challenge
router.get('/auth/biometric/challenge', sensitiveLimiter, async (req, res) => {
  try {
    const { uniqueId, deviceId } = req.query;
    if (!uniqueId || !deviceId) {
      return res.status(400).json({ error: 'uniqueId and deviceId required' });
    }

    // Validate pair exists
    const keyRef = db.doc(`biometricKeys/${uniqueId}:${deviceId}`);
    const keyDoc = await keyRef.get();
    if (!keyDoc.exists) {
      return res.status(404).json({ error: 'No biometric key registered for this device' });
    }

    cleanExpiredChallenges();

    // Generate challenge nonce
    const nonce = crypto.randomBytes(32).toString('base64');
    const challengeKey = `${uniqueId}:${deviceId}`;
    challenges.set(challengeKey, {
      nonce,
      expiresAt: Date.now() + 60 * 1000, // 60s
    });

    res.json({ challenge: nonce });
  } catch (err) {
    log.error('Biometric challenge failed', err);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// POST /api/auth/biometric/verify
router.post('/auth/biometric/verify', sensitiveLimiter, async (req, res) => {
  try {
    const { uniqueId, deviceId, signature } = req.body || {};
    if (!uniqueId || !deviceId || !signature) {
      return res.status(400).json({ error: 'uniqueId, deviceId, and signature required' });
    }

    const challengeKey = `${uniqueId}:${deviceId}`;
    const challenge = challenges.get(challengeKey);

    if (!challenge) {
      return res.status(404).json({ error: 'No challenge found. Request a new one.' });
    }

    if (Date.now() > challenge.expiresAt) {
      challenges.delete(challengeKey);
      return res.status(410).json({ error: 'Challenge expired' });
    }

    // Get stored public key
    const keyRef = db.doc(`biometricKeys/${uniqueId}:${deviceId}`);
    const keyDoc = await keyRef.get();
    if (!keyDoc.exists) {
      return res.status(404).json({ error: 'No biometric key registered' });
    }

    const { publicKey: storedKey } = keyDoc.data();

    // Convert stored Base64 SPKI DER to a KeyObject for verification
    let keyObject;
    try {
      // Try as PEM first (if client sent PEM-encoded key)
      if (storedKey.startsWith('-----')) {
        keyObject = crypto.createPublicKey(storedKey);
      } else {
        // Assume Base64-encoded SPKI DER (from Android Keystore)
        const derBuffer = Buffer.from(storedKey, 'base64');
        keyObject = crypto.createPublicKey({ key: derBuffer, format: 'der', type: 'spki' });
      }
    } catch (keyErr) {
      log.error('Invalid public key format', keyErr);
      return res.status(500).json({ error: 'Invalid biometric key' });
    }

    // Verify ECDSA signature
    const verify = crypto.createVerify('SHA256');
    verify.update(challenge.nonce);
    const isValid = verify.verify(keyObject, Buffer.from(signature, 'base64'));

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Clean up challenge
    challenges.delete(challengeKey);

    // Get user's Firebase UID
    const userRef = db.doc(`users/${uniqueId}`);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const firebaseUid = userDoc.data().firebaseUid;
    const customToken = await auth.createCustomToken(firebaseUid);
    res.json({ customToken });
  } catch (err) {
    log.error('Biometric verify failed', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// DELETE /api/auth/biometric/:deviceId (auth required)
router.delete('/auth/biometric/:deviceId', authMiddleware, async (req, res) => {
  try {
    const uniqueId = req.auth?.uniqueId;
    if (!uniqueId) return res.status(401).json({ error: 'Authentication required' });

    const { deviceId } = req.params;
    const keyRef = db.doc(`biometricKeys/${uniqueId}:${deviceId}`);
    await keyRef.delete();

    res.json({ message: 'Biometric key revoked' });
  } catch (err) {
    log.error('Biometric revoke failed', err);
    res.status(500).json({ error: 'Failed to revoke biometric key' });
  }
});

module.exports = router;
