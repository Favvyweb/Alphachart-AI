/**
 * AlphaChart AI - TradingView-Style Universal Crypto Futures Search (NO SPOT)
 * Exclusively provides access to Binance USDⓈ-M Perpetual Futures contracts:
 * - Real Binance Futures klines & tickers (fapi.binance.com)
 * - Real-time Binance Futures WebSocket streaming (fstream.binance.com)
 * - TradingView Futures contract mapping (BINANCE:<SYMBOL>USDT.P)
 * - Sector category filters: All Futures, Hot, Layer 1, DeFi, Memes, AI & Data, Layer 2
 * - Live 24h prices and % changes from Binance Futures
 * - Favorites Management: Up to 7 favorites with static BTC anchor, star toggles in search, and double-tap removal
 * - Arrow key navigation & Enter key selection
 */

/**
 * Global Favorites Manager for Top Quick-Select Bar
 */
window.FavoritesManager = {
  STORAGE_KEY: 'alphachart_favorites',
  MAX_FAVORITES: 7,
  DEFAULT_FAVORITES: ['BTC', 'ETH', 'SOL', 'AAVE', 'XRP', 'DOGE'],
  lastTap: {},
  tapTimeout: null,

  getFavorites: function () {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          let cleaned = parsed.map(s => String(s).toUpperCase().trim()).filter(Boolean);
          // Purge non-existent coins (e.g. EVAA)
          cleaned = cleaned.filter(s => s !== 'EVAA');
          // BTC is the permanent anchor at position 0
          if (!cleaned.includes('BTC')) cleaned.unshift('BTC');
          else if (cleaned.indexOf('BTC') !== 0) {
            const idx = cleaned.indexOf('BTC');
            cleaned.splice(idx, 1);
            cleaned.unshift('BTC');
          }
          const res = cleaned.slice(0, this.MAX_FAVORITES);
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(res));
          return res;
        }
      }
    } catch (e) {
      console.warn('Failed to read favorites', e);
    }
    return [...this.DEFAULT_FAVORITES];
  },

  saveFavorites: function (favs) {
    try {
      if (!favs.includes('BTC')) favs.unshift('BTC');
      const capped = favs.slice(0, this.MAX_FAVORITES);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(capped));
    } catch (e) {
      console.warn('Failed to save favorites', e);
    }
  },

  isFavorite: function (sym) {
    if (!sym) return false;
    const clean = sym.toUpperCase().replace(/[\s\-_/]/g, '').replace(/USDT$/i, '').replace(/\.P$/i, '');
    return this.getFavorites().includes(clean);
  },

  addFavorite: function (sym) {
    if (!sym) return false;
    const clean = sym.toUpperCase().replace(/[\s\-_/]/g, '').replace(/USDT$/i, '').replace(/\.P$/i, '');
    const favs = this.getFavorites();
    if (favs.includes(clean)) return true;

    if (favs.length >= this.MAX_FAVORITES) {
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast(`Max ${this.MAX_FAVORITES} favorites reached. Double-tap a coin above to remove it.`);
      }
      return false;
    }

    favs.push(clean);
    this.saveFavorites(favs);
    this.renderTopFavoritesBar();
    if (window.SymbolSearchModule && window.SymbolSearchModule.isOpen) {
      window.SymbolSearchModule.renderResults();
    }
    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`Added ${clean} to Favorites ★`);
    }
    return true;
  },

  removeFavorite: function (sym) {
    if (!sym) return false;
    const clean = sym.toUpperCase().replace(/[\s\-_/]/g, '').replace(/USDT$/i, '').replace(/\.P$/i, '');
    if (clean === 'BTC') {
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast('BTC is a permanent favorite and cannot be removed');
      }
      return false;
    }

    let favs = this.getFavorites();
    favs = favs.filter(s => s !== clean);
    this.saveFavorites(favs);
    this.renderTopFavoritesBar();
    if (window.SymbolSearchModule && window.SymbolSearchModule.isOpen) {
      window.SymbolSearchModule.renderResults();
    }
    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`Removed ${clean} from Favorites`);
    }
    return true;
  },

  toggleFavorite: function (sym) {
    if (this.isFavorite(sym)) {
      return this.removeFavorite(sym);
    } else {
      return this.addFavorite(sym);
    }
  },

  renderTopFavoritesBar: function () {
    const bar = document.getElementById('chart-favorites-bar');
    if (!bar) return;

    const favs = this.getFavorites();
    const activePair = (window.ScannerModule && window.ScannerModule.fullChartPair) || 'BTC / USDT';
    const activeClean = activePair.replace(/[\s\-_/]/g, '').replace(/USDT$/i, '').replace(/\.P$/i, '').toUpperCase();

    let html = `
      <span class="text-[11px] font-mono text-amber-400 font-bold uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1 select-none">
        <span class="material-symbols-outlined text-[15px] text-amber-400">star</span> FAV:
      </span>
    `;

    favs.forEach(sym => {
      const isActive = sym === activeClean;
      const isBTC = sym === 'BTC';
      const activeClass = isActive
        ? 'bg-primary-container text-black border-primary-container font-extrabold'
        : 'bg-[#1c1c1e] hover:bg-[#2c2c2e] text-white border-white/10 font-bold';
      const tooltip = isBTC
        ? 'BTC (Permanent Favorite)'
        : `${sym} • Double-tap to remove`;

      html += `
        <button type="button"
          class="btn-chart-quick-coin px-2.5 py-1 rounded-lg text-xs font-mono ${activeClass} border shrink-0 transition-all active:scale-95 cursor-pointer select-none"
          data-pair="${sym} / USDT"
          data-sym="${sym}"
          title="${tooltip}">${sym}</button>
      `;
    });

    bar.innerHTML = html;
    this.bindPillEvents();
  },

  bindPillEvents: function () {
    const self = this;
    const bar = document.getElementById('chart-favorites-bar');
    if (!bar) return;

    bar.querySelectorAll('.btn-chart-quick-coin').forEach(btn => {
      const sym = btn.getAttribute('data-sym');
      const pair = btn.getAttribute('data-pair');

      // Desktop double-click
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(self.tapTimeout);
        self.removeFavorite(sym);
      });

      // Mobile touch / click double-tap handler (< 320ms)
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const now = Date.now();
        const lastTime = self.lastTap[sym] || 0;
        const timeDiff = now - lastTime;

        if (timeDiff > 0 && timeDiff < 320) {
          // Double-tap detected: cancel single-click switch and remove
          clearTimeout(self.tapTimeout);
          self.lastTap[sym] = 0;
          self.removeFavorite(sym);
        } else {
          // First tap
          self.lastTap[sym] = now;
          clearTimeout(self.tapTimeout);
          self.tapTimeout = setTimeout(() => {
            if (window.ScannerModule && typeof window.ScannerModule.switchFullChartCoin === 'function') {
              window.ScannerModule.switchFullChartCoin(pair);
            }
          }, 220);
        }
      });
    });
  }
};

window.SymbolSearchModule = {
  isOpen: false,
  activeCategory: 'all',
  searchQuery: '',
  selectedIndex: 0,
  filteredCoins: [],
  isFetchingBinance: false,

  // Curated comprehensive registry of top real crypto USDⓈ-M Perpetual Futures
  coins: [
    // Hot / Flagship Futures
    { sym: 'BTC', name: 'Bitcoin Perpetual', pair: 'BTC / USDT', cat: ['hot', 'l1'], price: 96500.0, change: 1.85 },
    { sym: 'ETH', name: 'Ethereum Perpetual', pair: 'ETH / USDT', cat: ['hot', 'l1'], price: 3620.0, change: 2.40 },
    { sym: 'SOL', name: 'Solana Perpetual', pair: 'SOL / USDT', cat: ['hot', 'l1'], price: 235.0, change: 4.15 },
    { sym: 'SUI', name: 'Sui Network Perpetual', pair: 'SUI / USDT', cat: ['hot', 'l1'], price: 3.42, change: 6.80 },
    { sym: 'NEAR', name: 'NEAR Protocol Perpetual', pair: 'NEAR / USDT', cat: ['hot', 'l1', 'ai'], price: 6.85, change: 5.20 },
    { sym: 'AAVE', name: 'Aave Perpetual', pair: 'AAVE / USDT', cat: ['hot', 'defi'], price: 195.40, change: 3.10 },
    { sym: 'BNB', name: 'Binance Coin Perpetual', pair: 'BNB / USDT', cat: ['hot', 'l1'], price: 652.0, change: 1.15 },
    { sym: 'XRP', name: 'Ripple Perpetual', pair: 'XRP / USDT', cat: ['hot', 'payments'], price: 1.48, change: 3.45 },
    { sym: 'DOGE', name: 'Dogecoin Perpetual', pair: 'DOGE / USDT', cat: ['hot', 'meme'], price: 0.412, change: 7.20 },
    { sym: 'AVAX', name: 'Avalanche Perpetual', pair: 'AVAX / USDT', cat: ['hot', 'l1'], price: 42.50, change: 2.80 },
    { sym: 'LINK', name: 'Chainlink Perpetual', pair: 'LINK / USDT', cat: ['hot', 'defi'], price: 18.40, change: 3.90 },
    { sym: 'PEPE', name: 'Pepe Perpetual', pair: 'PEPE / USDT', cat: ['hot', 'meme'], price: 0.00002135, change: 8.45 },
    { sym: 'SHIB', name: 'Shiba Inu Perpetual', pair: 'SHIB / USDT', cat: ['hot', 'meme'], price: 0.0000264, change: 4.30 },
    { sym: 'ADA', name: 'Cardano Perpetual', pair: 'ADA / USDT', cat: ['hot', 'l1'], price: 0.965, change: 2.10 },
    { sym: 'DOT', name: 'Polkadot Perpetual', pair: 'DOT / USDT', cat: ['l1'], price: 7.60, change: 1.95 },
    { sym: 'TIA', name: 'Celestia Perpetual', pair: 'TIA / USDT', cat: ['hot', 'l1', 'ai'], price: 5.40, change: 4.80 },
    { sym: 'INJ', name: 'Injective Perpetual', pair: 'INJ / USDT', cat: ['hot', 'defi', 'l1'], price: 23.10, change: 5.60 },
    { sym: 'APT', name: 'Aptos Perpetual', pair: 'APT / USDT', cat: ['hot', 'l1'], price: 12.40, change: 3.75 },
    { sym: 'RENDER', name: 'Render Perpetual', pair: 'RENDER / USDT', cat: ['hot', 'ai'], price: 8.65, change: 6.10 },
    { sym: 'FET', name: 'ASI Alliance Perpetual', pair: 'FET / USDT', cat: ['hot', 'ai'], price: 1.38, change: 4.90 },
    { sym: 'TAO', name: 'Bittensor Perpetual', pair: 'TAO / USDT', cat: ['hot', 'ai'], price: 524.0, change: 7.80 },
    { sym: 'KAS', name: 'Kaspa Perpetual', pair: 'KAS / USDT', cat: ['l1'], price: 0.165, change: 2.40 },
    { sym: 'SEI', name: 'Sei Network Perpetual', pair: 'SEI / USDT', cat: ['hot', 'l1'], price: 0.56, change: 4.25 },
    { sym: 'ARB', name: 'Arbitrum Perpetual', pair: 'ARB / USDT', cat: ['l2', 'defi'], price: 0.88, change: 2.10 },
    { sym: 'OP', name: 'Optimism Perpetual', pair: 'OP / USDT', cat: ['l2'], price: 2.15, change: 3.40 },
    { sym: 'TON', name: 'Toncoin Perpetual', pair: 'TON / USDT', cat: ['l1'], price: 6.45, change: 1.80 },
    { sym: 'WIF', name: 'dogwifhat Perpetual', pair: 'WIF / USDT', cat: ['hot', 'meme'], price: 3.25, change: 9.10 },
    { sym: 'BONK', name: 'Bonk Perpetual', pair: 'BONK / USDT', cat: ['meme'], price: 0.0000445, change: 6.70 },
    { sym: 'FLOKI', name: 'Floki Perpetual', pair: 'FLOKI / USDT', cat: ['meme'], price: 0.000234, change: 5.40 },
    { sym: 'POPCAT', name: 'Popcat Perpetual', pair: 'POPCAT / USDT', cat: ['meme'], price: 1.62, change: 8.10 },
    { sym: 'PNUT', name: 'Peanut the Squirrel Perpetual', pair: 'PNUT / USDT', cat: ['hot', 'meme'], price: 1.25, change: 11.40 },
    { sym: 'NEIRO', name: 'First Neiro on Ethereum Perpetual', pair: 'NEIRO / USDT', cat: ['hot', 'meme'], price: 0.00185, change: 10.20 },
    { sym: 'ONDO', name: 'Ondo Finance Perpetual', pair: 'ONDO / USDT', cat: ['hot', 'defi'], price: 1.15, change: 6.40 },
    { sym: 'UNI', name: 'Uniswap Perpetual', pair: 'UNI / USDT', cat: ['defi'], price: 11.40, change: 3.20 },
    { sym: 'MKR', name: 'Maker Perpetual', pair: 'MKR / USDT', cat: ['defi'], price: 1680.0, change: 1.90 },
    { sym: 'CRV', name: 'Curve DAO Perpetual', pair: 'CRV / USDT', cat: ['defi'], price: 0.42, change: 4.10 },
    { sym: 'PENDLE', name: 'Pendle Perpetual', pair: 'PENDLE / USDT', cat: ['defi'], price: 5.85, change: 5.30 },
    { sym: 'JUP', name: 'Jupiter Perpetual', pair: 'JUP / USDT', cat: ['defi'], price: 1.12, change: 4.70 },
    { sym: 'RAY', name: 'Raydium Perpetual', pair: 'RAY / USDT', cat: ['defi'], price: 5.40, change: 7.60 },
    { sym: 'RUNE', name: 'THORChain Perpetual', pair: 'RUNE / USDT', cat: ['defi', 'l1'], price: 6.20, change: 3.80 },
    { sym: 'ATOM', name: 'Cosmos Perpetual', pair: 'ATOM / USDT', cat: ['l1'], price: 6.80, change: 1.70 },
    { sym: 'ALGO', name: 'Algorand Perpetual', pair: 'ALGO / USDT', cat: ['l1'], price: 0.28, change: 3.10 },
    { sym: 'FIL', name: 'Filecoin Perpetual', pair: 'FIL / USDT', cat: ['ai'], price: 5.75, change: 2.60 },
    { sym: 'ICP', name: 'Internet Computer Perpetual', pair: 'ICP / USDT', cat: ['l1', 'ai'], price: 10.40, change: 2.90 },
    { sym: 'GRT', name: 'The Graph Perpetual', pair: 'GRT / USDT', cat: ['ai'], price: 0.245, change: 4.50 },
    { sym: 'WLD', name: 'Worldcoin Perpetual', pair: 'WLD / USDT', cat: ['ai'], price: 2.85, change: 6.30 },
    { sym: 'POL', name: 'Polygon Perpetual', pair: 'POL / USDT', cat: ['l2', 'l1'], price: 0.58, change: 2.20 },
    { sym: 'STRK', name: 'Starknet Perpetual', pair: 'STRK / USDT', cat: ['l2'], price: 0.52, change: 3.10 },
    { sym: 'LTC', name: 'Litecoin Perpetual', pair: 'LTC / USDT', cat: ['payments'], price: 98.40, change: 1.80 },
    { sym: 'BCH', name: 'Bitcoin Cash Perpetual', pair: 'BCH / USDT', cat: ['payments'], price: 495.0, change: 2.30 },
    { sym: 'XLM', name: 'Stellar Lumens Perpetual', pair: 'XLM / USDT', cat: ['payments'], price: 0.48, change: 5.10 },
    { sym: 'HBAR', name: 'Hedera Perpetual', pair: 'HBAR / USDT', cat: ['l1'], price: 0.145, change: 4.80 },
    { sym: 'FTM', name: 'Fantom Perpetual', pair: 'FTM / USDT', cat: ['l1'], price: 0.94, change: 3.20 },
    { sym: 'S', name: 'Sonic Perpetual', pair: 'S / USDT', cat: ['l1'], price: 0.95, change: 3.50 }
  ],

  /**
   * Initialize module, bind search input, shortcuts, and fetch live Binance Futures directory
   */
  init: function () {
    const self = this;
    const searchBtn = document.getElementById('btn-chart-symbol-search');
    const modal = document.getElementById('symbol-search-modal');
    const backdrop = document.getElementById('symbol-search-backdrop');
    const closeBtn = document.getElementById('symbol-search-close-btn');
    const clearBtn = document.getElementById('symbol-search-clear-btn');
    const input = document.getElementById('symbol-search-input');

    if (searchBtn) {
      searchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        self.open();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => self.close());
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => self.close());
    }

    if (clearBtn && input) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        self.searchQuery = '';
        clearBtn.classList.add('hidden');
        input.focus();
        self.renderResults();
      });
    }

    if (input) {
      input.addEventListener('input', (e) => {
        self.searchQuery = e.target.value.trim().toUpperCase();
        if (clearBtn) {
          if (self.searchQuery.length > 0) clearBtn.classList.remove('hidden');
          else clearBtn.classList.add('hidden');
        }
        self.selectedIndex = 0;
        self.renderResults();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (self.selectedIndex < self.filteredCoins.length - 1) {
            self.selectedIndex++;
            self.highlightSelectedRow();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (self.selectedIndex > 0) {
            self.selectedIndex--;
            self.highlightSelectedRow();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (self.filteredCoins && self.filteredCoins[self.selectedIndex]) {
            self.selectCoin(self.filteredCoins[self.selectedIndex]);
          } else if (self.searchQuery.length > 0) {
            // User typed an arbitrary futures ticker (e.g. "KAS" or "ENA")
            self.selectCustomSymbol(self.searchQuery);
          }
        } else if (e.key === 'Escape') {
          self.close();
        }
      });
    }

    // Category Tabs
    document.querySelectorAll('.symbol-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.symbol-cat-tab').forEach(t => {
          t.classList.remove('active', 'bg-primary-container', 'text-black');
          t.classList.add('text-on-surface-variant');
        });
        tab.classList.add('active', 'bg-primary-container', 'text-black');
        tab.classList.remove('text-on-surface-variant');

        self.activeCategory = tab.getAttribute('data-cat') || 'all';
        self.selectedIndex = 0;
        self.renderResults();
      });
    });

    // Global keyboard shortcut: Press "/" or Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && self.isOpen) {
        self.close();
      }
    });

    // Fetch live prices and complete Binance Futures USDT trading universe in background
    self.fetchBinanceLiveTickers();

    // Render Favorites Top Bar
    if (window.FavoritesManager) {
      window.FavoritesManager.renderTopFavoritesBar();
    }
  },

  /**
   * Open the TradingView-style symbol search modal
   */
  open: function () {
    const modal = document.getElementById('symbol-search-modal');
    const input = document.getElementById('symbol-search-input');
    if (!modal) return;

    this.isOpen = true;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    if (input) {
      input.value = '';
      this.searchQuery = '';
      const clearBtn = document.getElementById('symbol-search-clear-btn');
      if (clearBtn) clearBtn.classList.add('hidden');
      setTimeout(() => input.focus(), 50);
    }

    this.selectedIndex = 0;
    this.renderResults();
  },

  /**
   * Close the symbol search modal
   */
  close: function () {
    const modal = document.getElementById('symbol-search-modal');
    if (!modal) return;
    this.isOpen = false;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  },

  /**
   * Filter and render results list (FUTURES ONLY)
   */
  renderResults: function () {
    const list = document.getElementById('symbol-search-results-list');
    if (!list) return;

    const q = this.searchQuery;
    const cat = this.activeCategory;

    // Filter coins by category and search query (STRICTLY REAL CONTRACTS ONLY - ZERO FAKE CONTRACTS)
    let filtered = this.coins.filter(c => {
      if (cat !== 'all') {
        if (!c.cat || !c.cat.includes(cat)) return false;
      }
      if (!q) return true;
      const matchSym = c.sym.toUpperCase().includes(q);
      const matchPair = c.pair.toUpperCase().includes(q);
      const matchName = c.name.toUpperCase().includes(q);
      return matchSym || matchPair || matchName;
    });

    this.filteredCoins = filtered;
    if (this.selectedIndex >= filtered.length) this.selectedIndex = 0;

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="py-12 px-4 text-center text-on-surface-variant font-mono">
          <span class="material-symbols-outlined text-[36px] mb-2 opacity-50">search_off</span>
          <p class="text-xs">No matching Binance Futures contract found for "${q}"</p>
          <p class="text-[10px] mt-1 text-on-surface-variant/70">Please search a real Binance ticker (e.g. SUI, NEAR, PEPE, SOL, BTC, ETH)</p>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach((coin, idx) => {
      const isSelected = idx === this.selectedIndex;
      const isPos = coin.change >= 0;
      const changeClass = isPos ? 'text-[#00ff88]' : 'text-[#ff3366]';
      const changeSign = isPos ? '+' : '';
      const rowBg = isSelected ? 'bg-white/10 border-l-2 border-primary-container' : 'hover:bg-white/[0.04]';

      const formattedPrice = this.formatPrice(coin.price);

      // Color badge based on symbol initials
      const initial = coin.sym.substring(0, 2);

      // Check if coin is favorited
      const isFav = window.FavoritesManager ? window.FavoritesManager.isFavorite(coin.sym) : false;
      const isBTC = coin.sym.toUpperCase() === 'BTC';
      const favTitle = isBTC
        ? 'BTC is permanent favorite'
        : (isFav ? 'Remove from Favorites' : 'Add to Favorites (Max 7)');
      const starIcon = isFav ? 'star' : 'star_border';
      const starColor = isFav ? 'text-amber-400 font-bold' : 'text-white/20 hover:text-amber-400';

      html += `
        <div class="symbol-search-row ${rowBg} px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-all gap-2"
          data-index="${idx}" data-pair="${coin.pair}">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center font-mono font-bold text-xs text-white shrink-0 group-hover:border-primary-container/40">
              ${initial}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono font-bold text-xs sm:text-sm text-white tracking-wide">${coin.sym}USDT.P</span>
                <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container font-extrabold border border-primary-container/30 uppercase">PERP</span>
                <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-on-surface-variant border border-white/5 uppercase">BINANCE FUTURES</span>
              </div>
              <p class="text-[10px] sm:text-[11px] text-on-surface-variant truncate font-sans">${coin.name}</p>
            </div>
          </div>
          <button type="button"
            class="btn-coin-fav p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-auto mr-1 cursor-pointer shrink-0 z-10 flex items-center justify-center active:scale-90"
            data-sym="${coin.sym}"
            title="${favTitle}">
            <span class="material-symbols-outlined text-[20px] ${starColor} transition-colors">
              ${starIcon}
            </span>
          </button>
          <div class="flex items-center gap-5 sm:gap-8 shrink-0 text-right font-mono">
            <div class="w-16 ${changeClass} font-bold text-xs">
              ${coin.change !== 0 ? `${changeSign}${coin.change.toFixed(2)}%` : '--'}
            </div>
            <div class="w-20 text-white font-bold text-xs sm:text-sm">
              ${coin.price > 0 ? `$${formattedPrice}` : 'Live'}
            </div>
          </div>
        </div>
      `;
    });

    list.innerHTML = html;

    // Attach click listeners to favorite star buttons
    list.querySelectorAll('.btn-coin-fav').forEach(favBtn => {
      favBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sym = favBtn.getAttribute('data-sym');
        if (window.FavoritesManager) {
          window.FavoritesManager.toggleFavorite(sym);
        }
      });
    });

    // Attach click listeners to rows
    list.querySelectorAll('.symbol-search-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.getAttribute('data-index'), 10);
        if (this.filteredCoins[idx]) {
          this.selectCoin(this.filteredCoins[idx]);
        }
      });
      row.addEventListener('mouseenter', () => {
        const idx = parseInt(row.getAttribute('data-index'), 10);
        this.selectedIndex = idx;
        this.highlightSelectedRow();
      });
    });
  },

  /**
   * Highlight row selected via keyboard arrow keys
   */
  highlightSelectedRow: function () {
    const list = document.getElementById('symbol-search-results-list');
    if (!list) return;

    const rows = list.querySelectorAll('.symbol-search-row');
    rows.forEach((r, idx) => {
      if (idx === this.selectedIndex) {
        r.classList.add('bg-white/10', 'border-l-2', 'border-primary-container');
        r.classList.remove('hover:bg-white/[0.04]');
        r.scrollIntoView({ block: 'nearest' });
      } else {
        r.classList.remove('bg-white/10', 'border-l-2', 'border-primary-container');
        r.classList.add('hover:bg-white/[0.04]');
      }
    });
  },

  /**
   * Action when user selects a coin
   */
  selectCoin: function (coin) {
    if (!coin || !coin.pair) return;
    this.close();

    // Notify Scanner & Trend Trader to load the selected futures contract
    if (window.ScannerModule && typeof window.ScannerModule.switchFullChartCoin === 'function') {
      window.ScannerModule.switchFullChartCoin(coin.pair);
    } else if (window.ScannerModule && typeof window.ScannerModule.renderFullChart === 'function') {
      window.ScannerModule.fullChartPair = coin.pair;
      window.ScannerModule.renderFullChart(coin.pair, window.ScannerModule.fullChartInterval || '5');
    }

    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`Loaded ${coin.sym}USDT.P • Binance Futures Active`);
    }
  },

  /**
   * Custom typed symbol fallback - validates against real Binance coin registry
   */
  selectCustomSymbol: function (sym) {
    const clean = sym.trim().toUpperCase().replace(/[\s\-_/]/g, '').replace(/\.P$/i, '').replace(/USDT$/i, '');
    const found = this.coins.find(c => c.sym.toUpperCase() === clean);
    if (found) {
      this.selectCoin(found);
    } else {
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast(`"${clean}" is not an active Binance Futures contract. Select a coin from the list.`);
      }
    }
  },

  /**
   * Format prices from $95,000 down to $0.00002135
   */
  formatPrice: function (price) {
    if (!price || isNaN(price)) return '0.00';
    const p = Number(price);
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    if (p >= 0.0001) return p.toFixed(6);
    return p.toFixed(8);
  },

  /**
   * Fetch 24h ticker data directly from Binance USDⓈ-M Futures (fapi.binance.com)
   */
  fetchBinanceLiveTickers: async function () {
    if (this.isFetchingBinance) return;
    this.isFetchingBinance = true;

    // Prioritize Binance USDⓈ-M Perpetual Futures endpoints
    const endpoints = [
      'https://fapi.binance.com/fapi/v1/ticker/24hr',
      'https://data-api.binance.vision/api/v3/ticker/24hr'
    ];

    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const tickers = await res.json();
          if (Array.isArray(tickers) && tickers.length > 50) {
            this.mergeBinanceTickers(tickers);
            break;
          }
        }
      } catch (err) {
        // Try fallback endpoint
      }
    }
    this.isFetchingBinance = false;
  },

  /**
   * Merge Binance Futures tickers into catalog: update existing prices + discover new USDT Perpetual pairs
   */
  mergeBinanceTickers: function (tickers) {
    const tickerMap = new Map();
    tickers.forEach(t => {
      if (t.symbol && t.symbol.endsWith('USDT')) {
        tickerMap.set(t.symbol, {
          price: parseFloat(t.lastPrice) || 0,
          change: parseFloat(t.priceChangePercent) || 0,
          volume: parseFloat(t.quoteVolume || t.volume) || 0
        });
      }
    });

    // 1. Update existing curated coins
    this.coins.forEach(c => {
      const symUSDT = `${c.sym}USDT`;
      const data = tickerMap.get(symUSDT);
      if (data) {
        c.price = data.price;
        c.change = data.change;
        c.volume = data.volume;
      }
    });

    // 2. Discover active real Binance USDⓈ-M Futures contracts not already in curated list
    const existingSyms = new Set(this.coins.map(c => c.sym));
    const extraCoins = [];

    tickerMap.forEach((data, symbol) => {
      const base = symbol.replace(/USDT$/, '');
      // Exclude leveraged tokens and existing
      if (!existingSyms.has(base) && !base.includes('UP') && !base.includes('DOWN') && !base.includes('BEAR') && !base.includes('BULL') && data.volume > 500000) {
        extraCoins.push({
          sym: base,
          name: `${base} Perpetual Contract`,
          pair: `${base} / USDT`,
          cat: ['all'],
          price: data.price,
          change: data.change,
          volume: data.volume
        });
      }
    });

    // Sort extra coins by volume and add top 150
    extraCoins.sort((a, b) => b.volume - a.volume);
    this.coins = this.coins.concat(extraCoins.slice(0, 150));

    // Re-render if modal currently open
    if (this.isOpen) {
      this.renderResults();
    }
  }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.SymbolSearchModule.init());
} else {
  window.SymbolSearchModule.init();
}
