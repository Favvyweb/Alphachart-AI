// Vercel / Node.js Serverless API: /api/journal/trades
// Synchronizes user's manual trading journal across devices using PostgreSQL

const { getDbClient } = require('../alerts/_config');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let client = null;

  try {
    client = await getDbClient();
    if (!client) {
      return res.status(200).json({
        success: true,
        count: 0,
        trades: [],
        notice: 'Database not connected. Operating in local mode.'
      });
    }

    // Ensure user_journal_trades table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_journal_trades (
        id BIGINT NOT NULL,
        email VARCHAR(255) NOT NULL,
        pair VARCHAR(50),
        market VARCHAR(50),
        type VARCHAR(20),
        trade_timestamp BIGINT,
        trade_time VARCHAR(100),
        entry_price VARCHAR(50),
        pnl VARCHAR(50),
        is_profit BOOLEAN,
        notes TEXT,
        user_outcome_pnl VARCHAR(50),
        user_observation TEXT,
        feedback_saved BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (email, id)
      );
      CREATE INDEX IF NOT EXISTS idx_journal_trades_email ON user_journal_trades(email);
    `);

    // GET /api/journal/trades?email=user@example.com
    if (req.method === 'GET') {
      const email = (req.query.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      const result = await client.query(
        `SELECT * FROM user_journal_trades WHERE email = $1 ORDER BY trade_timestamp DESC, id DESC`,
        [email]
      );

      const trades = result.rows.map(r => ({
        id: Number(r.id),
        pair: r.pair || 'BTC / USDT',
        market: r.market || 'Crypto',
        type: r.type || 'LONG',
        timestamp: Number(r.trade_timestamp || r.id),
        time: r.trade_time || 'Just now',
        entryPrice: r.entry_price || '--',
        pnl: r.pnl || '+$0.00',
        isProfit: Boolean(r.is_profit),
        notes: r.notes || '',
        userOutcomePnl: r.user_outcome_pnl || r.pnl,
        userObservation: r.user_observation || r.notes,
        feedbackSaved: r.feedback_saved !== false
      }));

      return res.status(200).json({
        success: true,
        count: trades.length,
        trades: trades
      });
    }

    // POST /api/journal/trades
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const { email, trades, trade } = body || {};
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      const items = Array.isArray(trades) ? trades : (trade ? [trade] : []);
      if (items.length === 0) {
        return res.status(200).json({ success: true, count: 0, message: 'No trades to sync' });
      }

      for (const t of items) {
        if (!t || !t.id) continue;
        const tradeId = Number(t.id);
        const pair = t.pair || 'BTC / USDT';
        const market = t.market || 'Crypto';
        const type = t.type || 'LONG';
        const timestamp = Number(t.timestamp || t.id || Date.now());
        const tradeTime = t.time || 'Just now';
        const entryPrice = t.entryPrice || '--';
        const pnl = t.pnl || '+$0.00';
        const isProfit = Boolean(t.isProfit !== undefined ? t.isProfit : (!pnl.startsWith('-') && !pnl.toLowerCase().includes('loss')));
        const notes = t.notes || '';
        const userOutcomePnl = t.userOutcomePnl || pnl;
        const userObservation = t.userObservation || notes;
        const feedbackSaved = Boolean(t.feedbackSaved !== false);

        await client.query(`
          INSERT INTO user_journal_trades (
            id, email, pair, market, type, trade_timestamp, trade_time, entry_price, pnl, is_profit, notes, user_outcome_pnl, user_observation, feedback_saved, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
          )
          ON CONFLICT (email, id) DO UPDATE SET
            pair = EXCLUDED.pair,
            market = EXCLUDED.market,
            type = EXCLUDED.type,
            trade_timestamp = EXCLUDED.trade_timestamp,
            trade_time = EXCLUDED.trade_time,
            entry_price = EXCLUDED.entry_price,
            pnl = EXCLUDED.pnl,
            is_profit = EXCLUDED.is_profit,
            notes = EXCLUDED.notes,
            user_outcome_pnl = EXCLUDED.user_outcome_pnl,
            user_observation = EXCLUDED.user_observation,
            feedback_saved = EXCLUDED.feedback_saved,
            updated_at = CURRENT_TIMESTAMP;
        `, [
          tradeId, cleanEmail, pair, market, type, timestamp, tradeTime, entryPrice, pnl, isProfit, notes, userOutcomePnl, userObservation, feedbackSaved
        ]);
      }

      return res.status(200).json({ success: true, count: items.length });
    }

    // DELETE /api/journal/trades
    if (req.method === 'DELETE') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const email = ((body && body.email) || req.query.email || '').trim().toLowerCase();
      const id = (body && body.id) || req.query.id;
      const clearAll = (body && body.all) || req.query.all === 'true';

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      if (clearAll) {
        await client.query(`DELETE FROM user_journal_trades WHERE email = $1`, [email]);
        return res.status(200).json({ success: true, message: 'All trades cleared' });
      } else if (id) {
        await client.query(`DELETE FROM user_journal_trades WHERE email = $1 AND id = $2`, [email, Number(id)]);
        return res.status(200).json({ success: true, message: 'Trade deleted' });
      } else {
        return res.status(400).json({ error: 'Trade ID or all=true required' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[API Journal Trades Error]:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
  }
};
