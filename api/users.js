// Vercel / Node.js Serverless API Endpoint: /api/users
// Retrieves all signed-up users from PostgreSQL for email marketing campaigns and CRM

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET.' });
  }

  try {
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      return res.status(200).json({
        success: true,
        count: 0,
        subscribers: [],
        notice: 'DATABASE_URL is not set yet. Configure DATABASE_URL in your hosting environment (Vercel/Supabase/Neon).'
      });
    }

    let Client;
    try {
      const pg = require('pg');
      Client = pg.Client;
    } catch (err) {
      const neon = require('@neondatabase/serverless');
      Client = neon.Client;
    }

    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();

    const result = await client.query(`
      SELECT 
        id,
        email,
        display_name,
        subscription_tier,
        login_count,
        device_platform,
        pwa_installed,
        created_at,
        last_login_at
      FROM users
      ORDER BY created_at DESC;
    `);

    await client.end();

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      subscribers: result.rows
    });
  } catch (error) {
    console.error('Fetch Users Error:', error);
    return res.status(500).json({
      error: 'Failed to query PostgreSQL subscribers.',
      details: error.message
    });
  }
};

