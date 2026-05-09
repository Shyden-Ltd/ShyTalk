/**
 * Sync from Production overlay — copies prod Firestore data to dev.
 *
 * Only shown when API_BASE contains "dev-api". Provides a 3-step
 * confirmation flow with Web Audio feedback and a progress bar.
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
  // Refresh deps every call — apiBase / getToken closure / auth instance
  // are stable in practice but a future caller might rebind them.
  _apiBase = deps.apiBase || '';
  _getToken = deps.getToken;
  _auth = deps.auth;

  const migrateCard = document.getElementById('migrate-prod-card');
  if (_apiBase.includes('dev-api')) {
    migrateCard.style.display = '';
  }

  // init() is invoked from main.js's onAuthStateChanged callback, which
  // fires on every sign-in, sign-out → sign-in cycle, and ID-token
  // refresh. Without this guard each cycle stacks another click handler
  // on every overlay button — clicking "migrate from prod" once would
  // open N overlays and run N parallel sync requests. See
  // tests/web/admin-init-idempotency.spec.ts.
  if (_initialised) return;
  _initialised = true;

  const migrateBtn = document.getElementById('migrate-prod-btn');
  migrateBtn.addEventListener('click', () => {
    document.getElementById('migrate-prod-result').style.display = 'none';
    openSyncOverlay();
  });

  document.getElementById('sync-cancel').addEventListener('click', dismissSyncOverlay);
  document.getElementById('sync-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sync-overlay')) dismissSyncOverlay();
  });

  document.getElementById('sync-confirm-input').addEventListener('input', () => {
    document.getElementById('sync-proceed').disabled =
      document.getElementById('sync-confirm-input').value !== SYNC_PHRASE;
  });

  document.getElementById('sync-mute').addEventListener('click', () => {
    syncMuted = !syncMuted;
    document.getElementById('sync-mute').textContent = syncMuted ? 'Unmute' : 'Mute';
    if (syncMuted) { stopSyncBeep(); stopSyncTransfer(); }
  });

  document.getElementById('sync-proceed').addEventListener('click', handleSyncProceed);
}

// ── State ─────────────────────────────────────────────────────────

const SYNC_PHRASE = 'SYNC';
let syncStep = 0;
let syncExecuting = false;
let syncMuted = false;

// ── Web Audio: digital pulse (confirmation steps) ─────────────────

let syncBeepCtx = null;
let syncBeepInterval = null;

function startSyncBeep() {
  if (syncBeepCtx || syncMuted) return;
  syncBeepCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playPulse() {
    if (!syncBeepCtx) return;
    const osc = syncBeepCtx.createOscillator();
    const gain = syncBeepCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    osc.frequency.exponentialRampToValueAtTime(600, syncBeepCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, syncBeepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, syncBeepCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(syncBeepCtx.destination);
    osc.start(syncBeepCtx.currentTime);
    osc.stop(syncBeepCtx.currentTime + 0.2);
  }
  playPulse();
  syncBeepInterval = setInterval(playPulse, 1200);
}

function stopSyncBeep() {
  if (syncBeepInterval) { clearInterval(syncBeepInterval); syncBeepInterval = null; }
  if (syncBeepCtx) { syncBeepCtx.close(); syncBeepCtx = null; }
}

// ── Web Audio: data transfer sound (execution phase) ──────────────

let syncTransferCtx = null;
let syncTransferInterval = null;

function startSyncTransfer() {
  if (syncTransferCtx || syncMuted) return;
  syncTransferCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = syncTransferCtx.createGain();
  masterGain.gain.value = 0.12;
  masterGain.connect(syncTransferCtx.destination);

  function chirp() {
    if (!syncTransferCtx) return;
    const osc = syncTransferCtx.createOscillator();
    const g = syncTransferCtx.createGain();
    osc.type = 'triangle';
    const freq = 300 + Math.random() * 1500;
    osc.frequency.value = freq;
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, syncTransferCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.15, syncTransferCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, syncTransferCtx.currentTime + 0.08);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(syncTransferCtx.currentTime);
    osc.stop(syncTransferCtx.currentTime + 0.08);
  }

  const drone = syncTransferCtx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 80;
  const droneGain = syncTransferCtx.createGain();
  droneGain.gain.value = 0.08;
  drone.connect(droneGain);
  droneGain.connect(syncTransferCtx.destination);
  drone.start();

  chirp();
  syncTransferInterval = setInterval(chirp, 150);
}

function stopSyncTransfer() {
  if (syncTransferInterval) { clearInterval(syncTransferInterval); syncTransferInterval = null; }
  if (syncTransferCtx) {
    setTimeout(() => {
      try { syncTransferCtx.close(); } catch (_) {}
      syncTransferCtx = null;
    }, 200);
  }
}

// ── Overlay ───────────────────────────────────────────────────────

function updateSyncBar(completed, total) {
  const pct = Math.round((completed / total) * 100);
  document.getElementById('sync-bar-fill').style.width = pct + '%';
  document.getElementById('sync-bar-pct').textContent = pct + '%';
  const labels = ['Syncing...', 'Copying data...', 'Transferring records...', 'Downloading...'];
  document.getElementById('sync-bar-text').textContent = completed < total
    ? labels[completed % labels.length]
    : 'Complete';
}

function openSyncOverlay() {
  syncStep = 1;
  const overlay = document.getElementById('sync-overlay');
  document.getElementById('sync-step-label').textContent = 'Step 1 of 3';
  document.getElementById('sync-title').textContent = 'Sync from Production?';
  document.getElementById('sync-desc').textContent = 'This will wipe ALL dev Firestore data and replace it with a complete copy of production data. Users, rooms, conversations, gifts, economy config, banners, and all subcollections will be overwritten. This cannot be undone.';
  document.getElementById('sync-input-wrap').style.display = 'none';
  document.getElementById('sync-confirm-input').value = '';
  document.getElementById('sync-btn-row').style.display = 'flex';
  const proceedBtn = document.getElementById('sync-proceed');
  proceedBtn.textContent = 'I understand, continue';
  proceedBtn.disabled = false;
  proceedBtn.style.display = '';
  document.getElementById('sync-progress').classList.remove('visible');
  for (const el of document.querySelectorAll('#sync-progress .step')) { el.className = 'step'; }
  overlay.classList.add('visible');
  startSyncBeep();
}

function closeSyncOverlay() {
  document.getElementById('sync-overlay').classList.remove('visible');
  stopSyncBeep();
  stopSyncTransfer();
  syncStep = 0;
}

function dismissSyncOverlay() {
  if (syncExecuting) return;
  closeSyncOverlay();
  document.getElementById('sync-proceed').style.display = '';
  document.getElementById('sync-cancel').textContent = 'Cancel';
}

async function handleSyncProceed() {
  const proceedBtn = document.getElementById('sync-proceed');
  const confirmInput = document.getElementById('sync-confirm-input');

  if (syncStep === 1) {
    syncStep = 2;
    document.getElementById('sync-step-label').textContent = 'Step 2 of 3';
    document.getElementById('sync-title').textContent = 'This will overwrite everything';
    document.getElementById('sync-desc').textContent = 'Every document in dev Firestore will be deleted first, then replaced with production data. All users, rooms, messages, gifts, economy settings, and configurations will be overwritten.';
    proceedBtn.textContent = 'Continue to final step';
    return;
  }
  if (syncStep === 2) {
    syncStep = 3;
    document.getElementById('sync-step-label').textContent = 'Step 3 of 3';
    document.getElementById('sync-title').textContent = 'Type to confirm';
    const desc = document.getElementById('sync-desc');
    desc.textContent = '';
    const strong = document.createElement('strong');
    strong.style.cssText = 'color:#3498db;font-family:monospace';
    strong.textContent = SYNC_PHRASE;
    desc.appendChild(document.createTextNode('Type '));
    desc.appendChild(strong);
    desc.appendChild(document.createTextNode(' exactly to proceed.'));
    document.getElementById('sync-input-wrap').style.display = 'block';
    confirmInput.value = '';
    confirmInput.focus();
    proceedBtn.textContent = 'START SYNC';
    proceedBtn.disabled = true;
    return;
  }
  if (syncStep === 3) {
    if (confirmInput.value !== SYNC_PHRASE) return;
    await executeSyncFromProd();
  }
}

async function executeSyncFromProd() {
  const migrateBtn = document.getElementById('migrate-prod-btn');
  const migrateResult = document.getElementById('migrate-prod-result');
  const overlay = document.getElementById('sync-overlay');

  syncExecuting = true;
  stopSyncBeep();
  startSyncTransfer();
  overlay.classList.add('locked');
  document.getElementById('sync-btn-row').style.display = 'none';
  document.getElementById('sync-input-wrap').style.display = 'none';
  document.getElementById('sync-step-label').textContent = 'SYNCING';
  document.getElementById('sync-title').textContent = 'Copying production data';
  document.getElementById('sync-desc').textContent = 'Do not close this page. This may take a while.';
  document.getElementById('sync-progress').classList.add('visible');
  updateSyncBar(0, 4);

  migrateBtn.disabled = true;
  migrateBtn.textContent = 'SYNCING...';

  const phases = [
    { id: 'sp-delete-sub', label: 'Delete dev subcollections' },
    { id: 'sp-delete-top', label: 'Delete dev top-level data' },
    { id: 'sp-copy-top', label: 'Copy prod top-level data' },
    { id: 'sp-copy-sub', label: 'Copy prod subcollections' },
  ];
  for (const p of phases) {
    const el = document.getElementById(p.id);
    el.className = 'step';
    el.textContent = '\u25CF ' + p.label;
  }
  const firstEl = document.getElementById(phases[0].id);
  firstEl.className = 'step running';
  firstEl.textContent = '\u25CF ' + phases[0].label + '...';

  try {
    const token = await _getToken();
    const resp = await fetch(`${_apiBase}/api/admin/migrate-prod-data`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Migration failed');

    let phaseIdx = 0;
    for (const p of phases) {
      phaseIdx++;
      const el = document.getElementById(p.id);
      el.className = 'step done';
      el.textContent = '\u2713 ' + p.label + ' \u2014 done';
      updateSyncBar(phaseIdx, 4);
    }

    const hasErrors = data.errors && data.errors.length > 0;
    if (hasErrors) {
      for (const e of data.errors) {
        const phaseMap = { 'delete': 0, 'copy': 2 };
        const idx = (phaseMap[e.phase] || 0) + (e.collection.includes('/') ? 0 : 1);
        if (phases[idx]) {
          document.getElementById(phases[idx].id).className = 'step failed';
        }
      }
    }

    syncExecuting = false;
    overlay.classList.remove('locked');
    stopSyncTransfer();
    document.getElementById('sync-step-label').textContent = hasErrors ? `Done with ${data.errors.length} error(s)` : 'Complete';
    document.getElementById('sync-title').textContent = hasErrors ? 'Sync completed with errors' : 'Sync complete!';
    document.getElementById('sync-desc').textContent = `Deleted ${data.totalDeleted} dev documents, copied ${data.totalCopied} prod documents.`;
    document.getElementById('sync-btn-row').style.display = 'flex';
    document.getElementById('sync-proceed').style.display = 'none';
    document.getElementById('sync-cancel').textContent = 'Close';

    const lines = [
      `Deleted ${data.totalDeleted} dev documents`,
      `Copied ${data.totalCopied} prod documents`,
    ];
    if (hasErrors) {
      lines.push(`${data.errors.length} error(s):`);
      for (const e of data.errors) {
        lines.push(`  ${e.collection} (${e.phase}): ${e.error}`);
      }
    }
    migrateResult.className = hasErrors ? 'maintenance-result error' : 'maintenance-result success';
    migrateResult.textContent = lines.join('\n');
    migrateResult.style.display = 'block';
  } catch (err) {
    syncExecuting = false;
    overlay.classList.remove('locked');
    stopSyncTransfer();
    document.getElementById('sync-step-label').textContent = 'Failed';
    document.getElementById('sync-title').textContent = 'Sync failed';
    document.getElementById('sync-desc').textContent = err.message;
    document.getElementById('sync-btn-row').style.display = 'flex';
    document.getElementById('sync-proceed').style.display = 'none';
    document.getElementById('sync-cancel').textContent = 'Close';

    migrateResult.className = 'maintenance-result error';
    migrateResult.textContent = err.message;
    migrateResult.style.display = 'block';
  }
  migrateBtn.disabled = false;
  migrateBtn.textContent = 'Copy Production Data';
}
