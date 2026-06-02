/**
 * Spin Monitor tab — live monitoring of user gacha spins with real-time
 * Firestore listeners, session/all-time stats, and guarantee management.
 *
 * Extracted from inline script block in index.html.
 * Uses Firestore onSnapshot for live user doc + transaction feed.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml, sanitizeImageUrl } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let monitorUid = null;
let monitorUserUnsub = null;
let monitorTxUnsub = null;
let monitorPollInterval = null; // Polling fallback for WebKit where onSnapshot is unreliable
let monitorGiftCatalog = {};
const monitorGiftCatalogByName = {};
let monitorSeenTxIds = new Set();
let monitorSession = { spins: 0, spent: 0, bestGift: null, bestValue: 0 };
let monitorAllTime = { spins: 0, spent: 0, bestGift: null, bestValue: 0 };
let monitorInitialSnapshotDone = false;
let spinEntryCount = 0;
let guaranteeGiftsLoaded = false;

// ── DOM refs (resolved lazily in init) ────────────────────────────

let monitorUidInput;
let monitorStartBtn;
let monitorStopBtn;
let monitorStatusEl;
let monitorDot;
let monitorStatusText;
let monitorStats;
let monitorUserName;
let monitorCoins;
let monitorPity;
let monitorPityBar;
let spinFeed;
let monitorTotalsWrap;
let spinHistoryToggle;
let spinHistoryCount;
let spinHistorySummary;
let guaranteeGiftSelect;
let guaranteeSetBtn;
let guaranteeRevokeBtn;
let guaranteeStatus;
let tabMonitor;

// ── Firestore refs (injected) ─────────────────────────────────────

let _clientDb = null;
let _collection = null;
let _query = null;
let _orderBy = null;
let _limit = null;
let _where = null;
let _onSnapshot = null;
let _getDocs = null;
let _doc = null;
let _getCurrentTab = () => '';
let _getPityHardLimit = () => 120;

// ── Helper ────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

// ── Public API ────────────────────────────────────────────────────

/**
 * One-time initialisation. Called after DOM is ready.
 *
 * @param deps.clientDb        — Firestore instance (client SDK)
 * @param deps.firestoreFns    — { collection, query, orderBy, limit, where, onSnapshot, getDocs, doc }
 * @param deps.getCurrentTab   — returns current tab name
 * @param deps.getPityHardLimit — returns cached pity hard limit from economy-config
 */
export function init(deps) {
  _clientDb = deps.clientDb;
  if (deps.firestoreFns) {
    _collection = deps.firestoreFns.collection;
    _query = deps.firestoreFns.query;
    _orderBy = deps.firestoreFns.orderBy;
    _limit = deps.firestoreFns.limit;
    _where = deps.firestoreFns.where;
    _onSnapshot = deps.firestoreFns.onSnapshot;
    _getDocs = deps.firestoreFns.getDocs;
    _doc = deps.firestoreFns.doc;
  }
  _getCurrentTab = deps.getCurrentTab;
  _getPityHardLimit = deps.getPityHardLimit;

  // Resolve DOM refs
  monitorUidInput = $("#monitor-uid-input");
  monitorStartBtn = $("#monitor-start-btn");
  monitorStopBtn = $("#monitor-stop-btn");
  monitorStatusEl = $("#monitor-status");
  monitorDot = $("#monitor-dot");
  monitorStatusText = $("#monitor-status-text");
  monitorStats = $("#monitor-stats");
  monitorUserName = $("#monitor-user-name");
  monitorCoins = $("#monitor-coins");
  monitorPity = $("#monitor-pity");
  monitorPityBar = $("#monitor-pity-bar");
  spinFeed = $("#spin-feed");
  monitorTotalsWrap = $("#monitor-totals-wrap");
  spinHistoryToggle = $("#spin-history-toggle");
  spinHistoryCount = $("#spin-history-count");
  spinHistorySummary = $("#spin-history-summary");
  guaranteeGiftSelect = $("#guarantee-gift-select");
  guaranteeSetBtn = $("#guarantee-set-btn");
  guaranteeRevokeBtn = $("#guarantee-revoke-btn");
  guaranteeStatus = $("#guarantee-status");
  tabMonitor = document.getElementById('tab-monitor');

  // Define a custom .open property on the div-based collapsible so that
  // existing code (and Playwright tests) can read/write it the same way
  // they would on a native <details> element.
  {
    let _histOpen = false;
    Object.defineProperty(spinHistoryToggle, "open", {
      get() { return _histOpen; },
      set(val) {
        _histOpen = !!val;
        spinFeed.style.display = _histOpen ? "" : "none";
        spinHistoryToggle.classList.toggle("open", _histOpen);
        spinHistorySummary.setAttribute("aria-expanded", String(_histOpen));
      },
      configurable: true,
    });
    // Click handler — no browser quirks since this is a plain div
    spinHistorySummary.addEventListener("click", () => {
      spinHistoryToggle.open = !spinHistoryToggle.open;
    });
    spinHistorySummary.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        spinHistoryToggle.open = !spinHistoryToggle.open;
      }
    });
  }

  // Strip non-digit characters from monitor UID input (type="text" for cross-browser compat)
  monitorUidInput.addEventListener("input", () => {
    const cleaned = monitorUidInput.value.replace(/\D/g, "");
    if (cleaned !== monitorUidInput.value) monitorUidInput.value = cleaned;
  });

  // Wire up monitor buttons
  monitorStartBtn.addEventListener("click", () => {
    const uid = monitorUidInput.value.trim();
    if (uid) sessionStorage.setItem("admin_monitor_uid", uid);
    startMonitoring(uid);
  });

  monitorStopBtn.addEventListener("click", stopMonitoring);

  // Enter key on monitor search — listen to both keydown and keypress for
  // maximum cross-browser compatibility (WebKit can be unreliable with
  // keydown on inputmode="numeric" inputs). Guard against double-fire.
  let monitorEnterHandled = false;
  function handleMonitorEnter(e) {
    if (e.key === "Enter" && !monitorEnterHandled) {
      e.preventDefault();
      monitorEnterHandled = true;
      setTimeout(() => { monitorEnterHandled = false; }, 200);
      const uid = monitorUidInput.value.trim();
      if (uid) {
        sessionStorage.setItem("admin_monitor_uid", uid);
        startMonitoring(uid);
      }
    }
  }
  monitorUidInput.addEventListener("keydown", handleMonitorEnter);
  monitorUidInput.addEventListener("keypress", handleMonitorEnter);
  monitorUidInput.addEventListener("keyup", handleMonitorEnter);

  // Guarantee buttons
  guaranteeSetBtn.addEventListener("click", handleGuaranteeSet);
  guaranteeRevokeBtn.addEventListener("click", handleGuaranteeRevoke);
}

/** Called every time the Monitor tab is activated. */
export function activate() {
  populateGuaranteeGiftDropdown();
  // Restore monitoring from session if not already active
  const savedUid = sessionStorage.getItem('admin_monitor_uid');
  if (savedUid && !monitorUid) {
    monitorUidInput.value = savedUid;
    startMonitoring(savedUid);
  } else if (monitorUidInput) {
    monitorUidInput.focus();
  }
}

/** Called when leaving the Monitor tab. */
export function deactivate() {
  // Monitoring continues in background (live dot stays on tab)
}

// ── Rendering helpers ─────────────────────────────────────────────

function flashCard(el) {
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 600);
}

function updateMonitorStats(userData) {
  const coins = userData.shyCoins ?? 0;
  const pity = userData.pityCounter ?? 0;
  const name = userData.displayName || "Unknown";
  const avatar = userData.profilePhotoUrl;

  // User card — always update or remove avatar
  const userCard = $("#monitor-user-card");
  const prevAvatar = userCard.querySelector(".user-avatar");
  const safeAvatar = sanitizeImageUrl(avatar);
  if (safeAvatar) {
    if (prevAvatar) {
      prevAvatar.src = safeAvatar;
    } else {
      const img = document.createElement("img");
      img.className = "user-avatar";
      img.src = safeAvatar;
      img.alt = "";
      userCard.insertBefore(img, userCard.firstChild);
    }
  } else if (prevAvatar) {
    prevAvatar.remove();
  }
  monitorUserName.textContent = name;

  // Coins
  const prevCoins = monitorCoins.textContent;
  monitorCoins.textContent = coins.toLocaleString();
  if (prevCoins !== "\u2014" && prevCoins !== coins.toLocaleString()) flashCard($("#monitor-coin-card"));

  // Pity
  const pityMax = _getPityHardLimit();
  const prevPity = monitorPity.textContent;
  monitorPity.textContent = `${pity} / ${pityMax}`;
  const pityPct = Math.min((pity / pityMax) * 100, 100);
  monitorPityBar.style.width = pityPct + "%";
  if (pityPct < 50) monitorPityBar.style.background = "var(--success)";
  else if (pityPct < 80) monitorPityBar.style.background = "var(--warning)";
  else monitorPityBar.style.background = "var(--danger)";
  if (prevPity !== "\u2014" && prevPity !== `${pity} / ${pityMax}`) flashCard($("#monitor-pity-card"));
}

function updateSessionTotals() {
  $("#session-spins").textContent = monitorSession.spins.toLocaleString();
  $("#session-spent").textContent = monitorSession.spent.toLocaleString();
  $("#session-best").textContent = monitorSession.bestGift || "\u2014";
}

function updateAllTimeTotals() {
  $("#alltime-spins").textContent = monitorAllTime.spins.toLocaleString();
  $("#alltime-spent").textContent = monitorAllTime.spent.toLocaleString();
  $("#alltime-best").textContent = monitorAllTime.bestGift || "\u2014";
}

function renderSpinEntry(txData, txId, isHistorical = false) {
  const pullCount = txData.pullCount || 1;
  const amount = Math.abs(txData.amount || 0);
  const details = txData.details || "";
  const balanceAfter = txData.balanceAfter ?? "?";
  const ts = txData.timestamp;
  const timeStr = ts && ts.toDate
    ? ts.toDate().toLocaleTimeString()
    : (ts ? new Date(ts).toLocaleTimeString() : "\u2014");

  // Parse gift names from details
  const giftNames = details.split(",").map(s => s.trim()).filter(Boolean);

  // Aggregate gifts: count duplicates and collect info
  const giftCounts = {};
  for (const name of giftNames) {
    if (!giftCounts[name]) {
      const info = monitorGiftCatalogByName[name];
      giftCounts[name] = {
        count: 0,
        coinValue: info ? info.coinValue : 0,
        iconUrl: info ? info.iconUrl : ""
      };
    }
    giftCounts[name].count++;

    const info = giftCounts[name];

    // Update session and all-time best (skip for historical entries)
    if (!isHistorical) {
      if (info.coinValue > monitorSession.bestValue) {
        monitorSession.bestValue = info.coinValue;
        monitorSession.bestGift = name;
      }
      if (info.coinValue > monitorAllTime.bestValue) {
        monitorAllTime.bestValue = info.coinValue;
        monitorAllTime.bestGift = name;
      }
    }
  }

  // Sort by coin value descending
  const sortedGifts = Object.entries(giftCounts).sort((a, b) => b[1].coinValue - a[1].coinValue);

  // Calculate total gift value
  const totalGiftValue = sortedGifts.reduce((sum, [, info]) => sum + info.coinValue * info.count, 0);

  // Build gift items HTML with icons, names, quantities, and values
  const giftItemsHtml = sortedGifts.map(([name, info]) => {
    const iconHtml = info.iconUrl
      ? `<img class="spin-gift-icon" src="${escapeHtml(info.iconUrl)}" alt="">`
      : `<span class="spin-gift-icon-placeholder">${escapeHtml(name.slice(0, 2))}</span>`;
    const qtyLabel = info.count > 1 ? `<span class="spin-gift-qty">&times;${info.count}</span>` : "";
    return `<div class="spin-gift-item">
      ${iconHtml}
      <span class="spin-gift-name">${escapeHtml(name)}</span>
      ${qtyLabel}
      <span class="spin-gift-value">${info.coinValue.toLocaleString()} coins</span>
    </div>`;
  }).join("");

  // Pull badge
  let pullClass = "";
  if (pullCount >= 100) pullClass = "pull-100";
  else if (pullCount >= 10) pullClass = "pull-10";

  // Update session and all-time totals (skip for historical entries)
  if (!isHistorical) {
    monitorSession.spins += pullCount;
    monitorSession.spent += amount;
    monitorAllTime.spins += pullCount;
    monitorAllTime.spent += amount;
  }

  const entry = document.createElement("div");
  entry.className = "spin-entry";
  entry.innerHTML = `
    <div class="spin-entry-header">
      <span class="spin-entry-time">${escapeHtml(timeStr)}</span>
      <span class="pull-badge ${pullClass}">${pullCount}x</span>
      <span class="spin-entry-cost">-${amount.toLocaleString()} coins &middot; bal: ${Number(balanceAfter).toLocaleString()}</span>
      <span class="spin-entry-total">value: ${totalGiftValue.toLocaleString()} coins</span>
    </div>
    <div class="spin-gifts">${giftItemsHtml}</div>
  `;

  // Remove empty placeholder if present
  const emptyMsg = spinFeed.querySelector(".spin-feed-empty");
  if (emptyMsg) emptyMsg.remove();

  // Prepend (newest first)
  spinFeed.insertBefore(entry, spinFeed.firstChild);

  // Update history count badge
  spinEntryCount++;
  spinHistoryCount.textContent = `(${spinEntryCount})`;

  // Auto-open history section for live entries
  if (!isHistorical) {
    spinHistoryToggle.open = true;
  }

  if (!isHistorical) {
    updateSessionTotals();
    updateAllTimeTotals();
  }
}

// ── Gift Catalog ──────────────────────────────────────────────────

async function loadGiftCatalog() {
  if (Object.keys(monitorGiftCatalog).length > 0) return;
  try {
    const snapshot = await _getDocs(_collection(_clientDb, "gifts"));
    snapshot.forEach(d => {
      const data = d.data();
      monitorGiftCatalog[d.id] = {
        name: data.name,
        coinValue: data.coinValue || 0,
        iconUrl: data.iconUrl || ""
      };
      monitorGiftCatalogByName[data.name] = {
        id: d.id,
        coinValue: data.coinValue || 0,
        iconUrl: data.iconUrl || ""
      };
    });
  } catch (err) {
    console.warn("Failed to load gift catalog:", err);
  }
}

// ── Monitoring ────────────────────────────────────────────────────

async function startMonitoring(uniqueId) {
  if (!uniqueId) { showToast("Enter a user ID", "error"); return; }

  // Stop any existing monitoring first
  if (monitorUserUnsub || monitorTxUnsub) stopMonitoring();

  // Reset all display state immediately
  monitorUserName.textContent = "\u2014";
  monitorCoins.textContent = "\u2014";
  monitorPity.textContent = "\u2014";
  monitorPityBar.style.width = "0%";
  const oldAvatar = $("#monitor-user-card").querySelector(".user-avatar");
  if (oldAvatar) oldAvatar.remove();

  monitorStartBtn.disabled = true;
  monitorStartBtn.textContent = "Connecting...";

  try {
    // Resolve uniqueId to user data via API (fast HTTP calls)
    const searchResult = await apiCall("GET", `/api/search/uniqueId/${uniqueId}`);
    const resolvedUniqueId = String(searchResult.uniqueId || uniqueId);
    if (!resolvedUniqueId) throw new Error("User not found");

    // Get initial user data via API (fast HTTP call)
    const userData = await apiCall("GET", `/api/user/${resolvedUniqueId}`);
    monitorUid = resolvedUniqueId;

    // Reset session and all-time totals
    monitorSession = { spins: 0, spent: 0, bestGift: null, bestValue: 0 };
    monitorAllTime = { spins: 0, spent: 0, bestGift: null, bestValue: 0 };
    monitorSeenTxIds = new Set();
    spinFeed.innerHTML = '<div class="spin-feed-empty">Listening for spins...</div>';
    spinEntryCount = 0;
    spinHistoryCount.textContent = "";
    spinHistoryToggle.open = false;

    // Show UI immediately after API data loads — do NOT wait for
    // Firestore connections (WebChannel can take 6-7s on WebKit first use)
    monitorStatusEl.style.display = "";
    monitorStats.style.display = "";
    monitorTotalsWrap.style.display = "";
    monitorDot.classList.add("live");
    monitorStatusText.textContent = `Live \u2014 monitoring ${userData.displayName || uniqueId} (#${resolvedUniqueId})`;
    monitorStartBtn.style.display = "none";
    monitorStopBtn.style.display = "";

    // Show live dot on tab
    let liveDot = tabMonitor.querySelector(".tab-live-dot");
    if (!liveDot) {
      liveDot = document.createElement("span");
      liveDot.className = "tab-live-dot";
      tabMonitor.appendChild(liveDot);
    }

    updateMonitorStats(userData);
    updateSessionTotals();
    updateAllTimeTotals(); // Show "0" initially; background load will update

    // Re-enable button immediately (UI is already shown)
    monitorStartBtn.disabled = false;
    monitorStartBtn.textContent = "Start Monitoring";

    // --- Background Firestore work (non-blocking) ---
    // Load gift catalog first (needed for all-time stats name->value lookups),
    // then compute all-time stats. Set up listeners concurrently.
    // These use Firestore's WebChannel which can be slow on WebKit first use,
    // but the monitor status UI is already visible above.

    // Load gift catalog, then compute all-time stats (depends on catalog)
    (async () => {
      await loadGiftCatalog().catch(err => console.warn("Gift catalog load failed:", err));
      try {
        const allTxQuery = _query(
          _collection(_clientDb, "users", resolvedUniqueId, "transactions"),
          _where("type", "==", "GACHA_PULL"),
          _orderBy("timestamp", "desc")
        );
        const allTxSnapshot = await _getDocs(allTxQuery);
        allTxSnapshot.forEach(txDoc => {
          const tx = txDoc.data();
          const pulls = tx.pullCount || 1;
          const spent = Math.abs(tx.amount || 0);
          monitorAllTime.spins += pulls;
          monitorAllTime.spent += spent;

          const names = (tx.details || "").split(",").map(s => s.trim()).filter(Boolean);
          for (const name of names) {
            const info = monitorGiftCatalogByName[name];
            if (info) {
              if (info.coinValue > monitorAllTime.bestValue) {
                monitorAllTime.bestValue = info.coinValue;
                monitorAllTime.bestGift = name;
              }
            }
          }
        });
        updateAllTimeTotals();
      } catch (err) {
        console.warn("Failed to load all-time stats:", err);
        $("#alltime-spins").textContent = "?";
        $("#alltime-spent").textContent = "?";
      }
    })();

    // Set up real-time user doc listener
    monitorUserUnsub = _onSnapshot(_doc(_clientDb, "users", resolvedUniqueId), (snap) => {
      if (snap.exists()) updateMonitorStats(snap.data());
    });

    // Polling fallback: on WebKit, the Firestore WebChannel transport
    // can be extremely slow or fail to deliver onSnapshot updates.
    // Poll the API every 10 seconds to keep the UI fresh regardless.
    if (monitorPollInterval) clearInterval(monitorPollInterval);
    monitorPollInterval = setInterval(async () => {
      if (!monitorUid) return;
      if (_getCurrentTab() !== "monitor") return;
      try {
        const freshData = await apiCall("GET", `/api/user/${monitorUid}`, null, { skipTabAbort: true });
        if (freshData) updateMonitorStats(freshData);
      } catch (_) { /* API may intermittently fail — ignore */ }
    }, 10000);

    // Set up real-time transactions listener
    const txQuery = _query(
      _collection(_clientDb, "users", resolvedUniqueId, "transactions"),
      _where("type", "==", "GACHA_PULL"),
      _orderBy("timestamp", "desc"),
      _limit(50)
    );

    monitorInitialSnapshotDone = false;
    monitorTxUnsub = _onSnapshot(txQuery, (snapshot) => {
      const isInitial = !monitorInitialSnapshotDone;
      snapshot.docChanges().forEach(change => {
        if (change.type === "added" && !monitorSeenTxIds.has(change.doc.id)) {
          monitorSeenTxIds.add(change.doc.id);
          renderSpinEntry(change.doc.data(), change.doc.id, isInitial);
        }
      });
      if (isInitial) monitorInitialSnapshotDone = true;
    });

    // Refresh guarantee status after monitoring starts
    await populateGuaranteeGiftDropdown();
    await loadGuaranteeStatus();

  } catch (err) {
    showToast(`Monitor error: ${err.message}`, "error");
    monitorStartBtn.style.display = "";
    monitorStopBtn.style.display = "none";
    monitorStartBtn.disabled = false;
    monitorStartBtn.textContent = "Start Monitoring";
  }
}

export function stopMonitoring() {
  if (monitorUserUnsub) { monitorUserUnsub(); monitorUserUnsub = null; }
  if (monitorTxUnsub) { monitorTxUnsub(); monitorTxUnsub = null; }
  if (monitorPollInterval) { clearInterval(monitorPollInterval); monitorPollInterval = null; }
  monitorUid = null;
  sessionStorage.removeItem("admin_monitor_uid");

  // Update status (guard: init() may not have run if tab was never visited)
  if (monitorDot) monitorDot.classList.remove("live");
  if (monitorStatusText) monitorStatusText.textContent = "Disconnected";
  if (monitorStartBtn) monitorStartBtn.style.display = "";
  if (monitorStopBtn) monitorStopBtn.style.display = "none";

  // Remove live dot from tab
  const liveDot = tabMonitor?.querySelector(".tab-live-dot");
  if (liveDot) liveDot.remove();
}

// ── Guarantee Next Prize ──────────────────────────────────────────

async function populateGuaranteeGiftDropdown() {
  // Reuse monitor gift catalog if loaded, otherwise load via API
  await loadGiftCatalog();
  // Clear existing options (keep first placeholder)
  while (guaranteeGiftSelect.options.length > 1) {
    guaranteeGiftSelect.remove(1);
  }
  // Build sorted list by coin value
  const gifts = Object.entries(monitorGiftCatalog)
    .sort((a, b) => a[1].coinValue - b[1].coinValue);
  for (const [giftId, info] of gifts) {
    const opt = document.createElement("option");
    opt.value = giftId;
    opt.textContent = `${info.name} (${info.coinValue.toLocaleString()} coins)`;
    guaranteeGiftSelect.appendChild(opt);
  }
}

async function loadGuaranteeStatus() {
  if (!monitorUid) {
    guaranteeStatus.textContent = "No user monitored.";
    guaranteeRevokeBtn.style.display = "none";
    return;
  }
  try {
    const data = await apiCall("GET", `/api/users/${monitorUid}/guarantee-next-pull`);
    if (data.active) {
      const setDate = data.setAt ? new Date(data.setAt).toLocaleString() : "unknown";
      guaranteeStatus.innerHTML = `<span style="color:var(--warning);font-weight:600;">Active:</span> Next pull guaranteed to be <strong>${escapeHtml(data.giftName)}</strong> (${(data.coinValue || 0).toLocaleString()} coins). Set at ${escapeHtml(setDate)}.`;
      guaranteeRevokeBtn.style.display = "";
    } else {
      guaranteeStatus.textContent = "No guarantee set for this user.";
      guaranteeRevokeBtn.style.display = "none";
    }
  } catch (err) {
    guaranteeStatus.textContent = "Failed to load guarantee status.";
    console.warn("Load guarantee status error:", err);
  }
}

async function handleGuaranteeSet() {
  if (guaranteeSetBtn.disabled) return;
  if (!monitorUid) {
    showToast("Start monitoring a user first", "error");
    return;
  }
  const giftId = guaranteeGiftSelect.value;
  if (!giftId) {
    showToast("Select a gift first", "error");
    return;
  }
  const selectedText = guaranteeGiftSelect.options[guaranteeGiftSelect.selectedIndex].textContent;
  if (!confirm(`Set guaranteed next pull to "${selectedText}" for the monitored user?`)) return;

  guaranteeSetBtn.disabled = true;
  try {
    const result = await apiCall("POST", `/api/users/${monitorUid}/guarantee-next-pull`, { giftId });
    showToast(`Guarantee set: ${result.giftName} (${result.coinValue} coins)`);
    await loadGuaranteeStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    guaranteeSetBtn.disabled = false;
  }
}

async function handleGuaranteeRevoke() {
  if (guaranteeRevokeBtn.disabled) return;
  if (!monitorUid) return;
  if (!confirm("Revoke the guaranteed next pull for this user?")) return;

  guaranteeRevokeBtn.disabled = true;
  try {
    await apiCall("DELETE", `/api/users/${monitorUid}/guarantee-next-pull`);
    showToast("Guarantee revoked");
    await loadGuaranteeStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    guaranteeRevokeBtn.disabled = false;
  }
}
