/**
 * AlphaChart AI - Native TradingView Chart Engine with Trend Trader Remastered & MACD
 * Powered by TradingView's official Lightweight Charts library:
 * - Full interactive TradingView dark-theme candlestick chart with pan & zoom
 * - Real-time BUY and SELL reversal tags + Take Profit (TP) fractal markers
 * - Volume overlay histogram
 * - Synchronized MACD (12, 26, close, 9) sub-chart with Histogram & Signal lines
 * - Real-time Sound Chimes, Mobile Vibration, and Phone Push Notifications
 */

window.TrendTraderEngine = {
  mainChart: null,
  macdChart: null,
  candleSeries: null,
  volumeSeries: null,
  psarSeries: null,
  histSeries: null,
  macdLineSeries: null,
  signalLineSeries: null,
  smcZonesOverlay: null,
  smcPriceLines: [],
  currentSwingHigh: 0,
  currentPremiumLow: 0,
  currentMidpoint: 0,
  currentDiscountHigh: 0,
  currentSwingLow: 0,
  showSMCLevels: true,
  lastPerformance: null,

  currentPair: 'BTC / USDT',
  currentTimeframe: '5m',
  lastCandles: [],
  lastAnalysis: null,
  candlesCache: {},
  liveWs: null,
  liveWsRetryTimer: null,
  isLiveStreamActive: false,
  lastNotifiedSignalKey: null,
  _bannerTimer: null,

  /**
   * Fetch live Binance candles for 5m, 15m, or 1h with high-speed parallel fetching and memory cache
   */
  fetchCandles: async function (pairName, interval = '5m') {
    if (pairName) this.currentPair = pairName;
    let cleanSymbol = 'BTCUSDT';
    if (pairName) {
      const raw = pairName.toUpperCase().replace(/[\s\-_/]/g, '');
      if (raw.endsWith('USDT') || raw.endsWith('USDC') || raw.endsWith('BUSD')) {
        cleanSymbol = raw;
      } else if (raw.endsWith('USD')) {
        cleanSymbol = `${raw.replace(/USD$/, '')}USDT`;
      } else if (['EURUSD', 'GBPUSD', 'XAUUSD', 'USOIL'].includes(raw)) {
        cleanSymbol = 'BTCUSDT';
      } else {
        cleanSymbol = `${raw}USDT`;
      }
    }

    let binanceInterval = '5m';
    if (interval === '60' || interval === '1h') binanceInterval = '1h';
    else if (interval === '15' || interval === '15m') binanceInterval = '15m';
    else binanceInterval = '5m';

    const now = new Date();
    // Midnight 00:00:00 UTC of today (12:00:00 AM)
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

    // Warm-up bars before midnight (100 bars) so EMA 50, MACD, and PSAR are fully stabilized and accurate from 12:00 AM
    let warmUpMs = 100 * 300 * 1000;
    if (binanceInterval === '15m') warmUpMs = 100 * 900 * 1000;
    else if (binanceInterval === '1h') warmUpMs = 100 * 3600 * 1000;

    const startFetchMs = midnightUtcMs - warmUpMs;

    const cacheKey = `${cleanSymbol}_${binanceInterval}`;
    const cached = this.candlesCache[cacheKey];

    // Return cached candles immediately if fresh (< 15s old) for 0ms instant display
    if (cached && (Date.now() - cached.timestamp < 15000) && cached.candles && cached.candles.length >= 20) {
      return cached.candles;
    }

    const endpoints = [
      `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=1000`,
      `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=1000`
    ];

    // Fast parallel fetch: query endpoints simultaneously with a 3.5s timeout. Fastest wins!
    const fetchWithTimeout = async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length >= 10) {
            return raw.map(k => ({
              time: Math.floor(k[0] / 1000), // Unix seconds for Lightweight Charts
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5])
            }));
          }
        }
      } catch (err) {
        clearTimeout(timer);
      }
      throw new Error(`Endpoint ${url} failed or timed out`);
    };

    try {
      const candles = await Promise.any(endpoints.map(fetchWithTimeout));
      this.candlesCache[cacheKey] = { timestamp: Date.now(), candles };
      return candles;
    } catch (e) {
      // If we have any cached data (even if slightly stale), return it rather than showing fake candles
      if (cached && cached.candles && cached.candles.length >= 20) {
        return cached.candles;
      }
      // Instant fallback candle model starting from 12:00 AM midnight
      const fallback = this.generateFallbackCandles(cleanSymbol, binanceInterval, 288);
      this.candlesCache[cacheKey] = { timestamp: Date.now(), candles: fallback };
      return fallback;
    }
  },

  generateFallbackCandles: function (symbol, interval, count = 350) {
    const candles = [];
    let intervalSec = 300;
    if (interval === '1h') intervalSec = 3600;
    else if (interval === '15m') intervalSec = 900;

    const now = new Date();
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);
    const startSec = midnightSec - (100 * intervalSec);
    let current = symbol.includes('BTC') ? 66500.0 : symbol.includes('ETH') ? 2600.0 : symbol.includes('AAVE') ? 125.36 : 100.0;

    for (let i = 0; i < count; i++) {
      const t = startSec + (i * intervalSec);
      const volatility = current * (interval === '1h' ? 0.006 : 0.003);
      const change = (Math.sin(i * 0.25) * 0.6 + (Math.random() - 0.48)) * volatility;
      const open = current;
      const close = current + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = Math.floor(Math.random() * 500) + 150;

      candles.push({ time: t, open, high, low, close, volume });
      current = close;
    }
    return candles;
  },

  /**
   * Parabolic SAR (start: 0.02, step: 0.02, max: 0.2)
   */
  calculatePSAR: function (candles, start = 0.02, step = 0.02, max = 0.2) {
    if (!candles || candles.length < 3) return [];
    const psar = [];

    let isUp = candles[1].close >= candles[0].close;
    let af = start;
    let ep = isUp ? candles[0].high : candles[0].low;
    let sar = isUp ? candles[0].low : candles[0].high;

    psar.push({ sar, isUp, flipped: false, tag: null });

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const prev2 = i >= 2 ? candles[i - 2] : prev;
      const cur = candles[i];

      let nextSar = sar + af * (ep - sar);
      let flipped = false;
      let tag = null;

      if (isUp) {
        nextSar = Math.min(nextSar, prev.low, prev2.low);
        if (cur.low < nextSar) {
          isUp = false;
          flipped = true;
          sar = ep;
          ep = cur.low;
          af = start;
          tag = 'SELL';
        } else {
          sar = nextSar;
          if (cur.high > ep) {
            ep = cur.high;
            af = Math.min(af + step, max);
          }
        }
      } else {
        nextSar = Math.max(nextSar, prev.high, prev2.high);
        if (cur.high > nextSar) {
          isUp = true;
          flipped = true;
          sar = ep;
          ep = cur.high;
          af = start;
          tag = 'BUY';
        } else {
          sar = nextSar;
          if (cur.low < ep) {
            ep = cur.low;
            af = Math.min(af + step, max);
          }
        }
      }

      psar.push({ sar, isUp, flipped, tag, af, ep });
    }

    return psar;
  },

  /**
   * Bill Williams 2-bar Fractals (2 2 0)
   */
  calculateFractals: function (candles, n = 2) {
    const fractals = [];
    for (let i = 0; i < candles.length; i++) {
      let isHigh = false;
      let isLow = false;

      if (i >= n && i <= candles.length - 1 - n) {
        const curH = candles[i].high;
        const curL = candles[i].low;
        let highCheck = true;
        let lowCheck = true;

        for (let j = 1; j <= n; j++) {
          if (candles[i - j].high >= curH || candles[i + j].high >= curH) highCheck = false;
          if (candles[i - j].low <= curL || candles[i + j].low <= curL) lowCheck = false;
        }

        isHigh = highCheck;
        isLow = lowCheck;
      }

      fractals.push({ isHigh, isLow });
    }
    return fractals;
  },

  /**
   * Smart Money Concepts (SMC) Market Structure:
   * Dynamically tracks Swing Highs (Resistance / Liquidity) and Swing Lows (Support / Liquidity)
   */
  calculateMarketStructure: function (candles, fractals) {
    const resistanceLevels = [];
    const supportLevels = [];
    let activeResistance = null;
    let activeSupport = null;

    for (let i = 0; i < candles.length; i++) {
      // In 2-bar fractals, the peak at [i - 2] is officially confirmed once bar [i] closes
      if (i >= 2 && fractals[i - 2]) {
        if (fractals[i - 2].isHigh) {
          activeResistance = candles[i - 2].high;
        }
        if (fractals[i - 2].isLow) {
          activeSupport = candles[i - 2].low;
        }
      }
      resistanceLevels.push(activeResistance);
      supportLevels.push(activeSupport);
    }

    return { resistanceLevels, supportLevels };
  },

  calcEMA: function (values, period) {
    if (!values || values.length === 0) return [];
    const k = 2 / (period + 1);
    const ema = [];
    let sum = 0;
    const initialLen = Math.min(period, values.length);
    for (let i = 0; i < initialLen; i++) sum += values[i];
    let prev = sum / initialLen;

    for (let i = 0; i < values.length; i++) {
      if (i < initialLen) {
        ema.push(prev);
      } else {
        const cur = (values[i] * k) + (prev * (1 - k));
        ema.push(cur);
        prev = cur;
      }
    }
    return ema;
  },

  calculateMACD: function (candles, fastLen = 12, slowLen = 26, sigLen = 9) {
    const closes = candles.map(c => c.close);
    const fastEMA = this.calcEMA(closes, fastLen);
    const slowEMA = this.calcEMA(closes, slowLen);
    const macdLine = [];

    for (let i = 0; i < closes.length; i++) {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }

    const signalLine = this.calcEMA(macdLine, sigLen);
    const histogram = [];

    for (let i = 0; i < closes.length; i++) {
      histogram.push(macdLine[i] - signalLine[i]);
    }

    return { macdLine, signalLine, histogram };
  },

  /**
   * Average True Range (ATR) calculation
   */
  calculateATR: function (candles, period = 14) {
    if (!candles || candles.length === 0) return [];
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
  },

  /**
   * Trend Trader Remastered (by aybarsm)
   * High-accuracy adaptive ATR trailing stop trend-following filter
   */
  calculateTrendTraderRemastered: function (candles, period = 14, mult = 1.6) {
    if (!candles || candles.length < 2) return { trend: [], stop: [], atr: [] };
    const atr = this.calculateATR(candles, period);
    const trend = [];
    const stop = [];
    let currTrend = -1; // -1 = Bearish, 1 = Bullish
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
    return { trend, stop, atr };
  },

  /**
   * Run Institutional Smart Money Concepts (SMC) + Trend Trader Remastered + MACD Momentum Engine:
   * - Eliminates weak false whipsaws and counter-trend traps
   * - Requires candle close confirmation (no wick triggers)
   * - Master Directional Gate: Trend Trader Stop line determines allowed signal direction
   * - BUY: Line flips Bullish below candles, confirmed with green close & rising MACD momentum
   * - SELL: Line flips Bearish above candles, confirmed with red close & falling MACD momentum
   */
  analyzeCandles: function (candles) {
    const psar = this.calculatePSAR(candles, 0.02, 0.02, 0.2);
    const fractals = this.calculateFractals(candles, 2);
    const macd = this.calculateMACD(candles, 12, 26, 9);

    // Adaptive parameters for 5m scalping vs higher timeframes
    let ttPeriod = 14;
    let ttMult = 1.6;
    if (this.currentTimeframe === '15m' || this.currentTimeframe === '15') {
      ttMult = 1.8;
    } else if (this.currentTimeframe === '1h' || this.currentTimeframe === '60') {
      ttMult = 2.0;
    }
    const trendTrader = this.calculateTrendTraderRemastered(candles, ttPeriod, ttMult);
    const closes = candles.map(c => c.close);
    const ema7 = this.calcEMA(closes, 7);
    const ema14 = this.calcEMA(closes, 14);
    const ema20 = this.calcEMA(closes, 20);
    const ema50 = this.calcEMA(closes, 50);

    const marketStructure = this.calculateMarketStructure(candles, fractals);

    // Rolling 20-period Volume Moving Average for institutional volume verification
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

    const cleanSymbol = (this.currentPair || 'BTCUSDT').toUpperCase().replace(/[\s\-_/]/g, '');
    const isAave = cleanSymbol.includes('AAVE');
    const minScoreThreshold = isAave ? 68 : 60;

    // Calculate start of day (12:00:00 AM UTC) to anchor the session
    const nowDayObj = new Date();
    const midnightUtcMs = Date.UTC(nowDayObj.getUTCFullYear(), nowDayObj.getUTCMonth(), nowDayObj.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);

    const tags = [];
    let activeTrade = null; // null, 'BUY', or 'SELL'
    let entryPrice = 0;
    let lastSignalIndex = -999;

    for (let i = 0; i < candles.length; i++) {
      if (i < 14) {
        tags.push(null);
        continue;
      }
      const cur = candles[i];
      const prev = candles[i - 1];
      const prev2 = i >= 2 ? candles[i - 2] : prev;

      // Session reset at each calendar day midnight UTC (00:00:00 UTC) so each day evaluates deterministically
      const curDayNum = Math.floor(cur.time / 86400);
      const prevDayNum = Math.floor(prev.time / 86400);
      if (curDayNum !== prevDayNum) {
        activeTrade = null;
        lastSignalIndex = -999;
      }

      const ttTrend = (trendTrader.trend && trendTrader.trend[i] !== undefined) ? trendTrader.trend[i] : -1;
      const prevTtTrend = (i > 0 && trendTrader.trend && trendTrader.trend[i - 1] !== undefined) ? trendTrader.trend[i - 1] : ttTrend;
      const isFlipBull = (ttTrend === 1 && prevTtTrend === -1);
      const isFlipBear = (ttTrend === -1 && prevTtTrend === 1);

      // Invalidate / reset trade lifecycle if trailing stop breached or severe adverse move:
      // This prevents activeTrade from being stuck across multi-hour cascades!
      if (activeTrade === 'BUY' && (ttTrend === -1 || (entryPrice > 0 && cur.close < entryPrice * 0.994))) {
        activeTrade = null;
      }
      if (activeTrade === 'SELL' && (ttTrend === 1 || (entryPrice > 0 && cur.close > entryPrice * 1.006))) {
        activeTrade = null;
      }

      const macdHist = (macd.histogram && macd.histogram[i] !== undefined) ? macd.histogram[i] : 0;
      const macdLine = (macd.macdLine && macd.macdLine[i] !== undefined) ? macd.macdLine[i] : 0;
      const sigLine = (macd.signalLine && macd.signalLine[i] !== undefined) ? macd.signalLine[i] : 0;
      const prevMacdHist = (i > 0 && macd.histogram && macd.histogram[i - 1] !== undefined) ? macd.histogram[i - 1] : 0;

      const isHistRising = macdHist > prevMacdHist;
      const isHistFalling = macdHist < prevMacdHist;
      const isMacdBullish = macdLine >= sigLine;
      const isMacdBearish = macdLine < sigLine;

      const curRange = Math.max(cur.high - cur.low, 0.0001);
      const upperWick = cur.high - Math.max(cur.close, cur.open);
      const lowerWick = Math.min(cur.close, cur.open) - cur.low;
      const upperWickRatio = upperWick / curRange;
      const lowerWickRatio = lowerWick / curRange;
      const isBullCandle = cur.close > cur.open;
      const isBearCandle = cur.close < cur.open;

      const prevRange = Math.max(prev.high - prev.low, 0.0001);
      const prevUpperWickRatio = (prev.high - Math.max(prev.close, prev.open)) / prevRange;
      const prevLowerWickRatio = (Math.min(prev.close, prev.open) - prev.low) / prevRange;

      // Dynamic session swing range for SMC Premium, Equilibrium, and Discount Zones
      const lookback = Math.max(0, i - 60);
      let sH = -Infinity;
      let sL = Infinity;
      for (let k = lookback; k <= i; k++) {
        if (candles[k].high > sH) sH = candles[k].high;
        if (candles[k].low < sL) sL = candles[k].low;
      }
      const sRange = Math.max(sH - sL, 0.0001);
      const sMid = sL + (sRange * 0.5); // 0.50 Equilibrium level
      const premLow = sH - (sRange * 0.20); // Top 20% is Premium Zone (Strong Resistance)
      const discHigh = sL + (sRange * 0.20); // Bottom 20% is Discount Zone (Weak Support)
      const eqTolerance = sRange * 0.07; // Equilibrium tolerance band

      // Cooldown check (prevent rapid-fire consecutive flips within 2 bars)
      const barsSinceSignal = i - lastSignalIndex;
      const canSignalAgain = barsSinceSignal >= 2;

      let canBuy = false;
      let canSell = false;

      // ========================================================
      // 1. INSTITUTIONAL PATTERN LEARNING & CONFLUENCE MATRIX
      // ========================================================
      // Evaluates Candlestick Anatomy, Absorption/Rejection Wicks,
      // Dynamic Support/Resistance Zones, Liquidity Sweeps, and Volume Participation.
      // - 100% Non-Repainting: Evaluated strictly on closed candles [0..i].
      // - Eliminates choppy low-volume fakeouts and wick-exhaustion traps.
      const curVolMA = volMA[i] || 0;
      const sweptLow = (cur.low < sL || prev.low < sL) && (cur.close >= sL);
      const sweptHigh = (cur.high > sH || prev.high > sH) && (cur.close <= sH);

      if (canSignalAgain) {
        if (isFlipBull) {
          let score = 50; // Base directional flip trigger
          if (isBullCandle) score += 15; // Solid green close confirms buyer control
          if (lowerWickRatio >= 0.15) score += 10; // Absorption wick: dip bought
          if (upperWickRatio >= 0.48 && !isBullCandle) score -= 25; // Rejection fakeout trap penalty
          if (cur.volume >= (curVolMA * 0.60) || cur.volume >= prev.volume) score += 10; // Volume participation
          if (cur.close <= sMid) score += 10; // Entry in Discount / lower half of range
          if (sweptLow) score += 15; // Institutional liquidity sweep of recent lows
          if (cur.close >= premLow && cur.volume < curVolMA) score -= 15; // Buying resistance ceiling with low volume

          if (score >= minScoreThreshold) {
            canBuy = true;
          }
        } else if (isFlipBear) {
          let score = 50; // Base directional flip trigger
          if (isBearCandle) score += 15; // Solid red close confirms seller control
          if (upperWickRatio >= 0.15) score += 10; // Rejection wick: rally sold
          if (lowerWickRatio >= 0.48 && !isBearCandle) score -= 25; // Absorption trap penalty
          if (cur.volume >= (curVolMA * 0.60) || cur.volume >= prev.volume) score += 10; // Volume participation
          if (cur.close >= sMid) score += 10; // Entry in Premium / upper half of range
          if (sweptHigh) score += 15; // Institutional liquidity sweep of recent highs
          if (cur.close <= discHigh && cur.volume < curVolMA) score -= 15; // Shorting support floor with low volume

          if (score >= minScoreThreshold) {
            canSell = true;
          }
        }
      }

      let tag = null;
      if (canBuy && activeTrade !== 'BUY') {
        tag = 'BUY';
        activeTrade = 'BUY';
        entryPrice = cur.close;
        lastSignalIndex = i;
      } else if (canSell && activeTrade !== 'SELL') {
        tag = 'SELL';
        activeTrade = 'SELL';
        entryPrice = cur.close;
        lastSignalIndex = i;
      }

      tags.push(tag);
    }

    // Update continuous background pattern intelligence profile in memory
    try {
      this.patternMemory = this.patternMemory || {};
      const confirmedTrades = tags.filter(t => t === 'BUY' || t === 'SELL').length;
      this.patternMemory[cleanSymbol] = {
        lastAnalyzedTime: candles[candles.length - 1]?.time || 0,
        confirmedTrades,
        minScoreThreshold,
        currentRegime: (trendTrader.trend[trendTrader.trend.length - 1] === 1) ? 'BULLISH_EXPANSION' : 'BEARISH_CONTRACTION'
      };
    } catch (e) { }

    return { candles, psar, fractals, macd, trendTrader, ema7, ema14, ema20, ema50, marketStructure, tags };
  },

  /**
   * Initializes or updates the complete TradingView Lightweight Chart & MACD sub-chart
   */
  renderLightweightChart: function (mainContainer, macdContainer, analysis) {
    if (!window.LightweightCharts || !mainContainer || !macdContainer || !analysis) return;

    const { candles, psar, macd, tags } = analysis;
    if (!candles || candles.length < 2) return;

    // Calculate start of day (12:00:00 AM UTC) to strictly isolate today's signals
    const nowDayObj = new Date();
    const midnightUtcMs = Date.UTC(nowDayObj.getUTCFullYear(), nowDayObj.getUTCMonth(), nowDayObj.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);
    const endOfDaySec = midnightSec + 86399; // 11:59:59 PM

    // Dispose previous chart instances if they exist
    if (this.seriesMarkers) {
      this.seriesMarkers = null;
    }
    if (this.smcPriceLines && this.candleSeries) {
      for (const line of this.smcPriceLines) {
        try { this.candleSeries.removePriceLine(line); } catch (e) { }
      }
    }
    this.smcPriceLines = [];
    if (this.smcZonesOverlay && this.smcZonesOverlay.parentNode) {
      try { this.smcZonesOverlay.parentNode.removeChild(this.smcZonesOverlay); } catch (e) { }
    }
    this.smcZonesOverlay = null;
    if (this.mainChart) {
      try { this.mainChart.remove(); } catch (e) { }
      this.mainChart = null;
    }
    if (this.macdChart) {
      try { this.macdChart.remove(); } catch (e) { }
      this.macdChart = null;
    }

    mainContainer.innerHTML = '';
    macdContainer.innerHTML = '';

    // ==========================================
    // 1. CREATE MAIN TRADINGVIEW CANDLESTICK CHART
    // ==========================================
    this.mainChart = window.LightweightCharts.createChart(mainContainer, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: '#080a0f' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'Inter, -apple-system, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        autoScale: true,
        scaleMargins: {
          top: 0.12,
          bottom: 0.20,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 9,
        minBarSpacing: 3,
        shiftVisibleRangeOnNewBar: true,
      },
    });

    // Helper helpers for LightweightCharts series creation across v4 and v5
    const addCandleSeries = (chart, options) => {
      if (typeof chart.addCandlestickSeries === 'function') return chart.addCandlestickSeries(options);
      return chart.addSeries(window.LightweightCharts.CandlestickSeries, options);
    };
    const addHistSeries = (chart, options) => {
      if (typeof chart.addHistogramSeries === 'function') return chart.addHistogramSeries(options);
      return chart.addSeries(window.LightweightCharts.HistogramSeries, options);
    };
    const addLineSeries = (chart, options) => {
      if (typeof chart.addLineSeries === 'function') return chart.addLineSeries(options);
      return chart.addSeries(window.LightweightCharts.LineSeries, options);
    };

    // Add Candlestick Series (exact TradingView neon styling)
    this.candleSeries = addCandleSeries(this.mainChart, {
      upColor: '#00ff88',
      downColor: '#ff3366',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3366',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff3366',
    });
    this.candleSeries.setData(candles);

    // Add Volume Series (isolated overlay scale at bottom so it NEVER distorts candlestick price scale)
    this.volumeSeries = addHistSeries(this.mainChart, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume_overlay',
    });
    try {
      this.mainChart.priceScale('volume_overlay').applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
        visible: false,
      });
    } catch (e) {
      try {
        this.volumeSeries.priceScale().applyOptions({
          scaleMargins: {
            top: 0.82,
            bottom: 0,
          },
          visible: false,
        });
      } catch (e2) { }
    }

    const volumeData = candles.map(c => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? 'rgba(0, 255, 136, 0.22)' : 'rgba(255, 51, 102, 0.22)'
    }));
    this.volumeSeries.setData(volumeData);

    // Add Trend Trader Remastered (aybarsm) Adaptive Trailing Line
    const dottedStyle = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Dotted : 1;
    this.psarSeries = addLineSeries(this.mainChart, {
      color: '#38bdf8',
      lineWidth: 1.5,
      lineStyle: dottedStyle,
      lastValueVisible: false,
      priceLineVisible: false,
      title: 'Trend Trader Stop',
    });
    const ttLineData = [];
    if (analysis.trendTrader && analysis.trendTrader.stop) {
      for (let i = 0; i < candles.length; i++) {
        if (analysis.trendTrader.stop[i]) {
          ttLineData.push({ time: candles[i].time, value: analysis.trendTrader.stop[i] });
        }
      }
    } else {
      for (let i = 0; i < candles.length; i++) {
        if (psar[i] && psar[i].sar) {
          ttLineData.push({ time: candles[i].time, value: psar[i].sar });
        }
      }
    }
    this.psarSeries.setData(ttLineData);

    // Calculate Institutional Smart Money Concepts (SMC) Zones (Premium, Equilibrium, Discount)
    const evalBars = candles.slice(-100);
    let sHigh = -Infinity;
    let sLow = Infinity;
    for (const c of evalBars) {
      if (c.high > sHigh) sHigh = c.high;
      if (c.low < sLow) sLow = c.low;
    }
    if (sHigh === -Infinity || sLow === Infinity || sHigh <= sLow) {
      sHigh = candles[candles.length - 1].close * 1.02;
      sLow = candles[candles.length - 1].close * 0.98;
    }
    const sRange = sHigh - sLow;
    const sMid = sLow + (sRange * 0.5);
    const premLow = sHigh - (sRange * 0.15); // Top 15% is Premium zone
    const discHigh = sLow + (sRange * 0.15); // Bottom 15% is Discount zone

    this.currentSwingHigh = sHigh;
    this.currentPremiumLow = premLow;
    this.currentMidpoint = sMid;
    this.currentDiscountHigh = discHigh;
    this.currentSwingLow = sLow;

    // Create Price Lines on right price scale
    const lineStyleSolid = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Solid : 0;
    const lineStyleDashed = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Dashed : 2;

    this.smcPriceLines = [];
    try {
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: sHigh,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: lineStyleSolid,
        axisLabelVisible: true,
        title: 'Premium (Strong)',
      }));
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: sMid,
        color: '#94a3b8',
        lineWidth: 1,
        lineStyle: lineStyleDashed,
        axisLabelVisible: true,
        title: 'Equilibrium (0.50)',
      }));
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: sLow,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: lineStyleSolid,
        axisLabelVisible: true,
        title: 'Discount (Weak)',
      }));
    } catch (e) {
      console.warn('Error creating SMC price lines:', e);
    }

    // Create Shaded HTML/CSS Overlay inside mainContainer
    mainContainer.style.position = 'relative';
    this.smcZonesOverlay = document.createElement('div');
    this.smcZonesOverlay.className = 'absolute inset-0 pointer-events-none overflow-hidden select-none z-10';
    mainContainer.appendChild(this.smcZonesOverlay);

    // Apply saved SMC visibility preference (default: ON)
    const savedSmcPref = localStorage.getItem('alphachart_show_smc_levels');
    this.showSMCLevels = (savedSmcPref !== 'false');
    this.updateSMCSeriesVisibility();
    this.setupSMCToggle();

    setTimeout(() => {
      this.updateSMCZonesOverlay();
    }, 60);

    // Add Real-time Signals (BUY/SELL on signal close) and Progressive TP & SL Markers
    this.renderSignalMarkers(analysis);

    // ==========================================
    // 2. CREATE SYNCHRONIZED MACD SUB-CHART
    // ==========================================
    this.macdChart = window.LightweightCharts.createChart(macdContainer, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: '#05070a' },
        textColor: '#94a3b8',
        fontSize: 10,
        fontFamily: 'Inter, -apple-system, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode ? window.LightweightCharts.CrosshairMode.Normal : 0,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        autoScale: true,
        scaleMargins: {
          top: 0.15,
          bottom: 0.15,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 9,
        minBarSpacing: 3,
        shiftVisibleRangeOnNewBar: true,
      },
    });

    // MACD Histogram Bars
    this.histSeries = addHistSeries(this.macdChart, {
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    const histData = candles.map((c, i) => {
      const val = macd.histogram[i] || 0;
      return {
        time: c.time,
        value: val,
        color: val >= 0 ? 'rgba(0, 255, 136, 0.75)' : 'rgba(255, 51, 102, 0.75)'
      };
    });
    this.histSeries.setData(histData);

    // MACD Line (Cyan)
    this.macdLineSeries = addLineSeries(this.macdChart, {
      color: '#38bdf8',
      lineWidth: 1.5,
      lastValueVisible: false,
    });
    const macdLineData = candles.map((c, i) => ({
      time: c.time,
      value: macd.macdLine[i] || 0
    }));
    this.macdLineSeries.setData(macdLineData);

    // Signal Line (Amber)
    this.signalLineSeries = addLineSeries(this.macdChart, {
      color: '#fbbf24',
      lineWidth: 1.5,
      lastValueVisible: false,
    });
    const signalLineData = candles.map((c, i) => ({
      time: c.time,
      value: macd.signalLine[i] || 0
    }));
    this.signalLineSeries.setData(signalLineData);

    // ==========================================
    // 3. SYNCHRONIZE SCROLLING & ZOOMING BETWEEN PANES
    // ==========================================
    let isSyncing = false;
    this.mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (isSyncing || !range) return;
      isSyncing = true;
      try { this.macdChart.timeScale().setVisibleLogicalRange(range); } catch (e) { }
      this.updateSMCZonesOverlay();
      isSyncing = false;
    });

    this.macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (isSyncing || !range) return;
      isSyncing = true;
      try { this.mainChart.timeScale().setVisibleLogicalRange(range); } catch (e) { }
      isSyncing = false;
    });

    // Display active trading session centered on recent candles with clean future whitespace (TradingView style)
    setTimeout(() => {
      try {
        const totalBars = candles.length;
        const barsToShow = Math.min(totalBars, 65);
        const logicalRange = {
          from: totalBars - barsToShow,
          to: totalBars + 12 // Exactly 12 bars into future reading the next hour!
        };
        if (this.mainChart && this.mainChart.timeScale) {
          this.mainChart.timeScale().setVisibleLogicalRange(logicalRange);
        }
        if (this.macdChart && this.macdChart.timeScale) {
          this.macdChart.timeScale().setVisibleLogicalRange(logicalRange);
        }
        this.updateSMCZonesOverlay();
      } catch (e) {
        if (this.mainChart) this.mainChart.timeScale().scrollToRealTime();
        if (this.macdChart) this.macdChart.timeScale().scrollToRealTime();
        this.updateSMCZonesOverlay();
      }
    }, 60);

    // Render Compact Daily Signal Performance Table (ONLY 1:2 Ratio)
    this.renderDailyPerformanceTable(analysis);
    this.seedHistoricalEvents(analysis);

    // Start live WebSocket streaming for instantaneous candle updates & closed candle alerts
    this.currentPair = (analysis && analysis.pair) || this.currentPair;
    this.currentTimeframe = (analysis && analysis.timeframe) || this.currentTimeframe || '5m';
    this.lastCandles = (analysis && analysis.candles) ? [...analysis.candles] : this.lastCandles;
    this.lastAnalysis = analysis;
    this.updateStatusHeader(analysis);
    this.startLiveStream(this.currentPair, this.currentTimeframe);
  },

  /**
   * Add Real-time Signals (BUY/SELL on signal close) and Progressive TP & SL Markers
   */
  renderSignalMarkers: function (analysis) {
    if (!analysis || !this.candleSeries) return;
    const { candles, tags, psar } = analysis;
    if (!candles || candles.length < 2) return;

    const nowDayObj = new Date();
    const midnightUtcMs = Date.UTC(nowDayObj.getUTCFullYear(), nowDayObj.getUTCMonth(), nowDayObj.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);

    const prePerf = this.calculateDailySignalPerformance(candles, tags, psar);
    const markers = [];

    // 1. Initial Signal Markers (BUY / SELL arrows) across all candles
    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (tag !== 'BUY' && tag !== 'SELL') continue;
      const c = candles[i];

      if (tag === 'BUY') {
        markers.push({
          time: c.time,
          position: 'belowBar',
          color: '#00e479',
          shape: 'arrowUp',
          text: 'BUY',
          size: 2
        });
      } else if (tag === 'SELL') {
        markers.push({
          time: c.time,
          position: 'aboveBar',
          color: '#ff3366',
          shape: 'arrowDown',
          text: 'SELL',
          size: 2
        });
      }
    }

    // 2. Clean Progressive TP Milestones & SL Markers across all candles
    if (prePerf && prePerf.evaluatedSignals) {
      for (const s of prePerf.evaluatedSignals) {
        if (s.tpEvents && s.tpEvents.length > 0) {
          for (const ev of s.tpEvents) {
            if (ev.time === s.time) continue;

            const isTp = ev.level.startsWith('TP');
            markers.push({
              time: ev.time,
              position: ev.isBuy ? (isTp ? 'aboveBar' : 'belowBar') : (isTp ? 'belowBar' : 'aboveBar'),
              color: isTp ? '#a855f7' : '#ff453a', // Purple for TP, red for SL
              shape: isTp ? 'square' : 'circle',
              text: isTp ? (ev.level || 'TP') : 'SL',
              size: 1.2
            });
          }
        }
      }
    }

    markers.sort((a, b) => a.time - b.time);
    if (markers.length > 0) {
      try {
        if (typeof this.candleSeries.setMarkers === 'function') {
          this.candleSeries.setMarkers(markers);
        } else if (window.LightweightCharts && window.LightweightCharts.createSeriesMarkers) {
          if (this.seriesMarkers && typeof this.seriesMarkers.setMarkers === 'function') {
            try { this.seriesMarkers.setMarkers(markers); } catch (e) {
              this.seriesMarkers = window.LightweightCharts.createSeriesMarkers(this.candleSeries, markers);
            }
          } else {
            this.seriesMarkers = window.LightweightCharts.createSeriesMarkers(this.candleSeries, markers);
          }
        }
      } catch (markerErr) {
        console.warn('Marker note:', markerErr);
      }
    }
  },

  updateMarkersAndPerformance: function (analysis) {
    this.renderSignalMarkers(analysis);
    this.renderDailyPerformanceTable(analysis);
  },

  /**
   * Pre-marks all historical candle signals and completed TP/SL events as notified.
   * Guarantees ZERO historical alert spam when the app or chart is opened!
   * Runs strictly ONCE on startup and NEVER silences live real-time candle close events!
   */
  seedHistoricalEvents: function (analysis) {
    if (this._hasSeededHistory) return;
    if (!analysis || !analysis.candles || !window.TrendTraderAlerts) return;
    this._hasSeededHistory = true;

    const cleanSymbol = (this.currentPair || analysis.pair || 'BTCUSDT').replace(/[\s\-_/]/g, '').toUpperCase();
    this._initialLoadTime = this._initialLoadTime || Math.floor(Date.now() / 1000);
    // Cutoff time: only mark signals that closed before this initial session load
    const cutoffTime = this._initialLoadTime - 60;

    // 1. Mark all historical BUY / SELL candle signals as notified
    if (analysis.tags) {
      for (let i = 0; i < analysis.candles.length; i++) {
        const tag = analysis.tags[i];
        if (tag === 'BUY' || tag === 'SELL') {
          const cTime = analysis.candles[i].time;
          if (cTime <= cutoffTime) {
            window.TrendTraderAlerts.markNotified(`${cleanSymbol}_${cTime}_${tag}`);
          }
        }
      }
    }

    // 2. Mark completed historical TP1, TP2, TP3, SL events as notified
    const perf = this.lastPerformance || (this.calculateDailySignalPerformance && this.calculateDailySignalPerformance(analysis.candles, analysis.tags, analysis.psar));
    if (perf && perf.evaluatedSignals) {
      for (const s of perf.evaluatedSignals) {
        if (s.time <= cutoffTime) {
          if (s.tpEvents && s.tpEvents.length > 0) {
            for (const ev of s.tpEvents) {
              if (ev.time <= cutoffTime) {
                window.TrendTraderAlerts.markNotified(`${cleanSymbol}_${s.time}_${ev.level}`);
              }
            }
          }
          // If trade was already completed / closed before app load, ensure all historical milestones are marked
          if (s.outcome === 'win' || s.outcome === 'loss' || s.reason !== 'In Play') {
            window.TrendTraderAlerts.markNotified(`${cleanSymbol}_${s.time}_TP1`);
            window.TrendTraderAlerts.markNotified(`${cleanSymbol}_${s.time}_TP2`);
            window.TrendTraderAlerts.markNotified(`${cleanSymbol}_${s.time}_SL`);
          }
        }
      }
    }
  },

  /**
   * Updates top modal status banner with latest confirmed signal
   */
  updateStatusHeader: function (analysis) {
    if (!analysis || !analysis.candles || !analysis.tags) return;
    let latestTag = null;
    let latestTagIndex = -1;
    for (let i = analysis.tags.length - 1; i >= 0; i--) {
      if (analysis.tags[i] === 'BUY' || analysis.tags[i] === 'SELL') {
        latestTag = analysis.tags[i];
        latestTagIndex = i;
        break;
      }
    }

    const statusBadge = document.getElementById('ttr-signal-status-badge');
    const statusText = document.getElementById('ttr-signal-status-text');
    const macdStatus = document.getElementById('ttr-macd-status-text');

    const lastM = (analysis.macd && analysis.macd.macdLine) ? (analysis.macd.macdLine[analysis.macd.macdLine.length - 1] || 0) : 0;
    const lastS = (analysis.macd && analysis.macd.signalLine) ? (analysis.macd.signalLine[analysis.macd.signalLine.length - 1] || 0) : 0;
    const isBullishMacd = lastM >= lastS;

    const perf = this.lastPerformance;
    const latestEvalTrade = (perf && perf.evaluatedSignals && perf.evaluatedSignals.length > 0)
      ? perf.evaluatedSignals[perf.evaluatedSignals.length - 1]
      : null;

    if (latestTag === 'BUY') {
      if (statusBadge) statusBadge.className = 'px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-primary-container/20 border border-primary-container/50 text-primary-container font-bold text-[10px] sm:text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,255,136,0.3)] max-w-full min-w-0 overflow-hidden';
      if (latestEvalTrade && latestEvalTrade.isWin && latestEvalTrade.tpTier && latestEvalTrade.tpTier.startsWith('TP')) {
        if (statusText) statusText.innerText = `🟣 BUY TP Hit! (${latestEvalTrade.tpTier}) • Profit: +$${latestEvalTrade.pnl.toFixed(2)}`;
      } else {
        const entryP = analysis.candles[latestTagIndex].close;
        const tp1P = entryP * 1.002;
        const slP = entryP * 0.995;
        if (statusText) statusText.innerText = `🟢 BUY Active ($${entryP.toFixed(2)}) • TP1: $${tp1P.toFixed(2)} (+2%) | SL: $${slP.toFixed(2)} (-5%)`;
      }
    } else if (latestTag === 'SELL') {
      if (statusBadge) statusBadge.className = 'px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-error/20 border border-error/50 text-error font-bold text-[10px] sm:text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,51,102,0.3)] max-w-full min-w-0 overflow-hidden';
      if (latestEvalTrade && latestEvalTrade.isWin && latestEvalTrade.tpTier && latestEvalTrade.tpTier.startsWith('TP')) {
        if (statusText) statusText.innerText = `🟣 SELL TP Hit! (${latestEvalTrade.tpTier}) • Profit: +$${latestEvalTrade.pnl.toFixed(2)}`;
      } else {
        const entryP = analysis.candles[latestTagIndex].close;
        const tp1P = entryP * 0.998;
        const slP = entryP * 1.005;
        if (statusText) statusText.innerText = `🔴 SELL Active ($${entryP.toFixed(2)}) • TP1: $${tp1P.toFixed(2)} (+2%) | SL: $${slP.toFixed(2)} (-5%)`;
      }
    } else {
      if (statusBadge) statusBadge.className = 'px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-white/5 border border-white/10 text-on-surface-variant font-bold text-[10px] sm:text-[11px] flex items-center gap-1.5 max-w-full min-w-0 overflow-hidden';
      if (statusText) statusText.innerText = `⚪ Scanning 5m Scalp Candles...`;
    }

    if (macdStatus) {
      macdStatus.innerText = `MACD: ${lastM.toFixed(2)} / ${lastS.toFixed(2)} • ${isBullishMacd ? 'Bullish Expansion' : 'Bearish Pressure'}`;
    }
  },

  /**
   * Start Live Binance WebSocket Kline Streaming (Zero-latency ticks & candle close detection)
   */
  startLiveStream: function (pairName, interval = '5m') {
    this.stopLiveStream();

    let cleanSymbol = 'btcusdt';
    if (pairName) {
      const raw = pairName.toLowerCase().replace(/[\s\-_/]/g, '');
      if (raw.endsWith('usdt') || raw.endsWith('usdc') || raw.endsWith('busd')) {
        cleanSymbol = raw;
      } else if (raw.endsWith('usd')) {
        cleanSymbol = `${raw.replace(/usd$/, '')}usdt`;
      } else {
        cleanSymbol = `${raw}usdt`;
      }
    }

    let binanceInterval = '5m';
    if (interval === '60' || interval === '1h') binanceInterval = '1h';
    else if (interval === '15' || interval === '15m') binanceInterval = '15m';

    this.isLiveStreamActive = true;
    this._liveStreamSymbol = cleanSymbol;
    const wsUrl = `wss://data-stream.binance.vision/ws/${cleanSymbol}@kline_${binanceInterval}`;

    try {
      const ws = new WebSocket(wsUrl);
      this.liveWs = ws;

      ws.onopen = () => {
        if (this.liveWs !== ws) { try { ws.close(); } catch (e) { } return; }
        console.log(`[AlphaChart AI] Live kline stream active: ${cleanSymbol}@${binanceInterval}`);
      };

      ws.onmessage = (event) => {
        if (this.liveWs !== ws) return; // Discard messages from previous or replaced stream
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.e === 'kline' && msg.k) {
            this.handleLiveKline(cleanSymbol, binanceInterval, msg.k);
          }
        } catch (e) { }
      };

      ws.onerror = (err) => {
        if (this.liveWs !== ws) return;
        console.warn('[AlphaChart AI] WebSocket stream note:', err);
      };

      ws.onclose = () => {
        if (this.liveWs !== ws) return;
        if (this.isLiveStreamActive && this._liveStreamSymbol === cleanSymbol) {
          this.liveWsRetryTimer = setTimeout(() => {
            if (this.isLiveStreamActive && this._liveStreamSymbol === cleanSymbol) {
              this.startLiveStream(pairName, interval);
            }
          }, 3500);
        }
      };
    } catch (e) {
      console.warn('Live WebSocket stream init note:', e);
    }
  },

  stopLiveStream: function () {
    this.isLiveStreamActive = false;
    this._liveStreamSymbol = null;
    if (this.liveWsRetryTimer) {
      clearTimeout(this.liveWsRetryTimer);
      this.liveWsRetryTimer = null;
    }
    if (this.liveWs) {
      try { this.liveWs.close(); } catch (e) { }
      this.liveWs = null;
    }
  },

  /**
   * Handle real-time incoming tick & candle close event
   */
  handleLiveKline: function (symbol, interval, k) {
    if (!k) return;

    // Strict Cross-Pair Isolation Gate:
    // Reject any tick that does NOT match the currently active chart pair
    const activeSym = (this.currentPair || 'BTCUSDT').toUpperCase().replace(/[\s\-_/]/g, '');
    const incomingSym = (symbol || '').toUpperCase().replace(/[\s\-_/]/g, '');
    if (incomingSym && activeSym && !incomingSym.includes(activeSym) && !activeSym.includes(incomingSym)) {
      return;
    }

    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v)
    };

    // Extreme Price Anomaly Filter:
    // Protect chart scale against contaminated or cross-pair spikes
    if (this.lastCandles && this.lastCandles.length > 0) {
      const prevClose = this.lastCandles[this.lastCandles.length - 1].close;
      if (prevClose > 0) {
        const ratio = candle.close / prevClose;
        if (ratio > 3.0 || ratio < 0.33) {
          console.warn(`[TrendTraderEngine] Rejected anomalous price tick: $${candle.close} vs expected ~$${prevClose}`);
          return;
        }
      }
    }

    // 1. Smooth real-time candlestick update on chart
    if (this.candleSeries) {
      try {
        this.candleSeries.update(candle);
      } catch (e) { }
    }
    if (this.volumeSeries) {
      try {
        this.volumeSeries.update({
          time: candle.time,
          value: candle.volume || 0,
          color: candle.close >= candle.open ? 'rgba(0, 255, 136, 0.22)' : 'rgba(255, 51, 102, 0.22)'
        });
      } catch (e) { }
    }

    // 2. Real-time Live Price Check for Active Trade TP1, TP2 & SL hits
    if (this.lastPerformance && this.lastPerformance.evaluatedSignals && this.lastPerformance.evaluatedSignals.length > 0) {
      const activeTrade = this.lastPerformance.evaluatedSignals[this.lastPerformance.evaluatedSignals.length - 1];
      const isTradeInPlay = activeTrade && (activeTrade.reason === 'In Play' || activeTrade.outcome === 'active') && !activeTrade.tpEvents?.some(e => e.level === 'SL');

      // Only evaluate live price ticks if trade is currently in play and belongs to the active live session
      if (isTradeInPlay) {
        const isBuy = activeTrade.type === 'BUY';
        const entry = activeTrade.entryPrice;
        const highRoe = isBuy ? ((candle.high - entry) / entry) * 1000 : ((entry - candle.low) / entry) * 1000;
        const lowRoe = isBuy ? ((candle.low - entry) / entry) * 1000 : ((entry - candle.high) / entry) * 1000;

        const cleanSymbol = symbol.replace(/[\s\-_/]/g, '').toUpperCase();
        const tradeTime = activeTrade.time;
        const tp1Key = `${cleanSymbol}_${tradeTime}_TP1`;
        const tp2Key = `${cleanSymbol}_${tradeTime}_TP2`;
        const slKey = `${cleanSymbol}_${tradeTime}_SL`;
        const displayPair = this.currentPair || `${symbol.toUpperCase().replace('USDT', ' / USDT')}`;

        if (!activeTrade.tpEvents) activeTrade.tpEvents = [];

        // TP1 Hit (+2% ROE): Exactly once
        if (highRoe >= 2.0 && !activeTrade.tpEvents.some(e => e.level === 'TP1') && (!window.TrendTraderAlerts || !window.TrendTraderAlerts.hasNotified(tp1Key))) {
          activeTrade.tpEvents.push({ time: candle.time, level: 'TP1', text: 'TP1 (+2%) • +$10.06', isBuy });
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.markNotified(tp1Key);
          const p = {
            dedupeKey: tp1Key,
            type: 'TP1',
            pair: displayPair,
            price: isBuy ? (entry * 1.002) : (entry * 0.998),
            timeframe: this.currentTimeframe || '5m',
            direction: activeTrade.type,
            candleTime: tradeTime,
            pnl: 10.06
          };
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.sendNotification(p);
        }

        // TP2 Hit (+10% ROE): Exactly once
        if (highRoe >= 10.0 && !activeTrade.tpEvents.some(e => e.level === 'TP2') && (!window.TrendTraderAlerts || !window.TrendTraderAlerts.hasNotified(tp2Key))) {
          activeTrade.tpEvents.push({ time: candle.time, level: 'TP2', text: 'TP2 (+10%) • +$30.30', isBuy });
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.markNotified(tp2Key);
          const p = {
            dedupeKey: tp2Key,
            type: 'TP2',
            pair: displayPair,
            price: isBuy ? (entry * 1.010) : (entry * 0.990),
            timeframe: this.currentTimeframe || '5m',
            direction: activeTrade.type,
            candleTime: tradeTime,
            pnl: 30.30
          };
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.sendNotification(p);
        }

        // SL Hit (-5% ROE): Exactly once, and only if TP1 was NOT hit
        if (lowRoe <= -5.0 && !activeTrade.tpEvents.some(e => e.level === 'SL') && !activeTrade.tpEvents.some(e => e.level === 'TP1') && (!window.TrendTraderAlerts || !window.TrendTraderAlerts.hasNotified(slKey))) {
          activeTrade.tpEvents.push({ time: candle.time, level: 'SL', text: 'SL (-5%) • -$5.00', isBuy });
          activeTrade.reason = 'Hit -5.00% SL';
          activeTrade.outcome = 'loss';
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.markNotified(slKey);
          const p = {
            dedupeKey: slKey,
            type: 'SL',
            pair: displayPair,
            price: isBuy ? (entry * 0.995) : (entry * 1.005),
            timeframe: this.currentTimeframe || '5m',
            direction: activeTrade.type,
            candleTime: tradeTime,
            pnl: -5.00
          };
          if (window.TrendTraderAlerts) window.TrendTraderAlerts.sendNotification(p);
        }
      }
    }

    // 3. CANDLE CLOSE EVENT: Triggered immediately when that very first candle closes!
    if (k.x === true) {
      this.onCandleClosed(symbol, interval, candle);
    }
  },

  /**
   * Evaluates newly closed candle immediately and fires instant notification if signal prints!
   */
  onCandleClosed: async function (symbol, interval, candle) {
    if (!candle) return;

    // Strict Cross-Pair Isolation Gate:
    // Reject any closed candle that does NOT match the currently active chart pair
    const activeSym = (this.currentPair || 'BTCUSDT').toUpperCase().replace(/[\s\-_/]/g, '');
    const incomingSym = (symbol || '').toUpperCase().replace(/[\s\-_/]/g, '');
    if (incomingSym && activeSym && !incomingSym.includes(activeSym) && !activeSym.includes(incomingSym)) {
      return;
    }

    // Extreme Price Anomaly Filter:
    // Protect chart scale against contaminated or cross-pair price spikes
    if (this.lastCandles && this.lastCandles.length > 0) {
      const prevClose = this.lastCandles[this.lastCandles.length - 1].close;
      if (prevClose > 0) {
        const ratio = candle.close / prevClose;
        if (ratio > 3.0 || ratio < 0.33) {
          console.warn(`[TrendTraderEngine] Blocked cross-pair closed candle: $${candle.close} vs expected ~$${prevClose}`);
          return;
        }
      }
    }

    // Ensure we have sufficient historical candles for indicator calculations
    if (!this.lastCandles || this.lastCandles.length < 30) {
      try {
        const hist = await this.fetchCandles(this.currentPair || symbol, interval);
        if (hist && hist.length >= 15) {
          this.lastCandles = hist;
        }
      } catch (e) { }
    }

    // Append or replace closed candle in lastCandles
    if (this.lastCandles && this.lastCandles.length > 0) {
      const last = this.lastCandles[this.lastCandles.length - 1];
      if (last.time === candle.time) {
        this.lastCandles[this.lastCandles.length - 1] = candle;
      } else if (candle.time > last.time) {
        this.lastCandles.push(candle);
      }
    } else {
      this.lastCandles = [candle];
    }

    // Re-run full institutional analysis on the closed candle
    const analysis = this.analyzeCandles(this.lastCandles);
    if (!analysis) return;
    this.lastAnalysis = analysis;

    // Update trailing stop line & MACD
    const lastIdx = this.lastCandles.length - 1;
    if (this.psarSeries && analysis.trendTrader && analysis.trendTrader.stop) {
      const stopVal = analysis.trendTrader.stop[lastIdx];
      if (stopVal) {
        try { this.psarSeries.update({ time: candle.time, value: stopVal }); } catch (e) { }
      }
    }
    if (this.histSeries && analysis.macd && analysis.macd.histogram) {
      const hVal = analysis.macd.histogram[lastIdx] || 0;
      try {
        this.histSeries.update({
          time: candle.time,
          value: hVal,
          color: hVal >= 0 ? 'rgba(0, 255, 136, 0.75)' : 'rgba(255, 51, 102, 0.75)'
        });
      } catch (e) { }
    }
    if (this.macdLineSeries && analysis.macd && analysis.macd.macdLine) {
      try { this.macdLineSeries.update({ time: candle.time, value: analysis.macd.macdLine[lastIdx] || 0 }); } catch (e) { }
    }
    if (this.signalLineSeries && analysis.macd && analysis.macd.signalLine) {
      try { this.signalLineSeries.update({ time: candle.time, value: analysis.macd.signalLine[lastIdx] || 0 }); } catch (e) { }
    }

    // Refresh markers, outcomes, and daily record table
    this.updateMarkersAndPerformance(analysis);
    this.updateStatusHeader(analysis);

    // ========================================================
    // 1. INSTANT BUY / SELL NOTIFICATION (On Candle Close):
    // ========================================================
    const signalTag = analysis.tags[lastIdx];
    if (signalTag === 'BUY' || signalTag === 'SELL') {
      const cleanSymbol = symbol.replace(/[\s\-_/]/g, '').toUpperCase();
      const signalKey = `${cleanSymbol}_${candle.time}_${signalTag}`;

      if (!window.TrendTraderAlerts || !window.TrendTraderAlerts.hasNotified(signalKey)) {
        const displayPair = this.currentPair || `${symbol.toUpperCase().replace('USDT', ' / USDT')}`;
        const entryPrice = candle.close;
        const isBuy = (signalTag === 'BUY');
        const tp1 = isBuy ? entryPrice * 1.002 : entryPrice * 0.998;
        const tp2 = isBuy ? entryPrice * 1.010 : entryPrice * 0.990;
        const tp3 = isBuy ? entryPrice * 1.030 : entryPrice * 0.970;
        const sl = isBuy ? entryPrice * 0.995 : entryPrice * 1.005;

        const signalPayload = {
          dedupeKey: signalKey,
          type: signalTag,
          pair: displayPair,
          price: entryPrice,
          timeframe: interval,
          candleTime: candle.time,
          tp1,
          tp2,
          tp3,
          sl,
          notes: `Instant Alert: ${signalTag} confirmed on candle close! Entry: $${entryPrice.toFixed(2)}`
        };

        if (window.TrendTraderAlerts) {
          window.TrendTraderAlerts.sendNotification(signalPayload);
        }
      }
    }

    // ========================================================
    // 2. INSTANT TP1, TP2 & SL NOTIFICATION (On Candle Close):
    // ========================================================
    if (this.lastPerformance && this.lastPerformance.evaluatedSignals) {
      for (const s of this.lastPerformance.evaluatedSignals) {
        if (s.tpEvents && s.tpEvents.length > 0) {
          for (const ev of s.tpEvents) {
            if (ev.time === candle.time) {
              const cleanSymbol = symbol.replace(/[\s\-_/]/g, '').toUpperCase();
              const eventKey = `${cleanSymbol}_${s.time}_${ev.level}`;

              if (!window.TrendTraderAlerts || !window.TrendTraderAlerts.hasNotified(eventKey)) {
                const displayPair = this.currentPair || `${symbol.toUpperCase().replace('USDT', ' / USDT')}`;
                const eventPayload = {
                  dedupeKey: eventKey,
                  type: ev.level, // 'TP1', 'TP2', or 'SL'
                  pair: displayPair,
                  price: candle.close,
                  timeframe: interval,
                  candleTime: s.time,
                  direction: s.type,
                  entryPrice: s.entryPrice,
                  exitPrice: s.exitPrice,
                  pnl: (ev.level === 'TP1' ? 10.06 : (ev.level === 'TP2' ? 30.30 : (ev.level === 'SL' ? -5.00 : s.pnl)))
                };

                if (window.TrendTraderAlerts) {
                  window.TrendTraderAlerts.sendNotification(eventPayload);
                }
              }
            }
          }
        }
      }
    }
  },

  /**
   * Prominent Neon Glassmorphism In-App Alert Banner (Appears at top center with sound & vibration)
   */
  showInstantSignalBanner: function (signal) {
    if (!signal) return;
    const isBuy = signal.type === 'BUY';
    const isSell = signal.type === 'SELL';
    const isTp1 = signal.type === 'TP1';
    const isTp2 = signal.type === 'TP2';
    const isSl = signal.type === 'SL';

    let accentColor = '#00ff88';
    let bgGlow = 'rgba(0, 255, 136, 0.15)';
    let borderColor = 'rgba(0, 255, 136, 0.6)';
    let bannerTitle = '🟢 INSTANT BUY CONFIRMED';
    let bannerIcon = 'arrow_upward';
    let subHeader = 'Candle Closed';

    if (isSell) {
      accentColor = '#ff3366';
      bgGlow = 'rgba(255, 51, 102, 0.15)';
      borderColor = 'rgba(255, 51, 102, 0.6)';
      bannerTitle = '🔴 INSTANT SELL CONFIRMED';
      bannerIcon = 'arrow_downward';
      subHeader = 'Candle Closed';
    } else if (isTp1) {
      accentColor = '#a855f7';
      bgGlow = 'rgba(168, 85, 247, 0.2)';
      borderColor = 'rgba(168, 85, 247, 0.7)';
      bannerTitle = '🎯 TAKE PROFIT 1 HIT (+2%)';
      bannerIcon = 'task_alt';
      subHeader = 'Milestone Secured';
    } else if (isTp2) {
      accentColor = '#c084fc';
      bgGlow = 'rgba(192, 132, 252, 0.25)';
      borderColor = 'rgba(192, 132, 252, 0.8)';
      bannerTitle = '🎯🎯 TAKE PROFIT 2 HIT (+10%)';
      bannerIcon = 'stars';
      subHeader = 'Runner Achieved';
    } else if (isSl) {
      accentColor = '#ff453a';
      bgGlow = 'rgba(255, 69, 58, 0.2)';
      borderColor = 'rgba(255, 69, 58, 0.7)';
      bannerTitle = '🛑 STOP LOSS TRIGGERED (-5%)';
      bannerIcon = 'gpp_bad';
      subHeader = 'Safety Cut';
    }

    let banner = document.getElementById('instant-signal-alert-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'instant-signal-alert-banner';
      document.body.appendChild(banner);
    }

    banner.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] max-w-md w-[92vw] sm:w-[460px] p-3.5 rounded-2xl shadow-2xl backdrop-blur-xl border transition-all duration-300 transform select-none cursor-pointer';
    banner.style.backgroundColor = 'rgba(8, 10, 15, 0.95)';
    banner.style.borderColor = borderColor;
    banner.style.boxShadow = `0 10px 40px -10px ${bgGlow}, 0 0 25px ${bgGlow}`;

    let bottomRowHtml = '';
    if (isTp1 || isTp2 || isSl) {
      const pnlText = isSl
        ? `-$${Math.abs(signal.pnl || 5.00).toFixed(2)} (-5%)`
        : `+$${(signal.pnl || (isTp1 ? 10.06 : 30.30)).toFixed(2)} (${isTp1 ? '+2%' : '+10%'})`;
      const pnlBg = isSl ? 'bg-error/20 text-error border-error/30' : 'bg-primary-container/20 text-primary-container border-primary-container/30';
      bottomRowHtml = `
        <div class="flex items-center gap-2 mt-2 text-[10px] font-mono">
          <span class="px-2 py-0.5 rounded ${pnlBg} font-bold border">
            ${isSl ? 'Loss' : 'Profit'}: ${pnlText}
          </span>
          <span class="px-2 py-0.5 rounded bg-white/10 text-white/80 border border-white/10">
            Price: $${(signal.price || signal.exitPrice || 0).toFixed(2)}
          </span>
        </div>
      `;
    } else {
      bottomRowHtml = `
        <div class="flex items-center gap-2 mt-2 text-[10px] font-mono">
          <span class="px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container border border-primary-container/30">
            TP1: $${signal.tp1 ? signal.tp1.toFixed(2) : (signal.price * (isBuy ? 1.002 : 0.998)).toFixed(2)} (+2%)
          </span>
          <span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
            TP2: $${signal.tp2 ? signal.tp2.toFixed(2) : (signal.price * (isBuy ? 1.010 : 0.990)).toFixed(2)} (+10%)
          </span>
          <span class="px-1.5 py-0.5 rounded bg-error/20 text-error border border-error/30">
            SL: $${signal.sl ? signal.sl.toFixed(2) : (signal.price * (isBuy ? 0.995 : 1.005)).toFixed(2)} (-5%)
          </span>
        </div>
      `;
    }

    banner.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: ${bgGlow}; border: 1px solid ${borderColor};">
          <span class="material-symbols-outlined text-[22px] animate-bounce" style="color: ${accentColor};">
            ${bannerIcon}
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-2 h-2 rounded-full animate-ping shrink-0" style="background: ${accentColor};"></span>
              <span class="text-xs font-black tracking-wider uppercase truncate" style="color: ${accentColor};">
                ${bannerTitle}
              </span>
            </div>
            <span class="text-[10px] text-white/50 font-mono shrink-0">${subHeader}</span>
          </div>
          <div class="text-sm font-bold text-white mt-0.5 truncate">
            ${signal.pair} • <span class="font-mono">$${(signal.price || 0).toFixed(2)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono ml-1 bg-white/10 text-white/80">${signal.timeframe || '5m'}</span>
          </div>
          ${bottomRowHtml}
        </div>
        <button type="button" class="text-white/40 hover:text-white transition-colors p-1" onclick="event.stopPropagation(); this.closest('#instant-signal-alert-banner').remove();">
          <span class="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    `;

    banner.onclick = () => {
      if (window.ScannerModule && typeof window.ScannerModule.openFullChartModal === 'function') {
        window.ScannerModule.openFullChartModal(signal.pair);
      }
      banner.remove();
    };

    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      if (banner && banner.parentNode) {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%, -20px)';
        setTimeout(() => { if (banner && banner.parentNode) banner.remove(); }, 300);
      }
    }, 10000);
  },

  /**
   * Clean Real-time Signal Evaluation on $100 investment mark:
   * - Capital: $100 entered per trade
   * - Signal candle closes to confirm entry price
   * - TP1: +2.0% gain -> Base Win (+$10.06)
   * - TP2: +10.0% gain -> Major Win (+$30.30)
   * - TP3: +30.0%+ gain -> Super Runner (+$82.05+)
   * - SL: -5.0% loss -> Loss (-$5.00) if drops before TP1 or reverses before TP1
   * Strictly tracks ONLY the current day (12:00 AM to 11:59 PM)
   */
  calculateDailySignalPerformance: function (candles, tags, psar) {
    if (!candles || candles.length < 2 || !tags) {
      return { sortedDays: [], totalNet12: 0, totalTrades: 0, winRate: 0, todayDayName: '', evaluatedSignals: [] };
    }

    const now = new Date();
    // Midnight 00:00:00 UTC of today (12:00:00 AM)
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayDayName = dayNames[now.getUTCDay()];
    const todayDateKey = now.toISOString().slice(0, 10);

    const evaluatedSignals = [];

    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (tag !== 'BUY' && tag !== 'SELL') continue;

      const c = candles[i];
      const isBuy = (tag === 'BUY');
      const entryPrice = c.close;

      let isWin = false;
      let isLoss = false;
      let maxRoePct = 0;
      let maxDrawdownPct = 0;
      let exitPrice = entryPrice;
      let reason = 'In Play';
      let tpTier = '';
      const tpEvents = [];
      let hitTp1 = false;
      let hitTp2 = false;
      let hitTp3 = false;
      let hitSL = false;
      let tradeClosed = false;
      let pnl = 0;

      // Scan subsequent candles forward (candle i has closed, trade progresses on candle i+1 onwards)
      const maxK = candles.length - 1;
      const isPastDay = (c.time < midnightSec);
      const signalDayEndSec = Math.floor(c.time / 86400) * 86400 + 86400; // 00:00:00 UTC of next day

      for (let k = i + 1; k <= maxK; k++) {
        const nextC = candles[k];
        const nextTag = tags[k];

        // Past Day Boundary: Close open trade at session close (23:55 UTC) so past days are strictly self-contained
        if (isPastDay && nextC.time >= signalDayEndSec) {
          tradeClosed = true;
          exitPrice = candles[k - 1].close;
          reason = `Session Close at $${exitPrice.toFixed(2)}`;
          break;
        }

        // Calculate % move on this candle (10x Leverage Framework on $100 Margin):
        // 0.20% price move * 10 = +2.0% ROE (TP1 Hit!)
        // 1.00% price move * 10 = +10.0% ROE (TP2 Hit!)
        // 3.00% price move * 10 = +30.0% ROE (TP3 Hit!)
        // -0.50% price move * 10 = -5.0% ROE (-$5.00 SL Hit!)
        let curHighRoe = 0;
        let curCloseRoe = 0;
        let curLowDrawdown = 0;

        if (isBuy) {
          curHighRoe = ((nextC.high - entryPrice) / entryPrice) * 1000;
          curCloseRoe = ((nextC.close - entryPrice) / entryPrice) * 1000;
          curLowDrawdown = ((nextC.low - entryPrice) / entryPrice) * 1000;
        } else {
          curHighRoe = ((entryPrice - nextC.low) / entryPrice) * 1000;
          curCloseRoe = ((entryPrice - nextC.close) / entryPrice) * 1000;
          curLowDrawdown = ((entryPrice - nextC.high) / entryPrice) * 1000;
        }

        // Track peak favorable excursion
        if (curHighRoe > maxRoePct) {
          maxRoePct = curHighRoe;
          exitPrice = isBuy ? nextC.high : nextC.low;
        }

        // Track peak adverse drawdown
        if (curLowDrawdown < maxDrawdownPct) {
          maxDrawdownPct = curLowDrawdown;
        }

        // Progressive TP milestone triggers (10x Leverage: TP1 +2%, TP2 +10%, TP3 +30%):
        // 1. TP1 at +2.0% ROE (0.20% price move at 10x leverage)
        if (curHighRoe >= 2.0 && !hitTp1) {
          hitTp1 = true;
          tpEvents.push({ time: nextC.time, level: 'TP1', text: 'TP1 (+2%) • +$10.06', isBuy });
        }
        // 2. TP2 at +10.0% ROE (1.00% price move at 10x leverage)
        if (curHighRoe >= 10.0 && !hitTp2) {
          hitTp2 = true;
          tpEvents.push({ time: nextC.time, level: 'TP2', text: 'TP2 (+10%) • +$30.30', isBuy });
        }
        // 3. TP3 at +30.0% ROE (3.00% price move at 10x leverage)
        if (curHighRoe >= 30.0 && !hitTp3) {
          hitTp3 = true;
          tpEvents.push({ time: nextC.time, level: 'TP3', text: 'TP3 (+30%) • +$82.05', isBuy });
        }

        // Stop Loss Check:
        // When adverse move reaches -5.0% ROE (-$5.00 loss on $100 margin at 10x)
        if (curLowDrawdown <= -5.0 && !hitTp1 && !hitSL) {
          hitSL = true;
          tradeClosed = true;
          exitPrice = isBuy ? (entryPrice * 0.995) : (entryPrice * 1.005);
          tpEvents.push({ time: nextC.time, level: 'SL', text: 'SL (-5%) • -$5.00', isBuy });
          reason = `Hit -5.00% SL ($${exitPrice.toFixed(2)})`;
          break;
        }

        // Opposite Reversal Signal:
        if ((isBuy && nextTag === 'SELL') || (!isBuy && nextTag === 'BUY')) {
          tradeClosed = true;
          exitPrice = nextC.close;
          const closedReturnRoe = isBuy
            ? ((exitPrice - entryPrice) / entryPrice) * 1000
            : ((entryPrice - exitPrice) / entryPrice) * 1000;

          if (hitTp1) {
            reason = `Reversal closed after TP1 (+${maxRoePct.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
          } else if (closedReturnRoe >= 0) {
            reason = `Reversed in profit (+${closedReturnRoe.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
          } else {
            reason = `Reversed before TP1 (${closedReturnRoe.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
          }
          break;
        }
      }

      // If trade has not closed by reversal or SL, its exit price is the latest candle (Active In Play!)
      if (!tradeClosed) {
        const lastCandle = candles[candles.length - 1];
        exitPrice = lastCandle.close;
      }

      // Calculate real ROE % return from Entry to Exit Price (with 10x leverage on $100)
      const finalReturnRoe = isBuy
        ? ((exitPrice - entryPrice) / entryPrice) * 1000
        : ((entryPrice - exitPrice) / entryPrice) * 1000;

      // DYNAMIC ACCURATE WIN/LOSS & PnL EVALUATION:
      // - TP3 (+30%+ ROE): Super Runner
      // - TP2 (+10%+ ROE): Major Win
      // - TP1 (+2%+ ROE): Base Win (+$10.06 to +$23.75)
      // - If positive return (> 0%): WIN!
      // - If negative return (< 0%): LOSS!
      if (maxRoePct >= 30.0 || finalReturnRoe >= 30.0) {
        isWin = true;
        isLoss = false;
        tpTier = 'TP3 (+30%)';
        const effPct = Math.max(maxRoePct, finalReturnRoe);
        pnl = Math.round((10.0616 + ((effPct - 2.0) * 2.5876)) * 100) / 100;
        reason = `Hit TP3 Super Runner (+${effPct.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
      } else if (maxRoePct >= 10.0 || finalReturnRoe >= 10.0) {
        isWin = true;
        isLoss = false;
        tpTier = 'TP2 (+10%)';
        const effPct = Math.max(maxRoePct, finalReturnRoe);
        pnl = Math.round((10.0616 + ((effPct - 2.0) * 2.5876)) * 100) / 100;
        reason = `Hit TP2 Runner (+${effPct.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
      } else if (hitTp1 || maxRoePct >= 2.0) {
        isWin = true;
        isLoss = false;
        tpTier = 'TP1 (+2%)';
        const effPct = Math.max(maxRoePct, finalReturnRoe);
        if (effPct > 2.5) {
          pnl = Math.round((10.0616 + ((effPct - 2.18) * 2.5876)) * 100) / 100;
        } else {
          pnl = 10.06;
        }
        reason = `Hit TP1 (+${effPct.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
      } else if (finalReturnRoe > 0) {
        isWin = true;
        isLoss = false;
        tpTier = `+${finalReturnRoe.toFixed(1)}%`;
        pnl = Math.max(0.50, Math.round(finalReturnRoe * 100) / 100);
        reason = !tradeClosed
          ? `Active In Profit (+${finalReturnRoe.toFixed(1)}%) • Current $${exitPrice.toFixed(2)}`
          : `Closed in Profit (+${finalReturnRoe.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
      } else {
        isWin = false;
        isLoss = true;
        tpTier = 'SL';
        pnl = Math.max(-5.00, Math.round(finalReturnRoe * 100) / 100);
        reason = hitSL
          ? `Hit -5.00% SL ($${exitPrice.toFixed(2)})`
          : `Loss (${finalReturnRoe.toFixed(1)}%) • Exit $${exitPrice.toFixed(2)}`;
      }

      const outcome = isWin ? 'win' : 'loss';
      const dateObj = new Date(c.time * 1000);
      const signalDateKey = dateObj.toISOString().slice(0, 10);
      const signalDayName = dayNames[dateObj.getUTCDay()];
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const mins = String(dateObj.getMinutes()).padStart(2, '0');
      const timeFormatted = `${hours}:${mins}`;

      evaluatedSignals.push({
        index: i,
        time: c.time,
        timeFormatted,
        dateKey: signalDateKey,
        dayName: signalDayName,
        type: tag,
        entryPrice,
        exitPrice,
        maxRoePct,
        maxDrawdownPct,
        tpTier: tpTier || (isWin ? 'TP1' : 'SL'),
        outcome,
        pnl,
        reason,
        isWin,
        tpEvents
      });
    }

    // Group signals by day
    const daysMap = {};
    for (const s of evaluatedSignals) {
      if (!daysMap[s.dateKey]) {
        daysMap[s.dateKey] = {
          dateKey: s.dateKey,
          dayName: s.dayName,
          isToday: (s.dateKey === todayDateKey),
          buySignals: [],
          sellSignals: []
        };
      }
      if (s.type === 'BUY') daysMap[s.dateKey].buySignals.push(s);
      if (s.type === 'SELL') daysMap[s.dateKey].sellSignals.push(s);
    }

    if (!daysMap[todayDateKey]) {
      daysMap[todayDateKey] = {
        dateKey: todayDateKey,
        dayName: todayDayName,
        isToday: true,
        buySignals: [],
        sellSignals: []
      };
    }

    // Persist and lock completed past days using centralized server records and master v5 cache
    const symKey = (this.currentPair || 'BTCUSDT').replace(/[\s\-_/]/g, '').toUpperCase();
    const tfKey = this.currentTimeframe || '5m';
    const masterDaysStorageKey = `alphachart_master_days_v5_${symKey}_${tfKey}`;

    // Purge outdated v4 local cache that caused device desynchronization
    try {
      localStorage.removeItem(`alphachart_locked_days_v4_${symKey}_${tfKey}`);
    } catch (e) { }

    let masterDays = {};
    try {
      const raw = localStorage.getItem(masterDaysStorageKey);
      if (raw) masterDays = JSON.parse(raw);
    } catch (e) { }

    for (const dateKey of Object.keys(daysMap)) {
      if (dateKey < todayDateKey) {
        const cloudKey = `${symKey}_${tfKey}_${dateKey}`;
        if (this._cloudDailyRecords && this._cloudDailyRecords[cloudKey]) {
          const rec = this._cloudDailyRecords[cloudKey];
          daysMap[dateKey] = {
            dateKey: rec.dateKey,
            dayName: rec.dayName,
            isToday: false,
            buySignals: rec.buySignals || [],
            sellSignals: rec.sellSignals || []
          };
          masterDays[dateKey] = daysMap[dateKey];
        } else if (masterDays[dateKey]) {
          daysMap[dateKey] = masterDays[dateKey];
        } else {
          masterDays[dateKey] = daysMap[dateKey];
        }
      }
    }

    try {
      localStorage.setItem(masterDaysStorageKey, JSON.stringify(masterDays));
    } catch (e) { }

    const allSortedDays = Object.values(daysMap).sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    // Strictly show the active relevant trading days: Today (Live) and Yesterday (Completed)
    const sortedDays = allSortedDays.slice(0, 2);

    // Build the finalized list of evaluated signals matching the displayed days
    const displayedSignals = [];
    for (const day of sortedDays) {
      if (day.buySignals) displayedSignals.push(...day.buySignals);
      if (day.sellSignals) displayedSignals.push(...day.sellSignals);
    }
    displayedSignals.sort((a, b) => a.time - b.time);

    let totalNet12 = 0;
    let totalWins12 = 0;
    let totalTrades = 0;

    for (const s of displayedSignals) {
      totalTrades++;
      totalNet12 += s.pnl;
      if (s.outcome === 'win') totalWins12++;
    }
    totalNet12 = Math.round(totalNet12 * 100) / 100;

    const winRate = totalTrades > 0 ? Math.round((totalWins12 / totalTrades) * 100) : 0;

    // Clear legacy multi-day storage so only current day is tracked
    try {
      localStorage.removeItem('alphachart_daily_signal_perf_1_2_v2');
      localStorage.removeItem('alphachart_daily_signal_history_v2');
      localStorage.removeItem('alphachart_daily_signals_history_v2');
    } catch (e) { }

    return { sortedDays, totalNet12, totalTrades, winRate, todayDayName, evaluatedSignals: displayedSignals };
  },

  _cloudDailyRecords: {},
  _lastDailySyncTime: {},

  /**
   * Synchronizes master locked past day records from the centralized backend server
   * Guarantees 100% uniformity across all devices and refreshes
   */
  syncDailyServerRecords: async function (pair, timeframe) {
    const sym = (pair || this.currentPair || 'BTCUSDT').replace(/[\s\-_/]/g, '').toUpperCase();
    const tf = timeframe || this.currentTimeframe || '5m';
    const syncKey = `${sym}_${tf}`;
    const now = Date.now();
    if (this._lastDailySyncTime[syncKey] && (now - this._lastDailySyncTime[syncKey] < 60000)) {
      return;
    }
    this._lastDailySyncTime[syncKey] = now;

    try {
      const res = await fetch(`/api/signals/daily?pair=${sym}&timeframe=${tf}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.records) {
          if (!this._cloudDailyRecords) this._cloudDailyRecords = {};
          let updated = false;
          for (const k of Object.keys(data.records)) {
            const compositeKey = `${sym}_${tf}_${k}`;
            if (!this._cloudDailyRecords[compositeKey]) {
              this._cloudDailyRecords[compositeKey] = data.records[k];
              updated = true;
            }
          }
          if (updated && this.lastAnalysis) {
            this.renderDailyPerformanceTable(this.lastAnalysis);
          }
        }
      }
    } catch (e) {
      console.warn('Daily records server sync note:', e);
    }
  },

  /**
   * Renders the compact daily performance table inside the chart overlay (ONLY 1:2 Ratio)
   */
  renderDailyPerformanceTable: function (analysis) {
    if (!analysis || !analysis.candles) return;
    this.lastAnalysis = analysis;
    this.syncDailyServerRecords(this.currentPair, this.currentTimeframe);

    const tbody = document.getElementById('ttr-compact-table-tbody');
    const netPnlEl = document.getElementById('ttr-compact-net-pnl');
    const winRateEl = document.getElementById('ttr-compact-win-rate');
    const totalTradesEl = document.getElementById('ttr-compact-total-trades');
    const pillPnlEl = document.getElementById('ttr-compact-pill-pnl');
    const pillRateEl = document.getElementById('ttr-compact-pill-rate');
    const todayTagEl = document.getElementById('ttr-compact-today-tag');

    const perf = this.calculateDailySignalPerformance(analysis.candles, analysis.tags, analysis.psar);
    this.lastPerformance = perf;
    try {
      localStorage.setItem('alphachart_trend_trader_cached_perf_v1', JSON.stringify({
        pair: this.currentPair,
        timestamp: Date.now(),
        perf: perf
      }));
    } catch (e) {}

    if (window.MonthlyResultModule) {
      if (typeof window.MonthlyResultModule.updatePreviewPill === 'function') {
        window.MonthlyResultModule.updatePreviewPill();
      }
      if (typeof window.MonthlyResultModule.render === 'function') {
        window.MonthlyResultModule.render();
      }
    }

    if (todayTagEl) {
      todayTagEl.innerText = `${perf.todayDayName || ''} (Today)`;
    }

    // Format Net PnL (ONLY 1:2 ratio based on $100 mark)
    const pnlSign = perf.totalNet12 >= 0 ? '+' : '-';
    const pnlAbs = Math.abs(perf.totalNet12).toFixed(2);
    const pnlFormatted = `${pnlSign}$${pnlAbs}`;
    const pnlColor = perf.totalNet12 >= 0 ? 'text-primary-container' : 'text-[#ff3366]';

    if (netPnlEl) {
      netPnlEl.innerText = pnlFormatted;
      netPnlEl.className = `font-bold ${pnlColor}`;
    }
    if (winRateEl) {
      winRateEl.innerText = `${perf.winRate}% Win`;
      winRateEl.className = `font-semibold ${perf.winRate >= 50 ? 'text-primary-container' : 'text-white'}`;
    }
    if (totalTradesEl) {
      totalTradesEl.innerText = `${perf.totalTrades} Trade${perf.totalTrades === 1 ? '' : 's'}`;
    }

    if (pillPnlEl) {
      pillPnlEl.innerText = pnlFormatted;
      pillPnlEl.className = `font-mono font-bold ${pnlColor}`;
    }
    if (pillRateEl) {
      pillRateEl.innerText = `(${perf.winRate}% W)`;
    }

    if (tbody) {
      let html = '';

      for (const day of perf.sortedDays) {
        const hasBuy = day.buySignals && day.buySignals.length > 0;
        const hasSell = day.sellSignals && day.sellSignals.length > 0;

        if (!hasBuy && !hasSell) {
          html += `
            <tr class="border-b border-white/[0.04] bg-white/[0.01]">
              <td class="py-1.5 px-2 text-left">
                <div class="flex items-center gap-1.5">
                  ${day.isToday ? '<span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>' : ''}
                  <span class="font-bold ${day.isToday ? 'text-primary-container' : 'text-white/80'}">${day.dayName}</span>
                  ${day.isToday ? '<span class="text-[8px] text-primary-container/80 uppercase">Today</span>' : ''}
                </div>
              </td>
              <td colspan="2" class="py-1.5 px-2 text-center text-on-surface-variant text-[9px] italic">
                Awaiting signals...
              </td>
            </tr>
          `;
          continue;
        }

        // BUY row
        if (hasBuy) {
          const buyCount = day.buySignals.length;
          const buyWins = day.buySignals.filter(s => s.outcome === 'win').length;
          const buyLosses = day.buySignals.filter(s => s.outcome === 'loss').length;
          const buyPnl = Math.round(day.buySignals.reduce((acc, s) => acc + s.pnl, 0) * 100) / 100;

          const recordText = `${buyWins}W - ${buyLosses}L`;
          const pnlText = buyPnl >= 0 ? `+$${buyPnl.toFixed(2)}` : `-$${Math.abs(buyPnl).toFixed(2)}`;
          const pnlClass = buyPnl >= 0 ? 'text-primary-container font-bold' : 'text-[#ff3366] font-semibold';

          const dayLabel = `
            <div class="flex items-center gap-1">
              ${day.isToday ? '<span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse shrink-0"></span>' : ''}
              <span class="font-bold ${day.isToday ? 'text-primary-container' : 'text-white'}">${day.dayName}:</span>
              <span class="px-1 py-0.2 rounded text-[8px] font-bold bg-[#00e479]/20 text-[#00e479] border border-[#00e479]/30">BUY</span>
              ${buyCount > 1 ? `<span class="text-[8px] text-white/50">(${buyCount})</span>` : ''}
            </div>
          `;

          html += `
            <tr class="border-b border-white/[0.04] ${day.isToday ? 'bg-primary-container/[0.04]' : 'bg-white/[0.01]'}">
              <td class="py-1.5 px-2 text-left">${dayLabel}</td>
              <td class="py-1.5 px-1.5 text-center font-semibold text-white/90">${recordText}</td>
              <td class="py-1.5 px-2 text-right ${pnlClass}">${pnlText}</td>
            </tr>
          `;
        }

        // SELL row
        if (hasSell) {
          const sellCount = day.sellSignals.length;
          const sellWins = day.sellSignals.filter(s => s.outcome === 'win').length;
          const sellLosses = day.sellSignals.filter(s => s.outcome === 'loss').length;
          const sellPnl = Math.round(day.sellSignals.reduce((acc, s) => acc + s.pnl, 0) * 100) / 100;

          const recordText = `${sellWins}W - ${sellLosses}L`;
          const pnlText = sellPnl >= 0 ? `+$${sellPnl.toFixed(2)}` : `-$${Math.abs(sellPnl).toFixed(2)}`;
          const pnlClass = sellPnl >= 0 ? 'text-primary-container font-bold' : 'text-[#ff3366] font-semibold';

          const dayLabel = `
            <div class="flex items-center gap-1">
              ${day.isToday && !hasBuy ? '<span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse shrink-0"></span>' : ''}
              <span class="font-bold ${day.isToday ? 'text-primary-container' : 'text-white'}">${day.dayName}:</span>
              <span class="px-1 py-0.2 rounded text-[8px] font-bold bg-[#ff3366]/20 text-[#ff3366] border border-[#ff3366]/30">SELL</span>
              ${sellCount > 1 ? `<span class="text-[8px] text-white/50">(${sellCount})</span>` : ''}
            </div>
          `;

          html += `
            <tr class="border-b border-white/[0.04] ${day.isToday ? 'bg-primary-container/[0.04]' : 'bg-white/[0.01]'}">
              <td class="py-1.5 px-2 text-left">${dayLabel}</td>
              <td class="py-1.5 px-1.5 text-center font-semibold text-white/90">${recordText}</td>
              <td class="py-1.5 px-2 text-right ${pnlClass}">${pnlText}</td>
            </tr>
          `;
        }
      }

      tbody.innerHTML = html;
    }

    // Update count badge on Signals Log tab
    const countBadgeEl = document.getElementById('ttr-signals-count-badge');
    if (countBadgeEl) {
      countBadgeEl.innerText = (perf.evaluatedSignals ? perf.evaluatedSignals.length : 0);
    }

    // Render VIEW B: Individual Signals Log (Detailed Chronological Trades)
    const signalsLogEl = document.getElementById('ttr-view-signals-log');
    if (signalsLogEl) {
      if (!perf.evaluatedSignals || perf.evaluatedSignals.length === 0) {
        signalsLogEl.innerHTML = `
          <div class="py-6 px-3 text-center text-on-surface-variant text-[10px] italic">
            Awaiting today's signals...
          </div>
        `;
      } else {
        // Show newest signals at top for instant visibility
        const reversed = [...perf.evaluatedSignals].reverse();
        let logHtml = '';
        for (const s of reversed) {
          const isBuy = s.type === 'BUY';
          const isWin = s.outcome === 'win';

          const typeBadge = isBuy
            ? `<span class="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00e479]/20 text-[#00e479] border border-[#00e479]/30">BUY</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#ff3366]/20 text-[#ff3366] border border-[#ff3366]/30">SELL</span>`;

          const pnlFormatted = s.pnl >= 0 ? `+$${s.pnl.toFixed(2)}` : `-$${Math.abs(s.pnl).toFixed(2)}`;
          const outcomeBadge = isWin
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-container/20 text-primary-container border border-primary-container/30">${pnlFormatted} WIN (${s.tpTier})</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-error-container/20 text-[#ff453a] border border-[#ff453a]/30">${pnlFormatted} LOSS (${s.tpTier})</span>`;

          const subText = s.reason || (isWin ? `${s.tpTier} • Exit $${s.exitPrice.toFixed(2)}` : `Exit $${s.exitPrice.toFixed(2)}`);

          logHtml += `
            <div class="px-2.5 py-2 hover:bg-white/[0.04] cursor-pointer transition-colors group"
                 onclick="window.TrendTraderEngine.jumpToCandle(${s.time})"
                 title="Click to focus this trade on the chart">
              <div class="flex items-center justify-between gap-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-white/60 text-[9px] font-mono">${s.timeFormatted}</span>
                  ${typeBadge}
                  <span class="text-white/90 text-[10px] font-medium">$${s.entryPrice.toFixed(2)}</span>
                </div>
                ${outcomeBadge}
              </div>
              <div class="mt-1 flex items-center justify-between text-[8px] text-on-surface-variant/80 gap-1.5">
                <span class="truncate max-w-[145px]" title="${subText}">
                  ${subText}
                </span>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button type="button"
                          onclick="window.TrendTraderEngine.logTradeToJournal(${s.time}, event)"
                          id="btn-journal-${s.time}"
                          class="px-1.5 py-0.5 rounded text-[8px] font-bold bg-white/[0.06] hover:bg-primary-container/20 text-white/80 hover:text-primary-container border border-white/[0.1] hover:border-primary-container/30 transition-all flex items-center gap-0.5"
                          title="1-Click Save this trade to Trading Journal">
                    <span class="material-symbols-outlined text-[10px]">bookmark_add</span>
                    <span>+ Journal</span>
                  </button>
                  <span class="text-primary-container/70 group-hover:text-primary-container flex items-center gap-0.5 transition-colors font-medium">
                    Focus ↗
                  </span>
                </div>
              </div>
            </div>
          `;
        }
        signalsLogEl.innerHTML = logHtml;
      }
    }

    this.setupViewTabs();
    this.applyActiveViewTab();
    this.setupTableToggle();
    this.updateTableCollapseUI();
  },

  activeViewTab: 'summary',
  _viewTabsInitialized: false,

  setupViewTabs: function () {
    if (this._viewTabsInitialized) return;
    this._viewTabsInitialized = true;

    const summaryBtn = document.getElementById('ttr-tab-summary-btn');
    const logBtn = document.getElementById('ttr-tab-log-btn');

    if (summaryBtn) {
      summaryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeViewTab = 'summary';
        this.applyActiveViewTab();
      });
    }

    if (logBtn) {
      logBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeViewTab = 'log';
        this.applyActiveViewTab();
      });
    }
  },

  applyActiveViewTab: function () {
    const summaryBtn = document.getElementById('ttr-tab-summary-btn');
    const logBtn = document.getElementById('ttr-tab-log-btn');
    const summaryView = document.getElementById('ttr-view-summary');
    const logView = document.getElementById('ttr-view-signals-log');

    if (!summaryView || !logView) return;

    if (this.activeViewTab === 'log') {
      summaryView.classList.add('hidden');
      logView.classList.remove('hidden');
      if (logBtn) logBtn.className = 'px-2 py-0.5 rounded text-[9px] font-bold bg-primary-container text-black transition-all';
      if (summaryBtn) summaryBtn.className = 'px-2 py-0.5 rounded text-[9px] font-bold text-on-surface-variant hover:text-white transition-all';
    } else {
      summaryView.classList.remove('hidden');
      logView.classList.add('hidden');
      if (summaryBtn) summaryBtn.className = 'px-2 py-0.5 rounded text-[9px] font-bold bg-primary-container text-black transition-all';
      if (logBtn) logBtn.className = 'px-2 py-0.5 rounded text-[9px] font-bold text-on-surface-variant hover:text-white transition-all';
    }
  },

  jumpToCandle: function (timeSec) {
    if (!this.mainChart || !this.mainChart.timeScale) return;
    try {
      const from = Math.max(0, timeSec - (15 * 300));
      const to = timeSec + (25 * 300);
      this.mainChart.timeScale().setVisibleRange({ from, to });
      if (this.macdChart && this.macdChart.timeScale) {
        this.macdChart.timeScale().setVisibleRange({ from, to });
      }
    } catch (e) {
      console.warn('Error focusing candle:', e);
    }
  },

  tableCollapsed: false,
  _tableToggleInitialized: false,

  setupTableToggle: function () {
    if (this._tableToggleInitialized) return;
    this._tableToggleInitialized = true;

    const saved = localStorage.getItem('alphachart_ttr_table_collapsed');
    if (saved !== null) {
      this.tableCollapsed = (saved === 'true');
    }

    const toggleBtn = document.getElementById('ttr-compact-table-toggle-btn');
    const collapsedEl = document.getElementById('ttr-compact-table-collapsed');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tableCollapsed = true;
        localStorage.setItem('alphachart_ttr_table_collapsed', 'true');
        this.updateTableCollapseUI();
      });
    }

    if (collapsedEl) {
      collapsedEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tableCollapsed = false;
        localStorage.setItem('alphachart_ttr_table_collapsed', 'false');
        this.updateTableCollapseUI();
      });
    }
  },

  updateTableCollapseUI: function () {
    const collapsedEl = document.getElementById('ttr-compact-table-collapsed');
    const expandedEl = document.getElementById('ttr-compact-table-expanded');
    if (!collapsedEl || !expandedEl) return;

    if (this.tableCollapsed) {
      expandedEl.classList.add('hidden');
      collapsedEl.classList.remove('hidden');
    } else {
      collapsedEl.classList.add('hidden');
      expandedEl.classList.remove('hidden');
    }
  },

  setupSMCToggle: function () {
    const btn = document.getElementById('btn-toggle-smc-levels');
    if (btn && !btn._smcBound) {
      btn._smcBound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSMCLevels();
      });
    }
    this.updateSMCToggleUI();
  },

  toggleSMCLevels: function () {
    this.showSMCLevels = !this.showSMCLevels;
    try {
      localStorage.setItem('alphachart_show_smc_levels', this.showSMCLevels ? 'true' : 'false');
    } catch (e) { }
    this.updateSMCSeriesVisibility();
    this.updateSMCToggleUI();
    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`SMC Zones (Premium / Discount): ${this.showSMCLevels ? 'Visible' : 'Hidden'}`);
    }
  },

  updateSMCSeriesVisibility: function () {
    if (this.showSMCLevels) {
      if (this.smcZonesOverlay) {
        this.smcZonesOverlay.style.display = 'block';
        this.updateSMCZonesOverlay();
      }
      this.createSMCPriceLines();
    } else {
      if (this.smcZonesOverlay) {
        this.smcZonesOverlay.style.display = 'none';
        this.smcZonesOverlay.innerHTML = '';
      }
      this.removeSMCPriceLines();
    }
  },

  createSMCPriceLines: function () {
    if (!this.candleSeries || !this.currentSwingHigh || !this.showSMCLevels) return;
    const lineStyleSolid = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Solid : 0;
    const lineStyleDashed = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Dashed : 2;

    this.removeSMCPriceLines();

    try {
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: this.currentSwingHigh,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: lineStyleSolid,
        axisLabelVisible: true,
        title: 'Premium (Strong)',
      }));
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: this.currentMidpoint,
        color: '#94a3b8',
        lineWidth: 1,
        lineStyle: lineStyleDashed,
        axisLabelVisible: true,
        title: 'Equilibrium (0.50)',
      }));
      this.smcPriceLines.push(this.candleSeries.createPriceLine({
        price: this.currentSwingLow,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: lineStyleSolid,
        axisLabelVisible: true,
        title: 'Discount (Weak)',
      }));
    } catch (e) {
      console.warn('Error creating SMC price lines:', e);
    }
  },

  removeSMCPriceLines: function () {
    if (this.smcPriceLines && this.candleSeries) {
      for (const line of this.smcPriceLines) {
        try { this.candleSeries.removePriceLine(line); } catch (e) { }
      }
    }
    this.smcPriceLines = [];
  },

  updateSMCToggleUI: function () {
    const btn = document.getElementById('btn-toggle-smc-levels');
    const label = document.getElementById('btn-toggle-smc-levels-text');
    if (!btn || !label) return;

    label.innerText = 'SMC Zones';
    if (this.showSMCLevels) {
      btn.className = 'px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all flex items-center gap-1 bg-primary-container/10 border-primary-container/40 text-primary-container hover:bg-primary-container/20 whitespace-nowrap shrink-0 cursor-pointer';
    } else {
      btn.className = 'px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all flex items-center gap-1 bg-[#000000] border-white/[0.08] text-on-surface-variant hover:border-white/20 hover:text-white whitespace-nowrap shrink-0 cursor-pointer';
    }
  },

  updateSMCZonesOverlay: function () {
    if (!this.smcZonesOverlay || !this.candleSeries || !this.showSMCLevels) {
      if (this.smcZonesOverlay) this.smcZonesOverlay.innerHTML = '';
      return;
    }
    try {
      const yHigh = this.candleSeries.priceToCoordinate(this.currentSwingHigh);
      const yPremLow = this.candleSeries.priceToCoordinate(this.currentPremiumLow);
      const yMid = this.candleSeries.priceToCoordinate(this.currentMidpoint);
      const yDiscHigh = this.candleSeries.priceToCoordinate(this.currentDiscountHigh);
      const yLow = this.candleSeries.priceToCoordinate(this.currentSwingLow);

      if (yHigh === null || yLow === null) {
        if (!this._retryingOverlay) {
          this._retryingOverlay = true;
          setTimeout(() => {
            this._retryingOverlay = false;
            this.updateSMCZonesOverlay();
          }, 120);
        }
        return;
      }

      const topHigh = Math.min(yHigh, yPremLow !== null ? yPremLow : yHigh);
      const premHeight = Math.max(18, Math.abs((yPremLow !== null ? yPremLow : (yHigh + 24)) - yHigh));
      const discTop = Math.min(yLow, yDiscHigh !== null ? yDiscHigh : yLow);
      const discHeight = Math.max(18, Math.abs(yLow - (yDiscHigh !== null ? yDiscHigh : (yLow - 24))));
      const eqTop = (yMid !== null) ? (yMid - 10) : 0;

      this.smcZonesOverlay.innerHTML = `
        <!-- Premium Zone Box -->
        <div style="top: ${topHigh}px; height: ${premHeight}px;"
             class="absolute left-0 right-14 bg-red-500/[0.14] border-t-2 border-red-500/80 border-b border-dashed border-red-500/30 flex items-start justify-between px-3 pt-0.5">
          <span class="text-[11px] font-bold text-red-400 tracking-wider">Premium</span>
          <span class="text-[9px] font-semibold text-red-400/80">Strong</span>
        </div>

        <!-- Equilibrium Zone Band -->
        ${yMid !== null ? `
        <div style="top: ${eqTop}px; height: 20px;"
             class="absolute left-0 right-14 bg-slate-500/[0.10] border-y border-dashed border-slate-400/30 flex items-center justify-end px-3">
          <span class="text-[10px] font-medium text-slate-300 tracking-wider">Equilibrium</span>
        </div>` : ''}

        <!-- Discount Zone Box -->
        <div style="top: ${discTop}px; height: ${discHeight}px;"
             class="absolute left-0 right-14 bg-emerald-500/[0.14] border-b-2 border-emerald-500/80 border-t border-dashed border-emerald-500/30 flex items-end justify-between px-3 pb-0.5">
          <span class="text-[11px] font-bold text-emerald-400 tracking-wider">Discount</span>
          <span class="text-[9px] font-semibold text-emerald-400/80">Weak</span>
        </div>
      `;
    } catch (e) {
      console.warn('Error updating SMC zones overlay:', e);
    }
  },

  logTradeToJournal: function (signalTime, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    if (!window.JournalModule || typeof window.JournalModule.logTradeDirect !== 'function') {
      if (window.App && window.App.showToast) window.App.showToast('Journal module not available');
      return;
    }

    const s = this.lastPerformance?.evaluatedSignals?.find(sig => sig.time === signalTime);
    if (!s) {
      if (window.App && window.App.showToast) window.App.showToast('Trade data not found');
      return;
    }

    const pairName = this.currentPair || window.ScannerModule?.fullChartPair || 'AAVE / USDT';

    window.JournalModule.logTradeDirect({
      pair: pairName,
      type: s.type,
      entryPrice: s.entryPrice,
      exitPrice: s.exitPrice,
      pnl: s.pnl,
      isWin: s.isWin,
      timestamp: s.time * 1000,
      reason: s.reason,
      notes: `Trend Trader 10x Signal: ${s.type} @ $${s.entryPrice.toFixed(2)}. ${s.reason}. Tier: ${s.tpTier}.`
    });

    const btn = document.getElementById(`btn-journal-${signalTime}`);
    if (btn) {
      btn.innerHTML = `<span class="material-symbols-outlined text-[10px]">check</span><span>Saved</span>`;
      btn.className = 'px-1.5 py-0.5 rounded text-[8px] font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 flex items-center gap-0.5 cursor-default';
      btn.disabled = true;
    }
  }
};

/**
 * Signal Alerts & Mobile Notifications
 * Sends native browser push notifications to phone/desktop, triggers audible chimes and vibration
 */
window.TrendTraderAlerts = {
  STORAGE_KEY: 'alphachart_alerts_active',
  HISTORY_KEY: 'alphachart_signal_history_v1',
  NOTIFIED_EVENTS_KEY: 'alphachart_notified_events_v3',
  audioCtx: null,
  _bgWs: null,
  _bgPair: 'AAVE / USDT',
  _bgInterval: '5m',
  _bgMonitorActive: false,
  _lastTestType: 'SELL',

  getNotifiedKeys: function () {
    try {
      return JSON.parse(localStorage.getItem(this.NOTIFIED_EVENTS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  },

  hasNotified: function (key) {
    if (!key) return false;
    const list = this.getNotifiedKeys();
    return list.includes(key);
  },

  markNotified: function (key) {
    if (!key) return;
    try {
      let list = this.getNotifiedKeys();
      if (!list.includes(key)) {
        list.push(key);
        if (list.length > 300) {
          list = list.slice(list.length - 300);
        }
        localStorage.setItem(this.NOTIFIED_EVENTS_KEY, JSON.stringify(list));
      }
    } catch (e) { }
  },

  isAlertsEnabled: function () {
    const val = localStorage.getItem(this.STORAGE_KEY);
    return val !== 'false'; // Defaults to true (Active!)
  },

  setAlertsEnabled: function (val) {
    localStorage.setItem(this.STORAGE_KEY, val ? 'true' : 'false');
    if (val) {
      this.initAudioUnlock();
      const pair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || 'AAVE / USDT';
      this.startBackgroundMonitor(pair, '5m');
    } else {
      this.stopBackgroundMonitor();
    }
  },

  init: function () {
    this.initAudioUnlock();
    // Register Service Worker for mobile lockscreen notifications
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('[AlphaChart AI] Mobile push service worker registered');
        if (this.isAlertsEnabled() && ('Notification' in window) && Notification.permission === 'granted') {
          this.subscribeToCloudPush();
        }
      }).catch(err => {
        console.warn('Service worker registration note:', err);
      });
    }

    if (this.isAlertsEnabled()) {
      const defaultPair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || 'AAVE / USDT';
      this.startBackgroundMonitor(defaultPair, '5m');
    }
  },

  /**
   * Registers device with 24/7 Cloud Web Push service (VAPID) so notifications arrive when app is closed
   */
  subscribeToCloudPush: async function () {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      let vapidKey = 'BHpqr3UT0lcUUPbk7x_9ndY66CIVM0ODI6H2ZgOcMfmARzS5yPn2fXcoY_7cYmph3M_8F81Egy-Nb2NswCYibAw';
      try {
        const keyRes = await fetch('/api/alerts/subscribe');
        if (keyRes.ok) {
          const keyData = await keyRes.json();
          if (keyData && keyData.vapidPublicKey) vapidKey = keyData.vapidPublicKey;
        }
      } catch (e) { }

      const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
      const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray
        });
      }

      if (sub) {
        const pair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || (window.ScannerModule && window.ScannerModule.fullChartPair) || 'AAVE / USDT';
        const tf = (window.TrendTraderEngine && window.TrendTraderEngine.currentTimeframe) || '5m';

        await fetch('/api/alerts/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub,
            pair,
            timeframe: tf
          })
        });

        console.log('[AlphaChart AI] 24/7 Cloud Background Push Subscription Registered!');
        return true;
      }
    } catch (err) {
      console.warn('[AlphaChart AI] Cloud push subscription note:', err);
      return false;
    }
  },

  initAudioUnlock: function () {
    const unlock = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!this.audioCtx) this.audioCtx = new AudioCtx();
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => { });
          }
        }
      } catch (e) { }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('click', unlock, { once: true });
  },

  requestPermission: async function () {
    // Unlock Web Audio immediately on user button click
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioCtx) this.audioCtx = new AudioCtx();
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      }
    } catch (e) { }

    this.setAlertsEnabled(true);

    if (!('Notification' in window)) {
      if (window.App) window.App.showToast('🔔 Phone Signal Alerts Active');
      return true;
    }

    try {
      const permission = await Notification.requestPermission();

      if (permission === 'granted') {
        await this.subscribeToCloudPush();
        if (window.App) window.App.showToast('🔔 Phone Signal Alerts Enabled');
      }
      return true;
    } catch (e) {
      console.warn('Error requesting notification permission:', e);
      return true;
    }
  },

  playAlertSound: function (signalType) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => { });
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (signalType === 'BUY') {
        // High bright ascending bell chime (880Hz -> 1320Hz -> 1760Hz)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.28);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.55);
      } else if (signalType === 'TP1') {
        // Double energetic profit chime (1046.5Hz -> 1318.5Hz -> 1567.98Hz - C6-E6-G6)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.10);
        osc.frequency.exponentialRampToValueAtTime(1567.98, now + 0.25);

        gain.gain.setValueAtTime(0.40, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.start(now);
        osc.stop(now + 0.65);
      } else if (signalType === 'TP2') {
        // Triumphant triple ascending victory chord (1046.5Hz -> 1318.5Hz -> 2093Hz - C6-E6-C7)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.12);
        osc.frequency.exponentialRampToValueAtTime(2093.0, now + 0.30);

        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        osc.start(now);
        osc.stop(now + 0.85);
      } else if (signalType === 'SL') {
        // Deep cautionary cut-loss tone (329.63Hz -> 220Hz - E4 to A3)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(329.63, now);
        osc.frequency.exponentialRampToValueAtTime(220.0, now + 0.35);

        gain.gain.setValueAtTime(0.30, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.70);
        osc.start(now);
        osc.stop(now + 0.70);
      } else {
        // Deep descending warning chime for SELL (587.33Hz -> 293.66Hz)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.25);

        gain.gain.setValueAtTime(0.40, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      }
    } catch (e) {
      console.warn('Web Audio note:', e);
    }
  },

  vibrate: function (signalType) {
    if ('navigator' in window && 'vibrate' in navigator) {
      try {
        if (signalType === 'TP2') {
          navigator.vibrate([150, 70, 150, 70, 350]);
        } else if (signalType === 'TP1') {
          navigator.vibrate([180, 80, 240]);
        } else if (signalType === 'SL') {
          navigator.vibrate([400, 120, 400]);
        } else if (signalType === 'SELL') {
          navigator.vibrate([300, 100, 300, 100, 300]);
        } else {
          navigator.vibrate([250, 100, 250]);
        }
      } catch (e) { }
    }
  },

  sendNotification: function (signal) {
    if (!signal) return;

    // Deduplication Key: Guarantee each event is notified EXACTLY ONCE!
    const cleanPair = (signal.pair || 'UNKNOWN').replace(/[\s\-_/]/g, '').toUpperCase();
    const eventTime = signal.candleTime || signal.time || Math.floor(Date.now() / 60000);
    const eventType = signal.type; // BUY, SELL, TP1, TP2, SL
    const dedupeKey = signal.dedupeKey || `${cleanPair}_${eventTime}_${eventType}`;

    // Test alerts pass signal.isTest = true to bypass deduplication on demand
    if (!signal.isTest && this.hasNotified(dedupeKey)) {
      console.log(`[TrendTraderAlerts] Notification suppressed (already notified): ${dedupeKey}`);
      return;
    }

    if (!signal.isTest) {
      this.markNotified(dedupeKey);
    }

    this.playAlertSound(signal.type);
    this.vibrate(signal.type);
    this.saveSignalToHistory(signal);

    const entryPrice = typeof signal.price === 'number' ? signal.price : parseFloat(signal.price) || 0;
    let title = '';
    let body = '';
    let toastMsg = '';

    if (signal.type === 'BUY') {
      const tp1Text = signal.tp1 ? `$${signal.tp1.toFixed(2)} (+2%)` : `$${(entryPrice * 1.002).toFixed(2)} (+2%)`;
      const tp2Text = signal.tp2 ? `$${signal.tp2.toFixed(2)} (+10%)` : `$${(entryPrice * 1.010).toFixed(2)} (+10%)`;
      const slText = signal.sl ? `$${signal.sl.toFixed(2)} (-5%)` : `$${(entryPrice * 0.995).toFixed(2)} (-5%)`;
      title = `🟢 BUY SIGNAL CONFIRMED: ${signal.pair}`;
      body = `Trend Trader Stop flipped BULLISH! Entry: $${entryPrice.toFixed(2)} (${signal.timeframe || '5m'}).\n🎯 TP1: ${tp1Text} | TP2: ${tp2Text}\n🛑 SL: ${slText}\nCandle closed & verified!`;
      toastMsg = `🚨 BUY SIGNAL on ${signal.pair} at $${entryPrice.toFixed(2)}! Confirmed on candle close.`;
    } else if (signal.type === 'SELL') {
      const tp1Text = signal.tp1 ? `$${signal.tp1.toFixed(2)} (+2%)` : `$${(entryPrice * 0.998).toFixed(2)} (+2%)`;
      const tp2Text = signal.tp2 ? `$${signal.tp2.toFixed(2)} (+10%)` : `$${(entryPrice * 0.990).toFixed(2)} (+10%)`;
      const slText = signal.sl ? `$${signal.sl.toFixed(2)} (-5%)` : `$${(entryPrice * 1.005).toFixed(2)} (-5%)`;
      title = `🔴 SELL SIGNAL CONFIRMED: ${signal.pair}`;
      body = `Trend Trader Stop flipped BEARISH! Entry: $${entryPrice.toFixed(2)} (${signal.timeframe || '5m'}).\n🎯 TP1: ${tp1Text} | TP2: ${tp2Text}\n🛑 SL: ${slText}\nCandle closed & verified!`;
      toastMsg = `🚨 SELL SIGNAL on ${signal.pair} at $${entryPrice.toFixed(2)}! Confirmed on candle close.`;
    } else if (signal.type === 'TP1') {
      const profit = signal.pnl ? `+$${signal.pnl.toFixed(2)}` : '+$10.06';
      title = `🎯 TP1 HIT (+2%): ${signal.pair}`;
      body = `Take Profit 1 achieved at $${entryPrice.toFixed(2)} (+2.0% gain)! Profit: ${profit}. First target secured!`;
      toastMsg = `🎯 TP1 HIT on ${signal.pair} at $${entryPrice.toFixed(2)}! Profit: ${profit} (+2%)`;
    } else if (signal.type === 'TP2') {
      const profit = signal.pnl ? `+$${signal.pnl.toFixed(2)}` : '+$30.30';
      title = `🎯🎯 TP2 HIT (+10%): ${signal.pair}`;
      body = `Take Profit 2 achieved at $${entryPrice.toFixed(2)} (+10.0% gain)! Profit: ${profit}. Super runner secured!`;
      toastMsg = `🎯🎯 TP2 HIT on ${signal.pair} at $${entryPrice.toFixed(2)}! Profit: ${profit} (+10%)`;
    } else if (signal.type === 'SL') {
      const loss = signal.pnl ? `-$${Math.abs(signal.pnl).toFixed(2)}` : '-$5.00';
      title = `🛑 STOP LOSS HIT (-5%): ${signal.pair}`;
      body = `Stop Loss reached at $${entryPrice.toFixed(2)} (-5.0% loss). PnL: ${loss}. Capital protection exit executed.`;
      toastMsg = `🛑 STOP LOSS HIT on ${signal.pair} at $${entryPrice.toFixed(2)} (${loss})`;
    }

    const notificationOptions = {
      body: body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: signal.isTest ? `test-${Date.now()}` : `alphachart-${cleanPair}-${eventType}-${eventTime}`,
      renotify: false,
      vibrate: [300, 100, 300, 100, 400],
      requireInteraction: true,
      data: {
        url: window.location.href,
        signal: signal
      }
    };

    // Mobile Phone Notification via Service Worker (Android & iOS PWA lockscreens)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, notificationOptions);
      }).catch(() => {
        try { new Notification(title, notificationOptions); } catch (e) { }
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, notificationOptions);
      } catch (e) {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, notificationOptions);
          }).catch(() => { });
        }
      }
    }

    if (window.App && typeof window.App.showToast === 'function' && toastMsg) {
      window.App.showToast(toastMsg);
    }

    if (window.TrendTraderEngine && typeof window.TrendTraderEngine.showInstantSignalBanner === 'function') {
      window.TrendTraderEngine.showInstantSignalBanner(signal);
    }
  },

  saveSignalToHistory: function (signal) {
    try {
      const existing = JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]');
      existing.unshift({
        id: Date.now(),
        ...signal,
        timestamp: Date.now()
      });
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(existing.slice(0, 50)));
    } catch (e) { }
  },

  startBackgroundMonitor: function (pairName = 'AAVE / USDT', interval = '5m') {
    if (this._bgMonitorActive && this._bgPair === pairName && this._bgInterval === interval) return;
    this.stopBackgroundMonitor();

    let cleanSymbol = 'aaveusdt';
    if (pairName) {
      const raw = pairName.toLowerCase().replace(/[\s\-_/]/g, '');
      if (raw.endsWith('usdt') || raw.endsWith('usdc') || raw.endsWith('busd')) {
        cleanSymbol = raw;
      } else if (raw.endsWith('usd')) {
        cleanSymbol = `${raw.replace(/usd$/, '')}usdt`;
      } else {
        cleanSymbol = `${raw}usdt`;
      }
    }

    let binanceInterval = '5m';
    if (interval === '60' || interval === '1h') binanceInterval = '1h';
    else if (interval === '15' || interval === '15m') binanceInterval = '15m';

    this._bgPair = pairName;
    this._bgInterval = interval;
    this._bgMonitorActive = true;

    // Pre-load candles ONLY if TrendTraderEngine matches this pair and is empty
    if (window.TrendTraderEngine) {
      const activeEngPair = (window.TrendTraderEngine.currentPair || '').toUpperCase().replace(/[\s\-_/]/g, '');
      const bgSym = cleanSymbol.toUpperCase();
      if ((!activeEngPair || activeEngPair === bgSym) && (!window.TrendTraderEngine.lastCandles || window.TrendTraderEngine.lastCandles.length < 30)) {
        window.TrendTraderEngine.fetchCandles(cleanSymbol, binanceInterval).then(candles => {
          if (candles && candles.length) {
            window.TrendTraderEngine.lastCandles = candles;
            const analysis = window.TrendTraderEngine.analyzeCandles(candles);
            if (analysis) {
              window.TrendTraderEngine.lastAnalysis = analysis;
            }
          }
        }).catch(() => { });
      }
    }

    // Connect to WebSocket stream for candle close events
    const wsUrl = `wss://data-stream.binance.vision/ws/${cleanSymbol}@kline_${binanceInterval}`;
    try {
      this._bgWs = new WebSocket(wsUrl);

      this._bgWs.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.e === 'kline' && msg.k && msg.k.x === true) {
            // A candle just closed!
            const k = msg.k;
            const closedCandle = {
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v)
            };

            // Evaluate signal via TrendTraderEngine ONLY if it matches the current active chart pair!
            if (window.TrendTraderEngine) {
              const curEngineSym = (window.TrendTraderEngine.currentPair || '').toUpperCase().replace(/[\s\-_/]/g, '');
              const incomingClean = cleanSymbol.toUpperCase();
              if (curEngineSym === incomingClean || curEngineSym.includes(incomingClean) || incomingClean.includes(curEngineSym)) {
                window.TrendTraderEngine.onCandleClosed(cleanSymbol, binanceInterval, closedCandle);
              }
            }
          }
        } catch (e) { }
      };

      this._bgWs.onclose = () => {
        if (this._bgMonitorActive) {
          setTimeout(() => {
            if (this._bgMonitorActive) this.startBackgroundMonitor(this._bgPair, this._bgInterval);
          }, 4000);
        }
      };
    } catch (err) {
      console.warn('Background monitor WS error:', err);
    }
  },

  stopBackgroundMonitor: function () {
    this._bgMonitorActive = false;
    if (this._bgWs) {
      try { this._bgWs.close(); } catch (e) { }
      this._bgWs = null;
    }
  },

  _testCycle: ['BUY', 'TP1', 'TP2', 'SELL', 'SL'],
  _testIndex: 0,

  /**
   * Test BUY, TP1, TP2, SELL, and SL alerts with unique audio chimes, phone vibration, banners & push notifications!
   */
  testAlert: function (forcedType) {
    const type = forcedType || this._testCycle[this._testIndex % this._testCycle.length];
    this._testIndex++;

    const pair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) ||
      (window.ScannerModule && window.ScannerModule.fullChartPair) || 'BTC / USDT';
    const tf = (window.TrendTraderEngine && window.TrendTraderEngine.currentTimeframe) ||
      (window.ScannerModule && window.ScannerModule.fullChartInterval ? `${window.ScannerModule.fullChartInterval}m` : '5m');

    const entry = 119.10;
    const isBuy = type === 'BUY' || type === 'TP1' || type === 'TP2';
    const tp1 = isBuy ? (entry * 1.002) : (entry * 0.998);
    const tp2 = isBuy ? (entry * 1.010) : (entry * 0.990);
    const tp3 = isBuy ? (entry * 1.030) : (entry * 0.970);
    const sl = isBuy ? (entry * 0.995) : (entry * 1.005);

    let testPrice = entry;
    let pnl = 0;
    if (type === 'TP1') {
      testPrice = tp1;
      pnl = 10.06;
    } else if (type === 'TP2') {
      testPrice = tp2;
      pnl = 30.30;
    } else if (type === 'SL') {
      testPrice = sl;
      pnl = -5.00;
    }

    const btnText = document.getElementById('test-alert-btn-text');
    if (btnText) {
      const typeIcons = {
        BUY: 'BUY 🟢',
        TP1: 'TP1 🎯',
        TP2: 'TP2 🎯🎯',
        SELL: 'SELL 🔴',
        SL: 'SL 🛑'
      };
      btnText.innerText = `Testing: ${typeIcons[type] || type}`;
      setTimeout(() => {
        if (btnText) btnText.innerText = 'Test Alert';
      }, 3500);
    }

    this.sendNotification({
      isTest: true,
      dedupeKey: `test_${type}_${Date.now()}`,
      type: type,
      pair: pair,
      price: testPrice,
      timeframe: tf,
      tp1: tp1,
      tp2: tp2,
      tp3: tp3,
      sl: sl,
      pnl: pnl,
      direction: isBuy ? 'BUY' : 'SELL',
      notes: `Test Instant Signal Alert: Confirmed ${type} demonstration!`
    });

    // Also trigger cloud push notification for closed-app / lockscreen test
    try {
      fetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, pair: pair, price: testPrice.toFixed(2) })
      }).catch(() => { });
    } catch (e) { }
  }
};

// Auto-initialize signal alerts and background monitoring
if (window.TrendTraderAlerts && typeof window.TrendTraderAlerts.init === 'function') {
  window.TrendTraderAlerts.init();
}
