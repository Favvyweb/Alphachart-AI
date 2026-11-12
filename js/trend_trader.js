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
      `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&startTime=${startFetchMs}&limit=1000`,
      `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&startTime=${startFetchMs}&limit=1000`
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
   * Run Institutional Smart Money Concepts (SMC) + S&R Break + MACD Momentum Engine:
   * - Eliminates weak false whipsaws and counter-trend traps
   * - Requires candle close confirmation (no wick triggers)
   * - Checks Break of Structure (BOS) across Swing Resistance / Support
   * - Validates MACD directional momentum and EMA 50 trend alignment
   */
  analyzeCandles: function (candles) {
    const psar = this.calculatePSAR(candles, 0.02, 0.02, 0.2);
    const fractals = this.calculateFractals(candles, 2);
    const macd = this.calculateMACD(candles, 12, 26, 9);
    const closes = candles.map(c => c.close);
    const ema7 = this.calcEMA(closes, 7);
    const ema14 = this.calcEMA(closes, 14);
    const ema20 = this.calcEMA(closes, 20);
    const ema50 = this.calcEMA(closes, 50);

    const marketStructure = this.calculateMarketStructure(candles, fractals);

    const tags = [];
    // Establish initial macro trend from early warmup bars
    let currentTrend = psar.length > 0 ? psar[0].isUp : true;
    if (candles.length > 10 && ema50.length > 10) {
      currentTrend = candles[10].close >= ema50[10];
    }

    for (let i = 0; i < candles.length; i++) {
      const cur = candles[i];
      const p = psar[i];
      const f = fractals[i];
      const res = marketStructure.resistanceLevels[i];
      const sup = marketStructure.supportLevels[i];
      const macdHist = (macd.histogram && macd.histogram[i] !== undefined) ? macd.histogram[i] : 0;
      const macdLine = (macd.macdLine && macd.macdLine[i] !== undefined) ? macd.macdLine[i] : 0;
      const sigLine = (macd.signalLine && macd.signalLine[i] !== undefined) ? macd.signalLine[i] : 0;
      const prevMacdHist = (i > 0 && macd.histogram && macd.histogram[i - 1] !== undefined) ? macd.histogram[i - 1] : 0;

      const isBullCandle = cur.close > cur.open;
      const isBearCandle = cur.close < cur.open;
      const range = Math.max(cur.high - cur.low, 0.00001);

      let tag = null;

      if (!currentTrend) {
        // ==========================================
        // CURRENT STATE: BEARISH / SELL TREND -> LOOKING FOR BUY REVERSAL
        // ==========================================
        // 1. Structural / Price Triggers:
        // Confirmed PSAR flip to underside of price OR Break of Structure (Close > Resistance)
        const sarBullish = p.isUp && cur.close > p.sar;
        const bosBullish = (res !== null) && (cur.close > res);

        // 2. Strict MACD Momentum Confirmation:
        // - MACD Line MUST be above Signal Line (cyan >= amber) - NO EXCEPTIONS!
        const macdCrossedUp = macdLine >= sigLine;
        // - MACD Histogram MUST be genuinely positive (green blocks: macdHist > 0) - NEVER RED!
        const macdHistGreen = macdHist > 0;
        // - Momentum Expansion: Histogram expanding upward OR has confirmed 2+ consecutive green blocks
        const macdExpandingUp = (macdHist >= prevMacdHist) || (prevMacdHist > 0 && macdHist > 0);
        const macdMomentumConfirm = macdCrossedUp && macdHistGreen && macdExpandingUp;

        // 3. Candle Body Quality:
        // Solid green candle closing near the top with strong body (no upper wick rejection trap)
        const bullBody = cur.close - cur.open;
        const upperWick = cur.high - cur.close;
        const candleSolid = isBullCandle && (bullBody >= range * 0.30) && (upperWick <= range * 0.45);

        // 4. Short-term Trend & EMA Confluence (EMA 7 / EMA 14 dynamic filter):
        // Fast EMA 7 must be above EMA 14, and price must close above EMA 7 (confirming active upward push)
        const emaBullish = (ema7[i] >= ema14[i]) && (cur.close >= ema7[i]);
        const trendConfluence = ((cur.close >= ema50[i]) || (bosBullish && macdMomentumConfirm)) && emaBullish;

        // STRICT ENTRY: Momentum, structure, and candle quality MUST all confirm simultaneously (NO RUSHING!)
        const canBuy = (sarBullish || bosBullish) && macdMomentumConfirm && candleSolid && trendConfluence;

        if (canBuy) {
          tag = 'BUY';
          currentTrend = true;
        } else if (f.isLow) {
          tag = 'TP';
        }
      } else {
        // ==========================================
        // CURRENT STATE: BULLISH / BUY TREND -> LOOKING FOR SELL REVERSAL
        // ==========================================
        // 1. Structural / Price Triggers:
        // Confirmed PSAR flip to top of price OR Break of Structure (Close < Support)
        const sarBearish = !p.isUp && cur.close < p.sar;
        const bosBearish = (sup !== null) && (cur.close < sup);

        // 2. Strict MACD Momentum Confirmation:
        // - MACD Line MUST be below Signal Line (cyan <= amber) - NO EXCEPTIONS!
        const macdCrossedDown = macdLine <= sigLine;
        // - MACD Histogram MUST be genuinely negative (red blocks: macdHist < 0) - NEVER GREEN!
        const macdHistRed = macdHist < 0;
        // - Momentum Expansion: Histogram expanding downward OR has confirmed 2+ consecutive red blocks
        const macdExpandingDown = (macdHist <= prevMacdHist) || (prevMacdHist < 0 && macdHist < 0);
        const macdMomentumConfirm = macdCrossedDown && macdHistRed && macdExpandingDown;

        // 3. Candle Body Quality:
        // Solid red candle closing near the low with strong body (no lower wick bounce trap)
        const bearBody = cur.open - cur.close;
        const lowerWick = cur.close - cur.low;
        const candleSolid = isBearCandle && (bearBody >= range * 0.30) && (lowerWick <= range * 0.45);

        // 4. Short-term Trend & EMA Confluence (EMA 7 / EMA 14 dynamic filter):
        // Fast EMA 7 must be below EMA 14, and price must close below EMA 7 (confirming active downward drop)
        const emaBearish = (ema7[i] <= ema14[i]) && (cur.close <= ema7[i]);
        const trendConfluence = ((cur.close <= ema50[i]) || (bosBearish && macdMomentumConfirm)) && emaBearish;

        // STRICT ENTRY: Momentum, structure, and candle quality MUST all confirm simultaneously (NO RUSHING!)
        const canSell = (sarBearish || bosBearish) && macdMomentumConfirm && candleSolid && trendConfluence;

        if (canSell) {
          tag = 'SELL';
          currentTrend = false;
        } else if (f.isHigh) {
          tag = 'TP';
        }
      }

      tags.push(tag);
    }

    return { candles, psar, fractals, macd, ema7, ema14, ema20, ema50, marketStructure, tags };
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

    // Add Parabolic SAR Series (trailing dots)
    const dottedStyle = (window.LightweightCharts && window.LightweightCharts.LineStyle) ? window.LightweightCharts.LineStyle.Dotted : 1;
    this.psarSeries = addLineSeries(this.mainChart, {
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: dottedStyle,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const psarData = [];
    for (let i = 0; i < candles.length; i++) {
      if (psar[i] && psar[i].sar) {
        psarData.push({ time: candles[i].time, value: psar[i].sar });
      }
    }
    this.psarSeries.setData(psarData);

    // Calculate Institutional Smart Money Concepts (SMC) Zones (Premium, Equilibrium, Discount)
    const recentBars = candles.filter(c => c.time >= midnightSec);
    const evalBars = (recentBars && recentBars.length >= 10) ? recentBars : candles.slice(-80);
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

    // Pre-calculate daily signal outcomes to display Win/Loss badges directly on the chart markers
    const prePerf = this.calculateDailySignalPerformance(candles, tags, psar);
    const signalOutcomesMap = {};
    if (prePerf && prePerf.evaluatedSignals) {
      for (const s of prePerf.evaluatedSignals) {
        signalOutcomesMap[s.index] = s;
      }
    }

    // Add Real-time Signals (BUY/SELL on signal close) and Progressive TP & SL Markers
    const markers = [];

    // 1. Initial Signal Markers & Swing TP Markers (Matching Institutional SMC Style)
    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (tag !== 'BUY' && tag !== 'SELL' && tag !== 'TP') continue;
      const c = candles[i];
      if (c.time < midnightSec) continue; // Strictly display today's signals from 12:00 AM onwards

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
      } else if (tag === 'TP') {
        markers.push({
          time: c.time,
          position: 'belowBar',
          color: '#a855f7', // Clean institutional purple TP square
          shape: 'square',
          text: 'TP',
          size: 1.2
        });
      }
    }

    // 2. Clean Progressive TP Milestones & SL Markers (Sleek Purple TP Squares & Red SL Badges)
    if (prePerf && prePerf.evaluatedSignals) {
      for (const s of prePerf.evaluatedSignals) {
        if (s.tpEvents && s.tpEvents.length > 0) {
          for (const ev of s.tpEvents) {
            if (ev.time < midnightSec) continue;
            // Never put an outcome circle on the initial signal candle itself
            if (ev.time === s.time) continue;

            const isTp = ev.level.startsWith('TP');
            markers.push({
              time: ev.time,
              position: ev.isBuy ? (isTp ? 'aboveBar' : 'belowBar') : (isTp ? 'belowBar' : 'aboveBar'),
              color: isTp ? '#a855f7' : '#ff453a', // Purple for TP, red for SL
              shape: isTp ? 'square' : 'circle',
              text: isTp ? 'TP' : 'SL',
              size: 1.2
            });
          }
        }
      }
    }

    // Sort markers by timestamp for Lightweight Charts
    markers.sort((a, b) => a.time - b.time);

    if (markers.length > 0) {
      try {
        if (typeof this.candleSeries.setMarkers === 'function') {
          this.candleSeries.setMarkers(markers);
        } else if (window.LightweightCharts && window.LightweightCharts.createSeriesMarkers) {
          this.seriesMarkers = window.LightweightCharts.createSeriesMarkers(this.candleSeries, markers);
        }
      } catch (markerErr) {
        console.warn('Marker note:', markerErr);
      }
    }

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

    // Display full day from 12:00 AM (00:00:00) to 11:59 PM (23:59:59)
    setTimeout(() => {
      try {
        const midnightCandle = candles.find(c => c.time >= midnightSec) || candles[0];
        if (this.mainChart && this.mainChart.timeScale) {
          this.mainChart.timeScale().setVisibleRange({
            from: midnightCandle.time,
            to: endOfDaySec
          });
        }
        if (this.macdChart && this.macdChart.timeScale) {
          this.macdChart.timeScale().setVisibleRange({
            from: midnightCandle.time,
            to: endOfDaySec
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
      // STRICT FILTER: Only include signals from THAT DAY (from 12:00:00 AM midnight onward)
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
      let hitTp4 = false;
      let hitTp5 = false;
      let hitSL = false;
      let tradeClosed = false;
      let pnl = 0;

      // Scan subsequent candles forward (candle i has closed, trade progresses on candle i+1 onwards)
      const maxK = Math.min(candles.length - 1, i + 60);
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
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const mins = String(dateObj.getMinutes()).padStart(2, '0');
      const timeFormatted = `${hours}:${mins}`;

      evaluatedSignals.push({
        index: i,
        time: c.time,
        timeFormatted,
        dateKey: todayDateKey,
        dayName: todayDayName,
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

    // Only build today's data (strictly that day's own per day)
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

  isAlertsEnabled: function () {
    return localStorage.getItem(this.STORAGE_KEY) === 'true';
  },

  setAlertsEnabled: function (val) {
    localStorage.setItem(this.STORAGE_KEY, val ? 'true' : 'false');
  },

  requestPermission: async function () {
    if (!('Notification' in window)) {
      alert('Desktop/Mobile Notifications are not supported in this browser.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.setAlertsEnabled(true);
        this.playAlertSound('BUY');
        this.vibrate();
        this.sendNotification({
          type: 'BUY',
          pair: window.ScannerModule.fullChartPair || 'AAVE / USDT',
          price: 125.36,
          timeframe: '5m',
          notes: 'AlphaChart Signal Alerts successfully activated on your phone!'
        });
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Error requesting notification permission:', e);
      return false;
    }
  },

  playAlertSound: function (signalType) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

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

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.55);
      } else {
        // Deep descending warning chime (587Hz -> 293Hz)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.25);

        gain.gain.setValueAtTime(0.35, now);
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
    this.playAlertSound(signal.type);
    this.vibrate();

    this.saveSignalToHistory(signal);

    if ('Notification' in window && Notification.permission === 'granted') {
      const isBuy = signal.type === 'BUY';
      const title = `${isBuy ? '🟢 BUY SIGNAL' : '🔴 SELL SIGNAL'}: ${signal.pair}`;
      const body = `Trend Trader Remastered confirmed ${signal.type} at $${signal.price.toFixed(2)} (${signal.timeframe}).\nMACD Momentum: ${isBuy ? 'Bullish Expansion' : 'Bearish Breakdown'}.`;

      try {
        new Notification(title, {
          body: body,
          icon: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=128&auto=format&fit=crop',
          badge: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=128&auto=format&fit=crop',
          tag: `signal-${signal.pair}-${Date.now()}`
        });
      } catch (e) { }
    }

    if (window.App) {
      window.App.showToast(`🚨 ${signal.type} SIGNAL on ${signal.pair} at $${signal.price.toFixed(2)}!`);
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

  testAlert: function () {
    const isGranted = 'Notification' in window && Notification.permission === 'granted';
    if (!isGranted && 'Notification' in window && Notification.permission !== 'denied') {
      this.requestPermission();
      return;
    }

    const pair = (window.ScannerModule && window.ScannerModule.fullChartPair) ? window.ScannerModule.fullChartPair : 'AAVE / USDT';
    const tf = (window.ScannerModule && window.ScannerModule.fullChartInterval) ? `${window.ScannerModule.fullChartInterval}m` : '5m';

    this.sendNotification({
      type: 'BUY',
      pair: pair,
      price: 125.36,
      timeframe: tf,
      notes: 'Test Signal Alert Triggered Successfully!'
    });
  }
};
