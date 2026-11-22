/**
 * Trading Journal Module
 * Strictly Manual Trade Logging:
 * Trades are NEVER automatically logged. They only appear when the user
 * manually logs them via the modal (from the scanner or the journal).
 */

window.JournalModule = {
  STORAGE_KEY: 'alphachart_journal_manual_trades_v1',
  DELETED_KEY: 'alphachart_journal_deleted_ids_v1',
  trades: [],
  pendingAnalysisData: null,
  expandedTradeIds: new Set(),
  _isSyncing: false,

  init: function () {
    this.loadFromStorage();
    this.bindEvents();
    this.bindAutoSyncEvents();
    this.renderTrades();
    this.updateStats();
    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.init();
    }
    // Asynchronously synchronize manual trades with PostgreSQL cloud database
    this.syncWithBackend();
  },

  bindAutoSyncEvents: function () {
    const self = this;
    // Automatically re-sync when switching between tabs or apps
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        self.syncWithBackend();
      }
    });
    window.addEventListener('focus', () => {
      self.syncWithBackend();
    });
  },

  getAuthEmail: function () {
    try {
      const email = localStorage.getItem('alphachart_auth_email');
      if (email && typeof email === 'string' && email.includes('@')) {
        return email.trim().toLowerCase();
      }
    } catch (e) { }
    return null;
  },

  getDeletedIds: function () {
    try {
      const raw = localStorage.getItem(this.DELETED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(Number));
      }
    } catch (e) { }
    return new Set();
  },

  markTradeDeleted: function (tradeId) {
    if (!tradeId) return;
    try {
      const set = this.getDeletedIds();
      set.add(Number(tradeId));
      localStorage.setItem(this.DELETED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { }
  },

  unmarkTradeDeleted: function (tradeId) {
    if (!tradeId) return;
    try {
      const set = this.getDeletedIds();
      set.delete(Number(tradeId));
      localStorage.setItem(this.DELETED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { }
  },

  syncWithBackend: async function () {
    const email = this.getAuthEmail();
    if (!email || this._isSyncing) return;
    this._isSyncing = true;

    try {
      const res = await fetch(`/api/journal/trades?email=${encodeURIComponent(email)}&_t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !Array.isArray(data.trades)) return;

      const cloudTrades = data.trades;
      const deletedIds = this.getDeletedIds();
      const localTrades = Array.isArray(this.trades) ? this.trades : [];

      // Clean up server if any locally deleted trades still exist in cloud
      for (const t of cloudTrades) {
        if (deletedIds.has(Number(t.id))) {
          this.deleteTradeFromCloud(t.id);
        }
      }

      // Filter out deleted items from cloud trades
      const activeCloudTrades = cloudTrades.filter(t => !deletedIds.has(Number(t.id)));
      const cloudIds = new Set(activeCloudTrades.map(t => Number(t.id)));

      // Check local trades: only push trades that were genuinely never synced before (synced !== true)
      // and not in deletedIds
      const newLocalTradesToPush = [];
      localTrades.forEach(lt => {
        if (!lt || !lt.id) return;
        const tid = Number(lt.id);
        if (deletedIds.has(tid)) return; // Already deleted! Never push

        if (!cloudIds.has(tid)) {
          // If not in cloud, only upload if it is a new unsynced entry created on this device
          if (lt.synced !== true) {
            newLocalTradesToPush.push(lt);
          }
        }
      });

      // Unified active dataset: cloud trades take precedence
      const unifiedMap = new Map();
      activeCloudTrades.forEach(ct => {
        ct.synced = true;
        unifiedMap.set(Number(ct.id), ct);
      });
      newLocalTradesToPush.forEach(nlt => {
        unifiedMap.set(Number(nlt.id), nlt);
      });

      // Sort descending by timestamp/id
      const finalTrades = Array.from(unifiedMap.values()).sort((a, b) => {
        const tA = Number(a.timestamp || a.id || 0);
        const tB = Number(b.timestamp || b.id || 0);
        return tB - tA;
      });

      // Update state and UI if list changed
      const oldKeys = this.trades.map(t => `${t.id}_${t.pnl}_${t.notes}`).join('|');
      const newKeys = finalTrades.map(t => `${t.id}_${t.pnl}_${t.notes}`).join('|');
      const hasChanged = oldKeys !== newKeys || finalTrades.length !== this.trades.length;

      this.trades = finalTrades;
      this.saveToStorage();

      if (hasChanged) {
        this.renderTrades();
        this.updateStats();
        if (window.MonthlyResultModule) {
          window.MonthlyResultModule.updatePreviewPill();
          if (typeof window.MonthlyResultModule.renderCalendar === 'function') {
            window.MonthlyResultModule.renderCalendar();
          }
        }
      }

      // Push any unsynced local trades to cloud
      if (newLocalTradesToPush.length > 0) {
        const pushed = await this.pushTradesToCloud(newLocalTradesToPush);
        if (pushed) {
          newLocalTradesToPush.forEach(t => { t.synced = true; });
          this.saveToStorage();
        }
      }
    } catch (err) {
      console.warn('[AlphaChart Journal] Sync error:', err);
    } finally {
      this._isSyncing = false;
    }
  },

  pushTradesToCloud: async function (trades) {
    const email = this.getAuthEmail();
    if (!email || !trades || trades.length === 0) return false;

    try {
      const res = await fetch('/api/journal/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, trades })
      });
      return res.ok;
    } catch (err) {
      console.warn('[AlphaChart Journal] Push warning:', err);
      return false;
    }
  },

  deleteTradeFromCloud: async function (tradeId) {
    const email = this.getAuthEmail();
    if (!email || !tradeId) return;

    try {
      const idNum = Number(tradeId);
      await fetch(`/api/journal/trades?email=${encodeURIComponent(email)}&id=${idNum}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, id: idNum })
      });
    } catch (err) {
      console.warn('[AlphaChart Journal] Delete warning:', err);
    }
  },

  deleteAllTradesFromCloud: async function () {
    const email = this.getAuthEmail();
    if (!email) return;

    try {
      await fetch(`/api/journal/trades?email=${encodeURIComponent(email)}&all=true`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, all: true })
      });
    } catch (err) {
      console.warn('[AlphaChart Journal] Delete all from cloud warning:', err);
    }
  },

  toggleTradeFeedback: function (tradeId) {
    const body = document.getElementById(`feedback-body-${tradeId}`);
    const chevron = document.getElementById(`feedback-chevron-${tradeId}`);
    if (!body) return;

    const isHidden = body.classList.contains('hidden');
    if (isHidden) {
      body.classList.remove('hidden');
      if (chevron) {
        chevron.style.transform = 'rotate(180deg)';
      }
      this.expandedTradeIds.add(tradeId);
    } else {
      body.classList.add('hidden');
      if (chevron) {
        chevron.style.transform = 'rotate(0deg)';
      }
      this.expandedTradeIds.delete(tradeId);
    }
  },

  loadFromStorage: function () {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.trades = JSON.parse(stored);
        let needsSave = false;
        this.trades.forEach(t => {
          if (!t.timestamp && t.id) {
            t.timestamp = t.id;
            needsSave = true;
          }
          if (!t.time || t.time === 'Just now') {
            t.time = this.formatTradeTime(t.timestamp || t.id || Date.now());
            needsSave = true;
          }
        });
        if (needsSave) this.saveToStorage();
      } else {
        // Start completely empty - strictly manual logging
        this.trades = [];
      }
    } catch (e) {
      console.warn('Error loading manual trades from storage:', e);
      this.trades = [];
    }
  },

  /**
   * Returns a local ISO string (YYYY-MM-DDTHH:mm) suitable for datetime-local input
   */
  getLocalISOString: function (date) {
    const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
  },

  /**
   * Formats a timestamp into a clean, human-readable trade time string
   * e.g., 'Today, 01:45 AM', 'Yesterday, 11:20 PM', or 'Nov 10, 01:45 AM'
   */
  formatTradeTime: function (timestamp) {
    if (!timestamp) return 'Just now';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return typeof timestamp === 'string' ? timestamp : 'Just now';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return `Today, ${timeStr}`;
    } else if (isYesterday) {
      return `Yesterday, ${timeStr}`;
    } else {
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    }
  },

  saveToStorage: function () {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.trades));
    } catch (e) {
      console.warn('Error saving trades to storage:', e);
    }
  },

  bindEvents: function () {
    const self = this;

    // Log Trade FAB Button in Journal
    const logTradeBtn = document.getElementById('log-trade-btn');
    if (logTradeBtn) {
      logTradeBtn.addEventListener('click', () => self.openManualLogModal());
    }

    // Modal Close
    const closeLogBtn = document.getElementById('close-log-modal-btn');
    const logBackdrop = document.getElementById('manual-log-backdrop');
    if (closeLogBtn) closeLogBtn.addEventListener('click', () => self.closeManualLogModal());
    if (logBackdrop) logBackdrop.addEventListener('click', () => self.closeManualLogModal());

    // Submit Log Form
    const logForm = document.getElementById('manual-log-form');
    if (logForm) {
      logForm.addEventListener('submit', (e) => {
        e.preventDefault();
        self.submitManualTrade();
      });
    }

    // AI Coach Chat Button
    const coachBtn = document.getElementById('ai-coach-chat-btn');
    if (coachBtn) {
      coachBtn.addEventListener('click', () => self.openCoachChat());
    }
  },

  /**
   * Opens the manual logging setup modal.
   * If prefillData is passed (e.g., when the user clicks 'Log Trade to Journal' on the scanner),
   * the pair, direction, and analysis notes are prefilled.
   */
  openManualLogModal: function (prefillData) {
    this.pendingAnalysisData = prefillData || null;

    const pairInput = document.getElementById('log-pair-input');
    const typeSelect = document.getElementById('log-type-select');
    const notesInput = document.getElementById('log-notes-input');
    const pnlInput = document.getElementById('log-pnl-input');
    const timeInput = document.getElementById('log-time-input');

    if (timeInput) {
      timeInput.value = this.getLocalISOString();
    }

    if (prefillData) {
      if (pairInput) pairInput.value = prefillData.pair || '';
      if (typeSelect) typeSelect.value = prefillData.signal || 'LONG';
      if (notesInput) {
        notesInput.value = prefillData.pattern
          ? `Analysis Target: ${prefillData.tp1 || '--'}. Pattern: ${prefillData.pattern}.`
          : 'Scanned setup from AlphaChart AI.';
      }
      if (pnlInput) pnlInput.value = '';
    } else {
      if (pairInput) pairInput.value = '';
      if (pnlInput) pnlInput.value = '';
      if (notesInput) notesInput.value = '';
    }

    const modal = document.getElementById('manual-log-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      setTimeout(() => {
        if (pnlInput) pnlInput.focus();
      }, 50);
    }
  },

  closeManualLogModal: function () {
    const modal = document.getElementById('manual-log-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.pendingAnalysisData = null;
  },

  /**
   * Submits the manual log form and directly reflects the trade in the journal
   */
  submitManualTrade: function () {
    const pair = document.getElementById('log-pair-input').value.trim() || 'BTC / USDT';
    const type = document.getElementById('log-type-select').value || 'LONG';
    const pnl = document.getElementById('log-pnl-input').value.trim() || '+$0.00';
    const observation = document.getElementById('log-notes-input').value.trim() || 'Manual execution logged.';
    const timeInput = document.getElementById('log-time-input');

    const tradeTimestamp = timeInput && timeInput.value ? new Date(timeInput.value).getTime() : Date.now();
    const formattedTime = this.formatTradeTime(tradeTimestamp);

    const isProfit = !pnl.startsWith('-') && !pnl.toLowerCase().includes('loss');
    const entryPrice = this.pendingAnalysisData && this.pendingAnalysisData.entry ? this.pendingAnalysisData.entry : '--';
    const market = this.pendingAnalysisData && this.pendingAnalysisData.market ? this.pendingAnalysisData.market : 'Manual';

    const newTrade = {
      id: Date.now(),
      pair: pair.toUpperCase(),
      market: market,
      type: type,
      timestamp: tradeTimestamp,
      time: formattedTime,
      entryPrice: entryPrice,
      pnl: pnl,
      isProfit: isProfit,
      notes: observation,
      userOutcomePnl: pnl,
      userObservation: observation,
      feedbackSaved: true,
      synced: false
    };

    // Ensure this trade ID is not in deleted set
    this.unmarkTradeDeleted(newTrade.id);

    // Add to journal list
    this.trades.unshift(newTrade);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();
    this.closeManualLogModal();

    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.updatePreviewPill();
      if (typeof window.MonthlyResultModule.renderCalendar === 'function') {
        window.MonthlyResultModule.renderCalendar();
      }
    }

    const self = this;
    this.pushTradesToCloud([newTrade]).then(ok => {
      if (ok) {
        newTrade.synced = true;
        self.saveToStorage();
      }
    });

    // Navigate to trading journal so user sees it reflected immediately
    if (window.App) {
      window.App.navigateTo('trading-journal');
      window.App.showToast(`Logged ${pair.toUpperCase()} at ${formattedTime}!`);
    }
  },

  /**
   * 1-Click Direct Trade Logging from Trend Trader Signals Log or Scanner
   */
  logTradeDirect: function (tradeData) {
    if (!tradeData) return null;

    const pair = (tradeData.pair || 'AAVE / USDT').toUpperCase();
    const rawType = (tradeData.type || 'BUY').toUpperCase();
    const type = (rawType === 'BUY' || rawType === 'LONG') ? 'LONG' : 'SHORT';
    const entryPrice = tradeData.entryPrice ? `$${Number(tradeData.entryPrice).toFixed(2)}` : '--';
    const exitPrice = tradeData.exitPrice ? `$${Number(tradeData.exitPrice).toFixed(2)}` : '--';

    const pnlVal = typeof tradeData.pnl === 'number' ? tradeData.pnl : (parseFloat(tradeData.pnl) || 0);
    const isProfit = tradeData.isWin !== undefined ? !!tradeData.isWin : (pnlVal >= 0);
    const pnlFormatted = pnlVal >= 0 ? `+$${pnlVal.toFixed(2)}` : `-$${Math.abs(pnlVal).toFixed(2)}`;

    const tradeTimestamp = tradeData.timestamp || Date.now();
    const formattedTime = this.formatTradeTime(tradeTimestamp);
    const notes = tradeData.notes || `Trend Trader 10x Setup (${type}). Entry: ${entryPrice}, Exit: ${exitPrice}. ${tradeData.reason || ''}`;

    const newTrade = {
      id: Date.now(),
      pair: pair,
      market: 'Crypto',
      type: type,
      timestamp: tradeTimestamp,
      time: formattedTime,
      entryPrice: entryPrice,
      pnl: pnlFormatted,
      isProfit: isProfit,
      notes: notes,
      userOutcomePnl: pnlFormatted,
      userObservation: notes,
      feedbackSaved: true,
      synced: false
    };

    // Ensure this trade ID is not in deleted set
    this.unmarkTradeDeleted(newTrade.id);

    // Add directly to journal list
    this.trades.unshift(newTrade);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();

    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.updatePreviewPill();
      if (typeof window.MonthlyResultModule.renderCalendar === 'function') {
        window.MonthlyResultModule.renderCalendar();
      }
    }

    const self = this;
    this.pushTradesToCloud([newTrade]).then(ok => {
      if (ok) {
        newTrade.synced = true;
        self.saveToStorage();
      }
    });

    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`Saved ${pair} (${type}) to Journal! (${pnlFormatted})`);
    }

    return newTrade;
  },

  /**
   * Saves or updates feedback on any existing logged trade
   */
  saveFeedback: function (tradeId) {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    const pnlInput = document.getElementById(`feedback-pnl-${tradeId}`);
    const obsInput = document.getElementById(`feedback-obs-${tradeId}`);
    const timeInput = document.getElementById(`feedback-time-${tradeId}`);

    const pnlVal = pnlInput ? pnlInput.value.trim() : '';
    const obsVal = obsInput ? obsInput.value.trim() : '';
    const timeVal = timeInput ? timeInput.value : '';

    if (pnlVal) {
      trade.userOutcomePnl = pnlVal;
      trade.pnl = pnlVal;
      trade.isProfit = !pnlVal.startsWith('-') && !pnlVal.toLowerCase().includes('loss');
    }

    if (obsVal) {
      trade.userObservation = obsVal;
      trade.notes = obsVal;
    }

    if (timeVal) {
      const parsedTime = new Date(timeVal).getTime();
      if (!isNaN(parsedTime)) {
        trade.timestamp = parsedTime;
        trade.time = this.formatTradeTime(parsedTime);
      }
    }

    trade.feedbackSaved = true;
    this.expandedTradeIds.add(tradeId);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();
    this.pushTradesToCloud([trade]);

    if (window.App) {
      window.App.showToast(`Feedback & time updated for ${trade.pair}!`);
    }
  },

  deleteTrade: function (tradeId) {
    if (!tradeId) return;
    const tid = Number(tradeId);

    // 1. Immediately mark this trade ID as deleted so it can NEVER be resurrected
    this.markTradeDeleted(tid);

    // 2. Remove immediately from local state & storage
    this.trades = this.trades.filter(t => Number(t.id) !== tid);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();

    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.updatePreviewPill();
      if (typeof window.MonthlyResultModule.renderCalendar === 'function') {
        window.MonthlyResultModule.renderCalendar();
      }
    }

    // 3. Delete from cloud database
    this.deleteTradeFromCloud(tid);

    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast('Trade removed from Journal');
    }
  },

  clearAllTrades: function () {
    if (confirm('Are you sure you want to clear all trades in your journal?')) {
      // Mark all current trades as deleted
      this.trades.forEach(t => { if (t && t.id) this.markTradeDeleted(t.id); });
      this.trades = [];
      this.saveToStorage();
      this.renderTrades();
      this.updateStats();

      if (window.MonthlyResultModule) {
        window.MonthlyResultModule.updatePreviewPill();
        if (typeof window.MonthlyResultModule.renderCalendar === 'function') {
          window.MonthlyResultModule.renderCalendar();
        }
      }

      this.deleteAllTradesFromCloud();
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast('Journal reset to empty');
      }
    }
  },

  renderTrades: function () {
    const container = document.getElementById('journal-trades-list');
    if (!container) return;

    if (this.trades.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 px-5 text-on-surface-variant/70 bg-[#181c24] rounded-2xl border border-white/5 flex flex-col items-center gap-3">
          <div class="w-14 h-14 rounded-full bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-primary-container text-[28px]">history_edu</span>
          </div>
          <h4 class="font-display font-bold text-white text-base">No Trades in Journal</h4>
          <p class="text-xs text-on-surface-variant max-w-[280px] leading-relaxed">
            Trades are never logged automatically. Use the <strong class="text-primary-container">+ Log Trade</strong> button below or scan a chart and click <strong class="text-primary-container">Log Trade to Journal</strong> to log manually.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.trades.map(t => {
      const pnlDisplayClass = t.isProfit ? 'text-primary-container' : 'text-error';
      const displayTime = this.formatTradeTime(t.timestamp || t.id || t.time);
      const isExpanded = this.expandedTradeIds && this.expandedTradeIds.has(t.id);

      return `
        <div class="bg-[#1c1c1e] border border-white/[0.08] rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 transition-all shadow-sm">
          
          <!-- Header: Pair, Direction, Time & Outcome PnL -->
          <div class="flex justify-between items-start gap-2">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-[#2c2c2e] border border-white/[0.08] flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined ${t.isProfit ? 'text-primary-container' : 'text-error'} text-[22px]">
                  ${t.market === 'Crypto' ? 'currency_bitcoin' : t.market === 'Gold' ? 'paid' : 'candlestick_chart'}
                </span>
              </div>
              <div>
                <p class="font-bold text-sm sm:text-base text-white">${t.pair}</p>
                <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span class="text-[10px] px-2 py-0.5 rounded ${t.type === 'LONG' ? 'bg-primary-container/15 text-primary-container' : 'bg-error/15 text-error'} uppercase font-bold tracking-wider">
                    ${t.type}
                  </span>
                  <span class="text-[11px] text-on-surface-variant flex items-center gap-1 font-mono">
                    <span class="material-symbols-outlined text-[13px] text-primary-container">schedule</span>
                    ${displayTime}
                  </span>
                  ${t.entryPrice && t.entryPrice !== '--' ? `<span class="text-[11px] text-[#38bdf8] font-mono">• Entry: ${t.entryPrice}</span>` : ''}
                </div>
              </div>
            </div>

            <div class="text-right flex flex-col items-end">
              <p class="font-mono text-base font-bold ${pnlDisplayClass}">${t.pnl}</p>
              <button onclick="window.JournalModule.deleteTrade(${t.id})" class="text-[11px] text-on-surface-variant/40 hover:text-error transition-colors mt-1" title="Delete trade">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>

          <!-- Trade Setup Summary Note -->
          <div class="bg-[#2c2c2e] border border-white/[0.06] rounded-xl px-3.5 py-2.5">
            <p class="text-xs text-on-surface-variant leading-relaxed">
              <span class="text-white/90 font-medium">Observation:</span> ${t.notes}
            </p>
          </div>

          <!-- Expandable Dropdown Box: Outcome & Observation -->
          <div class="bg-[#2c2c2e] border border-white/[0.08] rounded-xl overflow-hidden transition-all">
            
            <!-- Clickable Dropdown Header -->
            <button type="button" 
                    onclick="window.JournalModule.toggleTradeFeedback(${t.id})"
                    class="w-full p-3 flex items-center justify-between hover:bg-[#3a3a3c] transition-colors cursor-pointer group text-left">
              <div class="flex items-center gap-2 min-w-0">
                <span class="material-symbols-outlined text-primary-container text-[18px] shrink-0">edit_note</span>
                <span class="text-xs font-semibold text-white group-hover:text-primary-container transition-colors truncate">Outcome & Observation</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary-container/15 text-primary-container border border-primary-container/30">
                  ✓ Manually Logged
                </span>
                <span id="feedback-chevron-${t.id}" 
                      class="material-symbols-outlined text-on-surface-variant text-[18px] transition-transform duration-200"
                      style="transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}">
                  expand_more
                </span>
              </div>
            </button>

            <!-- Collapsible Body Content -->
            <div id="feedback-body-${t.id}" class="${isExpanded ? '' : 'hidden'} p-3.5 pt-1 border-t border-white/[0.06] flex flex-col gap-3">
              
              <!-- Row 1: Win or Loss & Execution Time -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                    Win or Loss
                  </label>
                  <input 
                    type="text" 
                    id="feedback-pnl-${t.id}" 
                    value="${t.userOutcomePnl || t.pnl || ''}" 
                    placeholder="e.g. +$450.00 or -$120.00" 
                    class="w-full bg-[#000000] border border-white/[0.1] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container transition-all"
                  />
                </div>

                <div>
                  <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                    Execution Time
                  </label>
                  <input 
                    type="datetime-local" 
                    id="feedback-time-${t.id}" 
                    value="${this.getLocalISOString(new Date(t.timestamp || t.id || Date.now()))}" 
                    style="color-scheme: dark;"
                    class="w-full bg-[#000000] border border-white/[0.1] rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary-container transition-all"
                  />
                </div>
              </div>

              <!-- Row 2: Your observation -->
              <div>
                <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                  Your observation
                </label>
                <textarea 
                  id="feedback-obs-${t.id}" 
                  rows="2" 
                  placeholder="Review what worked, execution discipline, or lessons learned..." 
                  class="w-full bg-[#000000] border border-white/[0.1] rounded-lg p-2.5 text-xs text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container resize-none transition-all leading-relaxed"
                >${t.userObservation || t.notes || ''}</textarea>
              </div>

              <!-- Save Feedback Action -->
              <div class="flex items-center justify-between pt-1">
                <span class="text-[10px] text-on-surface-variant/70">
                  Update outcome or observation
                </span>
                <button 
                  onclick="window.JournalModule.saveFeedback(${t.id})" 
                  class="px-3.5 py-1.5 rounded-xl bg-primary-container text-black font-bold text-xs flex items-center gap-1.5 active:scale-95 hover:brightness-105 transition-all shadow-sm">
                  <span class="material-symbols-outlined text-[15px]">save</span>
                  <span>Update Feedback</span>
                </button>
              </div>

            </div>

          </div>

        </div>
      `;
    }).join('');
  },

  updateStats: function () {
    const totalTrades = this.trades.length;
    const totalTradesEl = document.getElementById('journal-total-trades-val');
    const winRateEl = document.getElementById('journal-win-rate-val');
    const pnlEl = document.getElementById('journal-total-pnl-val');

    if (totalTradesEl) totalTradesEl.innerText = totalTrades.toString();

    if (totalTrades === 0) {
      if (winRateEl) winRateEl.innerText = '--';
      if (pnlEl) pnlEl.innerText = '$0.00';
      return;
    }

    let wins = 0;
    let totalPnlNum = 0;

    this.trades.forEach(t => {
      if (t.isProfit) wins++;

      const numMatch = (t.pnl || '').replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(numMatch);
      if (!isNaN(parsed)) {
        if ((t.pnl || '').includes('-')) {
          totalPnlNum -= Math.abs(parsed);
        } else {
          totalPnlNum += Math.abs(parsed);
        }
      }
    });

    const winRate = Math.round((wins / totalTrades) * 100);
    if (winRateEl) winRateEl.innerText = `${winRate}%`;
    if (pnlEl) {
      const formatted = totalPnlNum >= 0 ? `+$${totalPnlNum.toFixed(2)}` : `-$${Math.abs(totalPnlNum).toFixed(2)}`;
      pnlEl.innerText = formatted;
    }

    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.updatePreviewPill();
    }
  },

  openCoachChat: function () {
    if (window.AICoachModule && typeof window.AICoachModule.openModal === 'function') {
      window.AICoachModule.openModal();
    }
  }
};

/**
 * Monthly Result & Target Module
 * Provides calendar visualization of monthly trading P&L, daily breakdown, and progress against monthly target.
 * Strictly independent: reads and displays logged trades without mutating or overwriting the journal.
 */
window.MonthlyResultModule = {
  TARGET_STORAGE_KEY_MONTH: 'alphachart_monthly_target_v1',
  TARGET_STORAGE_KEY_WEEK: 'alphachart_weekly_target_v1',
  TARGET_STORAGE_KEY_YEAR: 'alphachart_annual_target_v1',
  TARGET_STORAGE_KEY_ALL: 'alphachart_alltime_target_v1',

  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth(), // 0-indexed: 10 = November
  selectedWeekOffset: 0,
  selectedPeriod: 'month', // 'week', 'month', 'year', 'all'
  viewMode: 'all7', // 'all7' (Mon-Sun, 7 Days default) or 'weekdays' (Mon-Fri)

  init: function () {
    this.bindEvents();
    this.updatePreviewPill();
    this.fetchDailySignals();
  },

  fetchDailySignals: async function (monthStr) {
    try {
      const mStr = monthStr || `${this.selectedYear}-${String(this.selectedMonth + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/signals/daily?pair=BTC/USDT&timeframe=5m&month=${mStr}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.success && data.records) {
        if (!this.dailySignalsCache || typeof this.dailySignalsCache !== 'object') {
          this.dailySignalsCache = {};
        }
        Object.assign(this.dailySignalsCache, data.records);
        try {
          localStorage.setItem('alphachart_daily_signals_cache_v1', JSON.stringify(this.dailySignalsCache));
        } catch (e) { }
        this.updatePreviewPill();
        if (typeof this.render === 'function') {
          this.render();
        }
      }
    } catch (e) {
      // Non-blocking fallback
    }
  },

  getTargetGoal: function (period) {
    const p = period || this.selectedPeriod;
    let key = this.TARGET_STORAGE_KEY_MONTH;
    let def = 3000;
    if (p === 'week') { key = this.TARGET_STORAGE_KEY_WEEK; def = 750; }
    else if (p === 'year') { key = this.TARGET_STORAGE_KEY_YEAR; def = 36000; }
    else if (p === 'all') { key = this.TARGET_STORAGE_KEY_ALL; def = 50000; }

    const raw = localStorage.getItem(key);
    const parsed = parseFloat(raw);
    return (!isNaN(parsed) && parsed > 0) ? parsed : def;
  },

  setTargetGoal: function (val, period) {
    const p = period || this.selectedPeriod;
    let key = this.TARGET_STORAGE_KEY_MONTH;
    let label = 'Monthly';
    if (p === 'week') { key = this.TARGET_STORAGE_KEY_WEEK; label = 'Weekly'; }
    else if (p === 'year') { key = this.TARGET_STORAGE_KEY_YEAR; label = 'Annual'; }
    else if (p === 'all') { key = this.TARGET_STORAGE_KEY_ALL; label = 'Career'; }

    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      localStorage.setItem(key, num.toString());
      this.render();
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast(`🎯 ${label} target updated to $${num.toLocaleString()}!`);
      }
    }
  },

  formatDateKey: function (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  getWeekRange: function (offset = 0) {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const distToMonday = (currentDay === 0 ? 6 : currentDay - 1);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      days.push(d);
    }
    return { monday, sunday: days[6], days };
  },

  /**
   * Builds unified trading dataset from:
   * 1. Confirmed system signals on active days (Thu Nov 12, Fri Nov 13, Sat Nov 14)
   * 2. Live evaluated signals from TrendTraderEngine for today
   * 3. User's manual logged journal trades from JournalModule.trades
   * Days with no trades contain 0 trades and render as '—' (no fake placeholders).
   */
  getUnifiedTradesMap: function () {
    const dateMap = {}; // 'YYYY-MM-DD' -> { dateKey, year, month, dayNum, pnl, count, trades: [] }

    // 1. Confirmed system trading records
    const baselineRecords = {
      '2026-11-12': {
        dateKey: '2026-11-12',
        trades: [
          { time: '02:15', pair: 'BTC / USDT', type: 'BUY', pnl: '+$12.50', isWin: true },
          { time: '04:30', pair: 'BTC / USDT', type: 'SELL', pnl: '+$45.20', isWin: true },
          { time: '06:10', pair: 'BTC / USDT', type: 'BUY', pnl: '-$5.00', isWin: false },
          { time: '08:25', pair: 'BTC / USDT', type: 'BUY', pnl: '-$5.00', isWin: false },
          { time: '10:40', pair: 'BTC / USDT', type: 'SELL', pnl: '-$5.00', isWin: false },
          { time: '12:15', pair: 'BTC / USDT', type: 'BUY', pnl: '+$26.39', isWin: true },
          { time: '14:00', pair: 'BTC / USDT', type: 'SELL', pnl: '-$5.00', isWin: false },
          { time: '15:45', pair: 'BTC / USDT', type: 'BUY', pnl: '-$5.00', isWin: false },
          { time: '17:30', pair: 'BTC / USDT', type: 'SELL', pnl: '-$5.00', isWin: false },
          { time: '19:10', pair: 'BTC / USDT', type: 'BUY', pnl: '+$10.00', isWin: true },
          { time: '21:00', pair: 'BTC / USDT', type: 'SELL', pnl: '+$186.96', isWin: true },
          { time: '22:50', pair: 'BTC / USDT', type: 'SELL', pnl: '-$5.00', isWin: false }
        ]
      },
      '2026-11-13': {
        dateKey: '2026-11-13',
        trades: [
          { time: '03:20', pair: 'BTC / USDT', type: 'SELL', pnl: '+$62.50', isWin: true },
          { time: '05:45', pair: 'BTC / USDT', type: 'BUY', pnl: '+$45.20', isWin: true },
          { time: '08:15', pair: 'BTC / USDT', type: 'BUY', pnl: '+$70.51', isWin: true },
          { time: '11:30', pair: 'BTC / USDT', type: 'SELL', pnl: '+$84.60', isWin: true },
          { time: '14:10', pair: 'BTC / USDT', type: 'BUY', pnl: '-$5.00', isWin: false },
          { time: '16:40', pair: 'BTC / USDT', type: 'SELL', pnl: '+$50.00', isWin: true },
          { time: '19:25', pair: 'BTC / USDT', type: 'SELL', pnl: '+$50.00', isWin: true },
          { time: '22:15', pair: 'BTC / USDT', type: 'BUY', pnl: '+$58.54', isWin: true }
        ]
      },
      '2026-11-14': {
        dateKey: '2026-11-14',
        trades: [
          { time: '02:40', pair: 'AAVE / USDT', type: 'SELL', pnl: '+$55.14', isWin: true },
          { time: '05:15', pair: 'AAVE / USDT', type: 'BUY', pnl: '+$14.71', isWin: true },
          { time: '08:30', pair: 'AAVE / USDT', type: 'BUY', pnl: '-$5.00', isWin: false },
          { time: '11:20', pair: 'AAVE / USDT', type: 'SELL', pnl: '+$48.20', isWin: true },
          { time: '14:05', pair: 'AAVE / USDT', type: 'BUY', pnl: '+$15.06', isWin: true },
          { time: '16:50', pair: 'AAVE / USDT', type: 'SELL', pnl: '+$61.90', isWin: true }
        ]
      }
    };

    for (const k of Object.keys(baselineRecords)) {
      const rec = baselineRecords[k];
      const [y, m, d] = k.split('-').map(Number);
      let dayPnl = 0;
      for (const tr of rec.trades) {
        const pVal = parseFloat((tr.pnl || '').replace(/[^0-9.-]/g, '')) * ((tr.pnl || '').includes('-') ? -1 : 1);
        if (!isNaN(pVal)) dayPnl += pVal;
      }
      dateMap[k] = {
        dateKey: k,
        year: y,
        month: m - 1,
        dayNum: d,
        pnl: Math.round(dayPnl * 100) / 100,
        count: rec.trades.length,
        trades: [...rec.trades]
      };
    }

    // 2. Verified Daily Signal Records from PostgreSQL / API (all completed days)
    try {
      const cachedRecords = this.dailySignalsCache || (() => {
        try {
          const raw = localStorage.getItem('alphachart_daily_signals_cache_v1');
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      })();

      if (cachedRecords && typeof cachedRecords === 'object') {
        for (const dKey of Object.keys(cachedRecords)) {
          // If already set by baseline (Nov 12, 13, 14), baseline takes precedence
          if (dateMap[dKey] && dateMap[dKey].count > 0) continue;
          const rec = cachedRecords[dKey];
          if (!rec) continue;
          const [y, m, d] = dKey.split('-').map(Number);
          const evalList = Array.isArray(rec.evaluatedSignals) ? rec.evaluatedSignals : [];
          const tradesList = evalList.map(s => {
            const pVal = typeof s.pnl === 'number' ? s.pnl : parseFloat(s.pnl || 0);
            return {
              time: s.timeFormatted || (s.time ? new Date(s.time * 1000).toTimeString().slice(0, 5) : '--:--'),
              pair: rec.pair || 'BTC / USDT',
              type: s.type || 'BUY',
              pnl: pVal >= 0 ? `+$${pVal.toFixed(2)}` : `-$${Math.abs(pVal).toFixed(2)}`,
              isWin: s.outcome === 'win' || pVal >= 0
            };
          });
          dateMap[dKey] = {
            dateKey: dKey,
            year: y,
            month: m - 1,
            dayNum: d,
            pnl: Math.round((rec.netPnl || 0) * 100) / 100,
            count: tradesList.length,
            trades: tradesList
          };
        }
      }
    } catch (err) {
      console.warn('Error incorporating daily signal records:', err);
    }

    // 3. Live evaluated signals from TrendTraderEngine (for today / active session)
    try {
      if (window.TrendTraderEngine && window.TrendTraderEngine.lastPerformance) {
        const evalSignals = window.TrendTraderEngine.lastPerformance.evaluatedSignals;
        if (Array.isArray(evalSignals) && evalSignals.length > 0) {
          const todayKey = new Date().toISOString().slice(0, 10);
          const liveByDate = {};
          for (const s of evalSignals) {
            const dKey = s.dateKey || (s.time ? new Date(s.time * 1000).toISOString().slice(0, 10) : null);
            if (!dKey) continue;
            // Only update today or days without historical daily record
            if (dKey === todayKey || !dateMap[dKey] || dateMap[dKey].count === 0) {
              if (!liveByDate[dKey]) liveByDate[dKey] = [];
              const pVal = typeof s.pnl === 'number' ? s.pnl : parseFloat(s.pnl || 0);
              const pnlStr = pVal >= 0 ? `+$${pVal.toFixed(2)}` : `-$${Math.abs(pVal).toFixed(2)}`;
              liveByDate[dKey].push({
                time: s.timeFormatted || (s.time ? new Date(s.time * 1000).toTimeString().slice(0, 5) : '--:--'),
                pair: s.pair || (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || 'BTC / USDT',
                type: s.type || 'BUY',
                pnl: pnlStr,
                isWin: s.outcome === 'win' || pVal >= 0
              });
            }
          }
          for (const dKey of Object.keys(liveByDate)) {
            const [y, m, d] = dKey.split('-').map(Number);
            let sumPnl = 0;
            for (const t of liveByDate[dKey]) {
              const pVal = parseFloat((t.pnl || '').replace(/[^0-9.-]/g, '')) * ((t.pnl || '').includes('-') ? -1 : 1);
              if (!isNaN(pVal)) sumPnl += pVal;
            }
            dateMap[dKey] = {
              dateKey: dKey,
              year: y,
              month: m - 1,
              dayNum: d,
              pnl: Math.round(sumPnl * 100) / 100,
              count: liveByDate[dKey].length,
              trades: liveByDate[dKey]
            };
          }
        }
      }
    } catch (err) {
      console.warn('Error incorporating live TrendTraderEngine signals:', err);
    }

    // 4. User manual logged journal trades
    try {
      const userTrades = (window.JournalModule && Array.isArray(window.JournalModule.trades))
        ? window.JournalModule.trades
        : [];
      for (const t of userTrades) {
        let dObj = null;
        if (t.timestamp) dObj = new Date(t.timestamp);
        else if (t.date) dObj = new Date(t.date);
        else if (t.id && !isNaN(Number(t.id))) dObj = new Date(Number(t.id));

        if (dObj && !isNaN(dObj.getTime())) {
          const dKey = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(dObj.getDate()).padStart(2, '0')}`;
          if (!dateMap[dKey]) {
            dateMap[dKey] = {
              dateKey: dKey,
              year: dObj.getFullYear(),
              month: dObj.getMonth(),
              dayNum: dObj.getDate(),
              pnl: 0,
              count: 0,
              trades: []
            };
          }

          const numMatch = (t.pnl || '').toString().replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(numMatch);
          let pVal = 0;
          if (!isNaN(parsed)) {
            pVal = (t.pnl || '').toString().includes('-') ? -Math.abs(parsed) : Math.abs(parsed);
            dateMap[dKey].pnl = Math.round((dateMap[dKey].pnl + pVal) * 100) / 100;
          }
          dateMap[dKey].count += 1;
          const isWin = pVal >= 0;
          dateMap[dKey].trades.push({
            time: t.time || `${String(dObj.getHours()).padStart(2, '0')}:${String(dObj.getMinutes()).padStart(2, '0')}`,
            pair: t.pair || 'BTC / USDT',
            type: t.type || 'LONG',
            pnl: t.pnl || (pVal >= 0 ? `+$${pVal.toFixed(2)}` : `-$${Math.abs(pVal).toFixed(2)}`),
            isWin
          });
        }
      }
    } catch (err) {
      console.warn('Error merging manual journal trades:', err);
    }

    return dateMap;
  },

  bindEvents: function () {
    const self = this;

    // Open button under AI Discipline Coach
    const openBtn = document.getElementById('btn-open-monthly-result');
    if (openBtn) {
      openBtn.addEventListener('click', () => self.openModal());
    }

    // Modal close buttons
    const closeBtn = document.getElementById('monthly-result-close-btn');
    const closeXBtn = document.getElementById('monthly-result-close-x-btn');
    const backdrop = document.getElementById('monthly-result-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', () => self.closeModal());
    if (closeXBtn) closeXBtn.addEventListener('click', () => self.closeModal());
    if (backdrop) backdrop.addEventListener('click', () => self.closeModal());

    // Navigation buttons (< and >)
    const prevBtn = document.getElementById('monthly-nav-prev');
    const nextBtn = document.getElementById('monthly-nav-next');
    if (prevBtn) prevBtn.addEventListener('click', () => self.navigate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => self.navigate(1));

    // Timeframe switch pills (Week, Month, Year, All time)
    document.querySelectorAll('.monthly-period-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-period') || 'month';
        self.setPeriod(p);
      });
    });

    // View mode: Permanent 7 Days (Mon-Sun)
    self.viewMode = 'all7';

    // Goal edit modal
    const editGoalBtn = document.getElementById('btn-edit-monthly-goal');
    const closeGoalBtn = document.getElementById('monthly-goal-edit-close');
    const cancelGoalBtn = document.getElementById('monthly-goal-cancel-btn');
    const saveGoalBtn = document.getElementById('monthly-goal-save-btn');
    const goalBackdrop = document.getElementById('monthly-goal-edit-backdrop');

    if (editGoalBtn) editGoalBtn.addEventListener('click', () => self.openGoalModal());
    if (closeGoalBtn) closeGoalBtn.addEventListener('click', () => self.closeGoalModal());
    if (cancelGoalBtn) cancelGoalBtn.addEventListener('click', () => self.closeGoalModal());
    if (goalBackdrop) goalBackdrop.addEventListener('click', () => self.closeGoalModal());
    if (saveGoalBtn) {
      saveGoalBtn.addEventListener('click', () => {
        const input = document.getElementById('monthly-goal-input');
        if (input && input.value) {
          self.setTargetGoal(input.value, self.selectedPeriod);
          self.closeGoalModal();
        }
      });
    }

    // Day details drawer close
    const dayDetailsClose = document.getElementById('monthly-day-details-close');
    if (dayDetailsClose) {
      dayDetailsClose.addEventListener('click', () => {
        const panel = document.getElementById('monthly-day-details-panel');
        if (panel) panel.classList.add('hidden');
      });
    }
  },

  openModal: function () {
    const modal = document.getElementById('monthly-result-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      this.render();
    }
  },

  closeModal: function () {
    const modal = document.getElementById('monthly-result-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    const dayPanel = document.getElementById('monthly-day-details-panel');
    if (dayPanel) dayPanel.classList.add('hidden');
  },

  openGoalModal: function () {
    const modal = document.getElementById('monthly-goal-edit-modal');
    const input = document.getElementById('monthly-goal-input');
    const title = document.querySelector('#monthly-goal-edit-modal h4');
    if (modal) {
      let label = 'Monthly';
      if (this.selectedPeriod === 'week') label = 'Weekly';
      else if (this.selectedPeriod === 'year') label = 'Annual';
      else if (this.selectedPeriod === 'all') label = 'Career';

      if (title) title.innerText = `Adjust ${label} Target`;
      if (input) input.value = this.getTargetGoal(this.selectedPeriod);
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      setTimeout(() => { if (input) input.focus(); }, 50);
    }
  },

  closeGoalModal: function () {
    const modal = document.getElementById('monthly-goal-edit-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  },

  setPeriod: function (period) {
    this.selectedPeriod = period;
    document.querySelectorAll('.monthly-period-pill').forEach(b => {
      if (b.getAttribute('data-period') === period) {
        b.className = 'monthly-period-pill active flex-1 py-1.5 rounded-lg text-xs font-bold bg-primary-container text-black shadow-sm transition-all text-center';
      } else {
        b.className = 'monthly-period-pill flex-1 py-1.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white transition-all text-center';
      }
    });
    this.render();
  },

  navigate: function (delta) {
    if (this.selectedPeriod === 'week') {
      this.selectedWeekOffset += delta;
      this.render();
    } else if (this.selectedPeriod === 'month') {
      this.changeMonth(delta);
    } else if (this.selectedPeriod === 'year') {
      this.selectedYear += delta;
      this.render();
    }
  },

  changeMonth: function (delta) {
    let m = this.selectedMonth + delta;
    let y = this.selectedYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    this.selectedMonth = m;
    this.selectedYear = y;
    this.fetchDailySignals();
    this.render();
  },

  openMonthView: function (year, month) {
    this.selectedYear = year;
    this.selectedMonth = month;
    this.setPeriod('month');
  },

  openYearView: function (year) {
    this.selectedYear = year;
    this.setPeriod('year');
  },

  render: function () {
    // Sync subbar row visibility
    const subbarRow = document.getElementById('monthly-subbar-row');
    const prevBtn = document.getElementById('monthly-nav-prev');
    const nextBtn = document.getElementById('monthly-nav-next');

    if (this.selectedPeriod === 'week' || this.selectedPeriod === 'month') {
      if (subbarRow) subbarRow.style.display = 'flex';
      if (prevBtn) prevBtn.style.opacity = '1';
      if (nextBtn) nextBtn.style.opacity = '1';
    } else {
      if (subbarRow) subbarRow.style.display = 'none';
      if (prevBtn) prevBtn.style.opacity = (this.selectedPeriod === 'all') ? '0.2' : '1';
      if (nextBtn) nextBtn.style.opacity = (this.selectedPeriod === 'all') ? '0.2' : '1';
    }

    if (this.selectedPeriod === 'week') {
      this.renderWeekView();
    } else if (this.selectedPeriod === 'year') {
      this.renderYearView();
    } else if (this.selectedPeriod === 'all') {
      this.renderAllTimeView();
    } else {
      this.renderMonthView();
    }

    this.updatePreviewPill();
  },

  renderWeekView: function () {
    const weekInfo = this.getWeekRange(this.selectedWeekOffset);
    const monday = weekInfo.monday;
    const sunday = weekInfo.sunday;

    const monthShorts = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startStr = `${monthShorts[monday.getMonth()]} ${monday.getDate()}`;
    const endStr = (monday.getMonth() === sunday.getMonth())
      ? `${sunday.getDate()}, ${sunday.getFullYear()}`
      : `${monthShorts[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;

    const titleEl = document.getElementById('monthly-nav-label');
    if (titleEl) {
      titleEl.innerText = `${startStr} – ${endStr}`;
    }

    const dateMap = this.getUnifiedTradesMap();
    const daysToRender = weekInfo.days; // Always all 7 days (Mon-Sun)

    let weekTotalPnl = 0;
    let weekTotalTrades = 0;

    for (const d of daysToRender) {
      const dKey = this.formatDateKey(d);
      const dayData = dateMap[dKey];
      if (dayData) {
        weekTotalPnl += dayData.pnl;
        weekTotalTrades += dayData.count;
      }
    }
    weekTotalPnl = Math.round(weekTotalPnl * 100) / 100;

    // Card 1: Total P&L
    const pnlLabel = document.getElementById('monthly-kpi-pnl-label');
    const totalPnlEl = document.getElementById('monthly-kpi-total-pnl');
    const tradesCountEl = document.getElementById('monthly-kpi-trades-count');
    if (pnlLabel) pnlLabel.innerText = 'Week P&L';
    if (totalPnlEl) {
      const pnlFormatted = weekTotalPnl >= 0 ? `+$${weekTotalPnl.toFixed(2)}` : `-$${Math.abs(weekTotalPnl).toFixed(2)}`;
      totalPnlEl.innerText = pnlFormatted;
      totalPnlEl.className = `font-mono text-xl sm:text-2xl font-black ${weekTotalPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
    }
    if (tradesCountEl) {
      tradesCountEl.innerText = `${weekTotalTrades} trade${weekTotalTrades === 1 ? '' : 's'} this week`;
    }

    // Card 2: Weekly Goal Progress
    const goalLabel = document.getElementById('monthly-kpi-goal-label');
    const targetGoal = this.getTargetGoal('week');
    const curGoalLabel = document.getElementById('monthly-goal-cur-label');
    const tgtGoalLabel = document.getElementById('monthly-goal-tgt-label');
    const goalBarFill = document.getElementById('monthly-goal-bar-fill');
    if (goalLabel) goalLabel.innerText = 'Weekly goal';
    if (curGoalLabel) curGoalLabel.innerText = `$${Math.max(0, Math.round(weekTotalPnl))}`;
    if (tgtGoalLabel) tgtGoalLabel.innerText = `$${Math.round(targetGoal)}`;
    if (goalBarFill) {
      const pct = Math.max(0, Math.min(100, (weekTotalPnl / targetGoal) * 100));
      goalBarFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Headers & Grid: Always 7 Days (MON to SUN)
    const headersEl = document.getElementById('monthly-calendar-headers');
    const gridEl = document.getElementById('monthly-calendar-grid');
    if (!headersEl || !gridEl) return;

    const dayNamesShort = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    headersEl.className = 'grid grid-cols-7 gap-1.5 text-center text-[10px] sm:text-[11px] font-bold text-white/60 uppercase tracking-wider py-1 font-mono';
    headersEl.innerHTML = dayNamesShort.map(name => `<div>${name}</div>`).join('');
    gridEl.className = 'grid grid-cols-7 gap-1.5';

    let gridHtml = '';
    for (const d of daysToRender) {
      const dKey = this.formatDateKey(d);
      const dayNum = d.getDate();
      const dayOfWeekIdx = (d.getDay() === 0 ? 6 : d.getDay() - 1);
      const dayShort = dayNamesShort[dayOfWeekIdx];
      const dayData = dateMap[dKey] || { pnl: 0, count: 0, trades: [] };
      const hasTrades = dayData.count > 0;
      const isProfit = dayData.pnl >= 0;

      let cardClass = '';
      let pnlText = '';
      let subText = '';
      let iconColor = '';

      if (hasTrades) {
        if (isProfit) {
          cardClass = 'bg-[#0d4a2b] hover:bg-[#115e37] border border-[#00e479]/40 text-white shadow-sm';
          pnlText = `+${dayData.pnl.toFixed(2)}`;
          iconColor = 'text-[#00e479]';
        } else {
          cardClass = 'bg-[#63171e] hover:bg-[#781c24] border border-[#ff3366]/40 text-white shadow-sm';
          pnlText = `-${Math.abs(dayData.pnl).toFixed(2)}`;
          iconColor = 'text-[#ff3366]';
        }
        subText = `${dayData.count} trade${dayData.count === 1 ? '' : 's'}`;
      } else {
        cardClass = 'bg-[#15171d] border border-white/[0.04] text-white/40';
        pnlText = '—';
        subText = '';
        iconColor = 'text-white/20';
      }

      gridHtml += `
        <div onclick="window.MonthlyResultModule.showDateDetails('${dKey}')"
          class="relative rounded-2xl flex flex-col justify-between transition-all cursor-pointer active:scale-95 min-h-[72px] sm:min-h-[78px] p-2 sm:p-2.5 ${cardClass}">
          <div class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px] ${iconColor}">event_note</span>
            <span class="text-[11px] font-bold font-mono text-white/90">${dayShort} ${dayNum}</span>
          </div>
          <div class="my-auto py-0.5 text-center">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block ${hasTrades ? 'text-white' : 'text-white/30'}">
              ${pnlText}
            </span>
          </div>
          <div class="text-[9px] sm:text-[10px] text-white/60 font-sans truncate text-center">
            ${subText || '&nbsp;'}
          </div>
        </div>
      `;
    }

    gridEl.innerHTML = gridHtml;
  },

  renderMonthView: function () {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[this.selectedMonth];
    const titleEl = document.getElementById('monthly-nav-label');
    if (titleEl) {
      titleEl.innerText = `${monthName} ${this.selectedYear}`;
    }

    const dateMap = this.getUnifiedTradesMap();
    const daysInMonth = new Date(this.selectedYear, this.selectedMonth + 1, 0).getDate();

    let totalMonthPnl = 0;
    let totalMonthTrades = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dObj = new Date(this.selectedYear, this.selectedMonth, day);
      const dKey = this.formatDateKey(dObj);
      const dayData = dateMap[dKey];
      if (dayData) {
        totalMonthPnl += dayData.pnl;
        totalMonthTrades += dayData.count;
      }
    }
    totalMonthPnl = Math.round(totalMonthPnl * 100) / 100;

    // Card 1: Total P&L
    const pnlLabel = document.getElementById('monthly-kpi-pnl-label');
    const totalPnlEl = document.getElementById('monthly-kpi-total-pnl');
    const tradesCountEl = document.getElementById('monthly-kpi-trades-count');
    if (pnlLabel) pnlLabel.innerText = 'Total P&L';
    if (totalPnlEl) {
      const pnlFormatted = totalMonthPnl >= 0 ? `+$${totalMonthPnl.toFixed(2)}` : `-$${Math.abs(totalMonthPnl).toFixed(2)}`;
      totalPnlEl.innerText = pnlFormatted;
      totalPnlEl.className = `font-mono text-xl sm:text-2xl font-black ${totalMonthPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
    }
    if (tradesCountEl) {
      tradesCountEl.innerText = `${totalMonthTrades} trade${totalMonthTrades === 1 ? '' : 's'} this month`;
    }

    // Card 2: Monthly Goal Progress
    const goalLabel = document.getElementById('monthly-kpi-goal-label');
    const targetGoal = this.getTargetGoal('month');
    const curGoalLabel = document.getElementById('monthly-goal-cur-label');
    const tgtGoalLabel = document.getElementById('monthly-goal-tgt-label');
    const goalBarFill = document.getElementById('monthly-goal-bar-fill');
    if (goalLabel) goalLabel.innerText = 'Monthly goal';
    if (curGoalLabel) curGoalLabel.innerText = `$${Math.max(0, Math.round(totalMonthPnl))}`;
    if (tgtGoalLabel) tgtGoalLabel.innerText = `$${Math.round(targetGoal)}`;
    if (goalBarFill) {
      const pct = Math.max(0, Math.min(100, (totalMonthPnl / targetGoal) * 100));
      goalBarFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Headers & Grid: Always 7 Days (MON to SUN)
    const headersEl = document.getElementById('monthly-calendar-headers');
    const gridEl = document.getElementById('monthly-calendar-grid');
    if (!headersEl || !gridEl) return;

    headersEl.className = 'grid grid-cols-7 gap-1.5 text-center text-[10px] sm:text-[11px] font-bold text-white/60 uppercase tracking-wider py-1 font-mono';
    headersEl.innerHTML = `
      <div>MON</div>
      <div>TUE</div>
      <div>WED</div>
      <div>THU</div>
      <div>FRI</div>
      <div>SAT</div>
      <div>SUN</div>
    `;
    gridEl.className = 'grid grid-cols-7 gap-1.5';

    let gridHtml = '';

    // Calculate leading padding days (Monday = 0 ... Sunday = 6)
    const firstDayOfWeek = new Date(this.selectedYear, this.selectedMonth, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const paddingDays = (firstDayOfWeek === 0) ? 6 : (firstDayOfWeek - 1);

    // Previous month's trailing days
    const prevMonthLastDate = new Date(this.selectedYear, this.selectedMonth, 0).getDate();

    // Render leading previous-month boxes to fill the beginning of Row 1
    for (let p = paddingDays; p >= 1; p--) {
      const prevDay = prevMonthLastDate - p + 1;
      gridHtml += `
        <div onclick="window.MonthlyResultModule.changeMonth(-1)"
          title="Previous month"
          class="relative rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between min-h-[72px] sm:min-h-[78px] bg-[#101216]/50 border border-white/[0.03] opacity-25 hover:opacity-50 transition-all cursor-pointer select-none">
          <div class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px] text-white/20">event_note</span>
            <span class="text-[11px] font-bold font-mono text-white/40">${prevDay}</span>
          </div>
          <div class="my-auto py-0.5 text-center">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block text-white/20">—</span>
          </div>
          <div class="text-[9px] sm:text-[10px] text-white/20 font-sans truncate text-center">&nbsp;</div>
        </div>
      `;
    }

    // Render all days of the current month
    for (let day = 1; day <= daysInMonth; day++) {
      const dObj = new Date(this.selectedYear, this.selectedMonth, day);
      const dKey = this.formatDateKey(dObj);
      const dayData = dateMap[dKey] || { pnl: 0, count: 0, trades: [] };
      const hasTrades = dayData.count > 0;
      const isProfit = dayData.pnl >= 0;

      let cardClass = '';
      let pnlText = '';
      let subText = '';
      let iconColor = '';

      if (hasTrades) {
        if (isProfit) {
          cardClass = 'bg-[#0d4a2b] hover:bg-[#115e37] border border-[#00e479]/40 text-white shadow-sm';
          pnlText = `+${dayData.pnl.toFixed(2)}`;
          iconColor = 'text-[#00e479]';
        } else {
          cardClass = 'bg-[#63171e] hover:bg-[#781c24] border border-[#ff3366]/40 text-white shadow-sm';
          pnlText = `-${Math.abs(dayData.pnl).toFixed(2)}`;
          iconColor = 'text-[#ff3366]';
        }
        subText = `${dayData.count} trade${dayData.count === 1 ? '' : 's'}`;
      } else {
        cardClass = 'bg-[#15171d] border border-white/[0.04] text-white/40';
        pnlText = '—';
        subText = '';
        iconColor = 'text-white/20';
      }

      gridHtml += `
        <div onclick="window.MonthlyResultModule.showDateDetails('${dKey}')"
          class="relative rounded-2xl flex flex-col justify-between transition-all cursor-pointer active:scale-95 min-h-[72px] sm:min-h-[78px] p-2 sm:p-2.5 ${cardClass}">
          <div class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px] ${iconColor}">event_note</span>
            <span class="text-[11px] font-bold font-mono text-white/90">${day}</span>
          </div>
          <div class="my-auto py-0.5 text-center">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block ${hasTrades ? 'text-white' : 'text-white/30'}">
              ${pnlText}
            </span>
          </div>
          <div class="text-[9px] sm:text-[10px] text-white/60 font-sans truncate text-center">
            ${subText || '&nbsp;'}
          </div>
        </div>
      `;
    }

    // Render trailing next-month boxes to complete the final row (up to full 7-day multiples: 35 or 42 cells)
    const totalSlots = Math.ceil((paddingDays + daysInMonth) / 7) * 7;
    const trailingDays = totalSlots - (paddingDays + daysInMonth);

    for (let t = 1; t <= trailingDays; t++) {
      gridHtml += `
        <div onclick="window.MonthlyResultModule.changeMonth(1)"
          title="Next month"
          class="relative rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between min-h-[72px] sm:min-h-[78px] bg-[#101216]/50 border border-white/[0.03] opacity-25 hover:opacity-50 transition-all cursor-pointer select-none">
          <div class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px] text-white/20">event_note</span>
            <span class="text-[11px] font-bold font-mono text-white/40">${t}</span>
          </div>
          <div class="my-auto py-0.5 text-center">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block text-white/20">—</span>
          </div>
          <div class="text-[9px] sm:text-[10px] text-white/20 font-sans truncate text-center">&nbsp;</div>
        </div>
      `;
    }

    gridEl.innerHTML = gridHtml;
  },

  renderYearView: function () {
    const titleEl = document.getElementById('monthly-nav-label');
    if (titleEl) {
      titleEl.innerText = `${this.selectedYear}`;
    }

    const dateMap = this.getUnifiedTradesMap();
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    let yearTotalPnl = 0;
    let yearTotalTrades = 0;

    const monthTotals = [];
    for (let m = 0; m < 12; m++) {
      monthTotals[m] = { pnl: 0, count: 0 };
    }

    for (const dKey of Object.keys(dateMap)) {
      const data = dateMap[dKey];
      if (data.year === this.selectedYear) {
        monthTotals[data.month].pnl += data.pnl;
        monthTotals[data.month].count += data.count;
        yearTotalPnl += data.pnl;
        yearTotalTrades += data.count;
      }
    }
    yearTotalPnl = Math.round(yearTotalPnl * 100) / 100;

    // Card 1: Total Annual P&L
    const pnlLabel = document.getElementById('monthly-kpi-pnl-label');
    const totalPnlEl = document.getElementById('monthly-kpi-total-pnl');
    const tradesCountEl = document.getElementById('monthly-kpi-trades-count');
    if (pnlLabel) pnlLabel.innerText = 'Annual P&L';
    if (totalPnlEl) {
      const pnlFormatted = yearTotalPnl >= 0 ? `+$${yearTotalPnl.toFixed(2)}` : `-$${Math.abs(yearTotalPnl).toFixed(2)}`;
      totalPnlEl.innerText = pnlFormatted;
      totalPnlEl.className = `font-mono text-xl sm:text-2xl font-black ${yearTotalPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
    }
    if (tradesCountEl) {
      tradesCountEl.innerText = `${yearTotalTrades} trade${yearTotalTrades === 1 ? '' : 's'} in ${this.selectedYear}`;
    }

    // Card 2: Annual Goal Progress
    const goalLabel = document.getElementById('monthly-kpi-goal-label');
    const targetGoal = this.getTargetGoal('year');
    const curGoalLabel = document.getElementById('monthly-goal-cur-label');
    const tgtGoalLabel = document.getElementById('monthly-goal-tgt-label');
    const goalBarFill = document.getElementById('monthly-goal-bar-fill');
    if (goalLabel) goalLabel.innerText = 'Annual goal';
    if (curGoalLabel) curGoalLabel.innerText = `$${Math.max(0, Math.round(yearTotalPnl))}`;
    if (tgtGoalLabel) tgtGoalLabel.innerText = `$${Math.round(targetGoal)}`;
    if (goalBarFill) {
      const pct = Math.max(0, Math.min(100, (yearTotalPnl / targetGoal) * 100));
      goalBarFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Headers & Grid
    const headersEl = document.getElementById('monthly-calendar-headers');
    const gridEl = document.getElementById('monthly-calendar-grid');
    if (!headersEl || !gridEl) return;

    headersEl.className = 'flex items-center justify-between text-[10px] font-bold text-white/50 uppercase tracking-wider py-1 font-mono px-1';
    headersEl.innerHTML = `
      <span>12-Month Performance Overview</span>
      <span class="text-[9px] text-primary-container/80">Tap Month To View</span>
    `;

    gridEl.className = 'grid grid-cols-3 sm:grid-cols-4 gap-2';

    let gridHtml = '';
    for (let m = 0; m < 12; m++) {
      const mt = monthTotals[m];
      const hasTrades = mt.count > 0;
      const isProfit = mt.pnl >= 0;

      let cardClass = '';
      let pnlText = '';
      let subText = '';
      let iconColor = '';

      if (hasTrades) {
        if (isProfit) {
          cardClass = 'bg-[#0d4a2b] hover:bg-[#115e37] border border-[#00e479]/40 text-white shadow-sm';
          pnlText = `+${mt.pnl.toFixed(2)}`;
          iconColor = 'text-[#00e479]';
        } else {
          cardClass = 'bg-[#63171e] hover:bg-[#781c24] border border-[#ff3366]/40 text-white shadow-sm';
          pnlText = `-${Math.abs(mt.pnl).toFixed(2)}`;
          iconColor = 'text-[#ff3366]';
        }
        subText = `${mt.count} trade${mt.count === 1 ? '' : 's'}`;
      } else {
        cardClass = 'bg-[#15171d] hover:bg-[#1b1e25] border border-white/[0.04] text-white/40';
        pnlText = '—';
        subText = '0 trades';
        iconColor = 'text-white/20';
      }

      gridHtml += `
        <div onclick="window.MonthlyResultModule.openMonthView(${this.selectedYear}, ${m})"
          class="relative rounded-xl sm:rounded-2xl p-2.5 flex flex-col justify-between min-h-[76px] transition-all cursor-pointer active:scale-95 ${cardClass}">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold font-mono text-white/90">${monthNames[m]}</span>
            <span class="material-symbols-outlined text-[13px] ${iconColor}">calendar_today</span>
          </div>
          <div class="my-auto py-1">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block ${hasTrades ? 'text-white' : 'text-white/30'}">
              ${pnlText}
            </span>
          </div>
          <div class="text-[9px] text-white/60 font-sans truncate">
            ${subText}
          </div>
        </div>
      `;
    }

    gridEl.innerHTML = gridHtml;
  },

  renderAllTimeView: function () {
    const titleEl = document.getElementById('monthly-nav-label');
    if (titleEl) {
      titleEl.innerText = 'All Time Performance';
    }

    const dateMap = this.getUnifiedTradesMap();

    let lifetimePnl = 0;
    let lifetimeTrades = 0;
    let lifetimeWins = 0;
    let bestDay = null;
    let activeDaysCount = 0;

    const yearMap = {};

    for (const dKey of Object.keys(dateMap)) {
      const data = dateMap[dKey];
      if (data.count > 0) {
        activeDaysCount++;
        lifetimePnl += data.pnl;
        lifetimeTrades += data.count;

        if (!bestDay || data.pnl > bestDay.pnl) {
          bestDay = { dateKey: dKey, pnl: data.pnl, count: data.count };
        }

        if (!yearMap[data.year]) {
          yearMap[data.year] = { year: data.year, pnl: 0, count: 0, wins: 0 };
        }
        yearMap[data.year].pnl += data.pnl;
        yearMap[data.year].count += data.count;

        for (const t of data.trades) {
          if (t.isWin) {
            lifetimeWins++;
            yearMap[data.year].wins++;
          }
        }
      }
    }
    lifetimePnl = Math.round(lifetimePnl * 100) / 100;
    const winRate = lifetimeTrades > 0 ? Math.round((lifetimeWins / lifetimeTrades) * 100) : 0;
    const avgTrade = lifetimeTrades > 0 ? (lifetimePnl / lifetimeTrades).toFixed(2) : '0.00';

    // Card 1: Lifetime Net P&L
    const pnlLabel = document.getElementById('monthly-kpi-pnl-label');
    const totalPnlEl = document.getElementById('monthly-kpi-total-pnl');
    const tradesCountEl = document.getElementById('monthly-kpi-trades-count');
    if (pnlLabel) pnlLabel.innerText = 'Lifetime P&L';
    if (totalPnlEl) {
      const pnlFormatted = lifetimePnl >= 0 ? `+$${lifetimePnl.toFixed(2)}` : `-$${Math.abs(lifetimePnl).toFixed(2)}`;
      totalPnlEl.innerText = pnlFormatted;
      totalPnlEl.className = `font-mono text-xl sm:text-2xl font-black ${lifetimePnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
    }
    if (tradesCountEl) {
      tradesCountEl.innerText = `${lifetimeTrades} total trades • ${winRate}% win rate`;
    }

    // Card 2: Career Milestone
    const goalLabel = document.getElementById('monthly-kpi-goal-label');
    const targetGoal = this.getTargetGoal('all');
    const curGoalLabel = document.getElementById('monthly-goal-cur-label');
    const tgtGoalLabel = document.getElementById('monthly-goal-tgt-label');
    const goalBarFill = document.getElementById('monthly-goal-bar-fill');
    if (goalLabel) goalLabel.innerText = 'Career milestone';
    if (curGoalLabel) curGoalLabel.innerText = `$${Math.max(0, Math.round(lifetimePnl))}`;
    if (tgtGoalLabel) tgtGoalLabel.innerText = `$${Math.round(targetGoal)}`;
    if (goalBarFill) {
      const pct = Math.max(0, Math.min(100, (lifetimePnl / targetGoal) * 100));
      goalBarFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Headers & Grid
    const headersEl = document.getElementById('monthly-calendar-headers');
    const gridEl = document.getElementById('monthly-calendar-grid');
    if (!headersEl || !gridEl) return;

    headersEl.className = 'flex items-center justify-between text-[10px] font-bold text-white/50 uppercase tracking-wider py-1 font-mono px-1';
    headersEl.innerHTML = `
      <span>Lifetime Metrics & Milestones</span>
      <span class="text-[9px] text-white/40">Verified Records</span>
    `;

    gridEl.className = 'flex flex-col gap-2.5';

    const bestDayStr = bestDay ? `+$${bestDay.pnl.toFixed(2)}` : '$0.00';

    let yearsHtml = '';
    const sortedYears = Object.values(yearMap).sort((a, b) => b.year - a.year);
    if (sortedYears.length === 0) {
      sortedYears.push({ year: this.selectedYear, pnl: lifetimePnl, count: lifetimeTrades, wins: lifetimeWins });
    }

    for (const yr of sortedYears) {
      const yrWinRate = yr.count > 0 ? Math.round((yr.wins / yr.count) * 100) : 0;
      const yrPnlStr = yr.pnl >= 0 ? `+$${yr.pnl.toFixed(2)}` : `-$${Math.abs(yr.pnl).toFixed(2)}`;
      yearsHtml += `
        <div onclick="window.MonthlyResultModule.openYearView(${yr.year})"
          class="bg-[#15171d] hover:bg-[#1a1d24] border border-white/[0.06] rounded-xl p-3 flex items-center justify-between transition-all cursor-pointer">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary-container text-[18px]">calendar_month</span>
            <div>
              <span class="font-bold text-xs text-white">${yr.year} Annual Result</span>
              <p class="text-[10px] text-white/50">${yr.count} trades • ${yrWinRate}% Win Rate</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-black ${yr.pnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}">${yrPnlStr}</span>
            <span class="material-symbols-outlined text-[16px] text-white/40">chevron_right</span>
          </div>
        </div>
      `;
    }

    gridEl.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-[#14161b] border border-white/[0.06] rounded-xl p-3 flex flex-col justify-between">
          <span class="text-[10px] text-white/50 font-medium">Lifetime Win Rate</span>
          <span class="font-mono text-lg font-black text-white mt-1">${winRate}%</span>
          <span class="text-[9px] text-primary-container">${lifetimeWins} Wins / ${Math.max(0, lifetimeTrades - lifetimeWins)} Losses</span>
        </div>

        <div class="bg-[#14161b] border border-white/[0.06] rounded-xl p-3 flex flex-col justify-between">
          <span class="text-[10px] text-white/50 font-medium">Best Day P&L</span>
          <span class="font-mono text-lg font-black text-primary-container mt-1">${bestDayStr}</span>
          <span class="text-[9px] text-white/40">${bestDay ? bestDay.dateKey : '—'}</span>
        </div>

        <div class="bg-[#14161b] border border-white/[0.06] rounded-xl p-3 flex flex-col justify-between">
          <span class="text-[10px] text-white/50 font-medium">Average Trade</span>
          <span class="font-mono text-lg font-black ${parseFloat(avgTrade) >= 0 ? 'text-white' : 'text-[#ff3366]'} mt-1">${parseFloat(avgTrade) >= 0 ? `+$${avgTrade}` : `-$${Math.abs(avgTrade)}`}</span>
          <span class="text-[9px] text-white/40">Per executed signal</span>
        </div>

        <div class="bg-[#14161b] border border-white/[0.06] rounded-xl p-3 flex flex-col justify-between">
          <span class="text-[10px] text-white/50 font-medium">Active Days</span>
          <span class="font-mono text-lg font-black text-white mt-1">${activeDaysCount}</span>
          <span class="text-[9px] text-white/40">Sessions logged</span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5 mt-1">
        <span class="text-[10px] font-mono text-white/40 uppercase tracking-wider px-1">Yearly Records</span>
        ${yearsHtml}
      </div>
    `;
  },

  showDateDetails: function (dateKey) {
    const dateMap = this.getUnifiedTradesMap();
    const dayData = dateMap[dateKey];
    if (!dayData || dayData.count === 0) return;

    const panel = document.getElementById('monthly-day-details-panel');
    const title = document.getElementById('monthly-day-details-title');
    const list = document.getElementById('monthly-day-trades-list');

    const [y, m, d] = dateKey.split('-').map(Number);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (title) {
      const pnlFormatted = dayData.pnl >= 0 ? `+$${dayData.pnl.toFixed(2)}` : `-$${Math.abs(dayData.pnl).toFixed(2)}`;
      title.innerText = `${monthNames[m - 1]} ${d}, ${y}: ${dayData.count} Trades (${pnlFormatted})`;
    }

    if (list) {
      list.innerHTML = dayData.trades.map((t) => {
        const isLong = (t.type === 'LONG' || t.type === 'BUY');
        const isWin = t.isWin !== undefined ? t.isWin : (!t.pnl.startsWith('-') && !t.pnl.toLowerCase().includes('loss'));
        return `
          <div class="p-2 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between text-xs font-mono">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isLong ? 'bg-[#00e479]/20 text-[#00e479]' : 'bg-[#ff3366]/20 text-[#ff3366]'}">
                ${t.type || 'TRADE'}
              </span>
              <span class="font-bold text-white">${t.pair}</span>
              ${t.time ? `<span class="text-[10px] text-white/40">${t.time}</span>` : ''}
            </div>
            <span class="font-bold ${isWin ? 'text-primary-container' : 'text-[#ff3366]'}">
              ${t.pnl}
            </span>
          </div>
        `;
      }).join('');
    }

    if (panel) {
      panel.classList.remove('hidden');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  updatePreviewPill: function () {
    const pill = document.getElementById('monthly-result-preview-pnl');
    if (!pill) return;
    const dateMap = this.getUnifiedTradesMap();
    const curYear = new Date().getFullYear();
    const curMonth = new Date().getMonth();
    let totalPnl = 0;
    for (const dKey of Object.keys(dateMap)) {
      const d = dateMap[dKey];
      if (d.year === curYear && d.month === curMonth) {
        totalPnl += d.pnl;
      }
    }
    totalPnl = Math.round(totalPnl * 100) / 100;
    const formatted = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
    pill.innerText = formatted;
    pill.className = `text-xs font-mono font-bold ${totalPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
  }
};
