/**
 * Portal JS — Single-page application for ShyTalk user portal.
 *
 * Handles:
 * - Firebase Auth init (Google, Apple, Email/Password sign-in)
 * - Hash-based routing with XSS-safe allowlist
 * - TOTP enrollment (QR code + manual key), verification, and recovery
 * - Dashboard rendering based on user role
 * - Firestore onSnapshot for role revocation
 * - Re-auth modal for sensitive actions
 * - Session persistence (remember me)
 * - Loading states and error handling
 */

/* global firebase, QRCode, PORTAL_T, applyPortalTranslations */

(function () {
  'use strict';

  // ─── Environment-aware API base ──────────────────────────────

  // Use config.js API_BASE if available, otherwise detect from hostname
  // eslint-disable-next-line -- localhost fallback is the first branch of the ternary
  var API_BASE = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.API_BASE) ? window.PORTAL_CONFIG.API_BASE : (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : location.hostname.includes('dev') ? 'https://dev-api.shytalk.shyden.co.uk' : 'https://api.shytalk.shyden.co.uk';

  // ─── State ───────────────────────────────────────────────────

  var auth = null;
  var db = null;
  var currentProfile = null;    // portal/me response
  var currentUniqueId = null;
  var unsubSnapshot = null;
  var sessionStartTime = Date.now();
  var totpFailures = 0;
  var pendingReauthResolve = null;
  var pendingReauthReject = null;

  // ─── Route allowlist (XSS prevention) ────────────────────────

  var VALID_ROUTES = new Set(['dashboard', 'profile', 'security', 'data-privacy']);

  // ─── Utility ─────────────────────────────────────────────────

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    if (!text) return '';
    var el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }

  // Translation lookup that reads the user's currently-selected portal
  // language from ShyTalkLanguage / localStorage, falls back to en. Used
  // by JS-side renderers that build textContent dynamically (welcome
  // greeting, suspension reason prefix, etc.) — these are NOT covered
  // by applyPortalTranslations's [data-i18n] walk because the JS
  // overwrites textContent after that walk runs.
  function getCurrentLang() {
    if (window.ShyTalkLanguage && typeof window.ShyTalkLanguage.get === 'function') {
      return window.ShyTalkLanguage.get();
    }
    try { return localStorage.getItem('shytalk_language') || 'en'; }
    catch (_e) { return 'en'; }
  }
  function t(key) {
    var T = window.PORTAL_T || {};
    var lang = getCurrentLang();
    var dict = T[lang] || T.en || {};
    return dict[key] !== undefined ? dict[key] : (T.en && T.en[key]) || key;
  }

  function hideAll() {
    var sections = document.querySelectorAll('.portal-section');
    for (var i = 0; i < sections.length; i++) {
      sections[i].hidden = true;
    }
  }

  function showSection(id) {
    hideAll();
    var section = $(id);
    if (section) section.hidden = false;
  }

  function showLoading() {
    showSection('loading-section');
  }

  function showError(containerId, message) {
    var el = $(containerId);
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  }

  function hideError(containerId) {
    var el = $(containerId);
    if (el) {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function showMessageModal(title, body) {
    var titleEl = $('message-modal-title');
    var bodyEl = $('message-modal-body');
    var modal = $('message-modal');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (modal) modal.hidden = false;
  }

  function hideMessageModal() {
    var modal = $('message-modal');
    if (modal) modal.hidden = true;
  }

  function disableButton(btn, durationMs) {
    if (!btn) return;
    btn.disabled = true;
    setTimeout(function () {
      btn.disabled = false;
    }, durationMs || 5000);
  }

  // ─── API Client ──────────────────────────────────────────────

  async function portalFetch(path, options) {
    options = options || {};
    var token = await auth.currentUser.getIdToken();
    var fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
    };
    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }
    return fetch(API_BASE + path, fetchOptions);
  }

  // ─── Firebase Init ───────────────────────────────────────────

  async function initFirebase() {
    if (typeof firebase === 'undefined') {
      console.error('Firebase SDK not loaded');
      handleUnauthenticatedRoute();
      return;
    }

    try {
      // Use local config.js if available, otherwise fetch from API
      var portalConfig = window.PORTAL_CONFIG || {};
      var config;
      if (portalConfig.FIREBASE_CONFIG) {
        config = portalConfig.FIREBASE_CONFIG;
      } else {
        var configRes = await fetch(API_BASE + '/api/firebase-config');
        if (!configRes.ok) throw new Error('Config fetch failed: ' + configRes.status);
        config = await configRes.json();
      }

      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      auth = firebase.auth();
      db = firebase.firestore();

      // Connect to Firebase emulators when running locally
      if (portalConfig.USE_EMULATORS) {
        auth.useEmulator('http://localhost:9099', { disableWarnings: true });
        db.useEmulator('localhost', 8080);
      }

      // Handle redirect result (for redirect-based OAuth)
      try {
        await firebase.auth().getRedirectResult();
      } catch (redirectErr) {
        if (redirectErr.code !== 'auth/popup-closed-by-user') {
          console.error('Redirect result error:', redirectErr);
        }
      }

      // Set up auth state listener
      auth.onAuthStateChanged(handleAuthStateChanged);
    } catch (err) {
      console.error('Firebase init failed:', err);
      handleUnauthenticatedRoute();
    }
  }

  // Show login or a pseudo-route when Firebase isn't available
  function handleUnauthenticatedRoute() {
    var hash = location.hash.slice(1);
    if (hash === 'no-account') {
      showSection('no-account-section');
    } else if (hash === 'recovery') {
      showSection('recovery-section');
    } else {
      showSection('login-section');
    }
  }

  // ─── Auth State Machine ──────────────────────────────────────

  async function handleAuthStateChanged(user) {
    if (!user) {
      // Not signed in — show login
      cleanupSnapshot();
      currentProfile = null;
      currentUniqueId = null;
      totpFailures = 0;

      // Check for recovery success message
      var recoveryMsg = sessionStorage.getItem('portal_recovery_success');
      if (recoveryMsg) {
        sessionStorage.removeItem('portal_recovery_success');
        showSection('login-section');
        showMessageModal('Recovery Complete', recoveryMsg);
        return;
      }

      // Check for pseudo-routes
      var hash = location.hash.slice(1);
      if (hash === 'no-account') {
        showSection('no-account-section');
      } else if (hash === 'recovery') {
        showSection('recovery-section');
      } else {
        showSection('login-section');
      }
      return;
    }

    // User is signed in — check profile
    showLoading();

    try {
      // Force token refresh to get latest claims
      await user.getIdToken(true);

      var res = await portalFetch('/api/portal/me');

      if (res.status === 403) {
        // TOTP required — check if enrolled or needs enrollment
        var errorBody = await res.json().catch(function () { return {}; });
        var errorMsg = errorBody.error || '';

        if (errorMsg === 'MFA required' || errorMsg === 'Re-verify TOTP') {
          // User has TOTP enrolled — show verification prompt
          showSection('totp-section');
          $('totp-code').value = '';
          $('totp-code').focus();
          return;
        }

        // Other 403 — show login
        await signOut();
        return;
      }

      if (res.status === 404) {
        // No ShyTalk account linked to this Firebase user
        await signOut();
        showSection('no-account-section');
        return;
      }

      if (!res.ok) {
        console.error('portal/me returned', res.status);
        showMessageModal('Error', 'Failed to load your account. Please try again.');
        showSection('login-section');
        return;
      }

      currentProfile = await res.json();
      currentUniqueId = currentProfile.uniqueId;

      // Check suspension
      if (currentProfile.isSuspended) {
        renderSuspension(currentProfile);
        return;
      }

      // Check if password user needs TOTP enrollment
      var providers = (user.providerData || []).map(function (p) { return p.providerId; });
      var isPasswordUser = providers.indexOf('password') !== -1;
      if (isPasswordUser && currentProfile.totpEnrolled === false) {
        // Needs enrollment — start setup
        await startTotpEnrollment();
        return;
      }

      // All good — show dashboard
      renderDashboard(currentProfile);
      setupRoleListener(currentUniqueId);

      // Navigate to stored deep link or current hash
      var storedHash = sessionStorage.getItem('portal_target_hash');
      if (storedHash) {
        sessionStorage.removeItem('portal_target_hash');
        location.hash = '#' + storedHash;
      } else {
        handleRoute();
      }

    } catch (err) {
      console.error('Auth state handling failed:', err);
      showMessageModal('Error', 'Something went wrong. Please try again.');
      showSection('login-section');
    }
  }

  // ─── Sign-In Flows ───────────────────────────────────────────

  async function signInWithEmail(email, password, rememberMe) {
    try {
      var persistence = rememberMe
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;

      await auth.setPersistence(persistence);
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      var message = 'Sign-in failed. Please check your credentials.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        message = 'Invalid email or password.';
      } else if (err.code === 'auth/too-many-requests') {
        message = 'Too many sign-in attempts. Please try again later.';
      } else if (err.code === 'auth/user-disabled') {
        message = 'This account has been disabled.';
      }
      throw new Error(message);
    }
  }

  async function signInWithGoogle() {
    try {
      var rememberMe = $('login-remember') && $('login-remember').checked;
      var persistence = rememberMe
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);

      var provider = new firebase.auth.GoogleAuthProvider();
      try {
        await auth.signInWithPopup(provider);
      } catch (popupErr) {
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
          // Fallback to redirect
          sessionStorage.setItem('portal_target_hash', location.hash.slice(1) || 'dashboard');
          await auth.signInWithRedirect(provider);
        } else if (popupErr.code !== 'auth/popup-closed-by-user') {
          throw popupErr;
        }
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Google sign-in failed:', err);
        showError('login-error', 'Google sign-in failed. Please try again.');
      }
    }
  }

  async function signInWithApple() {
    try {
      var rememberMe = $('login-remember') && $('login-remember').checked;
      var persistence = rememberMe
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);

      var provider = new firebase.auth.OAuthProvider('apple.com');
      try {
        await auth.signInWithPopup(provider);
      } catch (popupErr) {
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
          sessionStorage.setItem('portal_target_hash', location.hash.slice(1) || 'dashboard');
          await auth.signInWithRedirect(provider);
        } else if (popupErr.code !== 'auth/popup-closed-by-user') {
          throw popupErr;
        }
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Apple sign-in failed:', err);
        showError('login-error', 'Apple sign-in failed. Please try again.');
      }
    }
  }

  async function signOut() {
    cleanupSnapshot();
    try {
      if (auth && auth.currentUser) {
        await portalFetch('/api/portal/sign-out', { method: 'POST' }).catch(function () {});
      }
    } catch (_e) {
      // Best effort server-side sign-out
    }
    if (auth) {
      await auth.signOut();
    }
    currentProfile = null;
    currentUniqueId = null;
    totpFailures = 0;
    location.hash = '';
  }

  // ─── TOTP Enrollment ────────────────────────────────────────

  async function startTotpEnrollment() {
    showLoading();
    try {
      var res = await portalFetch('/api/portal/totp/setup', { method: 'POST' });

      if (res.status === 409) {
        // Already enrolled — show verification instead
        showSection('totp-section');
        $('totp-code').value = '';
        $('totp-code').focus();
        return;
      }

      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        showMessageModal('Error', errBody.error || 'Failed to start TOTP setup.');
        showSection('login-section');
        return;
      }

      var data = await res.json();

      // Clear previous QR code
      var qrContainer = $('enroll-qr');
      if (qrContainer) qrContainer.innerHTML = '';

      // Render QR code
      if (typeof QRCode !== 'undefined' && qrContainer) {
        new QRCode(qrContainer, {
          text: data.qrCodeUrl,
          width: 200,
          height: 200,
        });
      }

      // Set manual key
      var manualKey = $('enroll-manual-key');
      if (manualKey) manualKey.value = data.secret;

      // Show enrollment section
      showSection('enroll-section');
      hideError('enroll-error');
      $('enroll-code').value = '';
      $('enroll-code').focus();

    } catch (err) {
      console.error('TOTP setup failed:', err);
      showMessageModal('Error', 'Failed to start TOTP setup. Please try again.');
      showSection('login-section');
    }
  }

  async function confirmTotpEnrollment(code) {
    showLoading();
    try {
      var res = await portalFetch('/api/portal/totp/confirm-setup', {
        method: 'POST',
        body: { code: code },
      });

      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        showSection('enroll-section');

        if (res.status === 429) {
          showError('enroll-error', 'Too many attempts. Please start setup again.');
          disableButton($('enroll-confirm-btn'), 10000);
        } else if (res.status === 401) {
          showError('enroll-error', errBody.error || 'Invalid code. Please try again.');
        } else {
          showError('enroll-error', errBody.error || 'Verification failed.');
        }
        return;
      }

      // Success — refresh token and reload profile
      await auth.currentUser.getIdToken(true);

      var meRes = await portalFetch('/api/portal/me');
      if (meRes.ok) {
        currentProfile = await meRes.json();
        currentUniqueId = currentProfile.uniqueId;
        renderDashboard(currentProfile);
        setupRoleListener(currentUniqueId);
        handleRoute();
      } else {
        // Token refresh might not have propagated yet — sign out and re-login
        await signOut();
        showSection('login-section');
        showMessageModal('Setup Complete', 'Two-factor authentication enabled. Please sign in again.');
      }

    } catch (err) {
      console.error('TOTP confirm failed:', err);
      showSection('enroll-section');
      showError('enroll-error', 'Something went wrong. Please try again.');
    }
  }

  // ─── TOTP Verification ──────────────────────────────────────

  async function verifyTotp(code) {
    showLoading();
    try {
      var res = await portalFetch('/api/portal/totp/verify', {
        method: 'POST',
        body: { code: code },
      });

      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        showSection('totp-section');
        totpFailures++;

        if (res.status === 401) {
          showError('totp-error', errBody.error || 'Invalid code. Please try again.');
          var delay = totpFailures >= 3 ? Math.min(5000 * Math.pow(2, totpFailures - 3), 30000) : 5000;
          disableButton($('totp-verify-btn'), delay);
        } else if (res.status === 429) {
          showError('totp-error', 'Too many attempts. Please wait and try again.');
          disableButton($('totp-verify-btn'), 30000);
        } else {
          showError('totp-error', errBody.error || 'Verification failed.');
        }

        $('totp-code').value = '';
        $('totp-code').focus();
        return;
      }

      // Success — refresh token and load dashboard
      totpFailures = 0;
      await auth.currentUser.getIdToken(true);

      var meRes = await portalFetch('/api/portal/me');
      if (meRes.ok) {
        currentProfile = await meRes.json();
        currentUniqueId = currentProfile.uniqueId;
        renderDashboard(currentProfile);
        setupRoleListener(currentUniqueId);
        handleRoute();
      } else {
        showSection('totp-section');
        showError('totp-error', 'Session verification failed. Please try again.');
      }

    } catch (err) {
      console.error('TOTP verify failed:', err);
      showSection('totp-section');
      showError('totp-error', 'Something went wrong. Please try again.');
    }
  }

  // ─── TOTP Recovery ──────────────────────────────────────────

  async function sendRecoveryCode(email) {
    try {
      var res = await fetch(API_BASE + '/api/portal/totp-recovery/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });

      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        showError('recovery-error', errBody.error || 'Failed to send recovery code.');
        return;
      }

      // Show verify form regardless (anti-enumeration)
      hideError('recovery-error');
      $('recovery-send-form').hidden = true;
      $('recovery-verify-form').hidden = false;
      var msgEl = $('recovery-message');
      if (msgEl) {
        msgEl.textContent = t('recovery_code_sent');
        msgEl.hidden = false;
      }
      $('recovery-code').focus();

    } catch (err) {
      console.error('Recovery send failed:', err);
      showError('recovery-error', 'Failed to send recovery code. Please try again.');
    }
  }

  async function verifyRecoveryCode(email, code) {
    try {
      var res = await fetch(API_BASE + '/api/portal/totp-recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, code: code }),
      });

      var body = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        if (res.status === 429) {
          showError('recovery-error', 'Too many attempts. Please request a new code.');
        } else {
          showError('recovery-error', body.error || 'Invalid or expired code.');
        }
        return;
      }

      // Success — store message and redirect to login
      sessionStorage.setItem('portal_recovery_success', body.message || 'Authenticator removed. Sign in and set up a new one.');

      // Sign out if currently signed in, then go to login
      if (auth && auth.currentUser) {
        await auth.signOut();
      }
      location.hash = '';
      showSection('login-section');
      var msg = sessionStorage.getItem('portal_recovery_success');
      sessionStorage.removeItem('portal_recovery_success');
      showMessageModal('Recovery Complete', msg);

    } catch (err) {
      console.error('Recovery verify failed:', err);
      showError('recovery-error', 'Something went wrong. Please try again.');
    }
  }

  // ─── Suspension Screen ──────────────────────────────────────

  function renderSuspension(profile) {
    var reasonEl = $('suspended-reason');
    if (reasonEl && profile.suspensionReason) {
      reasonEl.textContent = t('suspended_reason_label') + ' ' + profile.suspensionReason;
    }

    var endDateEl = $('suspended-end-date');
    var endValueEl = $('suspended-end-value');
    if (endDateEl && endValueEl && profile.suspensionEndDate) {
      try {
        var date = new Date(profile.suspensionEndDate);
        endValueEl.textContent = date.toLocaleDateString(getCurrentLang(), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        endDateEl.hidden = false;
      } catch (_e) {
        endDateEl.hidden = true;
      }
    }

    showSection('suspended-section');
  }

  // ─── Dashboard Rendering ────────────────────────────────────

  function renderDashboard(profile) {
    // Welcome message
    var welcomeEl = $('dashboard-welcome');
    if (welcomeEl) {
      // Note: textContent assignment auto-escapes — escapeHtml here is
      // belt-and-braces but not strictly necessary (textContent is safe).
      welcomeEl.textContent = t('dashboard_welcome') + ', ' + (profile.displayName || t('default_user_name'));
    }

    // Panel cards (admin-only panels)
    var panelsGroup = $('panels-group');
    var panelsGrid = $('panels-grid');
    if (panelsGroup && panelsGrid) {
      panelsGrid.innerHTML = '';
      var hasAdminPanels = false;

      if (profile.isAdmin) {
        hasAdminPanels = true;
        var adminCard = document.createElement('a');
        adminCard.href = '/admin/';
        adminCard.className = 'dashboard-card';
        adminCard.innerHTML =
          '<div class="dashboard-card-icon" aria-hidden="true">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
            '</svg>' +
          '</div>' +
          '<span class="dashboard-card-label">Admin Panel</span>';
        panelsGrid.appendChild(adminCard);
      }

      panelsGroup.hidden = !hasAdminPanels;
    }

    // Profile section data
    renderProfileSection(profile);

    // Security section data
    renderSecuritySection(profile);

    showSection('dashboard-section');
  }

  function renderProfileSection(profile) {
    var avatarEl = $('profile-avatar');
    if (avatarEl) {
      if (profile.avatarUrl) {
        avatarEl.style.backgroundImage = 'url(' + escapeHtml(profile.avatarUrl) + ')';
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
      } else {
        // Show initials
        var initials = (profile.displayName || '?').charAt(0).toUpperCase();
        avatarEl.textContent = initials;
      }
    }

    var nameEl = $('profile-display-name');
    if (nameEl) nameEl.textContent = profile.displayName || '--';

    var idEl = $('profile-unique-id');
    if (idEl) idEl.textContent = profile.uniqueId || '--';

    var typeEl = $('profile-user-type');
    if (typeEl) {
      var typeMap = {
        'MEMBER': 'Member',
        'VIP': 'VIP',
        'MOD': 'Moderator',
        'ADMIN': 'Administrator',
      };
      typeEl.textContent = typeMap[profile.userType] || profile.userType || '--';
    }
  }

  function renderSecuritySection(profile) {
    var user = auth.currentUser;
    if (!user) return;

    var providers = (user.providerData || []).map(function (p) { return p.providerId; });
    var isPasswordUser = providers.indexOf('password') !== -1;

    // Password card — only for password users
    var passwordCard = $('security-password-card');
    if (passwordCard) {
      passwordCard.hidden = !isPasswordUser;
    }

    // TOTP status
    var totpStatusEl = $('security-totp-status');
    var totpBtn = $('security-totp-btn');
    var totpBtnLabel = $('security-totp-btn-label');

    if (totpStatusEl && totpBtn && totpBtnLabel) {
      if (!isPasswordUser) {
        totpStatusEl.textContent = t('security_totp_managed');
        totpBtn.hidden = true;
      } else if (profile.totpEnrolled) {
        totpStatusEl.textContent = t('security_totp_enabled');
        totpBtnLabel.textContent = t('security_totp_btn_reset');
        totpBtn.hidden = false;
        totpBtn.className = 'btn btn--danger btn--small';
      } else {
        totpStatusEl.textContent = t('security_totp_disabled');
        totpBtnLabel.textContent = t('security_totp_btn_enable');
        totpBtn.hidden = false;
        totpBtn.className = 'btn btn--primary btn--small';
      }
    }

    // Linked providers list
    var providersList = $('security-providers-list');
    if (providersList) {
      providersList.innerHTML = '';
      var providerNames = {
        'password': 'Email & Password',
        'google.com': 'Google',
        'apple.com': 'Apple',
      };
      providers.forEach(function (pid) {
        var li = document.createElement('li');
        li.className = 'provider-item';
        li.textContent = providerNames[pid] || pid;
        providersList.appendChild(li);
      });
    }
  }

  // ─── Hash Router ─────────────────────────────────────────────

  function handleRoute() {
    // Only route if user is authenticated and has a profile
    if (!currentProfile) return;

    var hash = location.hash.slice(1);

    // Empty hash or invalid → default to dashboard
    if (!hash || !VALID_ROUTES.has(hash)) {
      location.hash = '#dashboard';
      return;
    }

    showSection(hash + '-section');
  }

  // ─── onSnapshot for Role Revocation ──────────────────────────

  function setupRoleListener(uniqueId) {
    if (!db || !uniqueId) return;

    cleanupSnapshot();

    try {
      unsubSnapshot = db.doc('users/' + uniqueId).onSnapshot(function (doc) {
        var data = doc.data();
        if (data && data.roleChanged) {
          var roleChangedMs = typeof data.roleChanged.toMillis === 'function'
            ? data.roleChanged.toMillis()
            : (data.roleChanged instanceof Date ? data.roleChanged.getTime() : 0);

          if (roleChangedMs > sessionStartTime) {
            signOut().then(function () {
              showMessageModal('Session Ended', 'Your account permissions have changed. Please sign in again.');
            });
          }
        }
      }, function (err) {
        console.error('Snapshot listener error:', err);
        cleanupSnapshot();
      });
    } catch (err) {
      console.error('Failed to set up role listener:', err);
    }
  }

  function cleanupSnapshot() {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  }

  // Pause/resume snapshot on visibility change (Firestore quota saving)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && unsubSnapshot) {
      cleanupSnapshot();
    } else if (!document.hidden && currentUniqueId && currentProfile && !currentProfile.isSuspended) {
      setupRoleListener(currentUniqueId);
    }
  });

  // ─── Re-Auth Modal ──────────────────────────────────────────

  function showReauthModal() {
    return new Promise(function (resolve, reject) {
      var user = auth.currentUser;
      if (!user) {
        reject(new Error('Not signed in'));
        return;
      }

      var providers = (user.providerData || []).map(function (p) { return p.providerId; });
      var isPasswordUser = providers.indexOf('password') !== -1;

      if (!isPasswordUser) {
        // OAuth user — re-auth with popup
        var providerId = providers[0];
        var provider;
        if (providerId === 'google.com') {
          provider = new firebase.auth.GoogleAuthProvider();
        } else if (providerId === 'apple.com') {
          provider = new firebase.auth.OAuthProvider('apple.com');
        } else {
          reject(new Error('Unknown provider'));
          return;
        }

        user.reauthenticateWithPopup(provider)
          .then(function () { resolve(); })
          .catch(function (err) { reject(err); });
        return;
      }

      // Password user — show TOTP modal
      pendingReauthResolve = resolve;
      pendingReauthReject = reject;

      var modal = $('reauth-modal');
      var codeInput = $('reauth-totp-code');
      hideError('reauth-error');
      if (codeInput) codeInput.value = '';
      if (modal) modal.hidden = false;
      if (codeInput) codeInput.focus();
    });
  }

  function hideReauthModal() {
    var modal = $('reauth-modal');
    if (modal) modal.hidden = true;
    pendingReauthResolve = null;
    pendingReauthReject = null;
  }

  // ─── Security Actions ───────────────────────────────────────

  async function handleChangePassword() {
    var user = auth.currentUser;
    if (!user || !user.email) return;

    try {
      await firebase.auth().sendPasswordResetEmail(user.email);
      showMessageModal('Password Reset', 'A password reset email has been sent to ' + escapeHtml(user.email) + '.');
    } catch (err) {
      console.error('Password reset failed:', err);
      showMessageModal('Error', 'Failed to send password reset email. Please try again.');
    }
  }

  async function handleTotpAction() {
    if (!currentProfile) return;

    if (currentProfile.totpEnrolled) {
      // Reset 2FA — requires re-auth with current TOTP code
      try {
        await showReauthModal();

        // After re-auth, get the TOTP code that was entered
        var totpCode = $('reauth-totp-code') ? $('reauth-totp-code').value : '';
        if (!totpCode || !/^\d{6}$/.test(totpCode)) {
          showMessageModal('Error', 'Please enter a valid 6-digit code.');
          return;
        }

        showLoading();
        var res = await portalFetch('/api/portal/totp', {
          method: 'DELETE',
          body: { totpCode: totpCode },
        });

        if (!res.ok) {
          var errBody = await res.json().catch(function () { return {}; });
          showMessageModal('Error', errBody.error || 'Failed to reset 2FA.');
          // Re-render the current section
          if (currentProfile) {
            renderDashboard(currentProfile);
            location.hash = '#security';
          }
          return;
        }

        // Success — sign out and re-login
        await signOut();
        showSection('login-section');
        showMessageModal('2FA Reset', 'Two-factor authentication has been removed. Please sign in and set up a new authenticator.');

      } catch (err) {
        if (err && err.code === 'auth/popup-closed-by-user') return;
        console.error('2FA reset failed:', err);
        if (currentProfile) {
          renderDashboard(currentProfile);
          location.hash = '#security';
        }
      }
    } else {
      // Enable 2FA — start enrollment
      await startTotpEnrollment();
    }
  }

  async function handleRevokeAllSessions() {
    var user = auth.currentUser;
    if (!user) return;

    var providers = (user.providerData || []).map(function (p) { return p.providerId; });
    var isPasswordUser = providers.indexOf('password') !== -1;

    try {
      if (isPasswordUser && currentProfile && currentProfile.totpEnrolled) {
        // Need TOTP code
        await showReauthModal();
        var totpCode = $('reauth-totp-code') ? $('reauth-totp-code').value : '';
        if (!totpCode || !/^\d{6}$/.test(totpCode)) {
          showMessageModal('Error', 'Please enter a valid 6-digit code.');
          return;
        }

        showLoading();
        var res = await portalFetch('/api/portal/revoke-all-sessions', {
          method: 'POST',
          body: { totpCode: totpCode },
        });

        if (!res.ok) {
          var errBody = await res.json().catch(function () { return {}; });
          showMessageModal('Error', errBody.error || 'Failed to revoke sessions.');
          if (currentProfile) {
            renderDashboard(currentProfile);
            location.hash = '#security';
          }
          return;
        }
      } else {
        // OAuth user or no TOTP — just revoke
        showLoading();
        var resOAuth = await portalFetch('/api/portal/revoke-all-sessions', {
          method: 'POST',
        });
        if (!resOAuth.ok) {
          var errBodyOAuth = await resOAuth.json().catch(function () { return {}; });
          showMessageModal('Error', errBodyOAuth.error || 'Failed to revoke sessions.');
          if (currentProfile) {
            renderDashboard(currentProfile);
            location.hash = '#security';
          }
          return;
        }
      }

      // Sign out locally
      await signOut();
      showSection('login-section');
      showMessageModal('Sessions Revoked', 'All sessions have been signed out. Please sign in again.');

    } catch (err) {
      if (err && err.code === 'auth/popup-closed-by-user') return;
      console.error('Revoke all sessions failed:', err);
      if (currentProfile) {
        renderDashboard(currentProfile);
        location.hash = '#security';
      }
    }
  }

  async function handleDataExport() {
    showMessageModal('Data Export', 'Data export is coming soon. Please contact support at support@shytalk.dev for a copy of your data.');
  }

  async function handleDeleteAccount() {
    if (!confirm('Are you sure you want to permanently delete your account? This action cannot be undone.')) {
      return;
    }
    showMessageModal('Account Deletion', 'Account deletion is coming soon. Please contact support at support@shytalk.dev to request account deletion.');
  }

  // ─── Event Listeners ────────────────────────────────────────

  function bindEvents() {
    // Login form
    var loginForm = $('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('login-error');
        var email = $('login-email').value.trim();
        var password = $('login-password').value;
        var rememberMe = $('login-remember') && $('login-remember').checked;

        if (!email || !password) {
          showError('login-error', 'Please enter your email and password.');
          return;
        }

        var submitBtn = $('login-submit-btn');
        if (submitBtn) submitBtn.disabled = true;

        signInWithEmail(email, password, rememberMe)
          .catch(function (err) {
            showError('login-error', err.message);
          })
          .finally(function () {
            if (submitBtn) submitBtn.disabled = false;
          });
      });
    }

    // Google sign-in
    var googleBtn = $('google-signin-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', function () {
        hideError('login-error');
        signInWithGoogle();
      });
    }

    // Apple sign-in
    var appleBtn = $('apple-signin-btn');
    if (appleBtn) {
      appleBtn.addEventListener('click', function () {
        hideError('login-error');
        signInWithApple();
      });
    }

    // TOTP verification form
    var totpForm = $('totp-form');
    if (totpForm) {
      totpForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('totp-error');
        var code = $('totp-code').value.trim();
        if (!code || !/^\d{6}$/.test(code)) {
          showError('totp-error', 'Please enter a 6-digit code.');
          return;
        }
        verifyTotp(code);
      });
    }

    // "Lost your authenticator?" link
    var totpLostLink = document.querySelector('a[href="#recovery"]');
    if (totpLostLink) {
      totpLostLink.addEventListener('click', function (e) {
        e.preventDefault();
        // Sign out first so user can use recovery flow
        if (auth && auth.currentUser) {
          auth.signOut().then(function () {
            showSection('recovery-section');
            resetRecoveryForm();
          });
        } else {
          showSection('recovery-section');
          resetRecoveryForm();
        }
      });
    }

    // TOTP enrollment form
    var enrollForm = $('enroll-form');
    if (enrollForm) {
      enrollForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('enroll-error');
        var code = $('enroll-code').value.trim();
        if (!code || !/^\d{6}$/.test(code)) {
          showError('enroll-error', 'Please enter a 6-digit code.');
          return;
        }
        confirmTotpEnrollment(code);
      });
    }

    // Copy manual key
    var copyBtn = $('enroll-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var key = $('enroll-manual-key');
        if (key && key.value) {
          navigator.clipboard.writeText(key.value).then(function () {
            copyBtn.textContent = t('copy_feedback_copied');
            setTimeout(function () {
              copyBtn.textContent = t('enroll_copy');
            }, 2000);
          }).catch(function () {
            // Fallback: select the input
            key.select();
          });
        }
      });
    }

    // Recovery send form
    var recoverySendForm = $('recovery-send-form');
    if (recoverySendForm) {
      recoverySendForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('recovery-error');
        var email = $('recovery-email').value.trim();
        if (!email) {
          showError('recovery-error', 'Please enter your email address.');
          return;
        }
        var sendBtn = $('recovery-send-btn');
        if (sendBtn) sendBtn.disabled = true;
        sendRecoveryCode(email).finally(function () {
          if (sendBtn) sendBtn.disabled = false;
        });
      });
    }

    // Recovery verify form
    var recoveryVerifyForm = $('recovery-verify-form');
    if (recoveryVerifyForm) {
      recoveryVerifyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('recovery-error');
        var email = $('recovery-email').value.trim();
        var code = $('recovery-code').value.trim();
        if (!code) {
          showError('recovery-error', 'Please enter the recovery code.');
          return;
        }
        var verifyBtn = $('recovery-verify-btn');
        if (verifyBtn) verifyBtn.disabled = true;
        verifyRecoveryCode(email, code).finally(function () {
          if (verifyBtn) verifyBtn.disabled = false;
        });
      });
    }

    // "Back to sign in" link on recovery
    var recoveryBackLink = document.querySelector('#recovery-section a[href="#login"]');
    if (recoveryBackLink) {
      recoveryBackLink.addEventListener('click', function (e) {
        e.preventDefault();
        showSection('login-section');
        resetRecoveryForm();
        location.hash = '';
      });
    }

    // "Back to sign in" link on no-account
    var noAccountBackLink = document.querySelector('#no-account-section a[href="#login"]');
    if (noAccountBackLink) {
      noAccountBackLink.addEventListener('click', function (e) {
        e.preventDefault();
        showSection('login-section');
        location.hash = '';
      });
    }

    // "Don't have an account?" → download link
    var downloadLink = document.querySelector('#login-section a[href="#no-account"]');
    if (downloadLink) {
      downloadLink.addEventListener('click', function (e) {
        e.preventDefault();
        showSection('no-account-section');
      });
    }

    // Dashboard sign-out
    var signOutBtn = $('dashboard-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', function () {
        signOut();
      });
    }

    // Suspended sign-out
    var suspendedSignOutBtn = $('suspended-signout-btn');
    if (suspendedSignOutBtn) {
      suspendedSignOutBtn.addEventListener('click', function () {
        signOut();
      });
    }

    // Suspended appeal
    var appealBtn = $('suspended-appeal-btn');
    if (appealBtn) {
      appealBtn.addEventListener('click', function () {
        showMessageModal('Submit an Appeal', 'To appeal your suspension, please contact support at support@shytalk.dev with your account details.');
      });
    }

    // Suspended contact
    var contactLink = $('suspended-contact-link');
    if (contactLink) {
      contactLink.addEventListener('click', function (e) {
        e.preventDefault();
        window.open('mailto:support@shytalk.dev', '_blank');
      });
    }

    // Security: change password
    var changePasswordBtn = $('security-change-password-btn');
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', handleChangePassword);
    }

    // Security: TOTP action
    var totpBtn = $('security-totp-btn');
    if (totpBtn) {
      totpBtn.addEventListener('click', handleTotpAction);
    }

    // Security: revoke all sessions
    var revokeBtn = $('security-revoke-btn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', handleRevokeAllSessions);
    }

    // Data: export
    var exportBtn = $('data-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', handleDataExport);
    }

    // Data: delete account
    var deleteBtn = $('data-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', handleDeleteAccount);
    }

    // Re-auth modal: confirm
    var reauthForm = $('reauth-form');
    if (reauthForm) {
      reauthForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('reauth-error');
        var code = $('reauth-totp-code').value.trim();
        if (!code || !/^\d{6}$/.test(code)) {
          showError('reauth-error', 'Please enter a valid 6-digit code.');
          return;
        }
        hideReauthModal();
        if (pendingReauthResolve) pendingReauthResolve(code);
      });
    }

    // Re-auth modal: cancel
    var reauthCancelBtn = $('reauth-cancel-btn');
    if (reauthCancelBtn) {
      reauthCancelBtn.addEventListener('click', function () {
        hideReauthModal();
        if (pendingReauthReject) pendingReauthReject(new Error('Re-auth cancelled'));
      });
    }

    // Message modal: close
    var messageCloseBtn = $('message-modal-close-btn');
    if (messageCloseBtn) {
      messageCloseBtn.addEventListener('click', hideMessageModal);
    }

    // Close modals on overlay click
    var reauthModal = $('reauth-modal');
    if (reauthModal) {
      reauthModal.addEventListener('click', function (e) {
        if (e.target === reauthModal) {
          hideReauthModal();
          if (pendingReauthReject) pendingReauthReject(new Error('Re-auth cancelled'));
        }
      });
    }

    var messageModal = $('message-modal');
    if (messageModal) {
      messageModal.addEventListener('click', function (e) {
        if (e.target === messageModal) {
          hideMessageModal();
        }
      });
    }

    // Close modals on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('reauth-modal').hidden) {
          hideReauthModal();
          if (pendingReauthReject) pendingReauthReject(new Error('Re-auth cancelled'));
        }
        if (!$('message-modal').hidden) {
          hideMessageModal();
        }
      }
    });

    // Hash router
    window.addEventListener('hashchange', function () {
      var hash = location.hash.slice(1);

      // Handle pseudo-routes (login, no-account, recovery) when not authenticated
      if (!currentProfile) {
        if (hash === 'no-account') {
          showSection('no-account-section');
        } else if (hash === 'recovery') {
          showSection('recovery-section');
          resetRecoveryForm();
        } else if (hash === 'login' || hash === '') {
          showSection('login-section');
        }
        return;
      }

      // Authenticated — handle valid routes
      handleRoute();
    });

    // Auto-format TOTP code inputs (strip non-numeric, limit to 6)
    var codeInputs = document.querySelectorAll('.input--totp');
    for (var i = 0; i < codeInputs.length; i++) {
      codeInputs[i].addEventListener('input', function () {
        this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
      });
    }
  }

  function resetRecoveryForm() {
    var sendForm = $('recovery-send-form');
    var verifyForm = $('recovery-verify-form');
    var msgEl = $('recovery-message');
    if (sendForm) sendForm.hidden = false;
    if (verifyForm) verifyForm.hidden = true;
    if (msgEl) msgEl.hidden = true;
    hideError('recovery-error');
    var emailInput = $('recovery-email');
    if (emailInput) emailInput.value = '';
    var codeInput = $('recovery-code');
    if (codeInput) codeInput.value = '';
  }

  // ─── Initialize ──────────────────────────────────────────────

  function init() {
    showLoading();
    bindEvents();
    initFirebase();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
