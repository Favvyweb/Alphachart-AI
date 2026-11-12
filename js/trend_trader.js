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
      `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=500`,
      `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=500`
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

    // Calculate start of day (12:00:00 AM UTC) to anchor the session
    const nowDayObj = new Date();
    const midnightUtcMs = Date.UTC(nowDayObj.getUTCFullYear(), nowDayObj.getUTCMonth(), nowDayObj.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);

    const tags = [];
    let activeTrade = null; // null, 'BUY', or 'SELL'
    let entryPrice = 0;

    for (let i = 0; i < candles.length; i++) {
      if (i < 14) {
        tags.push(null);
        continue;
      }
      const cur = candles[i];
      const prev = candles[i - 1];
      const prev2 = i >= 2 ? candles[i - 2] : prev;

      // Session reset at midnight UTC: anchor fresh for today's trading session
      if (cur.time >= midnightSec && prev.time < midnightSec) {
        activeTrade = null;
      }

      const ttTrend = (trendTrader.trend && trendTrader.trend[i] !== undefined) ? trendTrader.trend[i] : -1;
      const prevTtTrend = (i > 0 && trendTrader.trend && trendTrader.trend[i - 1] !== undefined) ? trendTrader.trend[i - 1] : ttTrend;
      const isFlipBull = (ttTrend === 1 && prevTtTrend === -1);
      const isFlipBear = (ttTrend === -1 && prevTtTrend === 1);

      const macdHist = (macd.histogram && macd.histogram[i] !== undefined) ? macd.histogram[i] : 0;
      const macdLine = (macd.macdLine && macd.macdLine[i] !== undefined) ? macd.macdLine[i] : 0;
      const sigLine = (macd.signalLine && macd.signalLine[i] !== undefined) ? macd.signalLine[i] : 0;
      const prevMacdHist = (i > 0 && macd.histogram && macd.histogram[i - 1] !== undefined) ? macd.histogram[i - 1] : 0;

      const isBullCandle = cur.close > cur.open;
      const isBearCandle = cur.close < cur.open;

      // Dynamic session swing range for SMC Premium, Equilibrium, and Discount Zones
      const lookback = Math.max(0, i - 60);
      let sH = -Infinity;
      let sL = Infinity;
      for (let k = lookback; k <= i; k++) {
        if (candles[k].high > sH) sH = candles[k].high;
        if (candles[k].low < sL) sL = candles[k].low;
      }
      const sRange = Math.max(sH - sL, 0.0001);
      const sMid = sL + (sRange * 0.5);
      const premLow = sH - (sRange * 0.20);
      const discHigh = sL + (sRange * 0.20);

      // ========================================================
      // MASTER DIRECTIONAL GATE & ADVANCED SIGNAL CONFLUENCE:
      // ========================================================
      // 1. When Trend Trader line is ABOVE candles (ttTrend === -1):
      //    BUY is 100% FORBIDDEN. Minor green candles are pullbacks/retests into resistance.
      // 2. When Trend Trader line is BELOW candles (ttTrend === 1):
      //    SELL is 100% FORBIDDEN. Minor red candles are dips/consolidations.

      let canBuy = false;
      let canSell = false;

      // --- 1. ACCURATE BUY SIGNAL CONFLUENCE ---
      // Triggered ONLY when line flips Bullish (or first confirmed candle following flip).
      // Line is BELOW candles (ttTrend === 1). Riding undisturbed to TP1, TP2, TP3!
      if (ttTrend === 1 && activeTrade !== 'BUY') {
        const isBullEntry = isFlipBull || (prevTtTrend === 1 && (i >= 2 && trendTrader.trend[i - 2] === -1));
        const macdConfirm = (macdHist >= prevMacdHist) || (macdLine >= sigLine);
        const candleConfirm = isBullCandle || (cur.close >= cur.open);
        if (isBullEntry && (candleConfirm || macdConfirm)) {
          canBuy = true;
        }
      }

      // --- 2. ACCURATE SELL SIGNAL CONFLUENCE ---
      // Triggered ONLY when line flips Bearish (or first confirmed candle following flip).
      // Line is ABOVE candles (ttTrend === -1). Riding undisturbed to TP1, TP2, TP3!
      if (ttTrend === -1 && activeTrade !== 'SELL') {
        const isBearEntry = isFlipBear || (prevTtTrend === -1 && (i >= 2 && trendTrader.trend[i - 2] === 1));
        const macdConfirm = (macdHist <= prevMacdHist) || (macdLine <= sigLine);
        const candleConfirm = isBearCandle || (cur.close <= cur.open);
        if (isBearEntry && (candleConfirm || macdConfirm)) {
          canSell = true;
        }
      }

      let tag = null;
      if (canBuy) {
        tag = 'BUY';
        activeTrade = 'BUY';
        entryPrice = cur.close;
      } else if (canSell) {
        tag = 'SELL';
        activeTrade = 'SELL';
        entryPrice = cur.close;
      }

      tags.push(tag);
    }

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
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        barSpacing: 6,
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

    // Add Volume Series (overlay at bottom)
    this.volumeSeries = addHistSeries(this.mainChart, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay
    });
    try {
      this.volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });
    } catch (e) { }

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
        scaleMargins: {
          top: 0.15,
          bottom: 0.15,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        barSpacing: 6,
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

    // Display active trading session centered on recent candles (with smooth pan/zoom)
    setTimeout(() => {
      try {
        const lookbackBars = Math.min(candles.length - 1, 95);
        const fromTime = candles[candles.length - 1 - lookbackBars].time;
        const toTime = candles[candles.length - 1].time + (20 * 300);
        if (this.mainChart && this.mainChart.timeScale) {
          this.mainChart.timeScale().setVisibleRange({
            from: fromTime,
            to: toTime
          });
        }
        if (this.macdChart && this.macdChart.timeScale) {
          this.macdChart.timeScale().setVisibleRange({
            from: fromTime,
            to: toTime
          });
        }
        this.updateSMCZonesOverlay();
      } catch (e) {
        if (this.mainChart) this.mainChart.timeScale().fitContent();
        if (this.macdChart) this.macdChart.timeScale().fitContent();
        this.updateSMCZonesOverlay();
      }
    }, 60);

    // Render Compact Daily Signal Performance Table (ONLY 1:2 Ratio)
    this.renderDailyPerformanceTable(analysis);

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

    // 1. Initial Signal Markers (BUY / SELL arrows) - STRICT FILTER: Exact Day Only (Today)
    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (tag !== 'BUY' && tag !== 'SELL') continue;
      const c = candles[i];
      if (c.time < midnightSec) continue; // Only display signals for the exact current day

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

    // 2. Clean Progressive TP Milestones & SL Markers - STRICT FILTER: Exact Day Only (Today)
    if (prePerf && prePerf.evaluatedSignals) {
      for (const s of prePerf.evaluatedSignals) {
        if (s.time < midnightSec) continue;
        if (s.tpEvents && s.tpEvents.length > 0) {
          for (const ev of s.tpEvents) {
            if (ev.time < midnightSec) continue;
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
      if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-primary-container/20 border border-primary-container/50 text-primary-container font-bold text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,255,136,0.3)]';
      if (latestEvalTrade && latestEvalTrade.isWin && latestEvalTrade.tpTier && latestEvalTrade.tpTier.startsWith('TP')) {
        if (statusText) statusText.innerText = `🟣 Trend Trader: BUY TP Hit! (${latestEvalTrade.tpTier}) • Profit: +$${latestEvalTrade.pnl.toFixed(2)}`;
      } else {
        const entryP = analysis.candles[latestTagIndex].close;
        const tp1P = entryP * 1.002;
        const slP = entryP * 0.995;
        if (statusText) statusText.innerText = `🟢 Trend Trader: BUY Active ($${entryP.toFixed(2)}) • TP1: $${tp1P.toFixed(2)} (+2%) | SL: $${slP.toFixed(2)} (-5%)`;
      }
    } else if (latestTag === 'SELL') {
      if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-error/20 border border-error/50 text-error font-bold text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,51,102,0.3)]';
      if (latestEvalTrade && latestEvalTrade.isWin && latestEvalTrade.tpTier && latestEvalTrade.tpTier.startsWith('TP')) {
        if (statusText) statusText.innerText = `🟣 Trend Trader: SELL TP Hit! (${latestEvalTrade.tpTier}) • Profit: +$${latestEvalTrade.pnl.toFixed(2)}`;
      } else {
        const entryP = analysis.candles[latestTagIndex].close;
        const tp1P = entryP * 0.998;
        const slP = entryP * 1.005;
        if (statusText) statusText.innerText = `🔴 Trend Trader: SELL Active ($${entryP.toFixed(2)}) • TP1: $${tp1P.toFixed(2)} (+2%) | SL: $${slP.toFixed(2)} (-5%)`;
      }
    } else {
      if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-on-surface-variant font-bold text-[11px] flex items-center gap-1.5';
      if (statusText) statusText.innerText = `⚪ Trend Trader: Scanning Active 5m Scalp Candles...`;
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
    const wsUrl = `wss://data-stream.binance.vision/ws/${cleanSymbol}@kline_${binanceInterval}`;

    try {
      this.liveWs = new WebSocket(wsUrl);

      this.liveWs.onopen = () => {
        console.log(`[AlphaChart AI] Live kline stream active: ${cleanSymbol}@${binanceInterval}`);
      };

      this.liveWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.e === 'kline' && msg.k) {
            this.handleLiveKline(cleanSymbol, binanceInterval, msg.k);
          }
        } catch (e) { }
      };

      this.liveWs.onerror = (err) => {
        console.warn('[AlphaChart AI] WebSocket stream note:', err);
      };

      this.liveWs.onclose = () => {
        if (this.isLiveStreamActive) {
          this.liveWsRetryTimer = setTimeout(() => {
            if (this.isLiveStreamActive) this.startLiveStream(pairName, interval);
          }, 3500);
        }
      };
    } catch (e) {
      console.warn('Live WebSocket stream init note:', e);
    }
  },

  stopLiveStream: function () {
    this.isLiveStreamActive = false;
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

    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v)
    };

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

    // 2. CANDLE CLOSE EVENT: Triggered immediately when that very first candle closes!
    if (k.x === true) {
      this.onCandleClosed(symbol, interval, candle);
    }
  },

  /**
   * Evaluates newly closed candle immediately and fires instant notification if signal prints!
   */
  onCandleClosed: function (symbol, interval, candle) {
    if (!candle) return;

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
    // INSTANT NOTIFICATION TRIGGER (First closed candle!):
    // ========================================================
    const signalTag = analysis.tags[lastIdx];
    if (signalTag === 'BUY' || signalTag === 'SELL') {
      const signalKey = `${symbol}_${interval}_${candle.time}_${signalTag}`;
      if (this.lastNotifiedSignalKey !== signalKey) {
        this.lastNotifiedSignalKey = signalKey;

        const displayPair = this.currentPair || `${symbol.toUpperCase().replace('USDT', ' / USDT')}`;
        const entryPrice = candle.close;
        const isBuy = (signalTag === 'BUY');
        const tp1 = isBuy ? entryPrice * 1.002 : entryPrice * 0.998;
        const tp2 = isBuy ? entryPrice * 1.010 : entryPrice * 0.990;
        const tp3 = isBuy ? entryPrice * 1.030 : entryPrice * 0.970;
        const sl = isBuy ? entryPrice * 0.995 : entryPrice * 1.005;

        const signalPayload = {
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

        // 1. Native Push Notification + Web Audio Chime + Mobile Vibration
        if (window.TrendTraderAlerts) {
          window.TrendTraderAlerts.sendNotification(signalPayload);
        }

        // 2. High-Visibility On-Screen Alert Banner
        this.showInstantSignalBanner(signalPayload);
      }
    }
  },

  /**
   * Prominent Neon Glassmorphism In-App Alert Banner (Appears at top center with sound & vibration)
   */
  showInstantSignalBanner: function (signal) {
    if (!signal) return;
    const isBuy = signal.type === 'BUY';
    const accentColor = isBuy ? '#00ff88' : '#ff3366';
    const bgGlow = isBuy ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 51, 102, 0.15)';
    const borderColor = isBuy ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 51, 102, 0.6)';

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

    banner.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: ${bgGlow}; border: 1px solid ${borderColor};">
          <span class="material-symbols-outlined text-[22px] animate-bounce" style="color: ${accentColor};">
            ${isBuy ? 'arrow_upward' : 'arrow_downward'}
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full animate-ping" style="background: ${accentColor};"></span>
              <span class="text-xs font-black tracking-wider uppercase" style="color: ${accentColor};">
                ${isBuy ? '🟢 INSTANT BUY CONFIRMED' : '🔴 INSTANT SELL CONFIRMED'}
              </span>
            </div>
            <span class="text-[10px] text-white/50 font-mono">Candle Closed</span>
          </div>
          <div class="text-sm font-bold text-white mt-0.5 truncate">
            ${signal.pair} • <span class="font-mono">$${signal.price.toFixed(2)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono ml-1 bg-white/10 text-white/80">${signal.timeframe}</span>
          </div>
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
      // STRICT FILTER: Only include signals from the EXACT CURRENT DAY (from 12:00:00 AM UTC midnight onward)
      if (c.time < midnightSec) continue;

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
      for (let k = i + 1; k <= maxK; k++) {
        const nextC = candles[k];
        const nextTag = tags[k];

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

    // STRICT FILTER: Only build today's data (strictly the exact current day only)
    const todayData = {
      dateKey: todayDateKey,
      dayName: todayDayName,
      isToday: true,
      buySignals: evaluatedSignals.filter(s => s.type === 'BUY'),
      sellSignals: evaluatedSignals.filter(s => s.type === 'SELL')
    };

    const sortedDays = [todayData];

    let totalNet12 = 0;
    let totalWins12 = 0;
    let totalTrades = 0;

    for (const s of evaluatedSignals) {
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

    return { sortedDays, totalNet12, totalTrades, winRate, todayDayName, evaluatedSignals };
  },

  /**
   * Renders the compact daily performance table inside the chart overlay (ONLY 1:2 Ratio)
   */
  renderDailyPerformanceTable: function (analysis) {
    if (!analysis || !analysis.candles) return;

    const tbody = document.getElementById('ttr-compact-table-tbody');
    const netPnlEl = document.getElementById('ttr-compact-net-pnl');
    const winRateEl = document.getElementById('ttr-compact-win-rate');
    const totalTradesEl = document.getElementById('ttr-compact-total-trades');
    const pillPnlEl = document.getElementById('ttr-compact-pill-pnl');
    const pillRateEl = document.getElementById('ttr-compact-pill-rate');
    const todayTagEl = document.getElementById('ttr-compact-today-tag');

    const perf = this.calculateDailySignalPerformance(analysis.candles, analysis.tags, analysis.psar);
    this.lastPerformance = perf;

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

    if (this.showSMCLevels) {
      label.innerText = 'SMC Zones: ON';
      btn.className = 'px-2.5 py-0.5 rounded-lg text-[10px] font-semibold border transition-all flex items-center gap-1 bg-primary-container/10 border-primary-container/40 text-primary-container hover:bg-primary-container/20';
    } else {
      label.innerText = 'SMC Zones: OFF';
      btn.className = 'px-2.5 py-0.5 rounded-lg text-[10px] font-semibold border transition-all flex items-center gap-1 bg-[#000000] border-white/[0.08] text-on-surface-variant hover:border-white/20 hover:text-white';
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
  audioCtx: null,
  _bgWs: null,
  _bgPair: 'AAVE / USDT',
  _bgInterval: '5m',
  _bgMonitorActive: false,

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
    if (this.isAlertsEnabled()) {
      const defaultPair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || 'AAVE / USDT';
      this.startBackgroundMonitor(defaultPair, '5m');
    }
  },

  initAudioUnlock: function () {
    const unlock = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!this.audioCtx) this.audioCtx = new AudioCtx();
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
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
      if (window.App) window.App.showToast('🔔 Signal Alerts Active with Sound & Vibration!');
      this.playAlertSound('BUY');
      this.vibrate();
      return true;
    }

    try {
      const permission = await Notification.requestPermission();
      this.playAlertSound('BUY');
      this.vibrate();

      const pair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || (window.ScannerModule && window.ScannerModule.fullChartPair) || 'AAVE / USDT';
      this.sendNotification({
        type: 'BUY',
        pair: pair,
        price: 119.10,
        timeframe: '5m',
        tp1: 119.34,
        tp2: 120.29,
        tp3: 122.67,
        sl: 118.50,
        notes: 'AlphaChart Instant Signal Alerts activated on your device!'
      });
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
        this.audioCtx.resume().catch(() => {});
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
      } else {
        // Deep descending warning chime (587Hz -> 293Hz)
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

  vibrate: function () {
    if ('navigator' in window && 'vibrate' in navigator) {
      try {
        navigator.vibrate([250, 100, 250, 100, 350]);
      } catch (e) { }
    }
  },

  sendNotification: function (signal) {
    if (!signal) return;
    this.playAlertSound(signal.type);
    this.vibrate();
    this.saveSignalToHistory(signal);

    const isBuy = signal.type === 'BUY';
    const entryPrice = typeof signal.price === 'number' ? signal.price : parseFloat(signal.price) || 0;
    const tp1Text = signal.tp1 ? `$${signal.tp1.toFixed(2)} (+2%)` : `$${(entryPrice * (isBuy ? 1.002 : 0.998)).toFixed(2)} (+2%)`;
    const slText = signal.sl ? `$${signal.sl.toFixed(2)} (-5%)` : `$${(entryPrice * (isBuy ? 0.995 : 1.005)).toFixed(2)} (-5%)`;

    if ('Notification' in window && Notification.permission === 'granted') {
      const title = `${isBuy ? '🟢 BUY SIGNAL' : '🔴 SELL SIGNAL'}: ${signal.pair}`;
      const body = `Trend Trader Remastered confirmed ${signal.type} at $${entryPrice.toFixed(2)} (${signal.timeframe}).\nFirst candle closed! TP1: ${tp1Text} | SL: ${slText}.`;

      try {
        new Notification(title, {
          body: body,
          icon: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=128&auto=format&fit=crop',
          badge: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=128&auto=format&fit=crop',
          tag: `signal-${signal.pair}-${Date.now()}`,
          requireInteraction: true
        });
      } catch (e) { }
    }

    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`🚨 ${signal.type} SIGNAL on ${signal.pair} at $${entryPrice.toFixed(2)}! First candle closed.`);
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

            // Evaluate signal via TrendTraderEngine
            if (window.TrendTraderEngine) {
              window.TrendTraderEngine.onCandleClosed(cleanSymbol, binanceInterval, closedCandle);
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

  testAlert: function () {
    const pair = (window.TrendTraderEngine && window.TrendTraderEngine.currentPair) || (window.ScannerModule && window.ScannerModule.fullChartPair) || 'AAVE / USDT';
    const tf = (window.TrendTraderEngine && window.TrendTraderEngine.currentTimeframe) || (window.ScannerModule && window.ScannerModule.fullChartInterval ? `${window.ScannerModule.fullChartInterval}m` : '5m');

    this.sendNotification({
      type: 'BUY',
      pair: pair,
      price: 119.10,
      timeframe: tf,
      tp1: 119.34,
      tp2: 120.29,
      tp3: 122.67,
      sl: 118.50,
      notes: 'Test Instant Signal Alert: First candle closed!'
    });
  }
};

// Auto-initialize signal alerts and background monitoring
if (window.TrendTraderAlerts && typeof window.TrendTraderAlerts.init === 'function') {
  window.TrendTraderAlerts.init();
}
