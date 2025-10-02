import express from "express";
import cors from "cors";
import crypto from "crypto";

function buildUpiLink({ pa, pn, am, cu = "INR", tn = "South Asia Mart order" }) {
  // pa=payee address, pn=payee name, am=amount (string), cu=currency, tn=note
  const params = new URLSearchParams({ pa, pn, am, cu, tn });
  return `upi://pay?${params.toString()}`;
}

const app = express();
app.use(express.json());
app.use(cors());

function verifyInitData(initData, botToken) {
  if (!initData) return { ok: false, reason: "missing initData" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  const data = [];
  for (const [k, v] of params.entries()) data.push(`${k}=${v}`);
  data.sort();
  const dataCheckString = data.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const ok = hash && crypto.timingSafeEqual(Buffer.from(calcHash), Buffer.from(hash));
  return { ok, user: params.get("user") };
}

app.get("/", (_, res) => res.json({ ok: true, service: "backend-alive" }));

app.post("/verify", (req, res) => {
  const { initData } = req.body || {};
  const botToken = process.env.BOT_TOKEN;
  const result = verifyInitData(initData, botToken);
  if (!result.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });
  const userRaw = new URLSearchParams(initData).get("user") || "{}";
  return res.json({ ok: true, user: JSON.parse(decodeURIComponent(userRaw)) });


  app.post("/order", async (req, res) => {
  try {
    const { initData, items = [], paymentMethod } = req.body || {};
    const check = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!check.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });

    // Price on server (adapt to your DB if you have one)
    // Example uses your in-memory PRODUCTS array:
    let total = 0;
    const priced = items.map(({ id, qty = 1 }) => {
      const p = (global.PRODUCTS || []).find(x => x.id === id);
      const price = p ? p.price : 0;
      total += price * qty;
      return { id, qty, price };
    });

    if (total <= 0) return res.status(400).json({ ok:false, error:"EMPTY_CART" });

    const user = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"));
    const orderId = Date.now().toString(); // simple ID; use DB autoinc in production

    if (paymentMethod === "COD") {
      // Save as pending COD in your DB if you use one
      return res.json({
        ok: true,
        orderId,
        total,
        message: "COD order placed. Pay cash at delivery."
      });
    }

    if (paymentMethod === "UPI") {
      const link = buildUpiLink({
        pa: process.env.UPI_PAYEE,
        pn: process.env.UPI_NAME || "South Asia Mart",
        am: (total / 100).toFixed(2),
        tn: `Order ${orderId}`
      });
      return res.json({
        ok: true,
        orderId,
        total,
        upi: { link }
      });
    }

    return res.status(400).json({ ok:false, error:"UNSUPPORTED_METHOD" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }app.post("/order", async (req, res) => {
  try {
    const { initData, items = [], paymentMethod } = req.body || {};
    const check = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!check.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });

    // Price on server (adapt to your DB if you have one)
    // Example uses your in-memory PRODUCTS array:
    let total = 0;
    const priced = items.map(({ id, qty = 1 }) => {
      const p = (global.PRODUCTS || []).find(x => x.id === id);
      const price = p ? p.price : 0;
      total += price * qty;
      return { id, qty, price };
    });

    if (total <= 0) return res.status(400).json({ ok:false, error:"EMPTY_CART" });

    const user = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"));
    const orderId = Date.now().toString(); // simple ID; use DB autoinc in production

    if (paymentMethod === "COD") {
      // Save as pending COD in your DB if you use one
      return res.json({
        ok: true,
        orderId,
        total,
        message: "COD order placed. Pay cash at delivery."
      });
    }

    if (paymentMethod === "UPI") {
      const link = buildUpiLink({
        pa: process.env.UPI_PAYEE,
        pn: process.env.UPI_NAME || "South Asia Mart",
        am: (total / 100).toFixed(2),
        tn: `Order ${orderId}`
      });
      return res.json({
        ok: true,
        orderId,
        total,
        upi: { link }
      });
    }

    return res.status(400).json({ ok:false, error:"UNSUPPORTED_METHOD" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Backend running on :" + PORT));
