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

  init: function () {
    this.loadFromStorage();
    this.bindEvents();
    this.renderTrades();
    this.updateStats();
  },

  loadFromStorage: function () {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.trades = JSON.parse(stored);
      } else {
        // Start completely empty - strictly manual logging
        this.trades = [];
      }
    } catch (e) {
      console.warn('Error loading manual trades from storage:', e);
      this.trades = [];
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

    const isProfit = !pnl.startsWith('-') && !pnl.toLowerCase().includes('loss');
    const entryPrice = this.pendingAnalysisData && this.pendingAnalysisData.entry ? this.pendingAnalysisData.entry : '--';
    const market = this.pendingAnalysisData && this.pendingAnalysisData.market ? this.pendingAnalysisData.market : 'Manual';

    const newTrade = {
      id: Date.now(),
      pair: pair.toUpperCase(),
      market: market,
      type: type,
      time: 'Just now',
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
      window.App.showToast(`Logged ${pair.toUpperCase()} to your Journal!`);
    }
  },

  /**
   * Saves or updates feedback on any existing logged trade
   */
  saveFeedback: function (tradeId) {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    const pnlInput = document.getElementById(`feedback-pnl-${tradeId}`);
    const obsInput = document.getElementById(`feedback-obs-${tradeId}`);

    const pnlVal = pnlInput ? pnlInput.value.trim() : '';
    const obsVal = obsInput ? obsInput.value.trim() : '';

    if (pnlVal) {
      trade.userOutcomePnl = pnlVal;
      trade.pnl = pnlVal;
      trade.isProfit = !pnlVal.startsWith('-') && !pnlVal.toLowerCase().includes('loss');
    }

    if (obsVal) {
      trade.userObservation = obsVal;
      trade.notes = obsVal;
    }

    trade.feedbackSaved = true;
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();

    if (window.App) {
      window.App.showToast(`Feedback updated for ${trade.pair}!`);
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
      const pnlDisplayClass = t.isProfit ? 'text-primary-fixed-dim' : 'text-error';

      return `
        <div class="bg-[#181c24] border border-white/5 rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 transition-all">
          
          <!-- Header: Pair, Direction, Time & Outcome PnL -->
          <div class="flex justify-between items-start gap-2">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-black border border-white/10 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined ${t.isProfit ? 'text-primary-fixed-dim' : 'text-error'} text-[24px]">
                  ${t.market === 'Crypto' ? 'currency_bitcoin' : t.market === 'Gold' ? 'paid' : 'candlestick_chart'}
                </span>
              </div>
              <div>
                <p class="font-display text-[15px] font-bold text-white">${t.pair}</p>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="font-label-sm text-[10px] px-2 py-0.5 rounded ${t.type === 'LONG' ? 'bg-primary-container/10 text-primary-container' : 'bg-error/10 text-error'} uppercase font-bold tracking-wider">
                    ${t.type}
                  </span>
                  <span class="text-[11px] text-on-surface-variant">${t.time}</span>
                  ${t.entryPrice && t.entryPrice !== '--' ? `<span class="text-[11px] text-[#38bdf8] font-mono">• Entry: ${t.entryPrice}</span>` : ''}
                </div>
              </div>
            </div>

            <div class="text-right flex flex-col items-end">
              <p class="font-mono-data text-[16px] font-bold ${pnlDisplayClass}">${t.pnl}</p>
              <button onclick="window.JournalModule.deleteTrade(${t.id})" class="text-[11px] text-on-surface-variant/40 hover:text-error transition-colors mt-1" title="Delete trade">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>

          <!-- Trade Setup Summary Note -->
          <div class="bg-black/40 border border-white/5 rounded-xl px-3.5 py-2.5">
            <p class="text-[12px] text-on-surface-variant leading-relaxed">
              <span class="text-white/80 font-medium">Observation:</span> ${t.notes}
            </p>
          </div>

          <!-- Dedicated Feedback Box: How much did you make/loss? & Your observation -->
          <div class="bg-black/60 border border-white/10 rounded-xl p-3.5 flex flex-col gap-3">
            
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold uppercase tracking-wider text-primary-container flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[16px]">edit_note</span> Outcome & Observation
              </span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary-container/15 text-primary-container border border-primary-container/30">
                ✓ Manually Logged
              </span>
            </div>

            <!-- Field 1: How much did you make/loss? -->
            <div>
              <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                How much did you make / loss?
              </label>
              <input 
                type="text" 
                id="feedback-pnl-${t.id}" 
                value="${t.userOutcomePnl || t.pnl || ''}" 
                placeholder="e.g. +$450.00 or -$120.00" 
                class="w-full bg-[#10141d] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container transition-all"
              />
            </div>

            <!-- Field 2: Your observation -->
            <div>
              <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                Your observation
              </label>
              <textarea 
                id="feedback-obs-${t.id}" 
                rows="2" 
                placeholder="Review what worked, execution discipline, or lessons learned..." 
                class="w-full bg-[#10141d] border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container resize-none transition-all leading-relaxed"
              >${t.userObservation || t.notes || ''}</textarea>
            </div>

            <!-- Save Feedback Action -->
            <div class="flex items-center justify-between pt-1">
              <span class="text-[10px] text-on-surface-variant/60">
                Update outcome or observation anytime
              </span>
              <button 
                onclick="window.JournalModule.saveFeedback(${t.id})" 
                class="px-3.5 py-1.5 rounded-lg bg-primary-container text-black font-bold text-xs flex items-center gap-1.5 active:scale-95 hover:brightness-110 transition-all shadow-md">
                <span class="material-symbols-outlined text-[15px]">save</span>
                <span>Update Feedback</span>
              </button>
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
