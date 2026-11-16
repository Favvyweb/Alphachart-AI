// Serverless 24/7 Cloud Background Monitor: /api/alerts/cron
// Monitors Binance markets continuously, detects confirmed BUY, SELL, TP1, TP2, and SL signals on candle close,
// and sends native Web Push notifications directly to users' phones even when the app is completely closed.

const { webpush, getSubscriptions, removeSubscription, hasSentEvent, markSentEvent } = require('./_config');

// Deduplication map to ensure each candle's signal is notified exactly ONCE
global._sentSignalKeys = global._sentSignalKeys || new Set();

const MONITORED_PAIRS = ['AAVEUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

async function fetchBinanceCandles(symbol, interval = '5m', limit = 100) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance error ${res.status}`);
  const raw = await res.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

function calculateATR(candles, period = 14) {
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      trs.push(Math.max(hl, hc, lc));
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

function evaluateSignals(candles, symbol = 'BTCUSDT') {
  if (!candles || candles.length < 30) return [];
  const atr = calculateATR(candles, 14);
  const mult = 1.6;
  const trend = [];
  const stop = [];
  let currTrend = -1;
  let currStop = candles[0].close + (mult * (atr[0] || 1));

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

  // Precompute 20-period rolling Volume Moving Average
  const volMA = [];
  for (let v = 0; v < candles.length; v++) {
    const vStart = Math.max(0, v - 19);
    let vSum = 0;
    let vCount = 0;
    for (let k = vStart; k <= v; k++) {
      vSum += (candles[k].volume || 0);
      vCount++;
    }
    volMA.push(vCount > 0 ? (vSum / vCount) : 0);
  }

  const cleanSym = (symbol || '').toUpperCase().replace(/[\s\-_/]/g, '');
  const isAave = cleanSym.includes('AAVE');
  const minScoreThreshold = isAave ? 68 : 60;

  const signals = [];
  let activeTrade = null;
  let entryPrice = 0;
  let tp1Hit = false;
  let tp2Hit = false;
  let lastSignalIndex = -999;

  for (let i = 14; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const curDay = Math.floor(cur.time / 86400);
    const prevDay = Math.floor(prev.time / 86400);
    if (curDay !== prevDay) {
      activeTrade = null;
      tp1Hit = false;
      tp2Hit = false;
      lastSignalIndex = -999;
    }

    const t = trend[i];
    const pt = trend[i - 1];
    const isFlipBull = (t === 1 && pt === -1);
    const isFlipBear = (t === -1 && pt === 1);

    // Active trade TP / SL milestones
    if (activeTrade === 'BUY') {
      const roeHigh = ((cur.high - entryPrice) / entryPrice) * 1000;
      const roeLow = ((cur.low - entryPrice) / entryPrice) * 1000;
      if (roeHigh >= 2.0 && !tp1Hit) {
        tp1Hit = true;
        signals.push({ type: 'TP1', time: cur.time, price: cur.high, direction: 'BUY' });
      }
      if (roeHigh >= 10.0 && !tp2Hit) {
        tp2Hit = true;
        signals.push({ type: 'TP2', time: cur.time, price: cur.high, direction: 'BUY' });
      }
      if (roeLow <= -5.0 && !tp1Hit) {
        signals.push({ type: 'SL', time: cur.time, price: entryPrice * 0.995, direction: 'BUY' });
        activeTrade = null;
      }
    } else if (activeTrade === 'SELL') {
      const roeHigh = ((entryPrice - cur.low) / entryPrice) * 1000;
      const roeLow = ((entryPrice - cur.high) / entryPrice) * 1000;
      if (roeHigh >= 2.0 && !tp1Hit) {
        tp1Hit = true;
        signals.push({ type: 'TP1', time: cur.time, price: cur.low, direction: 'SELL' });
      }
      if (roeHigh >= 10.0 && !tp2Hit) {
        tp2Hit = true;
        signals.push({ type: 'TP2', time: cur.time, price: cur.low, direction: 'SELL' });
      }
      if (roeLow <= -5.0 && !tp1Hit) {
        signals.push({ type: 'SL', time: cur.time, price: entryPrice * 1.005, direction: 'SELL' });
        activeTrade = null;
      }
    }

    // Cooldown check (prevent rapid-fire consecutive flips within 2 bars)
    const canSignalAgain = (i - lastSignalIndex) >= 2;

    const curRange = Math.max(cur.high - cur.low, 0.0001);
    const upperWick = cur.high - Math.max(cur.close, cur.open);
    const lowerWick = Math.min(cur.close, cur.open) - cur.low;
    const upperWickRatio = upperWick / curRange;
    const lowerWickRatio = lowerWick / curRange;
    const isBullCandle = cur.close > cur.open;
    const isBearCandle = cur.close < cur.open;

    // Dynamic S/R lookback (50 bars)
    const lookback = Math.max(0, i - 50);
    let sH = -Infinity;
    let sL = Infinity;
    for (let k = lookback; k <= i; k++) {
      if (candles[k].high > sH) sH = candles[k].high;
      if (candles[k].low < sL) sL = candles[k].low;
    }
    const sRange = Math.max(sH - sL, 0.0001);
    const sMid = sL + (sRange * 0.5);
    const premZone = sH - (sRange * 0.20);
    const discZone = sL + (sRange * 0.20);

    const sweptLow = (cur.low < sL || prev.low < sL) && (cur.close >= sL);
    const sweptHigh = (cur.high > sH || prev.high > sH) && (cur.close <= sH);

    const curVolMA = volMA[i] || 0;
    let canBuy = false;
    let canSell = false;

    // Multi-factor Confluence Scoring (Candle Anatomy, Absorption/Rejection, S/R, Volume)
    if (canSignalAgain) {
      if (isFlipBull) {
        let score = 50;
        if (isBullCandle) score += 15;
        if (lowerWickRatio >= 0.15) score += 10;
        if (upperWickRatio >= 0.48 && !isBullCandle) score -= 25;
        if (cur.volume >= (curVolMA * 0.60) || cur.volume >= prev.volume) score += 10;
        if (cur.close <= sMid) score += 10;
        if (sweptLow) score += 15;
        if (cur.close >= premZone && cur.volume < curVolMA) score -= 15;

        if (score >= minScoreThreshold) canBuy = true;
      } else if (isFlipBear) {
        let score = 50;
        if (isBearCandle) score += 15;
        if (upperWickRatio >= 0.15) score += 10;
        if (lowerWickRatio >= 0.48 && !isBearCandle) score -= 25;
        if (cur.volume >= (curVolMA * 0.60) || cur.volume >= prev.volume) score += 10;
        if (cur.close >= sMid) score += 10;
        if (sweptHigh) score += 15;
        if (cur.close <= discZone && cur.volume < curVolMA) score -= 15;

        if (score >= minScoreThreshold) canSell = true;
      }
    }

    if (canBuy && activeTrade !== 'BUY') {
      activeTrade = 'BUY';
      entryPrice = cur.close;
      tp1Hit = false;
      tp2Hit = false;
      lastSignalIndex = i;
      signals.push({ type: 'BUY', time: cur.time, price: cur.close });
    } else if (canSell && activeTrade !== 'SELL') {
      activeTrade = 'SELL';
      entryPrice = cur.close;
      tp1Hit = false;
      tp2Hit = false;
      lastSignalIndex = i;
      signals.push({ type: 'SELL', time: cur.time, price: cur.close });
    }
  }

  return signals;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const subscriptions = await getSubscriptions();
  if (!subscriptions || subscriptions.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'Cloud monitor ran. No subscriptions registered yet.'
    });
  }

  const newTriggers = [];

  for (const sym of MONITORED_PAIRS) {
    try {
      const candles = await fetchBinanceCandles(sym, '5m', 80);
      const signals = evaluateSignals(candles, sym);

      // Inspect confirmed closed candles (safely covers last 2 closed candles so no jitter misses an event)
      const lastCandle = candles[candles.length - 2]; // Last closed candle
      if (!lastCandle) continue;

      const checkCutoff = candles[candles.length - 3] ? candles[candles.length - 3].time : lastCandle.time;
      const latestSignals = signals.filter(s => s.time >= checkCutoff);

      for (const sig of latestSignals) {
        const dedupeKey = `${sym}_5m_${sig.time}_${sig.type}`;
        const alreadySent = await hasSentEvent(dedupeKey);
        if (!alreadySent) {
          await markSentEvent(dedupeKey);
          newTriggers.push({
            symbol: sym,
            pairFormatted: sym.replace('USDT', ' / USDT'),
            ...sig
          });
        }
      }
    } catch (err) {
      console.warn(`[Monitor] Error checking ${sym}:`, err.message);
    }
  }

  // Dispatch Web Push to all registered devices for each new trigger
  let sentCount = 0;
  for (const trig of newTriggers) {
    const isBuy = trig.type === 'BUY';
    const isSell = trig.type === 'SELL';
    const isTp = trig.type === 'TP1' || trig.type === 'TP2';
    const isSl = trig.type === 'SL';

    let title = '';
    let body = '';

    if (isBuy) {
      title = `🟢 BUY Signal Confirmed! ${trig.pairFormatted}`;
      body = `Entry: $${trig.price.toFixed(2)} • TP1: +2% | SL: -5% • Live Instant Alert`;
    } else if (isSell) {
      title = `🔴 SELL Signal Confirmed! ${trig.pairFormatted}`;
      body = `Entry: $${trig.price.toFixed(2)} • TP1: +2% | SL: -5% • Live Instant Alert`;
    } else if (isTp) {
      title = `🎯 ${trig.type} Profit Hit! ${trig.pairFormatted}`;
      body = `Target reached at $${trig.price.toFixed(2)}! Profit booked. Click to view chart.`;
    } else if (isSl) {
      title = `🛑 Stop Loss Hit: ${trig.pairFormatted}`;
      body = `Protected exit at $${trig.price.toFixed(2)} (-5%). Trend Trader resetting for next entry.`;
    }

    const payload = JSON.stringify({
      title,
      body,
      tag: `alphachart-${trig.symbol}-${trig.type}-${trig.time}`,
      url: '/#charts',
      signal: trig
    });

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        sentCount++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await removeSubscription(sub.endpoint);
        }
      }
    }));
  }

  return res.status(200).json({
    success: true,
    newTriggersCount: newTriggers.length,
    notificationsSent: sentCount,
    activeSubscribers: subscriptions.length,
    timestamp: new Date().toISOString()
  });
};

