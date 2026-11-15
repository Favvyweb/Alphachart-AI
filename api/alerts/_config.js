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
global._dailyRecordsMemory = global._dailyRecordsMemory || new Map();
global._sentSignalKeys = global._sentSignalKeys || new Set();

function getDatabaseUrl() {
  return process.env.DATABASE_URL
    || process.env.DATABASE_URI
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_URI
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || process.env.NEON_DATABASE_URL
    || process.env.NEON_URL
    || process.env.SUPABASE_DB_URL
    || process.env.SUPABASE_DATABASE_URL
    || process.env.SUPABASE_URL
    || process.env.DB_URL
    || process.env.DB_URI
    || process.env.POSTGRESQL_URL
    || null;
}

async function getDbClient() {
  const dbUrl = getDatabaseUrl();
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

    // Ensure alert_sent_events table exists to guarantee strict 1-shot alerts
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_sent_events (
        dedupe_key TEXT PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure daily_signal_records table exists for immutable past days
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_signal_records (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        date_key TEXT NOT NULL,
        day_name TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (pair, timeframe, date_key)
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

async function saveDailySignalRecord(pair, timeframe, dateKey, dayName, data) {
  const cleanPair = (pair || 'BTCUSDT').replace(/[\s\-_/]/g, '').toUpperCase();
  const cleanTf = timeframe || '5m';
  const memKey = `${cleanPair}_${cleanTf}_${dateKey}`;
  global._dailyRecordsMemory.set(memKey, data);

  const client = await getDbClient();
  if (client) {
    try {
      await client.query(`
        INSERT INTO daily_signal_records (pair, timeframe, date_key, day_name, data)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (pair, timeframe, date_key) DO UPDATE SET
          day_name = EXCLUDED.day_name,
          data = EXCLUDED.data;
      `, [cleanPair, cleanTf, dateKey, dayName, JSON.stringify(data)]);
    } catch (e) {
      console.warn('Error saving daily signal record to DB:', e.message);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

async function getDailySignalRecord(pair, timeframe, dateKey) {
  const cleanPair = (pair || 'BTCUSDT').replace(/[\s\-_/]/g, '').toUpperCase();
  const cleanTf = timeframe || '5m';
  const memKey = `${cleanPair}_${cleanTf}_${dateKey}`;

  const client = await getDbClient();
  if (client) {
    try {
      const res = await client.query(
        `SELECT data FROM daily_signal_records WHERE pair = $1 AND timeframe = $2 AND date_key = $3`,
        [cleanPair, cleanTf, dateKey]
      );
      if (res.rows && res.rows.length > 0) {
        const d = res.rows[0].data;
        return typeof d === 'string' ? JSON.parse(d) : d;
      }
    } catch (e) {
      console.warn('Error querying daily signal record from DB:', e.message);
    } finally {
      await client.end().catch(() => {});
    }
  }

  return global._dailyRecordsMemory.get(memKey) || null;
}

async function hasSentEvent(key) {
  if (!key) return false;
  const client = await getDbClient();
  if (client) {
    try {
      const res = await client.query('SELECT 1 FROM alert_sent_events WHERE dedupe_key = $1', [key]);
      return res.rows && res.rows.length > 0;
    } catch (e) {
      console.warn('Error checking sent event in DB:', e.message);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return global._sentSignalKeys.has(key);
}

async function markSentEvent(key) {
  if (!key) return;
  global._sentSignalKeys.add(key);
  const client = await getDbClient();
  if (client) {
    try {
      await client.query(`
        INSERT INTO alert_sent_events (dedupe_key) VALUES ($1)
        ON CONFLICT (dedupe_key) DO NOTHING;
      `, [key]);
    } catch (e) {
      console.warn('Error marking sent event in DB:', e.message);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

module.exports = {
  webpush,
  VAPID_PUBLIC_KEY,
  getDatabaseUrl,
  saveSubscription,
  getSubscriptions,
  removeSubscription,
  saveDailySignalRecord,
  getDailySignalRecord,
  hasSentEvent,
  markSentEvent
};

