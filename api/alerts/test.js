// Serverless Endpoint: /api/alerts/test
// Sends an immediate test Web Push notification to registered phones/devices even when closed

const { webpush, getSubscriptions, removeSubscription } = require('./_config');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const type = (body && body.type) || (req.query && req.query.type) || 'BUY';
    const pair = (body && body.pair) || (req.query && req.query.pair) || 'AAVE / USDT';
    const price = (body && body.price) || '112.50';

    const subscriptions = await getSubscriptions();

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        sent: 0,
        message: 'No push subscriptions currently registered. Enable alerts in the app first to register your device.'
      });
    }

    const payload = JSON.stringify({
      title: type === 'BUY'
        ? `🟢 BUY Signal Confirmed! ${pair}`
        : (type === 'SELL' ? `🔴 SELL Signal Confirmed! ${pair}` : `🎯 ${type} Hit! ${pair}`),
      body: type === 'BUY'
        ? `Entry: $${price} • Target: TP1 (+2%) | SL: -5% • Live Instant Alert`
        : (type === 'SELL' ? `Entry: $${price} • Target: TP1 (+2%) | SL: -5% • Live Instant Alert` : `Signal milestone achieved! Profit booked. Click to view chart.`),
      tag: `alphachart-test-${Date.now()}`,
      url: '/#charts',
      signal: {
        type,
        pair,
        price,
        time: Math.floor(Date.now() / 1000)
      }
    });

    let sent = 0;
    const errors = [];

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        // If subscription is expired or unregistered, prune it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await removeSubscription(sub.endpoint);
        } else {
          errors.push(err.message);
        }
      }
    }));

    return res.status(200).json({
      success: true,
      sent,
      totalDevices: subscriptions.length,
      message: `Test push sent successfully to ${sent} device(s)! Lockscreen notification delivered.`
    });
  } catch (err) {
    console.error('[Alerts Test Error]', err);
    return res.status(500).json({
      error: 'Failed to send test push notification: ' + err.message
    });
  }
};
