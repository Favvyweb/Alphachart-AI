/**
 * AlphaChart AI Main App Core & Navigation Router (Mobile Optimized)
 */

window.App = {
  activeTab: 'signal-scanner',

  titles: {
    'signal-scanner': 'Signal Scanner',
    'charts': 'Charts',
    'trading-journal': 'Trading Journal',
    'user-profile': 'User Profile'
  },

  init: function () {
    this.bindNavigation();
    this.bindTopEarnersModal();
    if (window.ScannerModule) window.ScannerModule.init();
    if (window.JournalModule) window.JournalModule.init();
  },

  bindTopEarnersModal: function () {
    const self = this;
    const topEarnersBtn = document.getElementById('top-earners-btn');
    const modal = document.getElementById('top-earners-modal');
    const closeBtn = document.getElementById('top-earners-close-btn');
    const backdrop = document.getElementById('top-earners-backdrop');
    const submitBtn = document.getElementById('submit-earnings-btn');

    if (topEarnersBtn && modal) {
      topEarnersBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      });
    }

    const closeModal = () => {
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        closeModal();
        self.showToast('Tag @AlphaChartAI on socials & share monthly journal for review!');
      });
    }
  },

  bindNavigation: function () {
    const self = this;
    const navLinks = document.querySelectorAll('nav [data-path]');

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPath = link.getAttribute('data-path');
        self.navigateTo(targetPath);
      });
    });
  },

  navigateTo: function (path) {
    if (!path) return;
    this.activeTab = path;

    // Dynamic header title update
    const headerTitle = document.getElementById('app-header-title');
    if (headerTitle && this.titles[path]) {
      headerTitle.innerText = this.titles[path];
    }

    // Toggle tab pages visibility
    const pages = document.querySelectorAll('.tab-page');
    pages.forEach(page => {
      if (page.id === `page-${path}`) {
        page.classList.add('active');
        page.style.display = 'block';
        setTimeout(() => page.style.opacity = '1', 10);
      } else {
        page.classList.remove('active');
        page.style.opacity = '0';
        page.style.display = 'none';
      }
    });

    // Update bottom navigation active styles
    const allNavLinks = document.querySelectorAll('nav [data-path]');
    allNavLinks.forEach(link => {
      const linkPath = link.getAttribute('data-path');
      if (linkPath === path) {
        link.className = 'flex flex-col items-center gap-1 min-w-[64px] transition-colors duration-200 text-primary-container font-semibold';
        link.setAttribute('aria-current', 'page');
      } else {
        link.className = 'flex flex-col items-center gap-1 min-w-[64px] text-on-surface-variant/80 transition-colors duration-200 font-medium';
        link.removeAttribute('aria-current');
      }
    });

    // Trigger realtime chart render/refresh when navigating to Charts tab
    if (path === 'charts' && window.ScannerModule && typeof window.ScannerModule.renderFullChart === 'function') {
      setTimeout(() => {
        window.ScannerModule.renderFullChart(window.ScannerModule.fullChartPair || 'BTC / USDT', window.ScannerModule.fullChartInterval || '5');
      }, 50);
    }

    window.scrollTo(0, 0);
  },

  showToast: function (message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-primary-container text-black font-bold text-xs shadow-2xl transition-all duration-300 transform opacity-0 translate-y-[-20px] pointer-events-none flex items-center gap-2 max-w-[380px] w-[90%] justify-center';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<span class="material-symbols-outlined text-[18px]">check_circle</span> ${message}`;
    toast.classList.remove('opacity-0', 'translate-y-[-20px]');
    toast.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-[-20px]');
    }, 2800);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.App.init();
});
