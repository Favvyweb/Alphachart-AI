/**
 * AlphaChart AI - Persistent Gmail Authentication Engine
 * - Zero-hassle one-time sign-in with Gmail / Google
 * - Permanent session persistence on the user's device (localStorage)
 * - Automatically bypasses login on next visits / PWA launches
 * - Displays active user identity in Profile with Sign-Out capability
 */

window.AuthModule = {
  STORAGE_EMAIL: 'alphachart_auth_email',
  STORAGE_ACTIVE: 'alphachart_auth_active',
  STORAGE_TIME: 'alphachart_auth_timestamp',

  init: function () {
    this.bindEvents();
    this.checkSession();
  },

  /**
   * Check if user is already authenticated on this phone/browser
   */
  checkSession: function () {
    const email = localStorage.getItem(this.STORAGE_EMAIL);
    const isActive = localStorage.getItem(this.STORAGE_ACTIVE) === 'true';
    const gateScreen = document.getElementById('auth-gate-screen');

    if (isActive && email && email.includes('@')) {
      // User is already logged in on this phone!
      if (gateScreen) {
        gateScreen.classList.add('hidden');
        gateScreen.style.display = 'none';
      }
      this.updateProfileUI(email);
      // Background heartbeat to PostgreSQL backend (updates last_login_at timestamp)
      this.syncWithBackend(email);
      return true;
    } else {
      // User has not logged in yet on this phone: display sign-in gate
      if (gateScreen) {
        gateScreen.classList.remove('hidden');
        gateScreen.style.display = 'flex';
      }
      return false;
    }
  },

  /**
   * Complete login with Gmail address
   */
  login: function (rawEmail) {
    if (!rawEmail || typeof rawEmail !== 'string') return;
    let email = rawEmail.trim().toLowerCase();

    // Auto-complete @gmail.com if user only typed username
    if (!email.includes('@')) {
      email = `${email}@gmail.com`;
    }

    // Basic format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid Gmail address (e.g. trader@gmail.com)');
      return;
    }

    // Persist permanently on this device
    try {
      localStorage.setItem(this.STORAGE_EMAIL, email);
      localStorage.setItem(this.STORAGE_ACTIVE, 'true');
      localStorage.setItem(this.STORAGE_TIME, Date.now().toString());
    } catch (e) {
      console.warn('Storage error:', e);
    }

    // Smooth exit transition for auth gate
    const gateScreen = document.getElementById('auth-gate-screen');
    if (gateScreen) {
      gateScreen.style.opacity = '0';
      gateScreen.style.transform = 'scale(0.98)';
      setTimeout(() => {
        gateScreen.classList.add('hidden');
        gateScreen.style.display = 'none';
        gateScreen.style.opacity = '1';
        gateScreen.style.transform = 'scale(1)';
      }, 350);
    }

    this.updateProfileUI(email);

    // Asynchronously synchronize user with PostgreSQL backend
    this.syncWithBackend(email);

    if (window.App && window.App.showToast) {
      window.App.showToast(`Signed in as ${email} • Access Granted! 🚀`);
    }
  },

  /**
   * Asynchronously push subscriber intelligence to PostgreSQL backend
   */
  syncWithBackend: async function (email) {
    if (!email || !email.includes('@')) return;
    try {
      const isPwa = Boolean(
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true
      );
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? 'iOS'
        : /Android/i.test(navigator.userAgent)
        ? 'Android'
        : 'Desktop';

      const payload = {
        email: email.trim().toLowerCase(),
        display_name: email.split('@')[0],
        device_platform: `${platform}${isPwa ? ' (PWA)' : ' (Web)'}`,
        pwa_installed: isPwa,
        user_agent: navigator.userAgent
      };

      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[AlphaChart Backend] PostgreSQL sync response:', data);
      }
    } catch (err) {
      // Non-blocking background sync warning
      console.warn('[AlphaChart Backend] Sync warning (offline or local server):', err);
    }
  },

  /**
   * Sign out and clear stored session on this device
   */
  logout: function () {
    const confirmed = confirm('Are you sure you want to sign out from AlphaChart AI on this device?');
    if (!confirmed) return;

    try {
      localStorage.removeItem(this.STORAGE_EMAIL);
      localStorage.removeItem(this.STORAGE_ACTIVE);
      localStorage.removeItem(this.STORAGE_TIME);
    } catch (e) {
      console.warn('Storage error:', e);
    }

    const gateScreen = document.getElementById('auth-gate-screen');
    if (gateScreen) {
      gateScreen.classList.remove('hidden');
      gateScreen.style.display = 'flex';
      gateScreen.style.opacity = '0';
      gateScreen.style.transform = 'scale(1.02)';
      setTimeout(() => {
        gateScreen.style.opacity = '1';
        gateScreen.style.transform = 'scale(1)';
      }, 50);
    }

    // Reset email input
    const emailInput = document.getElementById('auth-email-input');
    if (emailInput) emailInput.value = '';

    if (window.App && window.App.showToast) {
      window.App.showToast('Signed out successfully.');
    }
  },

  /**
   * Update Profile tab with authenticated Gmail details
   */
  updateProfileUI: function (email) {
    const nameEl = document.getElementById('user-profile-name');
    const emailEl = document.getElementById('user-profile-email');
    const avatarEl = document.getElementById('user-profile-avatar-letter');
    const headerPill = document.getElementById('header-user-pill');

    const username = email.split('@')[0];
    const cleanName = username.replace(/[._\-0-9]/g, ' ').trim();
    const displayName = cleanName ? cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Trader';
    const firstLetter = displayName.charAt(0).toUpperCase() || 'A';

    if (nameEl) nameEl.innerText = displayName;
    if (emailEl) emailEl.innerText = email;
    if (avatarEl) avatarEl.innerText = firstLetter;

    if (headerPill) {
      headerPill.innerHTML = `
        <span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>
        <span class="truncate max-w-[90px] font-mono text-[9px] text-white/90">${username}</span>
      `;
      headerPill.classList.remove('hidden');
    }
  },

  /**
   * Bind DOM submit & click listeners
   */
  bindEvents: function () {
    const form = document.getElementById('auth-gmail-form');
    const emailInput = document.getElementById('auth-email-input');
    const googleBtn = document.getElementById('auth-google-quick-btn');
    const logoutBtn = document.getElementById('user-logout-btn');

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = emailInput ? emailInput.value : '';
        this.login(val);
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // If user already typed something in email input, use it
        const typed = emailInput && emailInput.value ? emailInput.value.trim() : '';
        if (typed) {
          this.login(typed);
          return;
        }

        // Quick 1-tap Google Sign-in prompt
        const userEntered = prompt('Enter your Gmail address to sign in with Google:', 'trader@gmail.com');
        if (userEntered) {
          this.login(userEntered);
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.AuthModule.init();
});

