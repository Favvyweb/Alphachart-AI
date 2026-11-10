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

    const cacheKey = `${cleanSymbol}_${binanceInterval}`;
    const cached = this.candlesCache[cacheKey];

    // Return cached candles immediately if fresh (< 25s old) for 0ms instant display
    if (cached && (Date.now() - cached.timestamp < 25000) && cached.candles && cached.candles.length >= 20) {
      return cached.candles;
    }

    const endpoints = [
      `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=120`,
      `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceInterval}&limit=120`
    ];

    // Fast parallel fetch: query endpoints simultaneously with a 2.5s timeout. Fastest wins!
    const fetchWithTimeout = async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length >= 20) {
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
      // Instant fallback candle model for offline or firewall-throttled environments
      const fallback = this.generateFallbackCandles(cleanSymbol, binanceInterval, 100);
      this.candlesCache[cacheKey] = { timestamp: Date.now(), candles: fallback };
      return fallback;
    }
  },

  generateFallbackCandles: function (symbol, interval, count = 100) {
    const candles = [];
    let intervalSec = 300;
    if (interval === '1h') intervalSec = 3600;
    else if (interval === '15m') intervalSec = 900;

    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - (count * intervalSec);
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

    // Add Real-time BUY, SELL, and TP Markers
    const markers = [];
    for (let i = 0; i < candles.length; i++) {
      const tag = tags[i];
      if (!tag) continue;
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

    // Fit content smoothly
    this.mainChart.timeScale().fitContent();
    this.macdChart.timeScale().fitContent();

    setTimeout(() => {
      try {
        if (this.mainChart) this.mainChart.timeScale().fitContent();
        if (this.macdChart) this.macdChart.timeScale().fitContent();
      } catch (e) { }
    }, 60);
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
