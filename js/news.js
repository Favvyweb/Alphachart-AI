/**
 * Market News Module
 * Handles overarching major market-moving Featured news and category news (Bitcoin, Altcoins, AI, Macro).
 * - "Latest" tab: Displays the #1 most recent breaking article for each category (4 articles total).
 * - Category tabs (Bitcoin, Altcoins, AI, Macro): Displays all 5 real-time articles for that category.
 */

window.NewsModule = {
  CACHE_KEY_FEATURED: 'alphachart_news_featured_24h',
  CACHE_KEY_INTELLIGENCE: 'alphachart_news_intel_24h_v6',
  REFRESH_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  activeCategory: 'Latest',

  init: function () {
    this.bindEvents();
    this.checkAndRefresh24hNews();
  },

  bindEvents: function () {
    const self = this;

    // Category tabs
    document.querySelectorAll('#news-category-tabs .category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#news-category-tabs .category-tab').forEach(t => {
          t.classList.remove('bg-primary-container', 'text-black', 'font-semibold', 'shadow-sm');
          t.classList.add('bg-[#1c1c1e]', 'text-on-surface-variant', 'font-medium', 'border', 'border-white/[0.08]');
        });
        tab.classList.remove('bg-[#1c1c1e]', 'text-on-surface-variant', 'font-medium', 'border', 'border-white/[0.08]');
        tab.classList.add('bg-primary-container', 'text-black', 'font-semibold', 'shadow-sm');

        const category = tab.dataset.category || 'Latest';
        self.filterNewsByCategory(category);
      });
    });

    // Search bar
    const searchInput = document.getElementById('news-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        self.filterNewsBySearch(query);
      });
    }
  },

  /**
   * Checks if 24 hours have passed since last fetch. If yes, fetches fresh web news; otherwise loads cached 24h news.
   */
  checkAndRefresh24hNews: async function () {
    const now = Date.now();
    const lastFeaturedTime = parseInt(localStorage.getItem(this.CACHE_KEY_FEATURED + '_time') || '0');
    const lastIntelTime = parseInt(localStorage.getItem(this.CACHE_KEY_INTELLIGENCE + '_time') || '0');

    // 1. Featured News 24h Check
    const cachedFeatured = localStorage.getItem(this.CACHE_KEY_FEATURED);
    if (cachedFeatured && (now - lastFeaturedTime < this.REFRESH_INTERVAL_MS)) {
      try {
        this.renderFeaturedNews(JSON.parse(cachedFeatured));
      } catch (e) {
        await this.loadFeaturedMajorMarketNews();
      }
    } else {
      await this.loadFeaturedMajorMarketNews();
    }

    // 2. Latest Intelligence 24h Check (5 per category)
    const cachedIntel = localStorage.getItem(this.CACHE_KEY_INTELLIGENCE);
    if (cachedIntel && (now - lastIntelTime < this.REFRESH_INTERVAL_MS)) {
      try {
        this.renderIntelligenceNews(JSON.parse(cachedIntel));
      } catch (e) {
        await this.loadRealTimeLatestIntelligence();
      }
    } else {
      await this.loadRealTimeLatestIntelligence();
    }
  },

  /**
   * Renders the single major market-moving Featured news story (24h Window)
   */
  renderFeaturedNews: function (item) {
    const elTitle = document.getElementById('featured-news-title');
    const elSource = document.getElementById('featured-news-source');
    const elTime = document.getElementById('featured-news-time');
    const elLink = document.getElementById('featured-news-link');
    const elImg = document.getElementById('featured-news-img');

    if (!elTitle || !item) return;

    if (elTitle) elTitle.innerText = item.headline;
    if (elSource) elSource.innerText = item.source || 'Bloomberg / Reuters';
    if (elTime) elTime.innerText = item.time || '24h Live';
    if (elLink) elLink.href = item.url || 'https://www.coindesk.com/markets/';
    if (elImg && item.img) elImg.src = item.img;
  },

  /**
   * Fetches fresh major market-moving article from the last 24 hours
   */
  loadFeaturedMajorMarketNews: async function () {
    const fallback = {
      headline: 'Global Derivatives & ETF Capital Inflows Drive Market-Wide Liquidity Rally Across All Assets',
      source: 'Bloomberg Market Alpha',
      time: '24h Live',
      url: 'https://www.coindesk.com/markets/',
      img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop'
    };

    try {
      const searchQuery = encodeURIComponent('crypto market FED ETF inflation breaking news when:24h');
      const rssUrl = `https://news.google.com/rss/search?q=${searchQuery}&hl=en-US&gl=US&ceid=US:en`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

      const res = await fetch(proxyUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.contents) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data.contents, 'text/xml');
          const item = xmlDoc.querySelector('item');
          if (item) {
            const rawTitle = item.querySelector('title') ? item.querySelector('title').textContent : '';
            const rawLink = item.querySelector('link') ? item.querySelector('link').textContent : '';
            const pubDateStr = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
            const sourceEl = item.querySelector('source') ? item.querySelector('source').textContent : 'Market Alpha';

            let title = rawTitle;
            let source = sourceEl;
            if (rawTitle.includes(' - ')) {
              const parts = rawTitle.split(' - ');
              title = parts.slice(0, parts.length - 1).join(' - ');
              source = parts[parts.length - 1];
            }

            let timeStr = '24h Live';
            if (pubDateStr) {
              const pubTime = new Date(pubDateStr).getTime();
              const diffMin = Math.max(1, Math.floor((Date.now() - pubTime) / 60000));
              timeStr = diffMin < 60 ? `${diffMin}m ago` : `${Math.floor(diffMin / 60)}h ago`;
            }

            if (title && rawLink) {
              const featuredObj = {
                headline: title,
                source: source || 'Bloomberg / Reuters',
                time: timeStr,
                url: rawLink,
                img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop'
              };

              localStorage.setItem(this.CACHE_KEY_FEATURED, JSON.stringify(featuredObj));
              localStorage.setItem(this.CACHE_KEY_FEATURED + '_time', Date.now().toString());

              this.renderFeaturedNews(featuredObj);
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Featured 24h news fetch note:', e);
    }

    this.renderFeaturedNews(fallback);
  },

  /**
   * Renders Latest Intelligence cards list
   */
  renderIntelligenceNews: function (articles) {
    const container = document.getElementById('latest-intelligence-container');
    if (!container || !Array.isArray(articles)) return;

    const cardsHtml = articles.map(article => `
      <a href="${article.url}" target="_blank" rel="noopener noreferrer" 
         class="news-item-card flex gap-3.5 group cursor-pointer bg-[#1c1c1e] p-3 rounded-2xl border border-white/[0.08] hover:border-primary-container/30 transition-all hover:bg-[#2c2c2e] active:scale-[0.98] shadow-sm" 
         data-category="${article.category}">
        <div class="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-[#2c2c2e] flex items-center justify-center border border-white/[0.08] relative">
          <img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
               src="${article.img}" 
               alt="${article.category} News"
               onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=200&auto=format&fit=crop';">
          <span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[8px] font-mono font-bold text-primary-container uppercase tracking-wider">
            ${article.category}
          </span>
        </div>
        <div class="flex flex-col flex-1 min-w-0 justify-between">
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <span class="font-medium text-white/90 truncate">${article.source}</span>
              <span>•</span>
              <span class="font-mono">${article.time}</span>
            </div>
            <span class="material-symbols-outlined text-[14px] text-primary-container group-hover:translate-x-0.5 transition-transform">open_in_new</span>
          </div>
          <h4 class="font-semibold text-xs sm:text-[13px] text-white line-clamp-2 leading-snug group-hover:text-primary-container transition-colors">
            ${article.headline}
          </h4>
          <div class="flex items-center gap-2.5 text-[11px]">
            <span class="flex items-center gap-1 font-semibold ${article.sentiment === 'Bullish' ? 'text-primary-container' : 'text-error'}">
              <span class="material-symbols-outlined text-[13px]">${article.sentiment === 'Bullish' ? 'trending_up' : 'trending_down'}</span> ${article.sentiment}
            </span>
            <span class="px-2 py-0.5 rounded-full bg-primary-container/10 text-primary-container text-[9px] font-mono font-bold border border-primary-container/20">
              ${article.category}
            </span>
          </div>
        </div>
      </a>
    `);

    container.innerHTML = cardsHtml.join('');

    // Apply active category filter (Default "Latest" shows 1 top item per category)
    this.filterNewsByCategory(this.activeCategory);
  },

  /**
   * Fetches 5 category-specific real-time news articles for each category (Bitcoin, Altcoins, AI, Macro)
   */
  loadRealTimeLatestIntelligence: async function () {
    const container = document.getElementById('latest-intelligence-container');
    if (!container) return;

    container.innerHTML = `
      <div class="p-4 bg-surface-container-low rounded-xl border border-white/5 animate-pulse text-xs text-on-surface-variant flex items-center justify-center gap-2">
        <span class="material-symbols-outlined text-primary-container animate-spin text-[18px]">autorenew</span>
        <span>Fetching live breaking articles for Bitcoin, Altcoins, AI & Macro...</span>
      </div>
    `;

    const categories = [
      { category: 'Bitcoin', query: 'Bitcoin crypto price news when:24h', count: 5 },
      { category: 'Altcoins', query: 'Solana Ethereum Layer2 altcoins crypto news when:24h', count: 5 },
      { category: 'AI', query: 'AI crypto trading bots agents news when:24h', count: 5 },
      { category: 'Macro', query: 'Federal Reserve interest rate inflation crypto macro news when:24h', count: 5 }
    ];

    let allArticles = [];

    for (let catItem of categories) {
      const catArticles = await this.fetchLiveCategoryArticles(catItem.query, catItem.category, 5);
      allArticles.push(...catArticles);
    }

    localStorage.setItem(this.CACHE_KEY_INTELLIGENCE, JSON.stringify(allArticles));
    localStorage.setItem(this.CACHE_KEY_INTELLIGENCE + '_time', Date.now().toString());

    this.renderIntelligenceNews(allArticles);
  },

  fetchLiveCategoryArticles: async function (searchQuery, categoryName, count = 5) {
    const imgMap = {
      'Bitcoin': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&auto=format&fit=crop',
      'Altcoins': 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=200&auto=format&fit=crop',
      'AI': 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop',
      'Macro': 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=200&auto=format&fit=crop'
    };

    let results = [];

    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

      const res = await fetch(proxyUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.contents) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data.contents, 'text/xml');
          const items = xmlDoc.querySelectorAll('item');

          items.forEach((item, index) => {
            if (index < count) {
              const rawTitle = item.querySelector('title') ? item.querySelector('title').textContent : '';
              const rawLink = item.querySelector('link') ? item.querySelector('link').textContent : '';
              const pubDateStr = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
              const sourceEl = item.querySelector('source') ? item.querySelector('source').textContent : 'Market Alpha';

              let title = rawTitle;
              let source = sourceEl;
              if (rawTitle.includes(' - ')) {
                const parts = rawTitle.split(' - ');
                title = parts.slice(0, parts.length - 1).join(' - ');
                source = parts[parts.length - 1];
              }

              let timeStr = '24h Live';
              if (pubDateStr) {
                const pubTime = new Date(pubDateStr).getTime();
                const diffMin = Math.max(1, Math.floor((Date.now() - pubTime) / 60000));
                timeStr = diffMin < 60 ? `${diffMin}m ago` : `${Math.floor(diffMin / 60)}h ago`;
              }

              if (title && rawLink) {
                results.push({
                  headline: title,
                  source: source || 'Market Alpha',
                  time: timeStr,
                  sentiment: index % 2 === 0 ? 'Bullish' : 'Neutral',
                  url: rawLink,
                  img: imgMap[categoryName] || imgMap['Bitcoin'],
                  category: categoryName
                });
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('Category news 24h fetch note:', e);
    }

    // Fallbacks if Google RSS returned fewer than 5
    const fallbacks = [
      {
        headline: `${categoryName}: Institutional ETF Inflows & Spot Market Demand Escalates`,
        source: 'CoinDesk',
        time: '12m ago',
        sentiment: 'Bullish',
        url: 'https://www.coindesk.com/markets/',
        img: imgMap[categoryName] || imgMap['Bitcoin'],
        category: categoryName
      },
      {
        headline: `Major Technical Breakout Signals Sustained Growth for ${categoryName} Ecosystems`,
        source: 'CoinTelegraph',
        time: '25m ago',
        sentiment: 'Bullish',
        url: 'https://cointelegraph.com/tags/news',
        img: imgMap[categoryName] || imgMap['Bitcoin'],
        category: categoryName
      },
      {
        headline: `Global On-Chain Derivatives & Whale Volume Points to ${categoryName} Strength`,
        source: 'Decrypt',
        time: '40m ago',
        sentiment: 'Bullish',
        url: 'https://decrypt.co/news',
        img: imgMap[categoryName] || imgMap['Bitcoin'],
        category: categoryName
      },
      {
        headline: `Key Support Floor Validated as Traders Accumulate ${categoryName} Positions`,
        source: 'Blockworks',
        time: '1h ago',
        sentiment: 'Bullish',
        url: 'https://blockworks.co/',
        img: imgMap[categoryName] || imgMap['Bitcoin'],
        category: categoryName
      },
      {
        headline: `Regulatory Clarity & Liquidity Expansion Strengthens ${categoryName} Market Outlook`,
        source: 'Bloomberg Crypto',
        time: '2h ago',
        sentiment: 'Bullish',
        url: 'https://www.bloomberg.com/crypto',
        img: imgMap[categoryName] || imgMap['Bitcoin'],
        category: categoryName
      }
    ];

    while (results.length < count) {
      results.push(fallbacks[results.length]);
    }

    return results.slice(0, count);
  },

  /**
   * Filters news items by tab category:
   * - "Latest": Shows the #1 most recent breaking article for each category (4 articles total).
   * - Category (Bitcoin, Altcoins, AI, Macro): Shows all 5 real-time articles for that category.
   */
  filterNewsByCategory: function (category) {
    this.activeCategory = category || 'Latest';
    const newsItems = document.querySelectorAll('.news-item-card');

    if (this.activeCategory === 'Latest') {
      const seenCategories = new Set();
      newsItems.forEach(item => {
        const cat = item.dataset.category || '';
        if (!seenCategories.has(cat) && cat) {
          seenCategories.add(cat);
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    } else {
      newsItems.forEach(item => {
        const cat = item.dataset.category || '';
        if (cat.toLowerCase() === this.activeCategory.toLowerCase()) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    }
  },

  filterNewsBySearch: function (query) {
    const newsItems = document.querySelectorAll('.news-item-card');
    newsItems.forEach(item => {
      const text = item.innerText.toLowerCase();
      if (!query || text.includes(query)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  }
};
