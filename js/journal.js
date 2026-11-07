/**
 * Trading Journal Module
 * Manages portfolio statistics, recent trade entries, persistent trade storage,
 * and automated trade logging with interactive feedback (Make/Loss & Observations).
 */

window.JournalModule = {
  STORAGE_KEY: 'alphachart_journal_trades_v2',

  defaultTrades: [
    {
      id: 1722510000000,
      pair: 'BTC / USDT',
      market: 'Crypto',
      type: 'LONG',
      time: '2h ago',
      entryPrice: '$64,280.00',
      pnl: '+$1,240.00',
      isProfit: true,
      notes: 'Bullish Flag Breakout confirmed on 1H.',
      userOutcomePnl: '+$1,240.00',
      userObservation: 'Stuck to the plan on the breakout. Exited at TP2 with 10/10 discipline.',
      feedbackSaved: true
    },
    {
      id: 1722500000000,
      pair: 'EUR / USD',
      market: 'Forex',
      type: 'SHORT',
      time: '5h ago',
      entryPrice: '1.08450',
      pnl: '-$420.50',
      isProfit: false,
      notes: 'Resistance rejection at London session open.',
      userOutcomePnl: '-$420.50',
      userObservation: 'Entered too early on FOMO before the candle close. Respect the stop loss earlier next time.',
      feedbackSaved: true
    },
    {
      id: 1722420000000,
      pair: 'XAU / USD',
      market: 'Gold',
      type: 'LONG',
      time: '1d ago',
      entryPrice: '$2,410.00',
      pnl: '+$2,150.00',
      isProfit: true,
      notes: 'Textbook 4H bull flag breakout during London session.',
      userOutcomePnl: '+$2,150.00',
      userObservation: 'Waited for 15m pullback confirmation. TP3 hit smoothly.',
      feedbackSaved: true
    }
  ],

  trades: [],

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
        this.trades = [...this.defaultTrades];
        this.saveToStorage();
      }
    } catch (e) {
      console.warn('Error loading trades from storage:', e);
      this.trades = [...this.defaultTrades];
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

    // Log Trade FAB Button
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
   * Called when user initiates logging from scanner: opens the manual log setup
   */
  addTradeFromAnalysis: function (analysisData) {
    this.openManualLogModal(analysisData);
  },

  /**
   * Saves user's feedback for a specific trade: How much did you make/loss & observation.
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
      // Determine if profit or loss based on negative sign
      trade.isProfit = !pnlVal.startsWith('-') && !pnlVal.toLowerCase().includes('loss');
    }

    if (obsVal) {
      trade.userObservation = obsVal;
    }

    trade.feedbackSaved = true;
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();

    if (window.App) {
      window.App.showToast(`Feedback saved for ${trade.pair}!`);
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

  renderTrades: function () {
    const container = document.getElementById('journal-trades-list');
    if (!container) return;

    if (this.trades.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 text-on-surface-variant/60 bg-surface-container-low rounded-2xl border border-white/5">
          <span class="material-symbols-outlined text-[36px] text-on-surface-variant/40 mb-2">history_edu</span>
          <p class="font-body-md text-sm">No trades logged yet.</p>
          <p class="text-xs text-on-surface-variant/50 mt-1">Scan a chart to auto-log trades here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.trades.map(t => {
      const isPending = t.pnl === 'Pending Result' && !t.userOutcomePnl;
      const pnlDisplayClass = isPending
        ? 'text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded text-xs'
        : (t.isProfit ? 'text-primary-fixed-dim' : 'text-error');

      return `
        <div class="bg-[#181c24] border ${t.isAutoLogged && !t.feedbackSaved ? 'border-primary-container/40 shadow-[0_0_20px_rgba(0,255,136,0.15)]' : 'border-white/5'} rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 transition-all">
          
          <!-- Header: Pair, Direction, Time & Outcome PnL -->
          <div class="flex justify-between items-start gap-2">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-black border border-white/10 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined ${t.isProfit ? 'text-primary-fixed-dim' : 'text-error'} text-[24px]">
                  ${t.market === 'Crypto' ? 'currency_bitcoin' : t.market === 'Gold' ? 'paid' : 'candlestick_chart'}
                </span>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-display text-[15px] font-bold text-white">${t.pair}</p>
                  ${t.isAutoLogged ? '<span class="text-[9px] uppercase px-1.5 py-0.5 rounded bg-primary-container/15 text-primary-container font-mono font-bold border border-primary-container/30">Auto-Logged</span>' : ''}
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="font-label-sm text-[10px] px-2 py-0.5 rounded ${t.type === 'LONG' ? 'bg-primary-container/10 text-primary-container' : 'bg-error/10 text-error'} uppercase font-bold tracking-wider">
                    ${t.type}
                  </span>
                  <span class="text-[11px] text-on-surface-variant">${t.time}</span>
                  ${t.entryPrice ? `<span class="text-[11px] text-[#38bdf8] font-mono">• Entry: ${t.entryPrice}</span>` : ''}
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
              <span class="text-white/80 font-medium">Setup:</span> ${t.notes}
            </p>
          </div>

          <!-- Dedicated Feedback Box: How much did you make/loss? & Your observation -->
          <div class="bg-black/60 border ${t.feedbackSaved ? 'border-white/10' : 'border-primary-container/40'} rounded-xl p-3.5 flex flex-col gap-3">
            
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold uppercase tracking-wider text-primary-container flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[16px]">edit_note</span> Trade Feedback & Outcome
              </span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${t.feedbackSaved ? 'bg-primary-container/15 text-primary-container border border-primary-container/30' : 'bg-amber-400/10 text-amber-300 border border-amber-400/30'}">
                ${t.feedbackSaved ? '✓ Feedback Saved' : '⚡ Awaiting Review'}
              </span>
            </div>

            <!-- Field 1: How much did you make/loss? -->
            <div>
              <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                How much did you make / loss?
              </label>
              <div class="relative">
                <input 
                  type="text" 
                  id="feedback-pnl-${t.id}" 
                  value="${t.userOutcomePnl || ''}" 
                  placeholder="e.g. +$450.00 or -$120.00" 
                  class="w-full bg-[#10141d] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container transition-all"
                />
              </div>
            </div>

            <!-- Field 2: Your observation -->
            <div>
              <label class="text-[10px] text-on-surface-variant uppercase font-semibold block mb-1">
                Your observation
              </label>
              <textarea 
                id="feedback-obs-${t.id}" 
                rows="2" 
                placeholder="e.g. Took profit at TP1 cleanly on 15m breakout, followed stop-loss discipline." 
                class="w-full bg-[#10141d] border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container resize-none transition-all leading-relaxed"
              >${t.userObservation || ''}</textarea>
            </div>

            <!-- Save Feedback Action -->
            <div class="flex items-center justify-between pt-1">
              <span class="text-[10px] text-on-surface-variant/60">
                ${t.feedbackSaved ? 'You can update your feedback anytime' : 'Log your actual result & notes'}
              </span>
              <button 
                onclick="window.JournalModule.saveFeedback(${t.id})" 
                class="px-3.5 py-1.5 rounded-lg bg-primary-container text-black font-bold text-xs flex items-center gap-1.5 active:scale-95 hover:brightness-110 transition-all shadow-md">
                <span class="material-symbols-outlined text-[15px]">save</span>
                <span>Save Feedback</span>
              </button>
            </div>

          </div>

        </div>
      `;
    }).join('');
  },

  updateStats: function () {
    const totalTrades = this.trades.length;
    if (totalTrades === 0) return;

    let wins = 0;
    let totalPnlNum = 0;

    this.trades.forEach(t => {
      if (t.isProfit) wins++;

      // Extract numeric value from PnL string
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

    // Update win rate element if present
    const winRateEl = document.querySelector('#page-trading-journal .text-\\[22px\\].font-bold');
    if (winRateEl) {
      winRateEl.innerText = `${winRate}%`;
    }
  },

  openManualLogModal: function (prefillData) {
    this.pendingAnalysisData = prefillData || null;

    const pairInput = document.getElementById('log-pair-input');
    const typeSelect = document.getElementById('log-type-select');
    const notesInput = document.getElementById('log-notes-input');
    const pnlInput = document.getElementById('log-pnl-input');

    if (prefillData) {
      if (pairInput) pairInput.value = prefillData.pair || '';
      if (typeSelect) typeSelect.value = prefillData.signal || 'LONG';
      if (notesInput) notesInput.value = prefillData.pattern ? `Target: ${prefillData.tp1 || '--'}. Setup: ${prefillData.pattern}.` : '';
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
  },

  submitManualTrade: function () {
    const pair = document.getElementById('log-pair-input').value || 'BTC / USDT';
    const type = document.getElementById('log-type-select').value || 'LONG';
    const pnl = document.getElementById('log-pnl-input').value || '+$0.00';
    const observation = document.getElementById('log-notes-input').value || 'Manual trade entry.';

    const isProfit = !pnl.startsWith('-') && !pnl.toLowerCase().includes('loss');
    const entryPrice = this.pendingAnalysisData && this.pendingAnalysisData.entry ? this.pendingAnalysisData.entry : '--';
    const market = this.pendingAnalysisData && this.pendingAnalysisData.market ? this.pendingAnalysisData.market : 'Crypto';

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
      feedbackSaved: true,
      isAutoLogged: false
    };

    this.trades.unshift(newTrade);
    this.saveToStorage();
    this.renderTrades();
    this.updateStats();
    this.closeManualLogModal();

    this.pendingAnalysisData = null;

    if (window.App) {
      window.App.navigateTo('trading-journal');
      window.App.showToast('Trade logged & reflected in your Journal!');
    }
  },

  openCoachChat: function () {
    const totalTrades = this.trades.length;
    const pendingFeedbackCount = this.trades.filter(t => !t.feedbackSaved).length;

    let coachMsg = `🤖 AI Discipline Coach: "You have ${totalTrades} trades in your journal. `;
    if (pendingFeedbackCount > 0) {
      coachMsg += `You have ${pendingFeedbackCount} trade(s) awaiting your outcome & observation review. Reflection is key to mastery!"`;
    } else {
      coachMsg += `Great job keeping your feedback and discipline notes up to date! Stay patient on your next setup."`;
    }

    alert(coachMsg);
  }
};
