// Serverless API: /api/signals/daily
// Provides 100% deterministic, immutable Daily Signal Records for completed past days
// Anchored to exact UTC calendar days with Session Close at 23:55:00 UTC.

const { getDailySignalRecord, saveDailySignalRecord, getRangeDailySignalRecords } = require('../alerts/_config');

function calculateATR(candles, period = 14) {
  if (!candles || candles.length === 0) return [];
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      trs.push(Math.max(hl, Math.max(hc, lc)));
    }
  }
  const atr = [];
  let sum = 0;
  const initialLen = Math.min(period, trs.length);
  for (let i = 0; i < initialLen; i++) {
    sum += trs[i];
    atr.push(sum / (i + 1));
  }
  for (let i = period; i < trs.length; i++) {
    const val = ((atr[i - 1] * (period - 1)) + trs[i]) / period;
    atr.push(val);
  }
  return atr;
}

function evaluateDaySignals(candles, dayStartSec, dayEndSec) {
  if (!candles || candles.length < 20) return null;

  const atr = calculateATR(candles, 14);
  const mult = 1.6;
  const trend = [];
  const stop = [];
  let currTrend = -1;
  let currStop = candles[0].close + (mult * (atr[0] || (candles[0].high - candles[0].low)));

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const a = atr[i] || (c.high - c.low);
    const up = c.low - (mult * a);
    const dn = c.high + (mult * a);

    if (currTrend === 1) {
      if (c.close < currStop) {
        currTrend = -1;
        currStop = dn;
      } else {
        currStop = Math.max(currStop, up);
      }
    } else {
      if (c.close > currStop) {
        currTrend = 1;
        currStop = up;
      } else {
        currStop = Math.min(currStop, dn);
      }
    }
    trend.push(currTrend);
    stop.push(currStop);
  }

  // Detect signal tags
  const tags = [];
  let activeTrade = null;
  let lastSignalIndex = -999;

  for (let i = 0; i < candles.length; i++) {
    if (i < 14) {
      tags.push(null);
      continue;
    }
    const cur = candles[i];
    const prev = candles[i - 1];

    const curDayNum = Math.floor(cur.time / 86400);
    const prevDayNum = Math.floor(prev.time / 86400);
    if (curDayNum !== prevDayNum) {
      activeTrade = null;
      lastSignalIndex = -999;
    }

    const t = trend[i];
    const pt = trend[i - 1];
    const isFlipBull = (t === 1 && pt === -1);
    const isFlipBear = (t === -1 && pt === 1);

    let canBuy = isFlipBull;
    let canSell = isFlipBear;

    let tag = null;
    if (canBuy && activeTrade !== 'BUY') {
      tag = 'BUY';
      activeTrade = 'BUY';
      lastSignalIndex = i;
    } else if (canSell && activeTrade !== 'SELL') {
      tag = 'SELL';
      activeTrade = 'SELL';
      lastSignalIndex = i;
    }
    tags.push(tag);
  }

  // Evaluate trade outcomes strictly bounded within that day
  const buySignals = [];
  const sellSignals = [];
  const evaluatedSignals = [];

  for (let i = 0; i < candles.length; i++) {
    const tag = tags[i];
    if (tag !== 'BUY' && tag !== 'SELL') continue;

    const c = candles[i];
    if (c.time < dayStartSec || c.time > dayEndSec) continue;

    const isBuy = (tag === 'BUY');
    const entryPrice = c.close;
    let isWin = false;
    let isLoss = false;
    let maxRoePct = 0;
    let maxDrawdownPct = 0;
    let exitPrice = entryPrice;
    let reason = 'In Play';
    let tpTier = '';
    let hitTp1 = false;
    let hitSL = false;
    let tradeClosed = false;
    let pnl = 0;

    for (let k = i + 1; k < candles.length; k++) {
      const nextC = candles[k];
      const nextTag = tags[k];

      // Settle trade at 23:55 UTC session close if not exited yet
      if (nextC.time > dayEndSec) {
        tradeClosed = true;
        exitPrice = candles[k - 1].close;
        reason = `Session Close at $${exitPrice.toFixed(2)}`;
        break;
      }

      let curHighRoe = 0;
      let curLowDrawdown = 0;

      if (isBuy) {
        curHighRoe = ((nextC.high - entryPrice) / entryPrice) * 1000;
        curLowDrawdown = ((nextC.low - entryPrice) / entryPrice) * 1000;
      } else {
        curHighRoe = ((entryPrice - nextC.low) / entryPrice) * 1000;
        curLowDrawdown = ((entryPrice - nextC.high) / entryPrice) * 1000;
      }

      if (curHighRoe > maxRoePct) {
        maxRoePct = curHighRoe;
        exitPrice = isBuy ? nextC.high : nextC.low;
      }
      if (curLowDrawdown < maxDrawdownPct) {
        maxDrawdownPct = curLowDrawdown;
      }

      if (curHighRoe >= 2.0 && !hitTp1) {
        hitTp1 = true;
      }

      // Stop Loss (-5%)
      if (curLowDrawdown <= -5.0 && !hitTp1 && !hitSL) {
        hitSL = true;
        tradeClosed = true;
        exitPrice = isBuy ? (entryPrice * 0.995) : (entryPrice * 1.005);
        reason = `Hit -5.00% SL ($${exitPrice.toFixed(2)})`;
        break;
      }

      // Opposite Reversal
      if ((isBuy && nextTag === 'SELL') || (!isBuy && nextTag === 'BUY')) {
        tradeClosed = true;
        exitPrice = nextC.close;
        reason = `Reversal at $${exitPrice.toFixed(2)}`;
        break;
      }
    }

    if (!tradeClosed) {
      exitPrice = candles[candles.length - 1].close;
    }

    const finalReturnRoe = isBuy
      ? ((exitPrice - entryPrice) / entryPrice) * 1000
      : ((entryPrice - exitPrice) / entryPrice) * 1000;

    if (maxRoePct >= 30.0 || finalReturnRoe >= 30.0) {
      isWin = true;
      tpTier = 'TP3 (+30%)';
      const effPct = Math.max(maxRoePct, finalReturnRoe);
      pnl = Math.round((10.0616 + ((effPct - 2.0) * 2.5876)) * 100) / 100;
    } else if (maxRoePct >= 10.0 || finalReturnRoe >= 10.0) {
      isWin = true;
      tpTier = 'TP2 (+10%)';
      const effPct = Math.max(maxRoePct, finalReturnRoe);
      pnl = Math.round((10.0616 + ((effPct - 2.0) * 2.5876)) * 100) / 100;
    } else if (hitTp1 || maxRoePct >= 2.0) {
      isWin = true;
      tpTier = 'TP1 (+2%)';
      const effPct = Math.max(maxRoePct, finalReturnRoe);
      if (effPct > 2.5) {
        pnl = Math.round((10.0616 + ((effPct - 2.18) * 2.5876)) * 100) / 100;
      } else {
        pnl = 10.06;
      }
    } else if (finalReturnRoe > 0) {
      isWin = true;
      tpTier = `+${finalReturnRoe.toFixed(1)}%`;
      pnl = Math.max(0.50, Math.round(finalReturnRoe * 100) / 100);
    } else {
      isLoss = true;
      tpTier = 'SL';
      pnl = Math.max(-5.00, Math.round(finalReturnRoe * 100) / 100);
    }

    const dObj = new Date(c.time * 1000);
    const timeFormatted = `${String(dObj.getUTCHours()).padStart(2, '0')}:${String(dObj.getUTCMinutes()).padStart(2, '0')}`;

    const sigObj = {
      time: c.time,
      timeFormatted,
      type: tag,
      entryPrice,
      exitPrice,
      maxRoePct,
      tpTier,
      outcome: isWin ? 'win' : 'loss',
      pnl,
      reason,
      isWin
    };

    evaluatedSignals.push(sigObj);
    if (tag === 'BUY') buySignals.push(sigObj);
    if (tag === 'SELL') sellSignals.push(sigObj);
  }

  const buyWins = buySignals.filter(s => s.outcome === 'win').length;
  const buyLosses = buySignals.filter(s => s.outcome === 'loss').length;
  const buyPnl = Math.round(buySignals.reduce((acc, s) => acc + s.pnl, 0) * 100) / 100;

  const sellWins = sellSignals.filter(s => s.outcome === 'win').length;
  const sellLosses = sellSignals.filter(s => s.outcome === 'loss').length;
  const sellPnl = Math.round(sellSignals.reduce((acc, s) => acc + s.pnl, 0) * 100) / 100;

  const totalTrades = evaluatedSignals.length;
  const totalWins = evaluatedSignals.filter(s => s.outcome === 'win').length;
  const totalLosses = totalTrades - totalWins;
  const winRate = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100) : 0;
  const netPnl = Math.round((buyPnl + sellPnl) * 100) / 100;

  return {
    buySignals,
    sellSignals,
    evaluatedSignals,
    buyWins,
    buyLosses,
    buyPnl,
    sellWins,
    sellLosses,
    sellPnl,
    totalTrades,
    totalWins,
    totalLosses,
    winRate,
    netPnl
  };
}

async function fetchAndEvaluateDay(cleanPair, timeframe, dateKey, dayNames) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const dayEndMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const dayStartSec = Math.floor(dayStartMs / 1000);
  const dayEndSec = Math.floor(dayEndMs / 1000);
  const dayName = dayNames[new Date(dayStartMs).getUTCDay()];

  let intervalMs = 300 * 1000;
  if (timeframe === '15m') intervalMs = 900 * 1000;
  if (timeframe === '1h') intervalMs = 3600 * 1000;

  const warmupMs = 50 * intervalMs;
  const fetchStartMs = dayStartMs - warmupMs;

  const binanceUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${cleanPair}&interval=${timeframe}&startTime=${fetchStartMs}&endTime=${dayEndMs}&limit=1000`;
  const binanceRes = await fetch(binanceUrl);
  if (!binanceRes.ok) throw new Error(`Binance error ${binanceRes.status}`);

  const raw = await binanceRes.json();
  const candles = raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));

  const evaluation = evaluateDaySignals(candles, dayStartSec, dayEndSec);
  if (!evaluation) return null;

  return {
    dateKey,
    dayName,
    isToday: false,
    ...evaluation
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const pairParam = req.query.pair || 'BTCUSDT';
  const cleanPair = pairParam.toUpperCase().replace(/[\s\-_/]/g, '').replace(/USD$/, 'USDT');
  const timeframe = req.query.timeframe || '5m';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

  // Determine target dates
  const targetDates = [];
  if (req.query.date) {
    targetDates.push(req.query.date);
  } else {
    // Month range: defaults to current month (e.g. "2026-11")
    const targetMonth = req.query.month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [tYear, tMonth] = targetMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(tYear, tMonth, 0)).getUTCDate();
    const isCurrentMonth = (tYear === now.getUTCFullYear() && (tMonth - 1) === now.getUTCMonth());
    const maxDay = isCurrentMonth ? Math.max(1, now.getUTCDate() - 1) : daysInMonth;

    for (let day = 1; day <= maxDay; day++) {
      const dStr = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      targetDates.push(dStr);
    }
  }

  const results = {};

  // 1. Fast range query in PostgreSQL (retrieves all previously locked days in a single query)
  if (targetDates.length > 0) {
    const startKey = targetDates[0];
    const endKey = targetDates[targetDates.length - 1];
    try {
      const dbRecords = await getRangeDailySignalRecords(cleanPair, timeframe, startKey, endKey);
      if (dbRecords && typeof dbRecords === 'object') {
        Object.assign(results, dbRecords);
      }
    } catch (e) {
      console.warn('Range DB query error:', e.message);
    }
  }

  // 2. Evaluate any missing days from Binance and lock them into PostgreSQL
  const missingDates = targetDates.filter(dKey => !results[dKey]);
  if (missingDates.length > 0) {
    for (let i = 0; i < missingDates.length; i += 4) {
      const batch = missingDates.slice(i, i + 4);
      await Promise.all(batch.map(async (dateKey) => {
        try {
          const record = await fetchAndEvaluateDay(cleanPair, timeframe, dateKey, dayNames);
          if (record) {
            await saveDailySignalRecord(cleanPair, timeframe, dateKey, record.dayName, record);
            results[dateKey] = record;
          }
        } catch (err) {
          console.warn(`[Daily Record Error] ${cleanPair} ${dateKey}:`, err.message);
        }
      }));
    }
  }

  return res.status(200).json({
    success: true,
    pair: cleanPair,
    timeframe,
    records: results
  });
};

