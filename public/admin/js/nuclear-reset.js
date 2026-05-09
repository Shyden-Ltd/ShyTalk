/**
 * Nuclear Reset overlay — runs ALL maintenance actions sequentially.
 *
 * Provides a 3-step confirmation flow with air-raid siren audio,
 * particle effects, shaking dialog, and a progress bar.
 *
 * Extracted from inline script block in index.html (PR C).
 */

import { escapeHtml } from '/js/core/ui.js';

// ── Dependencies ──────────────────────────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);
let _auth = null;
let _initialised = false;

// ── Public API ────────────────────────────────────────────────────

export function init(deps) {
  _apiBase = deps.apiBase || '';
  _getToken = deps.getToken;
  _auth = deps.auth;

  // Idempotent — init() runs from onAuthStateChanged in main.js, which
  // fires on every sign-in / sign-out → sign-in cycle. Without this
  // guard, every destructive nuclear-reset overlay button would
  // accumulate one extra click listener per cycle, so a single click
  // on "RESET EVERYTHING" would dispatch N parallel reset runs. See
  // tests/web/admin-init-idempotency.spec.ts.
  if (_initialised) return;
  _initialised = true;

  document.getElementById('reset-all-btn').addEventListener('click', () => {
    document.getElementById('reset-all-result').style.display = 'none';
    openOverlay();
  });

  document.getElementById('nuclear-cancel').addEventListener('click', dismissOverlay);
  document.getElementById('nuclear-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('nuclear-overlay')) dismissOverlay();
  });

  document.getElementById('nuclear-confirm-input').addEventListener('input', () => {
    document.getElementById('nuclear-proceed').disabled =
      document.getElementById('nuclear-confirm-input').value !== CONFIRM_PHRASE;
  });

  document.getElementById('nuclear-mute').addEventListener('click', () => {
    soundMuted = !soundMuted;
    document.getElementById('nuclear-mute').textContent = soundMuted ? 'Unmute' : 'Mute';
    if (soundMuted) { stopBeep(); stopSiren(); }
  });

  document.getElementById('nuclear-proceed').addEventListener('click', handleNuclearProceed);
}

// ── State ─────────────────────────────────────────────────────────

const CONFIRM_PHRASE = 'RESET EVERYTHING';
let step = 0;
let executing = false;
let soundMuted = false;

// ── Web Audio: warning beep (confirmation steps) ──────────────────

let beepCtx = null;
let beepInterval = null;

function startBeep() {
  if (beepCtx || soundMuted) return;
  beepCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone() {
    if (!beepCtx) return;
    const osc = beepCtx.createOscillator();
    const gain = beepCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, beepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(beepCtx.destination);
    osc.start(beepCtx.currentTime);
    osc.stop(beepCtx.currentTime + 0.15);
  }
  playTone();
  beepInterval = setInterval(playTone, 800);
}

function stopBeep() {
  if (beepInterval) { clearInterval(beepInterval); beepInterval = null; }
  if (beepCtx) { beepCtx.close(); beepCtx = null; }
}

// ── Web Audio: siren (execution phase) ────────────────────────────

let sirenCtx = null;
let sirenGain = null;
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenLfo = null;

function startSiren() {
  if (sirenCtx || soundMuted) return;
  sirenCtx = new (window.AudioContext || window.webkitAudioContext)();
  sirenGain = sirenCtx.createGain();
  sirenGain.gain.value = 0.18;
  sirenGain.connect(sirenCtx.destination);

  sirenOsc1 = sirenCtx.createOscillator();
  sirenOsc1.type = 'sawtooth';
  sirenOsc1.frequency.value = 400;
  const now = sirenCtx.currentTime;
  for (let i = 0; i < 60; i++) {
    const t = now + i * 3;
    sirenOsc1.frequency.linearRampToValueAtTime(900, t + 1.5);
    sirenOsc1.frequency.linearRampToValueAtTime(400, t + 3);
  }
  sirenOsc1.connect(sirenGain);
  sirenOsc1.start();

  sirenOsc2 = sirenCtx.createOscillator();
  sirenOsc2.type = 'sine';
  sirenOsc2.frequency.value = 55;
  const gain2 = sirenCtx.createGain();
  gain2.gain.value = 0.15;
  sirenOsc2.connect(gain2);
  gain2.connect(sirenCtx.destination);

  sirenLfo = sirenCtx.createOscillator();
  sirenLfo.frequency.value = 0.5;
  const lfoGain = sirenCtx.createGain();
  lfoGain.gain.value = 0.15;
  sirenLfo.connect(lfoGain);
  lfoGain.connect(sirenGain.gain);
  sirenLfo.start();
  sirenOsc2.start();
}

function stopSiren() {
  if (!sirenCtx) return;
  const t = sirenCtx.currentTime;
  sirenGain.gain.setValueAtTime(sirenGain.gain.value, t);
  sirenGain.gain.linearRampToValueAtTime(0, t + 1.5);
  setTimeout(() => {
    try { sirenOsc1.stop(); } catch (_) {}
    try { sirenOsc2.stop(); } catch (_) {}
    try { sirenLfo.stop(); } catch (_) {}
    sirenCtx.close();
    sirenCtx = null; sirenGain = null;
    sirenOsc1 = null; sirenOsc2 = null; sirenLfo = null;
  }, 1600);
}

// ── Visual effects ────────────────────────────────────────────────

function startSirenLights() {
  document.getElementById('siren-overlay').classList.add('active');
}

function stopSirenLights() {
  document.getElementById('siren-overlay').classList.remove('active');
}

let particleInterval = null;
const particleColors = ['#e74c3c', '#f39c12', '#e67e22', '#ff6b6b', '#ffd93d'];

function startParticles() {
  const container = document.getElementById('nuke-particles');
  container.innerHTML = '';
  particleInterval = setInterval(() => {
    const p = document.createElement('div');
    p.className = 'nuke-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = particleColors[Math.floor(Math.random() * particleColors.length)];
    p.style.animationDuration = (0.8 + Math.random() * 0.8) + 's';
    container.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }, 80);
}

function stopParticles() {
  if (particleInterval) { clearInterval(particleInterval); particleInterval = null; }
}

// ── Progress bar ──────────────────────────────────────────────────

function updateNukeBar(completed, total) {
  const pct = Math.round((completed / total) * 100);
  document.getElementById('nuke-bar-fill').style.width = pct + '%';
  document.getElementById('nuke-bar-pct').textContent = pct + '%';
  const labels = [
    'Destroying...', 'Wiping data...', 'Purging records...',
    'Clearing storage...', 'Emptying vaults...', 'Scorching earth...',
    'Obliterating...', 'Annihilating...',
  ];
  document.getElementById('nuke-bar-text').textContent = completed < total
    ? labels[completed % labels.length]
    : 'Complete';
}

// ── Overlay ───────────────────────────────────────────────────────

function setMaintenanceButtonsDisabled(disabled) {
  for (const btn of document.querySelectorAll('#maintenance-panel button')) {
    if (btn.id !== 'reset-all-btn') btn.disabled = disabled;
  }
}

function openOverlay() {
  step = 1;
  const overlay = document.getElementById('nuclear-overlay');
  document.getElementById('nuclear-step-label').textContent = 'Step 1 of 3';
  document.getElementById('nuclear-title').textContent = 'Are you absolutely sure?';
  document.getElementById('nuclear-desc').textContent = 'This will run ALL 16 maintenance actions and permanently delete system messages, reports, warnings, orphaned files, backpacks, gift walls, coins, beans, spin history, Super Shy, appeals, private messages, group chats, closed rooms, broadcasts, and audit logs for every user. This cannot be undone.';
  document.getElementById('nuclear-input-wrap').style.display = 'none';
  document.getElementById('nuclear-confirm-input').value = '';
  document.getElementById('nuclear-btn-row').style.display = 'flex';
  const proceedBtn = document.getElementById('nuclear-proceed');
  proceedBtn.textContent = 'I understand, continue';
  proceedBtn.disabled = false;
  document.getElementById('nuclear-progress').classList.remove('visible');
  for (const el of document.querySelectorAll('.nuclear-progress .step')) {
    el.className = 'step';
  }
  overlay.classList.add('visible');
  startBeep();
}

function closeOverlay() {
  document.getElementById('nuclear-overlay').classList.remove('visible');
  stopBeep();
  stopSiren();
  stopSirenLights();
  step = 0;
}

function dismissOverlay() {
  if (executing) return;
  closeOverlay();
  document.getElementById('nuclear-proceed').style.display = '';
  document.getElementById('nuclear-cancel').textContent = 'Cancel';
}

async function handleNuclearProceed() {
  const proceedBtn = document.getElementById('nuclear-proceed');
  const confirmInput = document.getElementById('nuclear-confirm-input');

  if (step === 1) {
    step = 2;
    document.getElementById('nuclear-step-label').textContent = 'Step 2 of 3';
    document.getElementById('nuclear-title').textContent = 'This is your last warning';
    document.getElementById('nuclear-desc').textContent = 'Every user will lose their coins, beans, backpack items, gift wall, spin history, and warnings. All reports, system messages, appeals, private messages, group chats, closed rooms, broadcasts, and audit logs will be deleted. Orphaned files will be purged.';
    proceedBtn.textContent = 'Continue to final step';
    return;
  }
  if (step === 2) {
    step = 3;
    document.getElementById('nuclear-step-label').textContent = 'Step 3 of 3';
    document.getElementById('nuclear-title').textContent = 'Type to confirm';
    document.getElementById('nuclear-desc').innerHTML = 'Type <strong style="color:#e74c3c;font-family:monospace">' + CONFIRM_PHRASE + '</strong> exactly to proceed.';
    document.getElementById('nuclear-input-wrap').style.display = 'block';
    confirmInput.value = '';
    confirmInput.focus();
    proceedBtn.textContent = 'EXECUTE RESET';
    proceedBtn.disabled = true;
    return;
  }
  if (step === 3) {
    if (confirmInput.value !== CONFIRM_PHRASE) return;
    await executeNuclearReset();
  }
}

async function executeNuclearReset() {
  const overlay = document.getElementById('nuclear-overlay');
  const resultEl = document.getElementById('reset-all-result');
  const mainBtn = document.getElementById('reset-all-btn');

  executing = true;
  stopBeep();
  startSiren();
  overlay.classList.add('locked');
  overlay.querySelector('.nuclear-dialog').classList.add('shaking');
  document.getElementById('nuclear-btn-row').style.display = 'none';
  document.getElementById('nuclear-input-wrap').style.display = 'none';
  document.getElementById('nuclear-step-label').textContent = 'DESTROYING';
  document.getElementById('nuclear-title').textContent = 'Resetting everything';
  document.getElementById('nuclear-desc').textContent = 'Do not close this page.';
  document.getElementById('nuclear-progress').classList.add('visible');
  startParticles();
  startSirenLights();

  mainBtn.disabled = true;
  mainBtn.textContent = 'RUNNING...';
  setMaintenanceButtonsDisabled(true);

  // Token refresh: Firebase ID tokens expire after 1 hour. The 21-action
  // reset can run for several minutes; capturing the token once at the
  // start meant the later actions could 401 if the admin's session was
  // close to expiry. _getToken() calls user.getIdToken() which Firebase
  // auto-refreshes near expiry, so calling it per-request keeps the
  // token fresh.
  // Auto-backup before wipe
  document.getElementById('nuclear-step-label').textContent = 'Creating safety backup...';
  try {
    const backupResp = await fetch(`${_apiBase}/api/admin/backups/trigger`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await _getToken()}` },
    });
    if (!backupResp.ok) throw new Error('Backup request failed');
  } catch (backupErr) {
    console.error('Pre-wipe backup failed:', backupErr);
    resultEl.className = 'maintenance-result error';
    resultEl.textContent = 'Backup failed \u2014 reset aborted for safety. Fix backup first.';
    resultEl.style.display = 'block';
    mainBtn.disabled = false;
    mainBtn.textContent = 'RESET EVERYTHING';
    setMaintenanceButtonsDisabled(false);
    executing = false;
    closeOverlay();
    stopParticles();
    return;
  }

  const actions = [
    { id: 'np-system-msgs', endpoint: 'all-system-conversations', label: 'System messages' },
    { id: 'np-reports', endpoint: 'all-reports', label: 'Reports' },
    { id: 'np-warnings', endpoint: 'all-warnings', label: 'Warnings' },
    { id: 'np-appeals', endpoint: 'all-appeals', label: 'Appeals' },
    { id: 'np-storage', endpoint: 'orphaned-storage', label: 'Orphaned storage', body: { folders: ['pm_images/', 'stickers/', 'report_evidence/'] } },
    { id: 'np-backpacks', endpoint: 'all-backpacks', label: 'Backpacks' },
    { id: 'np-giftwalls', endpoint: 'all-giftwalls', label: 'Gift walls' },
    { id: 'np-coins', endpoint: 'all-coins', label: 'Coins' },
    { id: 'np-beans', endpoint: 'all-beans', label: 'Beans' },
    { id: 'np-spin-history', endpoint: 'all-spin-history', label: 'Spin history' },
    { id: 'np-transactions', endpoint: 'all-transactions', label: 'All transactions' },
    { id: 'np-supershy', endpoint: 'all-supershy', label: 'Super Shy' },
    { id: 'np-pms', endpoint: 'all-private-messages', label: 'Private messages' },
    { id: 'np-groups', endpoint: 'all-group-chats', label: 'Group chats' },
    { id: 'np-rooms', endpoint: 'all-rooms', label: 'Closed rooms' },
    { id: 'np-broadcasts', endpoint: 'all-broadcasts', label: 'Broadcasts' },
    { id: 'np-audit-logs', endpoint: 'all-audit-logs', label: 'Audit logs' },
    { id: 'np-stalkers', endpoint: 'all-stalkers', label: 'Stalkers' },
    { id: 'np-suggestions', endpoint: 'all-suggestions', label: 'Suggestions' },
    { id: 'np-subscriptions', endpoint: 'all-subscriptions', label: 'Subscriptions' },
    { id: 'np-notifications', endpoint: 'all-notifications', label: 'Notifications' },
  ];

  updateNukeBar(0, actions.length);
  let failed = 0;
  let completed = 0;
  const results = [];

  for (const action of actions) {
    const stepEl = document.getElementById(action.id);
    if (stepEl) {
      stepEl.className = 'step running';
      stepEl.innerHTML = '&#9679; ' + escapeHtml(action.label) + '...';
    }
    document.getElementById('nuclear-step-label').textContent = `${completed + 1}/${actions.length}: ${action.label}...`;
    try {
      // Refresh token per-action — see top of run() for rationale.
      const resp = await fetch(`${_apiBase}/api/cleanup/${action.endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${await _getToken()}`, 'Content-Type': 'application/json' },
        body: action.body ? JSON.stringify(action.body) : undefined,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      if (stepEl) {
        stepEl.className = 'step done';
        stepEl.innerHTML = '&#10003; ' + escapeHtml(action.label) + ' \u2014 done';
      }
      results.push(`${action.label}: OK`);
    } catch (err) {
      if (stepEl) {
        stepEl.className = 'step failed';
        stepEl.innerHTML = '&#10007; ' + escapeHtml(action.label) + ' \u2014 ' + escapeHtml(err.message);
      }
      results.push(`${action.label}: FAILED (${err.message})`);
      failed++;
    }
    completed++;
    updateNukeBar(completed, actions.length);
  }

  executing = false;
  overlay.classList.remove('locked');
  overlay.querySelector('.nuclear-dialog').classList.remove('shaking');
  stopSiren();
  stopSirenLights();
  stopParticles();

  document.getElementById('nuclear-step-label').textContent = failed ? `Completed with ${failed} error(s)` : 'Complete';
  document.getElementById('nuclear-title').textContent = failed ? 'Some actions failed' : 'All done';
  document.getElementById('nuclear-desc').textContent = failed
    ? `${actions.length - failed} of ${actions.length} actions succeeded. Check the results below.`
    : `All ${actions.length} maintenance actions completed successfully.`;
  document.getElementById('nuclear-btn-row').style.display = 'flex';
  document.getElementById('nuclear-proceed').style.display = 'none';
  document.getElementById('nuclear-cancel').textContent = 'Close';

  mainBtn.disabled = false;
  mainBtn.textContent = 'RESET EVERYTHING';
  setMaintenanceButtonsDisabled(false);

  resultEl.className = failed ? 'maintenance-result error' : 'maintenance-result success';
  resultEl.textContent = results.join('\n');
  resultEl.style.display = 'block';
}
