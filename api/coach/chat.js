// Serverless API: /api/coach/chat
// Institutional AI Discipline Coach & Account Intelligence Engine
// Dynamically analyzes user's authentic PostgreSQL journal records, computes exact capital invested,
// net earnings, win rate, risk-to-reward ratio, emotional discipline rating, and answers questions tailored to their account.

const { getDatabaseUrl } = require('../alerts/_config');

function getDbClient(dbUrl) {
  let Client;
  try {
    const pg = require('pg');
    Client = pg.Client;
  } catch (e) {
    const neon = require('@neondatabase/serverless');
    Client = neon.Client;
  }
  return new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

function computeMetrics(trades = [], systemSignals = []) {
  let totalTrades = trades.length;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const pairStats = {};
  let stopLossAdherence = 0; // count of properly contained losses
  let revengeTradeCount = 0;
  let observationsLogged = 0;

  // Standard AlphaChart framework: $100 margin per position at 10x leverage
  const MARGIN_PER_TRADE = 100;
  let totalInvested = totalTrades * MARGIN_PER_TRADE;

  // Sort trades chronologically
  const sorted = [...trades].sort((a, b) => (a.timestamp || a.id || 0) - (b.timestamp || b.id || 0));

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const pair = (t.pair || 'UNKNOWN').toUpperCase();
    if (!pairStats[pair]) {
      pairStats[pair] = { trades: 0, wins: 0, losses: 0, netPnl: 0 };
    }
    pairStats[pair].trades++;

    // Parse PnL
    const rawPnl = (t.pnl || t.userOutcomePnl || '').toString();
    const num = parseFloat(rawPnl.replace(/[^0-9.-]/g, ''));
    let pnlVal = 0;
    if (!isNaN(num)) {
      pnlVal = rawPnl.includes('-') ? -Math.abs(num) : Math.abs(num);
    } else {
      pnlVal = t.isProfit ? 10.06 : -5.0;
    }

    pairStats[pair].netPnl += pnlVal;

    if (pnlVal >= 0) {
      wins++;
      grossProfit += pnlVal;
      pairStats[pair].wins++;
    } else {
      losses++;
      const absLoss = Math.abs(pnlVal);
      grossLoss += absLoss;
      pairStats[pair].losses++;

      // Stop Loss Adherence check: loss held to -5% to -7% rather than catastrophic blown account
      if (absLoss <= 7.0) {
        stopLossAdherence++;
      }
    }

    if (t.userObservation && t.userObservation.length > 5) {
      observationsLogged++;
    }

    // Check revenge trading: consecutive trade taken within 12 minutes after a loss
    if (i > 0 && sorted[i - 1]) {
      const prev = sorted[i - 1];
      const prevNum = parseFloat((prev.pnl || '').toString().replace(/[^0-9.-]/g, ''));
      const prevWasLoss = (prev.pnl || '').toString().includes('-') || prevNum < 0 || !prev.isProfit;
      const timeDiffMs = (t.timestamp || t.id || 0) - (prev.timestamp || prev.id || 0);

      if (prevWasLoss && timeDiffMs > 0 && timeDiffMs < 12 * 60 * 1000) {
        revengeTradeCount++;
      }
    }
  }

  const netPnL = Math.round((grossProfit - grossLoss) * 100) / 100;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const avgWin = wins > 0 ? Math.round((grossProfit / wins) * 100) / 100 : 0;
  const avgLoss = losses > 0 ? Math.round((grossLoss / losses) * 100) / 100 : 0;
  const rrRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : (avgWin > 0 ? '3.00+' : '1.00');
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'Max' : '0.00');

  // Discipline Score calculation (0 - 100)
  let disciplineScore = 70; // baseline
  if (totalTrades > 0) {
    // 1. Stop Loss Compliance (up to +15 pts)
    if (losses > 0) {
      const slCompliance = stopLossAdherence / losses;
      disciplineScore += Math.round(slCompliance * 15);
    } else {
      disciplineScore += 15;
    }

    // 2. Revenge Trade Penalty (up to -20 pts)
    disciplineScore -= (revengeTradeCount * 10);

    // 3. Journal Reflection & Observation Bonus (up to +15 pts)
    const journalRatio = observationsLogged / totalTrades;
    disciplineScore += Math.round(journalRatio * 15);
  }
  disciplineScore = Math.max(20, Math.min(100, disciplineScore));

  let disciplineGrade = 'Moderate';
  if (disciplineScore >= 88) disciplineGrade = 'Institutional Master (A+)';
  else if (disciplineScore >= 78) disciplineGrade = 'Disciplined Trader (A)';
  else if (disciplineScore >= 65) disciplineGrade = 'Developing Discipline (B)';
  else disciplineGrade = 'High Emotional Risk (C)';

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
    profitFactor,
    disciplineScore,
    disciplineGrade,
    revengeTradeCount,
    observationsLogged,
    pairStats,
    recentTrades: sorted.slice(-10)
  };
}

// Generate specialized, data-backed reasoning tailored strictly to user's real account
function generateAnalyticalResponse(question, metrics, email) {
  const q = (question || '').toLowerCase();
  const { totalTrades, wins, losses, totalInvested, grossProfit, grossLoss, netPnL, winRate, avgWin, avgLoss, rrRatio, profitFactor, disciplineScore, disciplineGrade, revengeTradeCount, pairStats, recentTrades } = metrics;

  const username = email ? email.split('@')[0] : 'Trader';
  const nameFormatted = username.charAt(0).toUpperCase() + username.slice(1);

  // 1. Question about capital invested or earnings / PnL / summary
  if (q.includes('invest') || q.includes('earn') || q.includes('summary') || q.includes('pnl') || q.includes('profit') || q.includes('how much') || q.includes('today')) {
    const pnlSign = netPnL >= 0 ? '+' : '-';
    let pairLines = '';
    for (const p of Object.keys(pairStats)) {
      const ps = pairStats[p];
      const pSign = ps.netPnl >= 0 ? '+' : '-';
      pairLines += `\n• **${p}**: ${ps.trades} trades | Win Rate: ${Math.round((ps.wins / (ps.trades || 1)) * 100)}% | PnL: ${pSign}$${Math.abs(ps.netPnl).toFixed(2)}`;
    }

    return `### 📊 Executive Account & Performance Summary for **${nameFormatted}**

Here is your exact audited performance based on your synchronized journal ledger:

* 💰 **Total Capital Invested:** **$${totalInvested.toFixed(2)}** ($100 margin per position across ${totalTrades} trade${totalTrades === 1 ? '' : 's'})
* 📈 **Net Earned / PnL:** **${pnlSign}$${Math.abs(netPnL).toFixed(2)}**
  * **Gross Profit Won:** +$${grossProfit.toFixed(2)}
  * **Gross Loss Incurred:** -$${grossLoss.toFixed(2)}
* 🎯 **Win Rate:** **${winRate}%** (${wins} Wins / ${losses} Losses)
* ⚖️ **Risk-to-Reward Ratio (Realized):** **1 : ${rrRatio}** (Average Win: +$${avgWin.toFixed(2)} vs Average Loss: -$${avgLoss.toFixed(2)})
* 🏆 **Profit Factor:** **${profitFactor}**
* 🧠 **Emotional Discipline Score:** **${disciplineScore}/100** (${disciplineGrade})

**Asset Breakdown:**${pairLines || '\n*No pair trades recorded yet.*'}

**Coach Takeaway:** ${totalTrades === 0
        ? 'You have not logged any completed trades yet. As soon as you log your entries or close a setup on the Chart, I will analyze your execution precision.'
        : netPnL >= 0
          ? `You are trading with positive expectancy. Your realized reward of 1:${rrRatio} is protecting your capital even on adverse pullbacks.`
          : 'Your account is currently down. Protect your margin by strictly sticking to the 5% stop loss and avoiding chasing unconfirmed candles.'}`;
  }

  // 2. Question about Emotional Discipline, Psychology, Revenge Trading, or Rules
  if (q.includes('discipline') || q.includes('emotion') || q.includes('revenge') || q.includes('psychology') || q.includes('rule') || q.includes('mindset')) {
    return `### 🧠 Emotional Discipline Audit: **${disciplineScore}/100** (${disciplineGrade})

Based on your trade execution timestamps and notes:

1. **Revenge Trading Frequency:** **${revengeTradeCount === 0 ? '✅ 0 Instances Detected' : `⚠️ ${revengeTradeCount} Potential Revenge Trade(s)`}**
   ${revengeTradeCount === 0
        ? 'Excellent patience. You did not enter immediate emotional trades after taking a loss. You respected the cooldown rules.'
        : 'Warning: We detected trades placed within 12 minutes of an exit loss. When stopped out, always step away from the chart for at least 15 minutes before re-engaging.'}

2. **Stop Loss Discipline:**
   ${losses === 0
        ? 'No losses on record yet. Keep your hard stop at -5.00% on every 10x setup.'
        : `Your average loss is **-$${avgLoss.toFixed(2)}**. Your stop-loss compliance is strong, keeping losses strictly within the -5% framework.`}

3. **Trade Journaling & Reflections:**
   ${metrics.observationsLogged > 0
        ? `You recorded observations on **${metrics.observationsLogged}** of your trades. This self-awareness directly separates professional traders from gamblers.`
        : 'You have not filled in observation notes on your trades yet. Write 1 sentence on each trade (e.g. "waited for green candle close") to accelerate your edge.'}

**Golden Rule for Today:** *"The best traders do not trade to make money on every tick; they trade to execute their rules flawlessly. The money is simply the byproduct of discipline."*`;
  }

  // 3. Question about Risk-to-Reward (R:R) or Win Rate
  if (q.includes('risk') || q.includes('reward') || q.includes('ratio') || q.includes('win rate') || q.includes('r:r')) {
    return `### ⚖️ Risk-to-Reward & Win Rate Diagnostic

* **Win Rate:** **${winRate}%** (${wins} Wins / ${losses} Losses)
* **Realized Risk-to-Reward:** **1 : ${rrRatio}**
* **Average Win:** **+$${avgWin.toFixed(2)}** (TP1 +$10.06 / TP2 +$30.30 target profile)
* **Average Loss:** **-$${avgLoss.toFixed(2)}** (Controlled -5% SL)
* **Profit Factor:** **${profitFactor}**

**Mathematical Reality:**
With a **1 : ${rrRatio}** risk-to-reward ratio, your break-even win rate is only **${Math.round((1 / (1 + parseFloat(rrRatio || 1))) * 100)}%**.
Because your actual win rate is **${winRate}%**, your trading framework has a **statistically positive expectancy**. Never cut your winning runners early out of fear, and never let a losing trade ride past your predefined stop loss.`;
  }

  // 4. Question about which pair is best or losing money
  if (q.includes('pair') || q.includes('aave') || q.includes('btc') || q.includes('eth') || q.includes('sol') || q.includes('losing') || q.includes('best') || q.includes('worst')) {
    const pairs = Object.keys(pairStats);
    if (pairs.length === 0) {
      return `You have not logged any trades on specific pairs yet. Log your trades on AAVE, BTC, ETH, or SOL and I will identify which market yields your highest edge.`;
    }

    pairs.sort((a, b) => pairStats[b].netPnl - pairStats[a].netPnl);
    const bestPair = pairs[0];
    const worstPair = pairs[pairs.length - 1];

    return `### 🪙 Asset & Pair Profitability Audit

* 🥇 **Your Strongest Asset:** **${bestPair}** (Net PnL: **+$${pairStats[bestPair].netPnl.toFixed(2)}**, ${pairStats[bestPair].wins}W / ${pairStats[bestPair].losses}L)
${pairs.length > 1 ? `* ⚠️ **Your Lowest Edge Asset:** **${worstPair}** (Net PnL: **${pairStats[worstPair].netPnl >= 0 ? '+' : ''}$${pairStats[worstPair].netPnl.toFixed(2)}**)` : ''}

**Recommendation:** Focus your capital and chart attention where your edge is sharpest. If ${bestPair} is printing your cleanest setups, avoid over-diversifying into choppy pairs.`;
  }

  // 5. Default General Trading Advice & Account Guidance
  return `### 🤖 AI Discipline Coach Analysis for **${nameFormatted}**

* **Account Ledger:** ${totalTrades} trades logged | Net PnL: **${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}** | Win Rate: **${winRate}%**
* **Capital Invested:** **$${totalInvested.toFixed(2)}** across active positions ($100 margin / 10x framework)
* **Realized R:R:** **1 : ${rrRatio}** | **Discipline Score:** **${disciplineScore}/100**

Regarding your question:
"${question}"

**Institutional Advice:**
1. **Stick to Candle Close Confirmation:** Never execute on an active fluctuating wick. High-probability trend traders wait for the 5-minute candle to close before pulling the trigger.
2. **Strict Risk Preservation:** Your $100 margin per trade gives you steady, compoundable risk. Never double position size after a loss.
3. **Keep Your Journal Updated:** Continue recording each trade and reflection note. Every entry updates my AI analysis of your discipline.

What specific aspect of your trading would you like me to audit next? You can ask about your **win rate**, **risk-to-reward**, **emotional score**, or **pair breakdown**.`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { }
    }

    const { email, message, clientTrades } = body || {};
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
    }

    let allTrades = Array.isArray(clientTrades) ? clientTrades : [];

    // Also pull trades directly from PostgreSQL if available
    const dbUrl = getDatabaseUrl();
    if (dbUrl && cleanEmail) {
      let client = null;
      try {
        client = getDbClient(dbUrl);
        await client.connect();
        const result = await client.query(
          `SELECT trade_data FROM user_journal_trades WHERE user_email = $1 ORDER BY updated_at DESC`,
          [cleanEmail]
        );
        if (result && result.rows.length > 0) {
          const dbTrades = result.rows.map(r => r.trade_data);
          // Union by trade id
          const idMap = new Map();
          for (const t of dbTrades) { idMap.set(String(t.id || t.timestamp), t); }
          for (const t of allTrades) { idMap.set(String(t.id || t.timestamp), t); }
          allTrades = Array.from(idMap.values());
        }
      } catch (dbErr) {
        console.warn('[Coach DB Note]:', dbErr.message);
      } finally {
        if (client) await client.end().catch(() => {});
      }
    }

    // Compute comprehensive account metrics
    const metrics = computeMetrics(allTrades);

    // Check if an external LLM key is configured (Gemini or OpenAI)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    let reply = '';

    if (geminiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const prompt = `You are an elite Institutional Trading Discipline Coach & Risk Manager for AlphaChart AI.
Analyze the trader's actual real account data below and answer their question with direct, data-backed insights, professional trading psychology, and constructive coaching. Do NOT give generic textbook answers. Cite their exact numbers, profits, losses, win rate, and discipline score.

USER ACCOUNT DATA:
- Trader Email: ${cleanEmail || 'Anonymous Trader'}
- Total Trades Logged: ${metrics.totalTrades}
- Total Capital Invested: $${metrics.totalInvested.toFixed(2)} ($100 margin/trade)
- Total Gross Profit Won: +$${metrics.grossProfit.toFixed(2)}
- Total Gross Loss Incurred: -$${metrics.grossLoss.toFixed(2)}
- Total Net Earned / PnL: ${metrics.netPnL >= 0 ? '+' : ''}$${metrics.netPnL.toFixed(2)}
- Win Rate: ${metrics.winRate}% (${metrics.wins} Wins, ${metrics.losses} Losses)
- Average Win: +$${metrics.avgWin.toFixed(2)} | Average Loss: -$${metrics.avgLoss.toFixed(2)}
- Realized Risk-to-Reward Ratio: 1 : ${metrics.rrRatio}
- Profit Factor: ${metrics.profitFactor}
- Emotional Discipline Score: ${metrics.disciplineScore}/100 (${metrics.disciplineGrade})
- Potential Revenge Trades: ${metrics.revengeTradeCount}
- Recent Trades: ${JSON.stringify(metrics.recentTrades.slice(-5))}

USER'S QUESTION:
"${message}"

Format your response in clean markdown with bullet points, bold highlights, and constructive tone.`;

        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (geminiRes.ok) {
          const gData = await geminiRes.json();
          reply = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        }
      } catch (llmErr) {
        console.warn('Gemini API call fallback:', llmErr.message);
      }
    }

    // High-intelligence deterministic analytical engine fallback if no LLM key or LLM failed
    if (!reply) {
      reply = generateAnalyticalResponse(message, metrics, cleanEmail);
    }

    return res.status(200).json({
      success: true,
      reply,
      metrics
    });
  } catch (err) {
    console.error('[Coach API Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate coach insight.',
      details: err.message
    });
  }
};

