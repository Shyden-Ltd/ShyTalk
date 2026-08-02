/**
 * SHY-0267 — the /events host panel.
 *
 * j16 has asserted this page since it was written and it did not exist, so every
 * scenario touching it failed and blamed the app.
 *
 * ALL DATA COMES FROM THE API. The page never reads Firestore directly — that is
 * the hard global rule (clients → Express only). Here it is also the only way the
 * cohort boundary on the roster can be enforced: the server refuses a
 * cross-cohort member from a VERIFIED claim, and answers 404 rather than 403 so
 * the refusal does not confirm that the other person exists. A client-side check
 * would be the client asserting its own cohort.
 */
(function () {
  'use strict';

  var API_BASE = (window.SHYTALK_CONFIG && window.SHYTALK_CONFIG.apiBase) || '';
  var auth = null;
  var selectedEventId = null;

  function show(id) {
    ['ev-loading', 'ev-signin', 'ev-error', 'ev-panel'].forEach(function (section) {
      var el = document.getElementById(section);
      if (el) el.hidden = section !== id;
    });
  }

  function el(id) {
    return document.getElementById(id);
  }

  /** Authenticated call. Throws on failure — an empty result is NOT an error. */
  function api(path, options) {
    var opts = options || {};
    return auth.currentUser.getIdToken().then(function (token) {
      var headers = { Authorization: 'Bearer ' + token };
      if (opts.body) headers['Content-Type'] = 'application/json';
      return fetch(API_BASE + '/api' + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) {
            var err = new Error((body && body.error) || 'Request failed');
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
    });
  }

  /** Plain-text row. textContent, never innerHTML — these are user-chosen names. */
  function row(text, testId) {
    var li = document.createElement('li');
    li.className = 'ev-row';
    li.textContent = text;
    if (testId) li.setAttribute('data-testid', testId);
    return li;
  }

  function renderEvents(events) {
    var list = el('ev-list');
    list.textContent = '';
    el('ev-empty').hidden = events.length > 0;

    events.forEach(function (event) {
      var li = document.createElement('li');
      li.className = 'ev-row';
      // Per event, so a scenario naming "Saturday Showcase" finds that row and
      // not whichever rendered first.
      li.setAttribute('data-testid', 'eventHost_event_' + event.eventId);

      var title = document.createElement('span');
      title.textContent = event.title + ' — ' + event.state;
      li.appendChild(title);

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--small';
      open.textContent = 'Open';
      open.setAttribute('data-testid', 'eventHost_open_' + event.eventId);
      open.addEventListener('click', function () {
        selectEvent(event.eventId);
      });
      li.appendChild(open);

      list.appendChild(li);
    });
  }

  /**
   * The roster with each member's ANSWER.
   *
   * j16 asserts Tariq sees Selma as "Declined". A list of names without answers
   * is a list of people who might not turn up, and the host finds out when the
   * doors open.
   */
  function renderRoster(event) {
    var panel = el('ev-roster-panel');
    var list = el('ev-roster-list');
    list.textContent = '';

    var states = {};
    (event.rosterStates || []).forEach(function (entry) {
      states[entry.uniqueId] = entry.status;
    });

    (event.roster || []).forEach(function (uniqueId) {
      var status = states[uniqueId] || 'PENDING';
      var label =
        status === 'ACCEPTED' ? 'Accepted' : status === 'DECLINED' ? 'Declined' : 'Waiting';
      var li = row(uniqueId + ': ' + label, 'eventHost_rosterMember_' + uniqueId);
      var badge = document.createElement('span');
      badge.className = 'ev-status';
      badge.textContent = label;
      badge.setAttribute('data-testid', 'eventHost_rosterStatus_' + uniqueId);
      li.appendChild(badge);
      list.appendChild(li);
    });

    panel.hidden = (event.roster || []).length === 0;
  }

  function renderTotals(summary) {
    el('eventHost_giftCount').textContent = String(summary.giftCount || 0);
    el('eventHost_coinTotal').textContent = String(summary.coinTotal || 0);
    el('eventHost_beanTotal').textContent = String(summary.beanTotal || 0);
    var hasTop = Boolean(summary.topContributorId);
    el('eventHost_topContributorRow').hidden = !hasTop;
    if (hasTop) el('eventHost_topContributor').textContent = summary.topContributorId;
    el('ev-totals').hidden = false;
  }

  function renderClosedSummary(summary) {
    el('eventSummary_totals').textContent =
      (summary.giftCount || 0) +
      ' gifts · ' +
      (summary.coinTotal || 0) +
      ' coins · ' +
      (summary.beanTotal || 0) +
      ' beans';
    var list = el('eventSummary_performers');
    list.textContent = '';
    (summary.perPerformer || []).forEach(function (line) {
      // Per performer, so an assertion about Selma's beans cannot be satisfied
      // by Theo's row.
      list.appendChild(
        row(
          line.uniqueId + ': ' + (line.beanTotal || 0) + ' beans',
          'eventSummary_performer_' + line.uniqueId,
        ),
      );
    });
    el('eventSummary_panel').hidden = false;
  }

  function selectEvent(eventId) {
    selectedEventId = eventId;
    api('/events/' + encodeURIComponent(eventId))
      .then(function (body) {
        renderRoster(body.event || {});
        return api('/events/' + encodeURIComponent(eventId) + '/summary');
      })
      .then(function (body) {
        var summary = body.summary || {};
        renderTotals(summary);
        // A CLOSED event shows the recap rather than live totals; the two are
        // different screens for the same numbers because one is still moving.
        if (summary.closed) renderClosedSummary(summary);
      })
      .catch(function () {
        // Selecting is a secondary action. Failing it must not blow away the
        // list the host already has.
        el('ev-roster-panel').hidden = true;
      });
  }

  function submitSchedule(e) {
    e.preventDefault();
    var error = el('scheduleEvent_error');
    error.hidden = true;

    var roster = el('scheduleEvent_roster')
      .value.split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);

    var startsAtLocal = el('scheduleEvent_startsAt').value;
    api('/events', {
      method: 'POST',
      body: {
        title: el('scheduleEvent_title').value.trim(),
        // The input is local time; the API takes ISO-8601. Sending the raw
        // local string would schedule the show in whatever timezone the server
        // happened to assume.
        startsAt: startsAtLocal ? new Date(startsAtLocal).toISOString() : '',
        durationMin: Number(el('scheduleEvent_durationMin').value) || 60,
        roster: roster,
      },
    })
      .then(function () {
        el('ev-form').hidden = true;
        return load();
      })
      .catch(function (err) {
        // The server's own message, shown verbatim. A cross-cohort roster member
        // comes back as "User not found" — deliberately identical to a genuinely
        // missing id, because a distinct message would confirm the minor exists.
        error.textContent = err.status === 404 ? 'User not found' : err.message;
        error.hidden = false;
      });
  }

  function load() {
    show('ev-loading');
    return api('/events/mine')
      .then(function (body) {
        renderEvents((body.hosting || []).concat(body.performing || []));
        // Pre-fill the roster from the host's standing team. Retyping the same
        // four ids before every show is how a performer gets left off one.
        var rosterInput = el('scheduleEvent_roster');
        if (rosterInput && !rosterInput.value && (body.teamRoster || []).length) {
          rosterInput.value = body.teamRoster.join(', ');
        }
        show('ev-panel');
        if (selectedEventId) selectEvent(selectedEventId);
      })
      .catch(function () {
        // A thrown request is NOT an empty schedule. Rendering zero events here
        // would tell the host something false about their own night.
        el('ev-error-detail').textContent =
          "We couldn't reach your events. Check your connection and try again.";
        show('ev-error');
      });
  }

  function init() {
    var retry = el('ev-retry');
    if (retry) retry.addEventListener('click', load);

    var newEvent = el('schedule_newEventButton');
    if (newEvent) {
      newEvent.addEventListener('click', function () {
        var form = el('ev-form');
        form.hidden = !form.hidden;
      });
    }

    var form = el('ev-form');
    if (form) form.addEventListener('submit', submitSchedule);

    if (!window.firebase || !window.SHYTALK_CONFIG) {
      el('ev-error-detail').textContent = 'The page could not start. Please reload.';
      show('ev-error');
      return;
    }
    // A throw here would otherwise leave the spinner running forever, with no
    // error and no retry — indistinguishable from a slow network.
    try {
      firebase.initializeApp(window.SHYTALK_CONFIG.firebase);
      auth = firebase.auth();
      if (window.SHYTALK_CONFIG.authEmulatorUrl) {
        auth.useEmulator(window.SHYTALK_CONFIG.authEmulatorUrl, { disableWarnings: true });
      }
      auth.onAuthStateChanged(function (user) {
        if (user) load();
        else show('ev-signin');
      });
    } catch (e) {
      el('ev-error-detail').textContent = 'The page could not start. Please reload.';
      show('ev-error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
