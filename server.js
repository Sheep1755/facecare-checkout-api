/**
 * Minimal Stripe Checkout API (Express) — Clean Fixed
 * --------------------------------------------------
 * ENV:
 *   STRIPE_SECRET_KEY=sk_test_...
 *   ALLOW_ORIGIN=https://sheep1755.github.io   (カンマ区切りで複数可)
 *   SUCCESS_URL=https://sheep1755.github.io/facecare-lp/thankyou.html
 *   CANCEL_URL=https://sheep1755.github.io/facecare-lp/cart.html
 *   PRICE_MAP= ①JSON か ②"key:price,key:price" どちらでもOK
 *     例①: {"toner-150":"price_...","cream-40":"price_..."}
 *     例②: toner-150:price_...,cream-40:price_...
 */

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// ---- ENV ----
const {
  STRIPE_SECRET_KEY,
  ALLOW_ORIGIN = "",
  SUCCESS_URL,
  CANCEL_URL,
  PRICE_MAP = "",
  PORT = 3000,
} = process.env;

if (!STRIPE_SECRET_KEY) {
  console.error("[FATAL] STRIPE_SECRET_KEY is missing");
  process.exit(1);
}
if (!SUCCESS_URL || !CANCEL_URL) {
  console.error("[FATAL] SUCCESS_URL and CANCEL_URL must be set");
  process.exit(1);
}

const stripe = require("stripe")(STRIPE_SECRET_KEY);

// ---- Parse allow list (CORS) ----
const allowList = ALLOW_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);

// ---- Parse PRICE_MAP (JSON or comma pairs) -> plain object ----
let priceMap = {};
try {
  if (PRICE_MAP.trim().startsWith("{")) {
    priceMap = JSON.parse(PRICE_MAP); // JSON 形式
  } else if (PRICE_MAP.trim()) {
    priceMap = PRICE_MAP.split(",").reduce((acc, pair) => {
      const [k, v] = pair.split(":").map(s => s && s.trim());
      if (k && v) acc[k] = v;
      return acc;
    }, {});
  }
} catch (e) {
  console.error("[FATAL] PRICE_MAP parse error:", e);
  process.exit(1);
}

const app = express();

// ---- CORS ----
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);            // curl/postman 等
      if (allowList.length === 0) return cb(null, true);
      if (allowList.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

// ---- Body parsers ----
app.use(bodyParser.json()); // JSON API 用

// ---- Health ----
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Diag（安全版・1つだけ）----
app.get("/diag", (_req, res) => {
  try {
    const mode = (STRIPE_SECRET_KEY || "").startsWith("sk_live_")
      ? "live"
      : (STRIPE_SECRET_KEY ? "test" : "missing");

    const priceMapKeys = Object.keys(priceMap || {});
    res.json({
      ok: true,
      mode,
      priceMapKeys,
      allowList, // CORS の許可オリジン
    });
  } catch (e) {
    console.error("[/diag] error:", e);
    res.status(500).send("diag error");
  }
});

/**
 * ---- Checkout session（形式の違いに強い・1つだけ）----
 * 受け付けるボディ：
 *   A) { items: [{ id|productId|sku|item_id, qty|quantity }, ...] }
 *   B) { productId|sku|item_id, quantity }
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const body = req.body || {};
    let lineItems = [];

    if (Array.isArray(body.items) && body.items.length > 0) {
      lineItems = body.items.map((it) => {
        const key = it.id ?? it.productId ?? it.sku ?? it.item_id;
        const priceId = priceMap[key];
        return {
          key,
          price: priceId,
          quantity: Math.max(1, Number(it.qty ?? it.quantity ?? 1) || 1),
        };
      });
    } else {
      const key = body.productId ?? body.item_id ?? body.sku;
      if (!key) {
        console.error("[create] No items / body:", body);
        return res.status(400).json({ error: "No items" });
      }
      const priceId = priceMap[key];
      lineItems = [
        { key, price: priceId, quantity: Math.max(1, Number(body.quantity ?? 1) || 1) },
      ];
    }

    const unknown = lineItems.filter(li => !li.price).map(li => li.key);
    if (unknown.length) {
      console.error("[create] Unknown product keys:", unknown, "known:", Object.keys(priceMap));
      return res.status(400).json({ error: `Unknown productId: ${unknown.join(",")}` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems.map(li => ({ price: li.price, quantity: li.quantity })),
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("[create] fatal:", err);
    return res.status(500).json({ error: "Failed to create session" });
  }
});

// ---- Listen（最後に1回だけ）----
app.listen(PORT, () => {
  console.log(`Stripe API listening on :${PORT}`);
});
