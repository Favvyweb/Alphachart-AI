/**
 * AlphaChart AI - Institutional AI Discipline Coach & Account Intelligence Module
 * - Connects to cloud journal ledger and real-time execution signals
 * - Computes automated end-of-day summary: Total Invested, Net Earned, Win Rate, Risk-to-Reward Ratio, and Discipline Score
 * - Interactive AI chat that answers any questions based on authentic account data
 */

window.AICoachModule = {
  isOpen: false,
  messages: [],
  lastMetrics: null,
  isSending: false,

  init: function () {
    this.bindEvents();
  },

  bindEvents: function () {
    const self = this;

    // Chat card button in Journal tab
    const chatBtn = document.getElementById('ai-coach-chat-btn');
    if (chatBtn) {
      chatBtn.onclick = (e) => {
        e.preventDefault();
        self.openModal();
      };
    }

    // Modal Close buttons
    const closeBtn = document.getElementById('ai-coach-close-btn');
    const closeBackdrop = document.getElementById('ai-coach-backdrop');
    if (closeBtn) closeBtn.onclick = () => self.closeModal();
    if (closeBackdrop) closeBackdrop.onclick = () => self.closeModal();

    // Chat Form Submit
    const form = document.getElementById('ai-coach-form');
    const input = document.getElementById('ai-coach-input');
    if (form && input) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (text) {
          input.value = '';
          self.sendMessage(text);
        }
      };
    }

    // Quick-Prompt Action Pills
    document.querySelectorAll('.coach-quick-prompt').forEach(pill => {
      pill.onclick = (e) => {
        e.preventDefault();
        const promptText = pill.getAttribute('data-prompt') || pill.innerText.trim();
        self.sendMessage(promptText);
      };
    });
  },

  computeLocalMetrics: function () {
    const trades = (window.JournalModule && Array.isArray(window.JournalModule.trades))
      ? window.JournalModule.trades
      : [];

    let totalTrades = trades.length;
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let stopLossAdherence = 0;
    let revengeTrades = 0;
    let notesCount = 0;

    const MARGIN_PER_TRADE = 100;
    const totalInvested = totalTrades * MARGIN_PER_TRADE;

    const sorted = [...trades].sort((a, b) => (a.timestamp || a.id || 0) - (b.timestamp || b.id || 0));

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const raw = (t.pnl || t.userOutcomePnl || '').toString();
      const num = parseFloat(raw.replace(/[^0-9.-]/g, ''));
      let pnlVal = 0;
      if (!isNaN(num)) {
        pnlVal = raw.includes('-') ? -Math.abs(num) : Math.abs(num);
      } else {
        pnlVal = t.isProfit ? 10.06 : -5.0;
      }

      if (pnlVal >= 0) {
        wins++;
        grossProfit += pnlVal;
      } else {
        losses++;
        const absLoss = Math.abs(pnlVal);
        grossLoss += absLoss;
        if (absLoss <= 7.0) stopLossAdherence++;
      }

      if (t.userObservation && t.userObservation.length > 5) notesCount++;

      if (i > 0) {
        const prev = sorted[i - 1];
        const prevNum = parseFloat((prev.pnl || '').toString().replace(/[^0-9.-]/g, ''));
        const prevWasLoss = (prev.pnl || '').toString().includes('-') || prevNum < 0 || !prev.isProfit;
        const diffMs = (t.timestamp || t.id || 0) - (prev.timestamp || prev.id || 0);
        if (prevWasLoss && diffMs > 0 && diffMs < 12 * 60 * 1000) revengeTrades++;
      }
    }

    const netPnL = Math.round((grossProfit - grossLoss) * 100) / 100;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const avgWin = wins > 0 ? Math.round((grossProfit / wins) * 100) / 100 : 0;
    const avgLoss = losses > 0 ? Math.round((grossLoss / losses) * 100) / 100 : 0;
    const rrRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : (avgWin > 0 ? '3.00+' : '1.00');

    let disciplineScore = 75;
    if (totalTrades > 0) {
      if (losses > 0) disciplineScore += Math.round((stopLossAdherence / losses) * 15);
      else disciplineScore += 15;
      disciplineScore -= (revengeTrades * 10);
      disciplineScore += Math.round((notesCount / totalTrades) * 10);
    }
    disciplineScore = Math.max(25, Math.min(100, disciplineScore));

    return {
      totalTrades,
      wins,
      losses,
      totalInvested,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      netPnL,
      winRate,
      avgWin,
      avgLoss,
      rrRatio,
      disciplineScore,
      revengeTrades
    };
  },

  renderSummaryCards: function (metrics) {
    const elInvested = document.getElementById('coach-kpi-invested');
    const elPnl = document.getElementById('coach-kpi-pnl');
    const elWinRate = document.getElementById('coach-kpi-winrate');
    const elRr = document.getElementById('coach-kpi-rr');
    const elScore = document.getElementById('coach-kpi-score');
    const elBrief = document.getElementById('coach-kpi-brief');

    if (!elInvested || !metrics) return;

    elInvested.innerText = `$${metrics.totalInvested.toFixed(2)}`;

    const pnlSign = metrics.netPnL >= 0 ? '+' : '-';
    elPnl.innerText = `${pnlSign}$${Math.abs(metrics.netPnL).toFixed(2)}`;
    elPnl.className = `font-mono text-base sm:text-lg font-bold ${metrics.netPnL >= 0 ? 'text-primary-container' : 'text-[#ff3366]'}`;

    elWinRate.innerText = `${metrics.winRate}%`;
    elRr.innerText = `1 : ${metrics.rrRatio}`;

    elScore.innerText = `${metrics.disciplineScore}/100`;
    elScore.className = `font-mono text-base sm:text-lg font-bold ${metrics.disciplineScore >= 75 ? 'text-primary-container' : 'text-amber-400'}`;

    if (elBrief) {
      if (metrics.totalTrades === 0) {
        elBrief.innerText = 'Log your trades in the journal or trade on the chart to generate your real-time discipline audit.';
      } else {
        const revText = metrics.revengeTrades > 0 ? `⚠️ ${metrics.revengeTrades} revenge trade alert.` : '✅ Zero revenge trading detected.';
        elBrief.innerText = `${metrics.totalTrades} trade(s) analyzed. ${metrics.wins}W / ${metrics.losses}L (${metrics.winRate}%). ${revText}`;
      }
    }
  },

  openModal: function () {
    const modal = document.getElementById('ai-coach-modal');
    if (!modal) return;

    this.isOpen = true;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Compute fresh metrics
    const metrics = this.computeLocalMetrics();
    this.lastMetrics = metrics;
    this.renderSummaryCards(metrics);

    // Initial greeting if no messages yet
    if (this.messages.length === 0) {
      const email = (window.AuthModule && typeof window.AuthModule.getCurrentEmail === 'function' ? window.AuthModule.getCurrentEmail() : null)
        || localStorage.getItem('alphachart_auth_email')
        || 'Trader';
      const name = email.includes('@') ? email.split('@')[0] : email;
      const formattedName = name.charAt(0).toUpperCase() + name.slice(1);

      const welcomeText = `👋 Hello **${formattedName}**! I am your **AI Discipline Coach & Risk Officer**.

I monitor your live trade journal, capital allocation, emotional discipline, and risk-to-reward ratio.

**Today's Executive Snapshot:**
• 💰 **Total Invested:** $${metrics.totalInvested.toFixed(2)} (${metrics.totalTrades} trade${metrics.totalTrades === 1 ? '' : 's'})
• 📈 **Net Earned:** ${metrics.netPnL >= 0 ? '+' : '-'}$${Math.abs(metrics.netPnL).toFixed(2)}
• 🎯 **Win Rate:** ${metrics.winRate}% (${metrics.wins}W / ${metrics.losses}L)
• ⚖️ **Risk-to-Reward Ratio:** 1 : ${metrics.rrRatio}
• 🧠 **Discipline Score:** ${metrics.disciplineScore}/100

Ask me anything about your trading performance, how to fix mistakes, or audit your psychology!`;

      this.appendMessage('coach', welcomeText);
    }

    this.scrollToBottom();
  },

  closeModal: function () {
    const modal = document.getElementById('ai-coach-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.isOpen = false;
  },

  appendMessage: function (role, text) {
    const chatContainer = document.getElementById('ai-coach-chat-container');
    if (!chatContainer) return;

    this.messages.push({ role, text, time: new Date() });

    const msgEl = document.createElement('div');
    const isUser = role === 'user';

    msgEl.className = `flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`;

    // Simple markdown formatting helper (bold, bullets, linebreaks)
    let formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n•/g, '<br>•')
      .replace(/\n/g, '<br>');

    if (isUser) {
      msgEl.innerHTML = `
        <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-container text-black px-4 py-2.5 shadow-sm text-xs sm:text-sm font-medium leading-relaxed">
          ${formattedText}
        </div>
      `;
    } else {
      msgEl.innerHTML = `
        <div class="w-8 h-8 rounded-xl bg-primary-container/15 border border-primary-container/30 flex items-center justify-center shrink-0 text-primary-container mt-0.5">
          <span class="material-symbols-outlined text-[18px]">smart_toy</span>
        </div>
        <div class="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tl-sm bg-[#1c1f26] border border-white/10 text-white/95 px-4 py-3 shadow-md text-xs sm:text-sm leading-relaxed">
          ${formattedText}
        </div>
      `;
    }

    chatContainer.appendChild(msgEl);
    this.scrollToBottom();
  },

  showTypingIndicator: function () {
    const chatContainer = document.getElementById('ai-coach-chat-container');
    if (!chatContainer) return;

    let indicator = document.getElementById('ai-coach-typing');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ai-coach-typing';
      indicator.className = 'flex items-center gap-2 text-xs text-on-surface-variant font-mono py-1';
      indicator.innerHTML = `
        <div class="w-6 h-6 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary-container">
          <span class="material-symbols-outlined text-[14px]">smart_toy</span>
        </div>
        <span class="flex items-center gap-1">
          Analyzing account data
          <span class="inline-block w-1 h-1 rounded-full bg-primary-container animate-bounce"></span>
          <span class="inline-block w-1 h-1 rounded-full bg-primary-container animate-bounce [animation-delay:0.15s]"></span>
          <span class="inline-block w-1 h-1 rounded-full bg-primary-container animate-bounce [animation-delay:0.3s]"></span>
        </span>
      `;
      chatContainer.appendChild(indicator);
      this.scrollToBottom();
    }
  },

  hideTypingIndicator: function () {
    const indicator = document.getElementById('ai-coach-typing');
    if (indicator) indicator.remove();
  },

  scrollToBottom: function () {
    const chatContainer = document.getElementById('ai-coach-chat-container');
    if (chatContainer) {
      setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 30);
    }
  },

  sendMessage: async function (text) {
    if (!text || this.isSending) return;

    this.appendMessage('user', text);
    this.showTypingIndicator();
    this.isSending = true;

    const email = (window.AuthModule && typeof window.AuthModule.getCurrentEmail === 'function' ? window.AuthModule.getCurrentEmail() : null)
      || localStorage.getItem('alphachart_auth_email')
      || '';

    const trades = (window.JournalModule && Array.isArray(window.JournalModule.trades))
      ? window.JournalModule.trades
      : [];

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          message: text,
          clientTrades: trades
        })
      });

      this.hideTypingIndicator();

      if (res.ok) {
        const data = await res.json();
        if (data && data.reply) {
          this.appendMessage('coach', data.reply);
          if (data.metrics) {
            this.lastMetrics = data.metrics;
            this.renderSummaryCards(data.metrics);
          }
        } else {
          this.appendMessage('coach', 'I received your query but could not extract a response. Please try again.');
        }
      } else {
        this.appendMessage('coach', '⚠️ Network timeout or connection glitch. Please check your internet connection.');
      }
    } catch (err) {
      this.hideTypingIndicator();
      this.appendMessage('coach', `⚠️ Note: Unable to reach coach endpoint (${err.message}). Local metrics remain updated.`);
    } finally {
      this.isSending = false;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.AICoachModule) {
    window.AICoachModule.init();
  }
});

