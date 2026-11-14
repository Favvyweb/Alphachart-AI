// Serverless 24/7 Cloud Background Monitor: /api/alerts/cron
// Monitors Binance markets continuously, detects confirmed BUY, SELL, TP1, TP2, and SL signals on candle close,
// and sends native Web Push notifications directly to users' phones even when the app is completely closed.

const { webpush, getSubscriptions, removeSubscription } = require('./_config');

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

function evaluateSignals(candles) {
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

  const signals = [];
  let activeTrade = null;
  let entryPrice = 0;

  for (let i = 14; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const curDay = Math.floor(cur.time / 86400);
    const prevDay = Math.floor(prev.time / 86400);
    if (curDay !== prevDay) {
      activeTrade = null;
    }

    const t = trend[i];
    const pt = trend[i - 1];
    const isFlipBull = (t === 1 && pt === -1);
    const isFlipBear = (t === -1 && pt === 1);

    if (activeTrade === 'BUY') {
      const roeHigh = ((cur.high - entryPrice) / entryPrice) * 1000;
      const roeLow = ((cur.low - entryPrice) / entryPrice) * 1000;
      if (roeHigh >= 2.0) {
        signals.push({ type: 'TP1', time: cur.time, price: cur.high, direction: 'BUY' });
      }
      if (roeHigh >= 10.0) {
        signals.push({ type: 'TP2', time: cur.time, price: cur.high, direction: 'BUY' });
      }
      if (roeLow <= -5.0) {
        signals.push({ type: 'SL', time: cur.time, price: entryPrice * 0.995, direction: 'BUY' });
        activeTrade = null;
      }
    } else if (activeTrade === 'SELL') {
      const roeHigh = ((entryPrice - cur.low) / entryPrice) * 1000;
      const roeLow = ((entryPrice - cur.high) / entryPrice) * 1000;
      if (roeHigh >= 2.0) {
        signals.push({ type: 'TP1', time: cur.time, price: cur.low, direction: 'SELL' });
      }
      if (roeHigh >= 10.0) {
        signals.push({ type: 'TP2', time: cur.time, price: cur.low, direction: 'SELL' });
      }
      if (roeLow <= -5.0) {
        signals.push({ type: 'SL', time: cur.time, price: entryPrice * 1.005, direction: 'SELL' });
        activeTrade = null;
      }
    }

    if (isFlipBull && activeTrade !== 'BUY') {
      activeTrade = 'BUY';
      entryPrice = cur.close;
      signals.push({ type: 'BUY', time: cur.time, price: cur.close });
    } else if (isFlipBear && activeTrade !== 'SELL') {
      activeTrade = 'SELL';
      entryPrice = cur.close;
      signals.push({ type: 'SELL', time: cur.close ? cur.close : cur.open });
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
      const signals = evaluateSignals(candles);

      // Check the latest closed candle signal
      const lastCandle = candles[candles.length - 2]; // Last closed candle
      if (!lastCandle) continue;

      const latestSignals = signals.filter(s => s.time >= lastCandle.time);

      for (const sig of latestSignals) {
        const dedupeKey = `${sym}_5m_${sig.time}_${sig.type}`;
        if (!global._sentSignalKeys.has(dedupeKey)) {
          global._sentSignalKeys.add(dedupeKey);
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
