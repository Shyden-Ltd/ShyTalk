/**
 * SHY-0265 — the /leaderboard page.
 *
 * j05 has asserted this page since it was written and it did not exist, so the
 * scenario failed every run and blamed the app.
 *
 * ALL DATA COMES FROM THE API. The page never reads Firestore directly — that is
 * the hard global rule (clients → Express only), and here it also happens to be
 * the only way the cohort boundary can be enforced: the server decides which
 * cohort's rows the caller may see, from a verified claim. A client-side query
 * would be a client asserting its own cohort.
 */
(function () {
  'use strict';

  var API_BASE = (window.SHYTALK_CONFIG && window.SHYTALK_CONFIG.apiBase) || '';
  var auth = null;

  function show(id) {
    ['lb-loading', 'lb-signin', 'lb-error', 'lb-board'].forEach(function (section) {
      var el = document.getElementById(section);
      if (el) el.hidden = section !== id;
    });
  }

  /** Locale-aware, because a leaderboard of "12345" reads differently by region. */
  function formatAmount(n) {
    try {
      return new Intl.NumberFormat(navigator.language || 'en').format(Number(n) || 0);
    } catch (e) {
      return String(n);
    }
  }

  function renderRows(rows, myId) {
    var tbody = document.getElementById('lb-rows');
    tbody.textContent = '';
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      // The caller's own row is marked so they can find themselves without
      // reading a hundred names.
      if (row.uniqueId === myId) tr.className = 'lb-row--me';

      var rank = document.createElement('td');
      rank.textContent = String(row.rank);
      var name = document.createElement('td');
      // textContent, never innerHTML: a display name is user-controlled input
      // and this page renders other people's.
      name.textContent = row.displayName;
      var amount = document.createElement('td');
      amount.textContent = formatAmount(row.amount);

      tr.appendChild(rank);
      tr.appendChild(name);
      tr.appendChild(amount);
      tbody.appendChild(tr);
    });
    document.getElementById('lb-empty').hidden = rows.length > 0;
  }

  function renderMe(me) {
    var box = document.getElementById('lb-me');
    if (!me) {
      box.hidden = true;
      return;
    }
    // `rank: null` means unranked, which is a FACT worth showing — not an error
    // and not a zero. Showing "—" says "you are not on the board" rather than
    // leaving the user unsure whether the page failed.
    document.getElementById('lb-me-rank').textContent = me.rank === null ? '—' : String(me.rank);
    document.getElementById('lb-me-name').textContent = me.displayName;
    document.getElementById('lb-me-amount').textContent = formatAmount(me.amount);
    box.hidden = false;
  }

  async function load() {
    show('lb-loading');
    try {
      var token = await auth.currentUser.getIdToken();
      var res = await fetch(API_BASE + '/api/economy/leaderboards', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.status === 401) {
        show('lb-signin');
        return;
      }
      if (!res.ok) {
        // A suspended caller gets 403 here. Saying so beats a generic failure —
        // they can act on it, and it is not a transient they should retry.
        document.getElementById('lb-error-detail').textContent =
          res.status === 403
            ? 'Your account cannot view the leaderboard right now.'
            : "We couldn't load the leaderboard just now.";
        show('lb-error');
        return;
      }
      var body = await res.json();
      var rows = Array.isArray(body.rows) ? body.rows : [];
      renderRows(rows, body.me && body.me.uniqueId);
      renderMe(body.me);
      var note = document.getElementById('lb-cohort-note');
      if (note && rows.length) note.textContent = 'Top gifters in your cohort';
      show('lb-board');
    } catch (e) {
      // A thrown request is NOT an empty leaderboard. Rendering zero rows here
      // would state something false about other users and give this user no
      // reason to retry.
      document.getElementById('lb-error-detail').textContent =
        "We couldn't reach the leaderboard. Check your connection and try again.";
      show('lb-error');
    }
  }

  function init() {
    var retry = document.getElementById('lb-retry');
    if (retry) retry.addEventListener('click', load);

    if (!window.firebase || !window.SHYTALK_CONFIG) {
      document.getElementById('lb-error-detail').textContent =
        'The page could not start. Please reload.';
      show('lb-error');
      return;
    }
    // A THROW HERE USED TO LEAVE THE SPINNER RUNNING FOREVER.
    //
    // `initializeApp` rejects a malformed or missing config, and the exception
    // escaped `init()` — so the page sat on its loading state with no error, no
    // retry and no way for the user to tell it apart from a slow network. A
    // page that hangs is worse than one that admits it failed: the second at
    // least offers a next step.
    try {
      firebase.initializeApp(window.SHYTALK_CONFIG.firebase);
      auth = firebase.auth();
      if (window.SHYTALK_CONFIG.authEmulatorUrl) {
        auth.useEmulator(window.SHYTALK_CONFIG.authEmulatorUrl, { disableWarnings: true });
      }
      auth.onAuthStateChanged(function (user) {
        if (user) load();
        else show('lb-signin');
      });
    } catch (e) {
      document.getElementById('lb-error-detail').textContent =
        'The page could not start. Please reload.';
      show('lb-error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
