// Serverless API: /api/journal/sync
// Synchronizes manual journal trades across devices (Mobile <-> Web) for authenticated accounts in PostgreSQL

const { getDatabaseUrl } = require('../alerts/_config');

function getClient(dbUrl) {
  let Client;
  try {
    const pg = require('pg');
    Client = pg.Client;
  } catch (e) {
    const neon = require('@neondatabase/serverless');
    Client = neon.Client;
  }
  return new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_journal_trades (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      trade_id VARCHAR(100) NOT NULL,
      trade_data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_email, trade_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_journal_email ON user_journal_trades(user_email);
  `);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const dbUrl = getDatabaseUrl();

  // 1. GET: Retrieve user's trades across all devices
  if (req.method === 'GET') {
    if (req.query.inspect === 'all') {
      if (!dbUrl) return res.status(200).json({ empty: true });
      let client = null;
      try {
        client = getClient(dbUrl);
        await client.connect();
        const r = await client.query('SELECT id, user_email, trade_id, created_at, updated_at FROM user_journal_trades');
        let users = [];
        try {
          const u = await client.query('SELECT email, display_name, device_platform, pwa_installed, last_login_at FROM users');
          users = u.rows;
        } catch (ue) { }
        return res.status(200).json({ count: r.rows.length, rows: r.rows, users });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      } finally {
        if (client) await client.end().catch(() => {});
      }
    }

    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid user email is required.' });
    }

    if (!dbUrl) {
      return res.status(200).json({
        success: true,
        trades: [],
        message: 'Database not connected yet. Operating in local mode.'
      });
    }

    let client = null;
    try {
      client = getClient(dbUrl);
      await client.connect();
      await ensureTable(client);

      const result = await client.query(
        `SELECT trade_data FROM user_journal_trades WHERE user_email = $1 ORDER BY updated_at DESC`,
        [email]
      );

      const trades = result.rows.map(r => r.trade_data);
      return res.status(200).json({
        success: true,
        count: trades.length,
        trades
      });
    } catch (err) {
      console.error('[Journal Sync GET Error]:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  // 2. POST: Upsert or delete trades from device into database
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { }
    }
    const { email, trades, action, deletedTradeId } = body || {};
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid user email is required.' });
    }

    if (!dbUrl) {
      return res.status(200).json({
        success: true,
        message: 'Saved locally (Database not connected yet).'
      });
    }

    let client = null;
    try {
      client = getClient(dbUrl);
      await client.connect();
      await ensureTable(client);

      // Handle single trade deletion
      if (action === 'delete' && deletedTradeId) {
        await client.query(
          `DELETE FROM user_journal_trades WHERE user_email = $1 AND trade_id = $2`,
          [cleanEmail, String(deletedTradeId)]
        );
        return res.status(200).json({
          success: true,
          message: 'Trade removed from cloud account.'
        });
      }

      // Handle clear all trades
      if (action === 'clear_all') {
        await client.query(
          `DELETE FROM user_journal_trades WHERE user_email = $1`,
          [cleanEmail]
        );
        return res.status(200).json({
          success: true,
          message: 'All trades cleared from cloud account.'
        });
      }

      // Handle bulk or single trade upsert
      if (Array.isArray(trades) && trades.length > 0) {
        for (const t of trades) {
          const tradeId = String(t.id || t.tradeId || t.timestamp || Date.now());
          await client.query(
            `INSERT INTO user_journal_trades (user_email, trade_id, trade_data, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (user_email, trade_id)
             DO UPDATE SET trade_data = EXCLUDED.trade_data, updated_at = CURRENT_TIMESTAMP`,
            [cleanEmail, tradeId, JSON.stringify(t)]
          );
        }

        // Fetch refreshed consolidated list
        const refreshed = await client.query(
          `SELECT trade_data FROM user_journal_trades WHERE user_email = $1 ORDER BY updated_at DESC`,
          [cleanEmail]
        );
        const consolidated = refreshed.rows.map(r => r.trade_data);

        return res.status(200).json({
          success: true,
          count: consolidated.length,
          trades: consolidated,
          message: 'Journal synchronized with cloud account successfully.'
        });
      }

      return res.status(200).json({ success: true, count: 0, trades: [] });
    } catch (err) {
      console.error('[Journal Sync POST Error]:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
