// Serverless Endpoint: /api/alerts/subscribe
// Handles registration of mobile/desktop Web Push subscriptions for 24/7 background alerts

const { saveSubscription, VAPID_PUBLIC_KEY } = require('./_config');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Return public VAPID key
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      vapidPublicKey: VAPID_PUBLIC_KEY
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const { subscription, pair, timeframe } = body || {};

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Valid PushSubscription required.' });
    }

    await saveSubscription(subscription, pair || 'AAVE / USDT', timeframe || '5m');

    return res.status(200).json({
      success: true,
      message: '24/7 background push notifications registered successfully! You will receive lockscreen alerts even when closed.'
    });
  } catch (err) {
    console.error('[Alerts Subscribe Error]', err);
    return res.status(500).json({
      error: 'Failed to save push subscription: ' + err.message
    });
  }
};
