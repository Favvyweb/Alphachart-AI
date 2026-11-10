/**
 * Scanner Module
 * Controls file upload, drag-and-drop, camera snapshot modal, scanning HUD laser animation,
 * and rendering real-time technical analysis results calibrated to exact chart picture data.
 */

window.ScannerModule = {
  currentStream: null,
  activeChartImage: null,
  lastAnalysisData: null,
  fullChartPair: 'BTC / USDT',
  fullChartInterval: '5',

  init: function () {
    this.bindEvents();
  },

  bindEvents: function () {
    const self = this;

    // Home screen primary action buttons
    const analyzeBtn = document.getElementById('analyze-chart-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => self.openModal());
    }

    // Modal close button & backdrop
    const modalClose = document.getElementById('modal-close-btn');
    const modalBackdrop = document.getElementById('scanner-modal-backdrop');
    if (modalClose) modalClose.addEventListener('click', () => self.closeModal());
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) self.closeModal();
      });
    }

    // Modal Tab Buttons (Upload vs Camera)
    const tabUpload = document.getElementById('tab-upload-btn');
    const tabCamera = document.getElementById('tab-camera-btn');
    if (tabUpload) tabUpload.addEventListener('click', () => self.switchTab('upload'));
    if (tabCamera) tabCamera.addEventListener('click', () => self.switchTab('camera'));

    // File input & Drag and Drop zone
    const fileInput = document.getElementById('chart-file-input');
    const dropzone = document.getElementById('chart-dropzone');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          self.handleFileSelect(e.target.files[0]);
        }
      });
    }

    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-primary-container', 'bg-primary-container/10');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-primary-container', 'bg-primary-container/10');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-primary-container', 'bg-primary-container/10');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          self.handleFileSelect(e.dataTransfer.files[0]);
        }
      });
      dropzone.addEventListener('click', () => {
        if (fileInput) fileInput.click();
      });
    }

    // Camera Snap Button
    const snapBtn = document.getElementById('camera-snap-btn');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => self.takeCameraSnapshot());
    }

    // Re-scan button on results page
    const rescanBtn = document.getElementById('rescan-chart-btn');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', () => self.openModal());
    }

    // Dynamic Direction Switcher (LONG vs SHORT)
    const btnDirLong = document.getElementById('btn-dir-long');
    const btnDirShort = document.getElementById('btn-dir-short');

    if (btnDirLong) {
      btnDirLong.addEventListener('click', () => {
        self.recalculateWithParameters(true);
      });
    }
    if (btnDirShort) {
      btnDirShort.addEventListener('click', () => {
        self.recalculateWithParameters(false);
      });
    }

    // Dynamic Coin Ticker Input
    const coinInput = document.getElementById('res-coin-input');
    if (coinInput) {
      coinInput.addEventListener('change', (e) => {
        if (self.lastAnalysisData) {
          self.lastAnalysisData.pair = e.target.value.toUpperCase();
          self.renderAnalysisResults(self.lastAnalysisData, self.activeChartImage);
        }
      });
    }

    // Inline Entry Price Input
    const priceInput = document.getElementById('res-price-input');
    if (priceInput) {
      priceInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0 && self.lastAnalysisData) {
          const isBull = self.lastAnalysisData.signal === 'LONG';
          const newAnalysis = window.AIEngine.calculateAnalysis(
            self.lastAnalysisData.pair,
            self.lastAnalysisData.market,
            val,
            isBull
          );
          self.lastAnalysisData = newAnalysis;
          self.renderAnalysisResults(newAnalysis, self.activeChartImage);
          if (window.App) window.App.showToast(`Calibrated targets to exact entry price ${newAnalysis.entry}`);
        }
      });
    }

    // Log to Journal button - opens manual log setup modal pre-filled with scanned data
    const saveJournalBtn = document.getElementById('save-journal-btn');
    if (saveJournalBtn) {
      saveJournalBtn.addEventListener('click', () => {
        if (window.JournalModule) {
          window.JournalModule.openManualLogModal(self.lastAnalysisData);
        }
      });
    }

    // View Full Chart button - opens full real-time interactive chart modal
    const viewFullChartBtn = document.getElementById('view-full-chart-btn');
    if (viewFullChartBtn) {
      viewFullChartBtn.addEventListener('click', () => self.openFullChartModal());
    }

    // Full Chart Modal close & backdrop
    const fullChartClose = document.getElementById('full-chart-close-btn');
    const fullChartBackdrop = document.getElementById('full-chart-backdrop');
    if (fullChartClose) {
      fullChartClose.addEventListener('click', () => self.closeFullChartModal());
    }
    if (fullChartBackdrop) {
      fullChartBackdrop.addEventListener('click', (e) => {
        if (e.target === fullChartBackdrop) self.closeFullChartModal();
      });
    }

    // Timeframe buttons (Strictly 5min and 1 hour)
    const tf5mBtn = document.getElementById('full-chart-tf-5m');
    const tf1hBtn = document.getElementById('full-chart-tf-1h');
    if (tf5mBtn) {
      tf5mBtn.addEventListener('click', () => self.setFullChartTimeframe('5'));
    }
    if (tf1hBtn) {
      tf1hBtn.addEventListener('click', () => self.setFullChartTimeframe('60'));
    }

    // Escape key listener for closing modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        self.closeFullChartModal();
      }
    });
  },

  recalculateWithParameters: function (isBullish) {
    if (!this.lastAnalysisData) return;
    const coinInput = document.getElementById('res-coin-input');
    const priceInput = document.getElementById('res-price-input');

    const pair = coinInput && coinInput.value ? coinInput.value.toUpperCase() : this.lastAnalysisData.pair;
    const rawPrice = priceInput && priceInput.value ? parseFloat(priceInput.value) : this.lastAnalysisData.rawEntry;

    const newAnalysis = window.AIEngine.calculateAnalysis(
      pair || 'UNKNOWN / CHART',
      this.lastAnalysisData.market || 'CRYPTO',
      rawPrice || null,
      isBullish
    );

    this.lastAnalysisData = newAnalysis;
    this.renderAnalysisResults(newAnalysis, this.activeChartImage);
  },

  openModal: function () {
    const modal = document.getElementById('scanner-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  },

  closeModal: function () {
    const modal = document.getElementById('scanner-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.stopCameraStream();
  },

  switchTab: function (tabName) {
    const tabUpload = document.getElementById('tab-upload-btn');
    const tabCamera = document.getElementById('tab-camera-btn');
    const viewUpload = document.getElementById('modal-view-upload');
    const viewCamera = document.getElementById('modal-view-camera');

    if (tabName === 'upload') {
      tabUpload.className = 'flex-1 py-2.5 font-semibold text-primary-container border-b-2 border-primary-container transition-all';
      tabCamera.className = 'flex-1 py-2.5 font-medium text-on-surface-variant hover:text-white transition-all';
      viewUpload.classList.remove('hidden');
      viewCamera.classList.add('hidden');
      this.stopCameraStream();
    } else {
      tabCamera.className = 'flex-1 py-2.5 font-semibold text-primary-container border-b-2 border-primary-container transition-all';
      tabUpload.className = 'flex-1 py-2.5 font-medium text-on-surface-variant hover:text-white transition-all';
      viewCamera.classList.remove('hidden');
      viewUpload.classList.add('hidden');
      this.startCameraStream();
    }
  },

  startCameraStream: async function () {
    const video = document.getElementById('camera-video');
    if (!video) return;

    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = this.currentStream;
      video.play();
    } catch (err) {
      console.warn('Camera access error or unsupported:', err);
      const camStatus = document.getElementById('camera-status-msg');
      if (camStatus) {
        camStatus.innerText = 'Unable to access device camera. Please upload an image file instead.';
        camStatus.classList.add('text-error');
      }
    }
  },

  stopCameraStream: function () {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
  },

  takeCameraSnapshot: function () {
    const video = document.getElementById('camera-video');
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    this.closeModal();
    this.startScanningProcess(dataUrl, { name: 'realtime_camera_snapshot.png' });
  },

  handleFileSelect: function (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.closeModal();
      this.startScanningProcess(e.target.result, file);
    };
    reader.readAsDataURL(file);
  },

  startScanningProcess: async function (imageSrc, fileMeta) {
    const emptyState = document.getElementById('home-empty-state');
    const scanningView = document.getElementById('home-scanning-view');
    const resultView = document.getElementById('home-result-view');
    const scanImg = document.getElementById('scanning-chart-img');
    const scanStatusText = document.getElementById('scanning-status-text');

    if (emptyState) emptyState.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    if (scanningView) scanningView.classList.remove('hidden');
    if (scanImg) scanImg.src = imageSrc;

    // Run AI Engine step-by-step
    const analysisData = await window.AIEngine.analyzeChart(fileMeta || imageSrc, (statusMsg) => {
      if (scanStatusText) scanStatusText.innerText = statusMsg;
    });

    this.lastAnalysisData = analysisData;
    this.activeChartImage = imageSrc;

    // Hide scanning animation and render full Technical Analysis results
    if (scanningView) scanningView.classList.add('hidden');
    if (resultView) resultView.classList.remove('hidden');

    this.renderAnalysisResults(analysisData, imageSrc);

    if (window.App) {
      if (analysisData.isPriceUnreadable) {
        window.App.showToast('⚠️ Could not read price. Type exact price below.');
      } else if (analysisData.pair === 'UNKNOWN / CHART') {
        window.App.showToast('Please confirm or adjust Ticker & Price if needed');
      } else {
        window.App.showToast(`Scanned ${analysisData.pair} @ ${analysisData.entry}`);
      }
    }
  },

  renderAnalysisResults: function (data, imageSrc) {
    const resultImg = document.getElementById('result-chart-img');
    const overlayCanvas = document.getElementById('result-chart-canvas');

    if (resultImg) {
      resultImg.src = imageSrc;
      resultImg.onload = () => {
        if (overlayCanvas && window.ChartOverlay) {
          window.ChartOverlay.render(overlayCanvas, resultImg, data);
        }
      };
    }

    // Single AI Signal Badge (LONG vs SHORT) & Toggle Button Sync
    const signalBadge = document.getElementById('res-signal-badge');
    const signalIcon = document.getElementById('res-signal-icon');
    const signalText = document.getElementById('res-signal-text');
    const btnDirLong = document.getElementById('btn-dir-long');
    const btnDirShort = document.getElementById('btn-dir-short');

    if (data.signal === 'LONG') {
      if (signalBadge) signalBadge.className = 'px-3 py-1.5 rounded-xl bg-primary-container/20 border border-primary-container/40 flex items-center gap-1.5 shadow-lg';
      if (signalIcon) {
        signalIcon.innerText = 'trending_up';
        signalIcon.className = 'material-symbols-outlined text-primary-container text-[18px]';
      }
      if (signalText) {
        signalText.innerText = 'LONG (BULLISH)';
        signalText.className = 'font-display font-extrabold text-xs text-primary-container uppercase tracking-wider';
      }
      if (btnDirLong) btnDirLong.className = 'px-2.5 py-1 rounded-lg transition-all bg-primary-container text-black font-bold';
      if (btnDirShort) btnDirShort.className = 'px-2.5 py-1 rounded-lg transition-all text-on-surface-variant hover:text-white font-medium';
    } else {
      if (signalBadge) signalBadge.className = 'px-3 py-1.5 rounded-xl bg-error/20 border border-error/40 flex items-center gap-1.5 shadow-lg';
      if (signalIcon) {
        signalIcon.innerText = 'trending_down';
        signalIcon.className = 'material-symbols-outlined text-error text-[18px]';
      }
      if (signalText) {
        signalText.innerText = 'SHORT (BEARISH)';
        signalText.className = 'font-display font-extrabold text-xs text-error uppercase tracking-wider';
      }
      if (btnDirLong) btnDirLong.className = 'px-2.5 py-1 rounded-lg transition-all text-on-surface-variant hover:text-white font-medium';
      if (btnDirShort) btnDirShort.className = 'px-2.5 py-1 rounded-lg transition-all bg-error text-white font-bold';
    }

    // Coin Input & Price Input
    const coinInput = document.getElementById('res-coin-input');
    const priceInput = document.getElementById('res-price-input');
    const confidenceText = document.getElementById('res-confidence-text');
    const timeframeText = document.getElementById('res-timeframe-text');

    if (coinInput) coinInput.value = data.pair;
    if (priceInput) {
      if (data.isPriceUnreadable || !data.rawEntry || data.rawEntry <= 0) {
        priceInput.value = '';
        priceInput.placeholder = 'Enter exact price from image...';
        priceInput.className = 'w-full bg-black text-amber-300 font-mono font-bold text-base border-2 border-amber-400 bg-amber-400/10 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-300 animate-pulse';
      } else {
        priceInput.value = data.rawEntry;
        priceInput.placeholder = 'Chart Price';
        priceInput.className = 'w-full bg-black text-[#38bdf8] font-mono font-bold text-base border border-white/10 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#38bdf8]';
      }
    }
    if (confidenceText) confidenceText.innerText = `${data.confidence}% Confluence`;
    if (timeframeText) timeframeText.innerText = `${data.market} • ${data.timeframe}`;

    // Entry Execution Recommendation Action Card (Sleek Minimal Design with 1-Sentence Rationale)
    const execTitle = document.getElementById('res-exec-title');
    const execBadge = document.getElementById('res-exec-badge');
    const execCard = document.getElementById('res-exec-card');
    const execReason = document.getElementById('res-exec-reason');

    if (data.execution) {
      if (execTitle) {
        execTitle.innerText = data.execution.title;
        execTitle.className = data.execution.isScalpNow
          ? 'font-display font-extrabold text-base text-primary-container mt-0.5'
          : 'font-display font-extrabold text-base text-[#38bdf8] mt-0.5';
      }
      if (execBadge) {
        execBadge.innerText = data.execution.badgeText;
        execBadge.className = data.execution.isScalpNow
          ? 'px-3 py-1.5 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-primary-container text-black shadow-md shrink-0'
          : 'px-3 py-1.5 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-[#38bdf8] text-black shadow-md shrink-0';
      }
      if (execReason && data.execution.reason) {
        execReason.innerText = data.execution.reason;
      }
      if (execCard) {
        execCard.className = data.execution.isScalpNow
          ? 'bg-surface-container-low border border-primary-container/30 rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg'
          : 'bg-surface-container-low border border-[#38bdf8]/30 rounded-2xl p-4 flex flex-col gap-2.5 shadow-lg';
      }
    }

    // Price Target Values
    const elEntry = document.getElementById('res-entry-val');
    const elSL = document.getElementById('res-sl-val');
    const elTP1 = document.getElementById('res-tp1-val');
    const elTP2 = document.getElementById('res-tp2-val');
    const elTP3 = document.getElementById('res-tp3-val');
    const elRR = document.getElementById('res-rr-val');

    if (elEntry) elEntry.innerText = data.entry;
    if (elSL) elSL.innerText = data.sl;
    if (elTP1) elTP1.innerText = data.tp1;
    if (elTP2) elTP2.innerText = data.tp2;
    if (elTP3) elTP3.innerText = data.tp3;
    if (elRR) elRR.innerText = data.riskReward;

    // Technical Metrics Breakdown
    const elTrend = document.getElementById('res-trend-val');
    const elMomentum = document.getElementById('res-momentum-val');
    const elSupport = document.getElementById('res-support-val');
    const elResistance = document.getElementById('res-resistance-val');
    const elPattern = document.getElementById('res-pattern-val');
    const elSummary = document.getElementById('res-summary-val');

    if (elTrend) elTrend.innerText = data.trend;
    if (elMomentum) elMomentum.innerText = data.momentum;
    if (elSupport) elSupport.innerText = data.support;
    if (elResistance) elResistance.innerText = data.resistance;
    if (elPattern) elPattern.innerText = data.pattern;
    if (elSummary) elSummary.innerText = data.summary;

    // Real-Time Fundamental Market Catalysts News List
    const newsContainer = document.getElementById('res-news-list');
    if (newsContainer && data.news && Array.isArray(data.news)) {
      newsContainer.innerHTML = data.news.slice(0, 3).map(item => `
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" 
           class="p-3 bg-black/50 border border-white/10 hover:border-primary-container/40 rounded-xl flex items-start justify-between gap-3 transition-all hover:bg-surface-container-high group">
          <div class="flex-1 min-w-0">
            <p class="font-body-md text-xs text-white font-medium leading-snug line-clamp-2 group-hover:text-primary-container transition-colors">
              ${item.headline}
            </p>
            <div class="flex items-center gap-2 mt-1.5 text-[10px] text-on-surface-variant opacity-80">
              <span class="font-semibold text-white/90">${item.source}</span>
              <span>•</span>
              <span>${item.time}</span>
              <span class="material-symbols-outlined text-[12px] text-primary-container ml-auto group-hover:translate-x-0.5 transition-transform">open_in_new</span>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-extrabold shrink-0 ${item.sentiment === 'Bullish' ? 'bg-primary-container/20 text-primary-container border border-primary-container/30' : 'bg-error/20 text-error border border-error/30'}">
            ${item.sentiment}
          </span>
        </a>
      `).join('');
    }
  },

  /**
   * Open full real-time interactive chart modal
   */
  openFullChartModal: function (customPair) {
    const coinInput = document.getElementById('res-coin-input');
    const pair = customPair || (coinInput && coinInput.value ? coinInput.value.trim() : null) || (this.lastAnalysisData ? this.lastAnalysisData.pair : null) || 'BTC / USDT';
    this.fullChartPair = pair;
    if (!this.fullChartInterval) this.fullChartInterval = '5';

    const modal = document.getElementById('full-chart-modal');
    const coinTitle = document.getElementById('full-chart-coin-title');
    const priceDisplay = document.getElementById('full-chart-price-display');

    if (coinTitle) coinTitle.innerText = pair;
    if (priceDisplay) {
      priceDisplay.innerText = `Real-time ${this.fullChartInterval === '5' ? '5-Minute' : '1-Hour'} Candles`;
    }

    this.updateTimeframeButtonsUI(this.fullChartInterval);

    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    this.renderFullChart(this.fullChartPair, this.fullChartInterval);
  },

  /**
   * Close full real-time interactive chart modal and clear iframe src
   */
  closeFullChartModal: function () {
    const modal = document.getElementById('full-chart-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    const iframe = document.getElementById('full-chart-iframe');
    if (iframe) {
      iframe.src = '';
    }
  },

  /**
   * Set chart timeframe strictly to 5min ('5') or 1 hour ('60')
   */
  setFullChartTimeframe: function (interval) {
    if (interval !== '5' && interval !== '60') return;
    this.fullChartInterval = interval;
    this.updateTimeframeButtonsUI(interval);

    const priceDisplay = document.getElementById('full-chart-price-display');
    if (priceDisplay) {
      priceDisplay.innerText = `Real-time ${interval === '5' ? '5-Minute' : '1-Hour'} Candles`;
    }

    this.renderFullChart(this.fullChartPair, this.fullChartInterval);
  },

  /**
   * Update active button styling for timeframe toggles
   */
  updateTimeframeButtonsUI: function (interval) {
    const tf5mBtn = document.getElementById('full-chart-tf-5m');
    const tf1hBtn = document.getElementById('full-chart-tf-1h');
    const activeClasses = 'px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all bg-primary-container text-black shadow-sm';
    const inactiveClasses = 'px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all text-on-surface-variant hover:text-white';

    if (tf5mBtn) {
      tf5mBtn.className = interval === '5' ? activeClasses : inactiveClasses;
    }
    if (tf1hBtn) {
      tf1hBtn.className = interval === '60' ? activeClasses : inactiveClasses;
    }
  },

  /**
   * Map asset symbol to TradingView format
   */
  getTradingViewSymbol: function (pairName) {
    if (!pairName || typeof pairName !== 'string') return 'BINANCE:BTCUSDT';

    const raw = pairName.trim().toUpperCase().replace(/[\s\-_/]/g, '');

    // Gold / Commodities
    if (raw.includes('XAU') || raw.includes('GOLD')) {
      return 'OANDA:XAUUSD';
    }
    if (raw.includes('USOIL') || raw.includes('CRUDE') || raw.includes('WTI')) {
      return 'TVC:USOIL';
    }

    // Forex Pairs
    const forexPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];
    for (const fx of forexPairs) {
      if (raw.includes(fx)) {
        return `FX:${fx}`;
      }
    }

    // Crypto Pairs
    if (raw.endsWith('USDT') || raw.endsWith('USDC') || raw.endsWith('BUSD')) {
      return `BINANCE:${raw}`;
    }
    if (raw.endsWith('USD')) {
      const base = raw.replace(/USD$/, '');
      return `BINANCE:${base}USDT`;
    }

    // Default crypto base token (e.g. "ENA", "BTC", "SOL", "ETH") -> pair with USDT on Binance
    return `BINANCE:${raw}USDT`;
  },

  /**
   * Load real-time candlestick stream into TradingView embed iframe
   */
  renderFullChart: function (pairName, interval) {
    const iframe = document.getElementById('full-chart-iframe');
    const loader = document.getElementById('full-chart-loader');
    if (!iframe) return;

    if (loader) {
      loader.style.opacity = '1';
      loader.classList.remove('pointer-events-none');
    }

    iframe.onload = () => {
      if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
          loader.classList.add('pointer-events-none');
        }, 300);
      }
    };

    const tvSymbol = this.getTradingViewSymbol(pairName);
    const embedUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}&theme=dark&style=1&timezone=Etc%2FUTC&studies=[]&hide_top_toolbar=0&hide_legend=0&hide_side_toolbar=0&save_image=0&locale=en`;

    iframe.src = embedUrl;
  }
};
