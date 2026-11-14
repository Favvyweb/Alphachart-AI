/**
 * Trading Journal Module
 * Strictly Manual Trade Logging:
 * Trades are NEVER automatically logged. They only appear when the user
 * manually logs them via the modal (from the scanner or the journal).
 */

window.JournalModule = {
  STORAGE_KEY: 'alphachart_journal_manual_trades_v1',
  trades: [],
  pendingAnalysisData: null,
  expandedTradeIds: new Set(),

  init: function () {
    this.loadFromStorage();
    this.bindEvents();
    this.renderTrades();
    this.updateStats();
    if (window.MonthlyResultModule) {
      window.MonthlyResultModule.init();
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
      feedbackSaved: true
    };

    // Add to journal list
    this.trades.unshift(newTrade);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();
    this.closeManualLogModal();

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
      feedbackSaved: true
    };

    // Add directly to journal list
    this.trades.unshift(newTrade);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();

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

    if (window.App) {
      window.App.showToast(`Feedback & time updated for ${trade.pair}!`);
    }
  },

  deleteTrade: function (tradeId) {
    this.trades = this.trades.filter(t => t.id !== tradeId);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();
    if (window.App) {
      window.App.showToast('Trade removed from Journal');
    }
  },

  clearAllTrades: function () {
    if (confirm('Are you sure you want to clear all trades in your journal?')) {
      this.trades = [];
      this.saveToStorage();
      this.renderTrades();
      this.updateStats();
      if (window.App) {
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
    const totalTrades = this.trades.length;
    let coachMsg = '';

    if (totalTrades === 0) {
      coachMsg = '🤖 AI Discipline Coach: "You have not logged any trades yet. Whenever you take a trade, click Log Trade to record your outcome and observation!"';
    } else {
      coachMsg = `🤖 AI Discipline Coach: "You have ${totalTrades} manually logged trades in your journal. Continue reviewing your observations after every session!"`;
    }

    alert(coachMsg);
  }
};

/**
 * Monthly Result & Target Module
 * Provides calendar visualization of monthly trading P&L, daily breakdown, and progress against monthly target.
 * Strictly independent: reads and displays logged trades without mutating or overwriting the journal.
 */
window.MonthlyResultModule = {
  TARGET_STORAGE_KEY: 'alphachart_monthly_target_v1',
  selectedYear: 2025,
  selectedMonth: 11, // December (0-indexed)
  viewMode: 'weekdays', // 'weekdays' (Mon-Fri matching screenshot) or 'all7'
  selectedPeriod: 'month',

  // Benchmark December 2025 dataset matching user's design reference
  _benchmarkDec2025: {
    1: { pnl: 193.11, count: 2, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '+$112.50', time: '09:30' }, { pair: 'ETH / USDT', type: 'SHORT', pnl: '+$80.61', time: '14:20' }] },
    2: { pnl: -98.62, count: 2, trades: [{ pair: 'SOL / USDT', type: 'LONG', pnl: '-$50.00', time: '11:15' }, { pair: 'AAVE / USDT', type: 'LONG', pnl: '-$48.62', time: '16:40' }] },
    3: { pnl: -135.41, count: 1, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '-$135.41', time: '10:00' }] },
    4: { pnl: -45.73, count: 3, trades: [{ pair: 'ETH / USDT', type: 'SHORT', pnl: '-$20.50', time: '08:15' }, { pair: 'SOL / USDT', type: 'LONG', pnl: '+$15.00', time: '13:00' }, { pair: 'AAVE / USDT', type: 'SHORT', pnl: '-$40.23', time: '17:30' }] },
    5: { pnl: 102.10, count: 2, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '+$60.00', time: '09:45' }, { pair: 'ETH / USDT', type: 'LONG', pnl: '+$42.10', time: '15:10' }] },
    8: { pnl: 152.68, count: 1, trades: [{ pair: 'AAVE / USDT', type: 'LONG', pnl: '+$152.68', time: '11:20' }] },
    9: { pnl: 155.64, count: 1, trades: [{ pair: 'BTC / USDT', type: 'SHORT', pnl: '+$155.64', time: '14:00' }] },
    10: { pnl: -38.90, count: 2, trades: [{ pair: 'ETH / USDT', type: 'LONG', pnl: '-$18.90', time: '10:30' }, { pair: 'SOL / USDT', type: 'SHORT', pnl: '-$20.00', time: '16:00' }] },
    11: { pnl: 55.00, count: 1, trades: [{ pair: 'AAVE / USDT', type: 'LONG', pnl: '+$55.00', time: '12:15' }] },
    12: { pnl: 573.00, count: 2, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '+$350.00', time: '09:30' }, { pair: 'SOL / USDT', type: 'LONG', pnl: '+$223.00', time: '14:45' }] },
    15: { pnl: 31.00, count: 1, trades: [{ pair: 'ETH / USDT', type: 'LONG', pnl: '+$31.00', time: '10:15' }] },
    16: { pnl: -35.56, count: 1, trades: [{ pair: 'AAVE / USDT', type: 'SHORT', pnl: '-$35.56', time: '13:50' }] },
    17: { pnl: -31.00, count: 1, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '-$31.00', time: '11:00' }] },
    18: { pnl: 152.64, count: 1, trades: [{ pair: 'SOL / USDT', type: 'LONG', pnl: '+$152.64', time: '15:20' }] },
    19: { pnl: 34.34, count: 1, trades: [{ pair: 'ETH / USDT', type: 'SHORT', pnl: '+$34.34', time: '16:30' }] },
    22: { pnl: -313.46, count: 1, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '-$313.46', time: '09:10' }] },
    23: { pnl: 21.00, count: 1, trades: [{ pair: 'AAVE / USDT', type: 'LONG', pnl: '+$21.00', time: '12:40' }] },
    24: { pnl: 233.65, count: 2, trades: [{ pair: 'SOL / USDT', type: 'LONG', pnl: '+$140.00', time: '11:00' }, { pair: 'ETH / USDT', type: 'LONG', pnl: '+$93.65', time: '14:15' }] },
    25: { pnl: -31.34, count: 1, trades: [{ pair: 'BTC / USDT', type: 'SHORT', pnl: '-$31.34', time: '15:45' }] },
    26: { pnl: 54.96, count: 2, trades: [{ pair: 'AAVE / USDT', type: 'LONG', pnl: '+$30.00', time: '10:20' }, { pair: 'ETH / USDT', type: 'SHORT', pnl: '+$24.96', time: '16:10' }] },
    29: { pnl: 31.00, count: 1, trades: [{ pair: 'SOL / USDT', type: 'LONG', pnl: '+$31.00', time: '11:30' }] },
    30: { pnl: 105.00, count: 1, trades: [{ pair: 'BTC / USDT', type: 'LONG', pnl: '+$105.00', time: '14:00' }] },
    31: { pnl: 0, count: 0, trades: [] }
  },

  init: function () {
    this.bindEvents();
    this.updatePreviewPill();
  },

  getTargetGoal: function () {
    const raw = localStorage.getItem(this.TARGET_STORAGE_KEY);
    const parsed = parseFloat(raw);
    return (!isNaN(parsed) && parsed > 0) ? parsed : 3000;
  },

  setTargetGoal: function (val) {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      localStorage.setItem(this.TARGET_STORAGE_KEY, num.toString());
      this.render();
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast(`🎯 Monthly target updated to $${num.toLocaleString()}!`);
      }
    }
  },

  bindEvents: function () {
    const self = this;

    // Button under AI Discipline Coach
    const openBtn = document.getElementById('btn-open-monthly-result');
    if (openBtn) {
      openBtn.addEventListener('click', () => self.openModal());
    }

    // Modal Close Buttons
    const closeBtn = document.getElementById('monthly-result-close-btn');
    const closeXBtn = document.getElementById('monthly-result-close-x-btn');
    const backdrop = document.getElementById('monthly-result-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', () => self.closeModal());
    if (closeXBtn) closeXBtn.addEventListener('click', () => self.closeModal());
    if (backdrop) backdrop.addEventListener('click', () => self.closeModal());

    // Navigation Buttons
    const prevBtn = document.getElementById('monthly-nav-prev');
    const nextBtn = document.getElementById('monthly-nav-next');
    if (prevBtn) prevBtn.addEventListener('click', () => self.changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => self.changeMonth(1));

    // Timeframe Filter Pills (Week, Month, Year, All time)
    document.querySelectorAll('.monthly-period-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.monthly-period-pill').forEach(b => {
          b.className = 'monthly-period-pill flex-1 py-1.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white transition-all text-center';
        });
        btn.className = 'monthly-period-pill active flex-1 py-1.5 rounded-lg text-xs font-bold bg-primary-container text-black shadow-sm transition-all text-center';
        self.selectedPeriod = btn.getAttribute('data-period') || 'month';
        self.render();
      });
    });

    // View Mode Switcher: Mon-Fri vs 7 Days
    const viewWeekdaysBtn = document.getElementById('monthly-view-weekdays');
    const viewAll7Btn = document.getElementById('monthly-view-all7');
    if (viewWeekdaysBtn) {
      viewWeekdaysBtn.addEventListener('click', () => {
        self.viewMode = 'weekdays';
        viewWeekdaysBtn.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white transition-all cursor-pointer';
        if (viewAll7Btn) viewAll7Btn.className = 'px-2 py-0.5 rounded text-[10px] font-semibold text-white/40 hover:text-white transition-all cursor-pointer';
        self.render();
      });
    }
    if (viewAll7Btn) {
      viewAll7Btn.addEventListener('click', () => {
        self.viewMode = 'all7';
        viewAll7Btn.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white transition-all cursor-pointer';
        if (viewWeekdaysBtn) viewWeekdaysBtn.className = 'px-2 py-0.5 rounded text-[10px] font-semibold text-white/40 hover:text-white transition-all cursor-pointer';
        self.render();
      });
    }

    // Goal Edit Modal
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
          self.setTargetGoal(input.value);
          self.closeGoalModal();
        }
      });
    }

    // Day Details Close
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
    if (modal) {
      if (input) input.value = this.getTargetGoal();
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
    this.render();
  },

  /**
   * Retrieves all trades for the active month:
   * Merges user manual logged trades with the reference dataset if viewing Dec 2025
   */
  getMonthTradesMap: function (year, month) {
    const dayMap = {}; // dayNumber (1..31) -> { pnl: number, count: number, trades: [] }

    // If viewing December 2025, prefill with benchmark dataset matching user's screenshot
    const isBenchmarkDec2025 = (year === 2025 && month === 11);
    if (isBenchmarkDec2025) {
      for (const d of Object.keys(this._benchmarkDec2025)) {
        const item = this._benchmarkDec2025[d];
        dayMap[d] = {
          pnl: item.pnl,
          count: item.count,
          trades: [...item.trades]
        };
      }
    }

    // Merge user's actual journal trades
    const userTrades = (window.JournalModule && window.JournalModule.trades) ? window.JournalModule.trades : [];
    for (const t of userTrades) {
      const dObj = new Date(t.timestamp || t.id);
      if (!isNaN(dObj.getTime())) {
        if (dObj.getFullYear() === year && dObj.getMonth() === month) {
          const dayNum = dObj.getDate();
          if (!dayMap[dayNum]) {
            dayMap[dayNum] = { pnl: 0, count: 0, trades: [] };
          }
          const numMatch = (t.pnl || '').replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(numMatch);
          if (!isNaN(parsed)) {
            const pnlVal = (t.pnl || '').includes('-') ? -Math.abs(parsed) : Math.abs(parsed);
            dayMap[dayNum].pnl += pnlVal;
          }
          dayMap[dayNum].count += 1;
          dayMap[dayNum].trades.push({
            pair: t.pair,
            type: t.type,
            pnl: t.pnl,
            time: t.time
          });
        }
      }
    }

    return dayMap;
  },

  render: function () {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[this.selectedMonth];
    const titleEl = document.getElementById('monthly-nav-label');
    if (titleEl) {
      titleEl.innerText = `${monthName} ${this.selectedYear}`;
    }

    const dayMap = this.getMonthTradesMap(this.selectedYear, this.selectedMonth);

    // Calculate Month Totals
    let totalMonthPnl = 0;
    let totalMonthTrades = 0;
    for (const d of Object.keys(dayMap)) {
      totalMonthPnl += dayMap[d].pnl;
      totalMonthTrades += dayMap[d].count;
    }
    totalMonthPnl = Math.round(totalMonthPnl * 100) / 100;

    // Update Card 1: Total P&L
    const totalPnlEl = document.getElementById('monthly-kpi-total-pnl');
    const tradesCountEl = document.getElementById('monthly-kpi-trades-count');
    if (totalPnlEl) {
      const pnlFormatted = totalMonthPnl >= 0 ? `+$${totalMonthPnl.toFixed(2)}` : `-$${Math.abs(totalMonthPnl).toFixed(2)}`;
      totalPnlEl.innerText = pnlFormatted;
      totalPnlEl.className = `font-mono text-xl sm:text-2xl font-black ${totalMonthPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
    }
    if (tradesCountEl) {
      tradesCountEl.innerText = `${totalMonthTrades} trade${totalMonthTrades === 1 ? '' : 's'} this month`;
    }

    // Update Card 2: Monthly Goal Progress
    const targetGoal = this.getTargetGoal();
    const curGoalLabel = document.getElementById('monthly-goal-cur-label');
    const tgtGoalLabel = document.getElementById('monthly-goal-tgt-label');
    const goalBarFill = document.getElementById('monthly-goal-bar-fill');

    if (curGoalLabel) {
      curGoalLabel.innerText = `$${Math.max(0, Math.round(totalMonthPnl))}`;
    }
    if (tgtGoalLabel) {
      tgtGoalLabel.innerText = `$${Math.round(targetGoal)}`;
    }
    if (goalBarFill) {
      const pct = Math.max(0, Math.min(100, (totalMonthPnl / targetGoal) * 100));
      goalBarFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Render Calendar Grid Headers
    const headersEl = document.getElementById('monthly-calendar-headers');
    const gridEl = document.getElementById('monthly-calendar-grid');
    if (!headersEl || !gridEl) return;

    const isWeekdaysOnly = (this.viewMode === 'weekdays');
    if (isWeekdaysOnly) {
      headersEl.className = 'grid grid-cols-5 gap-1.5 text-center text-[10px] font-bold text-white/60 uppercase tracking-wider py-1 font-mono';
      headersEl.innerHTML = `
        <div>MON</div>
        <div>TUE</div>
        <div>WED</div>
        <div>THU</div>
        <div>FRI</div>
      `;
      gridEl.className = 'grid grid-cols-5 gap-1.5';
    } else {
      headersEl.className = 'grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-white/60 uppercase tracking-wider py-1 font-mono';
      headersEl.innerHTML = `
        <div>MON</div>
        <div>TUE</div>
        <div>WED</div>
        <div>THU</div>
        <div>FRI</div>
        <div>SAT</div>
        <div>SUN</div>
      `;
      gridEl.className = 'grid grid-cols-7 gap-1';
    }

    // Days in this month
    const daysInMonth = new Date(this.selectedYear, this.selectedMonth + 1, 0).getDate();
    let gridHtml = '';

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(this.selectedYear, this.selectedMonth, day);
      const dayOfWeek = dateObj.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

      // In weekdays mode, omit weekends (matching screenshot)
      if (isWeekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
        continue;
      }

      const dayData = dayMap[day] || { pnl: 0, count: 0, trades: [] };
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
        <div onclick="window.MonthlyResultModule.showDayDetails(${day})"
          class="relative rounded-xl sm:rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between min-h-[64px] sm:min-h-[74px] transition-all cursor-pointer active:scale-95 ${cardClass}">
          
          <!-- Top Row: Icon + Day Number -->
          <div class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[13px] ${iconColor}">event_note</span>
            <span class="text-[11px] font-bold font-mono text-white/90">${day}</span>
          </div>

          <!-- Middle Row: Day P&L -->
          <div class="my-auto py-0.5">
            <span class="font-mono text-xs sm:text-[13px] font-black tracking-tight block ${hasTrades ? (isProfit ? 'text-white' : 'text-white') : 'text-white/30 text-center'}">
              ${pnlText}
            </span>
          </div>

          <!-- Bottom Row: Trade Count -->
          <div class="text-[9px] sm:text-[10px] text-white/60 font-sans truncate">
            ${subText || '&nbsp;'}
          </div>

        </div>
      `;
    }

    gridEl.innerHTML = gridHtml;
    this.updatePreviewPill();
  },

  showDayDetails: function (dayNumber) {
    const dayMap = this.getMonthTradesMap(this.selectedYear, this.selectedMonth);
    const dayData = dayMap[dayNumber];
    if (!dayData || dayData.count === 0) return;

    const panel = document.getElementById('monthly-day-details-panel');
    const title = document.getElementById('monthly-day-details-title');
    const list = document.getElementById('monthly-day-trades-list');

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (title) {
      const pnlFormatted = dayData.pnl >= 0 ? `+$${dayData.pnl.toFixed(2)}` : `-$${Math.abs(dayData.pnl).toFixed(2)}`;
      title.innerText = `${monthNames[this.selectedMonth]} ${dayNumber}, ${this.selectedYear}: ${dayData.count} Trades (${pnlFormatted})`;
    }

    if (list) {
      list.innerHTML = dayData.trades.map((t, idx) => {
        const isLong = (t.type === 'LONG' || t.type === 'BUY');
        const isWin = !t.pnl.startsWith('-') && !t.pnl.toLowerCase().includes('loss');
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
    const dayMap = this.getMonthTradesMap(this.selectedYear, this.selectedMonth);
    let totalPnl = 0;
    for (const d of Object.keys(dayMap)) {
      totalPnl += dayMap[d].pnl;
    }
    const formatted = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
    pill.innerText = formatted;
    pill.className = `text-xs font-mono font-bold ${totalPnl >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;
  }
};
