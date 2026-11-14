// Central Web Push & Database Configuration for 24/7 Signal Alerts
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHpqr3UT0lcUUPbk7x_9ndY66CIVM0ODI6H2ZgOcMfmARzS5yPn2fXcoY_7cYmph3M_8F81Egy-Nb2NswCYibAw';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'kIsS01tCvmJLX-TM3DkSTcP0Tla64WESeYpx-McpJe0';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@alphachart.ai';

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// In-memory fallback if PostgreSQL is not connected
global._pushSubscriptionsMemory = global._pushSubscriptionsMemory || new Map();
global._lastProcessedSignals = global._lastProcessedSignals || new Map();

async function getDbClient() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;

  try {
    let Client;
    try {
      const pg = require('pg');
      Client = pg.Client;
    } catch (e) {
      const neon = require('@neondatabase/serverless');
      Client = neon.Client;
    }

    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();

    // Ensure push_subscriptions table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        pair TEXT DEFAULT 'AAVE / USDT',
        timeframe TEXT DEFAULT '5m',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_notified_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      );
    `);

    return client;
  } catch (err) {
    console.warn('[Alerts DB] Database connection fallback:', err.message);
    return null;
  }
}

async function saveSubscription(sub, pair = 'AAVE / USDT', timeframe = '5m') {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Invalid PushSubscription payload.');
  }

  const client = await getDbClient();
  if (client) {
    try {
      await client.query(`
        INSERT INTO push_subscriptions (endpoint, p256dh, auth, pair, timeframe, last_notified_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (endpoint) DO UPDATE SET
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          pair = EXCLUDED.pair,
          timeframe = EXCLUDED.timeframe,
          last_notified_at = CURRENT_TIMESTAMP;
      `, [sub.endpoint, sub.keys.p256dh, sub.keys.auth, pair, timeframe]);
    } finally {
      await client.end().catch(() => {});
    }
  } else {
    // Memory fallback
    global._pushSubscriptionsMemory.set(sub.endpoint, {
      endpoint: sub.endpoint,
      keys: sub.keys,
      pair,
      timeframe,
      updatedAt: Date.now()
    });
  }
  return true;
}

async function getSubscriptions() {
  const client = await getDbClient();
  if (client) {
    try {
      const res = await client.query(`SELECT endpoint, p256dh, auth, pair, timeframe FROM push_subscriptions`);
      return res.rows.map(r => ({
        endpoint: r.endpoint,
        keys: { p256dh: r.p256dh, auth: r.auth },
        pair: r.pair,
        timeframe: r.timeframe
      }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Memory fallback
  return Array.from(global._pushSubscriptionsMemory.values());
}

async function removeSubscription(endpoint) {
  const client = await getDbClient();
  if (client) {
    try {
      await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    } finally {
      await client.end().catch(() => {});
    }
  }
  global._pushSubscriptionsMemory.delete(endpoint);
}

module.exports = {
  webpush,
  VAPID_PUBLIC_KEY,
  saveSubscription,
  getSubscriptions,
  removeSubscription
};
