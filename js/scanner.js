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
  fullChartMode: 'tv',
  currentTTRAnalysis: null,
  livePollTimer: null,
  currentTvSymbol: null,
  currentTvInterval: null,

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

    // Timeframe buttons (Strictly 5min, 15min and 1 hour)
    const tf5mBtn = document.getElementById('full-chart-tf-5m');
    const tf15mBtn = document.getElementById('full-chart-tf-15m');
    const tf1hBtn = document.getElementById('full-chart-tf-1h');
    if (tf5mBtn) {
      tf5mBtn.addEventListener('click', () => self.setFullChartTimeframe('5'));
    }
    if (tf15mBtn) {
      tf15mBtn.addEventListener('click', () => self.setFullChartTimeframe('15'));
    }
    if (tf1hBtn) {
      tf1hBtn.addEventListener('click', () => self.setFullChartTimeframe('60'));
    }

    // Chart Mode Tabs (Trend Trader vs TradingView)
    const tabTtr = document.getElementById('full-chart-tab-ttr');
    const tabTv = document.getElementById('full-chart-tab-tv');
    if (tabTtr) {
      tabTtr.addEventListener('click', () => self.setFullChartMode('ttr'));
    }
    if (tabTv) {
      tabTv.addEventListener('click', () => self.setFullChartMode('tv'));
    }

    // Phone / Signal Alert Action Buttons
    const toggleAlertsBtn = document.getElementById('btn-toggle-phone-alerts');
    const testAlertBtn = document.getElementById('btn-test-phone-alert');

    if (toggleAlertsBtn) {
      toggleAlertsBtn.addEventListener('click', () => self.togglePhoneAlerts());
    }
    if (testAlertBtn) {
      testAlertBtn.addEventListener('click', () => {
        if (window.TrendTraderAlerts) window.TrendTraderAlerts.testAlert();
      });
    }

    // Window Resize listener to keep TradingView chart sharp and auto-fitted
    window.addEventListener('resize', () => {
      const modal = document.getElementById('full-chart-modal');
      if (modal && !modal.classList.contains('hidden') && self.fullChartMode === 'ttr') {
        const mainBox = document.getElementById('tv-main-chart-container');
        const macdBox = document.getElementById('tv-macd-chart-container');
        if (window.TrendTraderEngine) {
          if (mainBox && window.TrendTraderEngine.mainChart) {
            window.TrendTraderEngine.mainChart.resize(mainBox.clientWidth, mainBox.clientHeight);
          }
          if (macdBox && window.TrendTraderEngine.macdChart) {
            window.TrendTraderEngine.macdChart.resize(macdBox.clientWidth, macdBox.clientHeight);
          }
        }
      }
    });

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
          ? 'px-3 py-1.5 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-primary-container text-black shadow-md shrink-0 whitespace-nowrap'
          : 'px-3 py-1.5 rounded-xl text-xs font-extrabold uppercase tracking-wider bg-[#38bdf8] text-black shadow-md shrink-0 whitespace-nowrap';
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

    // Top 5 Elite Quantitative Indicators Confluence List
    const eliteList = document.getElementById('res-elite-indicators-list');
    const eliteBadge = document.getElementById('res-elite-badge');

    if (data.eliteIndicators && Array.isArray(data.eliteIndicators)) {
      const bullCount = data.eliteIndicators.filter(i => i.isBullish).length;
      const bearCount = data.eliteIndicators.length - bullCount;
      const isLong = data.signal === 'LONG';
      const activeCount = isLong ? bullCount : bearCount;

      if (eliteBadge) {
        eliteBadge.innerText = `${activeCount} / 4 ${isLong ? 'Bullish' : 'Bearish'} Confluence`;
        eliteBadge.className = activeCount >= 3
          ? 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 whitespace-nowrap shrink-0'
          : 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 whitespace-nowrap shrink-0';
      }

      if (eliteList) {
        eliteList.innerHTML = data.eliteIndicators.map(ind => `
          <div class="p-2.5 rounded-xl bg-black/60 border border-white/5 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full ${ind.isBullish ? 'bg-primary-container' : 'bg-error'} shrink-0"></span>
              <div class="min-w-0">
                <p class="text-xs font-bold text-white truncate">${ind.name} <span class="text-[10px] text-on-surface-variant font-normal">(${ind.author})</span></p>
                <p class="text-[10px] text-on-surface-variant/80 font-mono truncate">${ind.detail}</p>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 whitespace-nowrap ${ind.isBullish ? 'bg-primary-container/15 text-primary-container border border-primary-container/20' : 'bg-error/15 text-error border border-error/20'}">
              ${ind.signal}
            </span>
          </div>
        `).join('');
      }
    }

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

    this.updatePhoneAlertsUI();
  },

  /**
   * Switch between native Trend Trader Engine and TradingView embed
   */
  setFullChartMode: function (mode) {
    this.fullChartMode = mode;
    this.updateModeTabsUI();
    this.renderFullChart(this.fullChartPair, this.fullChartInterval);
  },

  updateModeTabsUI: function () {
    const tabTtr = document.getElementById('full-chart-tab-ttr');
    const tabTv = document.getElementById('full-chart-tab-tv');
    const active = 'px-2.5 py-1.5 rounded-lg font-bold transition-all bg-primary-container text-black shadow-sm flex items-center gap-1';
    const inactive = 'px-2.5 py-1.5 rounded-lg font-bold transition-all text-on-surface-variant hover:text-white flex items-center gap-1';

    if (tabTtr) tabTtr.className = this.fullChartMode === 'ttr' ? active : inactive;
    if (tabTv) tabTv.className = this.fullChartMode === 'tv' ? active : inactive;
  },

  /**
   * Toggle Phone / Browser Signal Notifications
   */
  togglePhoneAlerts: async function () {
    if (!window.TrendTraderAlerts) return;
    const isCurrentlyEnabled = window.TrendTraderAlerts.isAlertsEnabled();

    if (isCurrentlyEnabled) {
      window.TrendTraderAlerts.setAlertsEnabled(false);
      this.updatePhoneAlertsUI();
      if (window.App) window.App.showToast('Phone Signal Alerts turned OFF');
    } else {
      const granted = await window.TrendTraderAlerts.requestPermission();
      this.updatePhoneAlertsUI();
      if (granted && window.App) {
        window.App.showToast('🔔 Phone Signal Alerts turned ON with Sound & Vibration!');
      }
    }
  },

  updatePhoneAlertsUI: function () {
    const isEnabled = window.TrendTraderAlerts ? window.TrendTraderAlerts.isAlertsEnabled() : false;
    const statusLabel = document.getElementById('phone-alerts-status-label');
    const toggleBtn = document.getElementById('btn-toggle-phone-alerts');

    if (statusLabel) {
      statusLabel.innerText = isEnabled ? 'Phone Alerts: ACTIVE 🔔' : 'Phone Alerts: OFF';
    }
    if (toggleBtn) {
      toggleBtn.className = isEnabled
        ? 'px-3 py-1 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-1.5 bg-primary-container/20 border-primary-container text-primary-container shadow-[0_0_12px_rgba(0,255,136,0.3)]'
        : 'px-3 py-1 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-1.5 bg-black/60 border-white/10 text-on-surface-variant hover:border-primary-container hover:text-white';
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
    if (!this.fullChartMode) this.fullChartMode = 'tv';

    const modal = document.getElementById('full-chart-modal');
    const coinTitle = document.getElementById('full-chart-coin-title');
    const priceDisplay = document.getElementById('full-chart-price-display');

    if (coinTitle) coinTitle.innerText = pair;
    if (priceDisplay) {
      const tfLabel = this.fullChartInterval === '5' ? '5-Minute' : this.fullChartInterval === '15' ? '15-Minute' : '1-Hour';
      priceDisplay.innerText = `Real-time ${tfLabel} Candles • Live Streaming`;
    }

    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    // Render chart without any continuous reloading loop
    this.renderFullChart(this.fullChartPair, this.fullChartInterval);
  },

  /**
   * Close full real-time interactive chart modal
   */
  closeFullChartModal: function () {
    const modal = document.getElementById('full-chart-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    if (this.livePollTimer) {
      clearInterval(this.livePollTimer);
      this.livePollTimer = null;
    }
  },

  /**
   * Set chart timeframe to 5min ('5'), 15min ('15'), or 1 hour ('60')
   */
  setFullChartTimeframe: function (interval) {
    if (interval !== '5' && interval !== '15' && interval !== '60') return;
    this.fullChartInterval = interval;
    this.updateTimeframeButtonsUI(interval);

    const priceDisplay = document.getElementById('full-chart-price-display');
    if (priceDisplay) {
      const tfLabel = interval === '5' ? '5-Minute' : interval === '15' ? '15-Minute' : '1-Hour';
      priceDisplay.innerText = `Real-time ${tfLabel} Candles & Signals`;
    }

    this.renderFullChart(this.fullChartPair, this.fullChartInterval);
  },

  /**
   * Update active button styling for timeframe toggles (5min, 15min, 1h)
   */
  updateTimeframeButtonsUI: function (interval) {
    const tf5mBtn = document.getElementById('full-chart-tf-5m');
    const tf15mBtn = document.getElementById('full-chart-tf-15m');
    const tf1hBtn = document.getElementById('full-chart-tf-1h');
    const activeClasses = 'px-2.5 py-1.5 rounded-lg text-xs font-extrabold transition-all bg-primary-container text-black shadow-sm';
    const inactiveClasses = 'px-2.5 py-1.5 rounded-lg text-xs font-extrabold transition-all text-on-surface-variant hover:text-white';

    if (tf5mBtn) {
      tf5mBtn.className = interval === '5' ? activeClasses : inactiveClasses;
    }
    if (tf15mBtn) {
      tf15mBtn.className = interval === '15' ? activeClasses : inactiveClasses;
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
   * Render either the native Trend Trader Engine Canvas or TradingView embed
   */
  renderFullChart: async function (pairName, interval) {
    const pair = pairName || this.fullChartPair || 'BTC / USDT';
    const intv = interval || this.fullChartInterval || '5';
    this.fullChartPair = pair;
    this.fullChartInterval = intv;

    this.updateTimeframeButtonsUI(intv);
    this.updateModeTabsUI();
    this.updatePhoneAlertsUI();

    const viewTTR = document.getElementById('view-ttr-engine');
    const viewTV = document.getElementById('view-tv-embed');
    const loader = document.getElementById('full-chart-loader');

    if (this.fullChartMode === 'ttr') {
      if (viewTTR) viewTTR.classList.remove('hidden');
      if (viewTV) viewTV.classList.add('hidden');
      if (loader) {
        loader.style.opacity = '1';
        loader.classList.remove('pointer-events-none');
      }

      const mainContainer = document.getElementById('tv-main-chart-container');
      const macdContainer = document.getElementById('tv-macd-chart-container');
      let tfCode = '5m';
      if (intv === '60') tfCode = '1h';
      else if (intv === '15') tfCode = '15m';
      else tfCode = '5m';

      try {
        const candles = await window.TrendTraderEngine.fetchCandles(pair, tfCode);
        const analysis = window.TrendTraderEngine.analyzeCandles(candles);
        this.currentTTRAnalysis = analysis;

        if (mainContainer && macdContainer && window.TrendTraderEngine && window.TrendTraderEngine.renderLightweightChart) {
          window.TrendTraderEngine.renderLightweightChart(mainContainer, macdContainer, analysis);
        }

        // Determine latest signal from analysis
        let latestTag = null;
        let latestTagIndex = -1;
        for (let i = analysis.tags.length - 1; i >= 0; i--) {
          if (analysis.tags[i]) {
            latestTag = analysis.tags[i];
            latestTagIndex = i;
            break;
          }
        }

        const statusBadge = document.getElementById('ttr-signal-status-badge');
        const statusText = document.getElementById('ttr-signal-status-text');
        const macdStatus = document.getElementById('ttr-macd-status-text');

        const lastM = analysis.macd.macdLine[analysis.macd.macdLine.length - 1] || 0;
        const lastS = analysis.macd.signalLine[analysis.macd.signalLine.length - 1] || 0;
        const isBullishMacd = lastM >= lastS;

        if (latestTag === 'BUY') {
          if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-primary-container/20 border border-primary-container/50 text-primary-container font-bold text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,255,136,0.3)]';
          if (statusText) statusText.innerText = `🟢 Trend Trader: BUY Tag Confirmed ($${candles[latestTagIndex].close.toFixed(2)})`;
        } else if (latestTag === 'SELL') {
          if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-error/20 border border-error/50 text-error font-bold text-[11px] flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,51,102,0.3)]';
          if (statusText) statusText.innerText = `🔴 Trend Trader: SELL Tag Confirmed ($${candles[latestTagIndex].close.toFixed(2)})`;
        } else if (latestTag === 'TP') {
          if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-purple-500/20 border border-purple-500/50 text-purple-300 font-bold text-[11px] flex items-center gap-1.5';
          if (statusText) statusText.innerText = `🟣 Take Profit (TP) Level Hit ($${candles[latestTagIndex].close.toFixed(2)})`;
        } else {
          if (statusBadge) statusBadge.className = 'px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-on-surface-variant font-bold text-[11px] flex items-center gap-1.5';
          if (statusText) statusText.innerText = `⚪ Trend Trader: Scanning Active Candles...`;
        }

        if (macdStatus) {
          macdStatus.innerText = `MACD: ${lastM.toFixed(2)} / ${lastS.toFixed(2)} • ${isBullishMacd ? 'Bullish Expansion' : 'Bearish Pressure'}`;
        }

      } catch (err) {
        console.warn('Error in TTR render:', err);
      } finally {
        if (loader) {
          loader.style.opacity = '0';
          setTimeout(() => loader.classList.add('pointer-events-none'), 300);
        }
      }

    } else {
      // FULL TRADINGVIEW TOOLS & INTERFACE MODE (Native Realtime WebSockets - ZERO Reloads)
      if (viewTTR) viewTTR.classList.add('hidden');
      if (viewTV) viewTV.classList.remove('hidden');

      const tvContainer = document.getElementById('full-chart-tv-container');
      if (!tvContainer) return;

      const tvSymbol = this.getTradingViewSymbol(pair);

      // Check if already initialized with this symbol and interval to prevent ANY reloads!
      if (this.currentTvSymbol === tvSymbol && this.currentTvInterval === intv && tvContainer.children.length > 0) {
        if (loader) {
          loader.style.opacity = '0';
          loader.classList.add('pointer-events-none');
        }
        return;
      }

      this.currentTvSymbol = tvSymbol;
      this.currentTvInterval = intv;

      tvContainer.innerHTML = '';

      if (window.TradingView && window.TradingView.widget) {
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: intv,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1", // Japanese Candlesticks
          locale: "en",
          toolbar_bg: "#080a0f",
          enable_publishing: false,
          hide_top_toolbar: false, // Full Top Toolbar: Timeframes, Indicators (fx), Settings, Fullscreen
          hide_side_toolbar: false, // Full Left Drawing Toolbar: Lines, Fibs, Text, Ruler, Brush, etc.
          allow_symbol_change: true, // Search and switch any crypto or forex pair directly
          save_image: true,
          studies: [
            "MACD@tv-basicstudies",
            "MASimple@tv-basicstudies"
          ],
          show_popup_button: true,
          popup_width: "1000",
          popup_height: "650",
          withdateranges: true, // Bottom date range selectors (1D, 5D, 1M, 1Y, ALL)
          container_id: "full-chart-tv-container"
        });
      }

      // Hide loader quickly once widget initializes
      if (loader) {
        setTimeout(() => {
          loader.style.opacity = '0';
          loader.classList.add('pointer-events-none');
        }, 350);
      }
    }
  }
};
