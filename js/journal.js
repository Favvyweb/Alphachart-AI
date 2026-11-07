/**
 * Trading Journal Module
 * Manages portfolio statistics, recent trade entries, trade logger modal, and AI Discipline Coach.
 */

window.JournalModule = {
  trades: [
    {
      id: 1,
      pair: 'BTC / USDT',
      market: 'Crypto',
      type: 'LONG',
      time: '2h ago',
      pnl: '+$1,240.00',
      isProfit: true,
      notes: '"Stuck to the plan on the breakout. Discipline: 10/10."'
    },
    {
      id: 2,
      pair: 'EUR / USD',
      market: 'Forex',
      type: 'SHORT',
      time: '5h ago',
      pnl: '-$420.50',
      isProfit: false,
      notes: '"Entered too early on FOMO. Need to wait for confirmation."'
    },
    {
      id: 3,
      pair: 'XAU / USD',
      market: 'Gold',
      type: 'LONG',
      time: '1d ago',
      pnl: '+$2,150.00',
      isProfit: true,
      notes: '"Textbook 4H bull flag breakout during London session."'
    }
  ],

  init: function () {
    this.bindEvents();
    this.renderTrades();
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
    if (closeLogBtn) {
      closeLogBtn.addEventListener('click', () => self.closeManualLogModal());
    }

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

  addTradeFromAnalysis: function (analysisData) {
    const isLong = analysisData.signal === 'LONG';
    const estPnl = isLong ? '+$850.00' : '+$640.00';
    const newTrade = {
      id: Date.now(),
      pair: analysisData.pair,
      market: analysisData.market,
      type: analysisData.signal,
      time: 'Just now',
      pnl: estPnl,
      isProfit: true,
      notes: `Target ${analysisData.tp1} set based on ${analysisData.pattern}.`
    };

    this.trades.unshift(newTrade);
    this.renderTrades();
  },

  renderTrades: function () {
    const container = document.getElementById('journal-trades-list');
    if (!container) return;

    if (this.trades.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 text-on-surface-variant/60">
          <p class="font-body-md">No trades logged yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.trades.map(t => `
      <div class="bg-[#181c24] border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
        <div class="flex justify-between items-start">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-black border border-white/10 flex items-center justify-center">
              <span class="material-symbols-outlined ${t.isProfit ? 'text-primary-fixed-dim' : 'text-error'} text-[28px]">
                ${t.market === 'Crypto' ? 'currency_bitcoin' : t.market === 'Gold' ? 'paid' : 'candlestick_chart'}
              </span>
            </div>
            <div>
              <p class="font-body-lg text-body-lg font-semibold text-on-surface">${t.pair}</p>
              <div class="flex items-center gap-2">
                <span class="font-label-sm text-[10px] px-2 py-0.5 rounded ${t.type === 'LONG' ? 'bg-primary/10 text-primary-fixed-dim' : 'bg-error/10 text-error'} uppercase font-bold tracking-wider">
                  ${t.type}
                </span>
                <span class="font-label-sm text-[11px] text-on-surface-variant">${t.time}</span>
              </div>
            </div>
          </div>
          <p class="font-mono-data text-[18px] font-bold ${t.isProfit ? 'text-primary-fixed-dim' : 'text-error'}">${t.pnl}</p>
        </div>
        <div class="bg-black/40 border border-white/5 rounded-xl p-4">
          <p class="font-body-md text-[14px] text-on-surface-variant leading-relaxed italic">${t.notes}</p>
        </div>
      </div>
    `).join('');
  },

  openManualLogModal: function () {
    const modal = document.getElementById('manual-log-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
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
    const pnl = document.getElementById('log-pnl-input').value || '+$500.00';
    const notes = document.getElementById('log-notes-input').value || 'Executed based on AlphaChart signal.';

    const isProfit = !pnl.startsWith('-');
    const newTrade = {
      id: Date.now(),
      pair: pair.toUpperCase(),
      market: 'Manual',
      type: type,
      time: 'Just now',
      pnl: pnl,
      isProfit: isProfit,
      notes: `"${notes}"`
    };

    this.trades.unshift(newTrade);
    this.renderTrades();
    this.closeManualLogModal();
    if (window.App) window.App.showToast('New trade added to your Journal!');
  },

  openCoachChat: function () {
    alert('🤖 AI Discipline Coach: "Great job keeping your risk under control today! Remember to respect your stop-loss on every execution."');
  }
};
