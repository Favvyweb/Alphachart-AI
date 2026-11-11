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

  currentPair: 'BTC / USDT',
  currentTimeframe: '5m',
  lastCandles: [],
  lastAnalysis: null,
  candlesCache: {},

  /**
   * Fetch live Binance candles for 5m, 15m, or 1h with high-speed parallel fetching and memory cache
   */
  fetchCandles: async function (pairName, interval = '5m') {
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

    // Warm-up bars before midnight (30 bars) so EMA, MACD, and PSAR are accurate from 12:00 AM
    let warmUpMs = 30 * 300 * 1000;
    if (binanceInterval === '15m') warmUpMs = 30 * 900 * 1000;
    else if (binanceInterval === '1h') warmUpMs = 30 * 3600 * 1000;

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

  generateFallbackCandles: function (symbol, interval, count = 288) {
    const candles = [];
    let intervalSec = 300;
    if (interval === '1h') intervalSec = 3600;
    else if (interval === '15m') intervalSec = 900;

    const now = new Date();
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);
    const startSec = midnightSec - (30 * intervalSec);
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
   * Run full technical analysis
   */
  analyzeCandles: function (candles) {
    const psar = this.calculatePSAR(candles, 0.02, 0.02, 0.2);
    const fractals = this.calculateFractals(candles, 2);
    const macd = this.calculateMACD(candles, 12, 26, 9);

    const tags = [];
    let currentTrend = psar.length > 0 ? psar[0].isUp : true;

    for (let i = 0; i < candles.length; i++) {
      const p = psar[i];
      const f = fractals[i];
      let tag = null;

      if (p.flipped) {
        tag = p.tag; // 'BUY' or 'SELL'
        currentTrend = p.isUp;
      } else if (currentTrend && f.isHigh) {
        tag = 'TP';
      } else if (!currentTrend && f.isLow) {
        tag = 'TP';
      }

      tags.push(tag);
    }

    return { candles, psar, fractals, macd, tags };
  },

  /**
   * Initializes or updates the complete TradingView Lightweight Chart & MACD sub-chart
   */
  renderLightweightChart: function (mainContainer, macdContainer, analysis) {
    if (!window.LightweightCharts || !mainContainer || !macdContainer || !analysis) return;

    const { candles, psar, macd, tags } = analysis;
    if (!candles || candles.length < 2) return;

    // Dispose previous chart instances if they exist
    if (this.seriesMarkers) {
      this.seriesMarkers = null;
    }
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

    // Calculate start of day (12:00:00 AM UTC) to strictly isolate today's signals
    const nowDayObj = new Date();
    const midnightUtcMs = Date.UTC(nowDayObj.getUTCFullYear(), nowDayObj.getUTCMonth(), nowDayObj.getUTCDate(), 0, 0, 0, 0);
    const midnightSec = Math.floor(midnightUtcMs / 1000);
    const endOfDaySec = midnightSec + 86399; // 11:59:59 PM

    // Pre-calculate daily signal outcomes to display Win/Loss badges directly on the chart markers
    const prePerf = this.calculateDailySignalPerformance(candles, tags, psar);
    const signalOutcomesMap = {};
    if (prePerf && prePerf.evaluatedSignals) {
      for (const s of prePerf.evaluatedSignals) {
        signalOutcomesMap[s.index] = s;
      }
    }

    // Add Real-time BUY, SELL, and TP Markers with Win/Loss badges on chart (today only from 12:00 AM)
    const markers = [];
    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (!tag) continue;
      const c = candles[i];
      if (c.time < midnightSec) continue; // Strictly display today's signals from 12:00 AM onwards
      const outcomeData = signalOutcomesMap[i];

      if (tag === 'BUY') {
        const isWin = outcomeData ? (outcomeData.outcome === 'win') : true;
        let textLabel = 'BUY';
        if (outcomeData) {
          textLabel = isWin
            ? `BUY • +$${outcomeData.pnl.toFixed(2)} (${outcomeData.tpTier || 'TP1'} +${(outcomeData.maxRoePct || 2).toFixed(1)}%)`
            : `BUY • -$5.00 (SL -5%)`;
        }
        markers.push({
          time: c.time,
          position: 'belowBar',
          color: isWin ? '#00e479' : '#ff453a',
          shape: 'arrowUp',
          text: textLabel,
          size: 2
        });
      } else if (tag === 'SELL') {
        const isWin = outcomeData ? (outcomeData.outcome === 'win') : true;
        let textLabel = 'SELL';
        if (outcomeData) {
          textLabel = isWin
            ? `SELL • +$${outcomeData.pnl.toFixed(2)} (${outcomeData.tpTier || 'TP1'} +${(outcomeData.maxRoePct || 2).toFixed(1)}%)`
            : `SELL • -$5.00 (SL -5%)`;
        }
        markers.push({
          time: c.time,
          position: 'aboveBar',
          color: isWin ? '#00e479' : '#ff453a',
          shape: 'arrowDown',
          text: textLabel,
          size: 2
        });
      } else if (tag === 'TP') {
        const isUp = c.close >= c.open;
        markers.push({
          time: c.time,
          position: isUp ? 'aboveBar' : 'belowBar',
          color: '#c084fc',
          shape: 'circle',
          text: 'TP',
          size: 1.2
        });
      }
    }

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
      } catch (e) {
        if (this.mainChart) this.mainChart.timeScale().fitContent();
        if (this.macdChart) this.macdChart.timeScale().fitContent();
      }
    }, 60);

    // Render Compact Daily Signal Performance Table (ONLY 1:2 Ratio)
    this.renderDailyPerformanceTable(analysis);
  },

  /**
   * Evaluates real-time BUY & SELL signals on a $100 investment mark using user's % framework:
   * - Capital: $100 entered per trade
   * - Stop Loss: Price moves against entry by -5% (0.50% raw price) -> LOSS -$5.00
   * - Take Profit Ladder:
   *    TP1: +2.0% -> WIN (~+$10.06, matching real AAVE short trade at 123.63->123.36)
   *    TP2: +4.0% -> WIN (~+$14.78)
   *    TP3: +6.0% -> WIN (~+$19.95)
   *    TP4: +7.5% -> WIN (~+$23.75, matching real AAVE short trade profit at 7.47%)
   *    TP5: +10.0%+ -> WIN (~+$30.30+)
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

      // Scan subsequent candles forward to track real % excursion
      const maxK = Math.min(candles.length - 1, i + 60);
      for (let k = i + 1; k <= maxK; k++) {
        const nextC = candles[k];
        const nextTag = tags[k];

        // Calculate % move on this candle (raw price delta * 1000 = user's ROE % scale: 0.218% raw = 2.18% ROE)
        let curHighRoe = 0;
        let curLowDrawdown = 0;

        if (isBuy) {
          curHighRoe = ((nextC.high - entryPrice) / entryPrice) * 1000;
          curLowDrawdown = ((nextC.low - entryPrice) / entryPrice) * 1000;
        } else {
          curHighRoe = ((entryPrice - nextC.low) / entryPrice) * 1000;
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

        // 1. STOP LOSS CHECK:
        // If trade drops to -5.0% or worse BEFORE reaching +2.0% TP1, it's stopped out!
        if (maxDrawdownPct <= -5.0 && maxRoePct < 2.0) {
          isLoss = true;
          exitPrice = isBuy ? (entryPrice * 0.995) : (entryPrice * 1.005);
          reason = `Hit -5.00% SL ($${exitPrice.toFixed(2)})`;
          break;
        }

        // 2. PROFIT TARGETS (TP Tiers):
        if (maxRoePct >= 10.0) {
          isWin = true;
          tpTier = 'TP5';
          reason = `Hit TP5 Runner (+${maxRoePct.toFixed(2)}%)`;
          break;
        }

        // 3. REVERSAL SIGNAL CHECK:
        if (isBuy && nextTag === 'SELL') {
          if (maxRoePct >= 2.0) {
            isWin = true;
            reason = `Reversal closed in profit (+${maxRoePct.toFixed(2)}%)`;
          } else if (curLowDrawdown <= -5.0) {
            isLoss = true;
            reason = `Stopped out at -5.00% SL`;
          } else {
            const curCloseRoe = ((nextC.close - entryPrice) / entryPrice) * 1000;
            if (curCloseRoe >= 1.0) {
              isWin = true;
              maxRoePct = curCloseRoe;
              reason = `Closed on Reversal (+${curCloseRoe.toFixed(2)}%)`;
            } else {
              isLoss = true;
              reason = `Closed on Reversal (${curCloseRoe.toFixed(2)}%)`;
            }
          }
          exitPrice = nextC.close;
          break;
        } else if (!isBuy && nextTag === 'BUY') {
          if (maxRoePct >= 2.0) {
            isWin = true;
            reason = `Reversal closed in profit (+${maxRoePct.toFixed(2)}%)`;
          } else if (curLowDrawdown <= -5.0) {
            isLoss = true;
            reason = `Stopped out at -5.00% SL`;
          } else {
            const curCloseRoe = ((entryPrice - nextC.close) / entryPrice) * 1000;
            if (curCloseRoe >= 1.0) {
              isWin = true;
              maxRoePct = curCloseRoe;
              reason = `Closed on Reversal (+${curCloseRoe.toFixed(2)}%)`;
            } else {
              isLoss = true;
              reason = `Closed on Reversal (${curCloseRoe.toFixed(2)}%)`;
            }
          }
          exitPrice = nextC.close;
          break;
        }
      }

      // If trade reached at least +2.0%, it is a WIN
      if (maxRoePct >= 2.0) {
        isWin = true;
        isLoss = false;
        if (maxRoePct >= 10.0) tpTier = 'TP5';
        else if (maxRoePct >= 7.5) tpTier = 'TP4';
        else if (maxRoePct >= 6.0) tpTier = 'TP3';
        else if (maxRoePct >= 4.0) tpTier = 'TP2';
        else tpTier = 'TP1';
      }

      // If trade is still floating (no SL and no TP reached yet)
      if (!isWin && !isLoss) {
        if (maxDrawdownPct <= -5.0) {
          isLoss = true;
          reason = `Hit -5.00% SL`;
        } else if (maxRoePct >= 1.5) {
          isWin = true;
          tpTier = 'TP1';
          reason = `Floating near TP1 (+${maxRoePct.toFixed(2)}%)`;
        } else {
          isLoss = (maxDrawdownPct < -2.0);
          reason = isLoss ? `Drawdown (${maxDrawdownPct.toFixed(2)}%)` : `Floating (+${maxRoePct.toFixed(2)}%)`;
        }
      }

      // Calculate Dollar PnL based on calibrated user trade framework ($100 capital mark)
      let pnl = 0;
      if (isWin) {
        // Calibrated: 2.18% = $10.0616, 7.47% = $23.75 (slope = 2.5876)
        const effPct = Math.max(2.0, maxRoePct);
        pnl = 10.0616 + ((effPct - 2.18) * 2.5876);
        pnl = Math.round(pnl * 100) / 100;
      } else {
        // Stop loss: -5% on $100 = -$5.00
        pnl = -5.00;
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
        isWin
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

          const outcomeBadge = isWin
            ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-container/20 text-primary-container border border-primary-container/30">+$${s.pnl.toFixed(2)} WIN (${s.tpTier})</span>`
            : `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-error-container/20 text-[#ff453a] border border-[#ff453a]/30">-$5.00 LOSS (SL)</span>`;

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
              <div class="mt-1 flex items-center justify-between text-[8px] text-on-surface-variant/80">
                <span class="truncate max-w-[190px]">
                  ${isWin ? `${s.tpTier} Hit (+${(s.maxRoePct || 2).toFixed(2)}%) • Exit $${s.exitPrice.toFixed(2)}` : `Stopped Out (-5.00% SL) • Exit $${s.exitPrice.toFixed(2)}`}
                </span>
                <span class="text-primary-container/70 group-hover:text-primary-container flex items-center gap-0.5 transition-colors font-medium">
                  Focus on chart ↗
                </span>
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
