// Vercel / Node.js Serverless API Endpoint: /api/auth/sync
// Automatically persists Gmail sign-ups directly into PostgreSQL database

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { email, display_name, device_platform, pwa_installed, user_agent } = req.body || {};

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address provided.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const username = cleanEmail.split('@')[0];
    const derivedName = display_name || username.charAt(0).toUpperCase() + username.slice(1);
    const platform = device_platform || 'Web/Mobile';
    const isPwa = Boolean(pwa_installed);
    const ua = user_agent || req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    const dbUrl = process.env.DATABASE_URL;

    // If DATABASE_URL is configured (e.g. Supabase, Neon, Vercel Postgres)
    if (dbUrl) {
      let Client;
      try {
        const pg = require('pg');
        Client = pg.Client;
      } catch (err) {
        // Fallback for Neon serverless driver
        const neon = require('@neondatabase/serverless');
        Client = neon.Client;
      }

      const client = new Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });

      await client.connect();

      // Upsert user in PostgreSQL (inserts new user, or updates login count and timestamps on returning user)
      const upsertQuery = `
        INSERT INTO users (
          email, display_name, device_platform, pwa_installed, user_agent, ip_address, login_count, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (email) DO UPDATE SET
          login_count = users.login_count + 1,
          last_login_at = CURRENT_TIMESTAMP,
          device_platform = EXCLUDED.device_platform,
          pwa_installed = EXCLUDED.pwa_installed,
          ip_address = EXCLUDED.ip_address
        RETURNING id, email, display_name, login_count, subscription_tier, created_at;
      `;

      const userResult = await client.query(upsertQuery, [cleanEmail, derivedName, platform, isPwa, ua, ip]);
      const user = userResult.rows[0];

      // Record session history
      try {
        await client.query(
          `INSERT INTO user_sessions (user_id, email, device_type, platform, ip_address) VALUES ($1, $2, $3, $4, $5)`,
          [user.id, cleanEmail, platform, ua.includes('Mobile') ? 'Mobile' : 'Desktop', ip]
        );
      } catch (e) {
        console.warn('Session logging warning:', e);
      }

      await client.end();

      return res.status(200).json({
        success: true,
        message: 'User synchronized with PostgreSQL database successfully.',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          loginCount: user.login_count,
          tier: user.subscription_tier,
          memberSince: user.created_at
        }
      });
    } else {
      // Local fallback mode when DATABASE_URL is not set yet
      return res.status(200).json({
        success: true,
        message: 'User captured in local session (DATABASE_URL environment variable is ready to be connected).',
        user: {
          email: cleanEmail,
          displayName: derivedName,
          platform: platform,
          pwaInstalled: isPwa
        }
      });
    }
  } catch (error) {
    console.error('PostgreSQL Sync Error:', error);
    return res.status(500).json({
      error: 'Failed to synchronize with PostgreSQL database.',
      details: error.message
    });
  }
};

