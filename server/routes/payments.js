const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// Use raw body for webhook verification. Attach BEFORE any JSON parsers for this route.
router.post('/razorpay', express.raw({ type: '*/*' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing RAZORPAY_WEBHOOK_SECRET');
    return res.status(500).send('Server misconfigured');
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return res.status(400).send('Missing signature');

  try {
    // compute expected signature
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      console.warn('Webhook signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    // parse JSON body now
    const payload = JSON.parse(req.body.toString('utf8'));
    // Example: handle payment.authorized or payment.captured
    // IMPORTANT: Do not grant access until you validate the payment via Razorpay API if needed.
    if (payload.event === 'payment.captured' || payload.event === 'order.paid') {
      const paymentEntity = payload.payload && payload.payload.payment && payload.payload.payment.entity;
      // process payment: map to user/order and mark subscription active in DB
      // Example pseudocode:
      // const db = req.app.locals.db; await db.query('UPDATE users SET pro_expires_at = $1 WHERE id = $2', [newExpiry, userId]);
    }

    // respond
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
