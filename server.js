/**
 * Minimal Stripe Checkout API (Express)
 * ------------------------------------
 * Host separately from your static site (Render/Railway/Fly.io/Vercel Functions).
 * Keep SECRET keys in environment variables (never commit them).
 *
 * ENV:
 *   STRIPE_SECRET_KEY=sk_test_...
 *   ALLOW_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io (comma-separated to allow multiple)
 *   SUCCESS_URL=https://YOUR_GITHUB_USERNAME.github.io/facecare-lp/thankyou.html
 *   CANCEL_URL=https://YOUR_GITHUB_USERNAME.github.io/facecare-lp/cart.html
 *   PRICE_MAP=essence-30ml:price_123,toner-150ml:price_456  (comma-separated pairs)
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const {
  STRIPE_SECRET_KEY,
  ALLOW_ORIGIN = '',
  SUCCESS_URL,
  CANCEL_URL,
  PRICE_MAP = '',
  PORT = 3000,
} = process.env;

if (!STRIPE_SECRET_KEY) {
  console.error('[FATAL] STRIPE_SECRET_KEY is missing');
  process.exit(1);
}

if (!SUCCESS_URL || !CANCEL_URL) {
  console.error('[FATAL] SUCCESS_URL and CANCEL_URL must be set');
  process.exit(1);
}

const stripe = require('stripe')(STRIPE_SECRET_KEY);

// Parse allow list
const allowList = ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

// Parse "itemId:priceId" pairs into an object
const priceMap = PRICE_MAP.split(',').reduce((acc, pair) => {
  const [k, v] = pair.split(':').map(s => s && s.trim());
  if (k && v) acc[k] = v;
  return acc;
}, {});

const app = express();

// CORS: allow only specified origins (or everything for non-browser clients with no origin)
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // allow curl/postman
    if (allowList.length === 0) return cb(null, true);
    if (allowList.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
}));

app.use(bodyParser.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/**
 * POST /create-checkout-session
 * Body: { "items": [ { "item_id":"essence-30ml", "quantity":1 }, ... ] }
 */
app.post('/create-checkout-session', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: 'No items' });
    }

    const line_items = items.map(({ item_id, quantity }) => {
      const price = priceMap[item_id];
      if (!price) throw new Error(`Unknown item_id: ${item_id}`);
      return {
        price,
        quantity: Math.max(1, Number(quantity || 1)),
        adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 }
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: CANCEL_URL,
    });

    res.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error:', err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Stripe API listening on :${PORT}`);
});

// === ここから diag 追加（server.js の他ルートの上でOK） ===
app.get("/diag", (req, res) => {
  const mode = (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") ? "live" :
               (process.env.STRIPE_SECRET_KEY ? "test" : "missing");
  res.json({
    ok: true,
    mode,
    priceMapKeys: Object.keys(PRICE_MAP),
    // CORS 設定確認用
    allowedOrigins
  });
});
// === ここまで ===
