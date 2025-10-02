import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: [/\.vercel\.app$/, /localhost:\d+$/],
    methods: ["GET", "POST"],
  })
);

// ---- Telegram initData verification
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

// ---- Simple catalog (price in paise, like INR cents)
global.PRODUCTS = [
  // Staples
  { id:"RICE5",  title:"Basmati Rice 5kg",    price: 89900, category:"Rice & Grains", image:"", tags:["rice"] },
  { id:"ATTA5",  title:"Wheat Flour 5kg",     price: 34900, category:"Flour & Atta",  image:"", tags:["flour"] },
  { id:"DAL1",   title:"Toor Dal 1kg",       price: 19900, category:"Pulses",        image:"", tags:["pulses"] },
  { id:"CHAITEA",title:"Masala Tea 250g",    price: 24900, category:"Tea & Beverages",image:"", tags:["tea"] },
  { id:"BIS1",   title:"Marie Biscuits 500g",price: 11900, category:"Snacks & Namkeen", image:"", tags:["biscuits"] },
  { id:"NP_MIX", title:"South Mix 400g",     price: 14900, category:"Snacks & Namkeen", image:"", tags:["namkeen"] },
  // Age-restricted samples (force COD)
  { id:"BEER6",  title:"Lager Beer 6-pack",  price: 79900, category:"Alcohol", image:"", tags:["alcohol"], ageRestricted:true },
  { id:"SMOKPK", title:"Cigarette Pack",     price: 34900, category:"Tobacco", image:"", tags:["tobacco"], ageRestricted:true },
];

// ---- Helpers
const uniq = (arr) => [...new Set(arr)].filter(Boolean);
function buildUpiLink({ pa, pn, am, cu="INR", tn="South Asia Mart order" }) {
  const params = new URLSearchParams({ pa, pn, am, cu, tn });
  return `upi://pay?${params.toString()}`;
}

// ---- Health
app.get("/", (_, res) => res.json({ ok:true, service:"backend-alive" }));

// ---- Verify user (test button)
app.post("/verify", (req, res) => {
  const { initData } = req.body || {};
  const result = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!result.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });
  const userRaw = new URLSearchParams(initData).get("user") || "{}";
  res.json({ ok:true, user: JSON.parse(decodeURIComponent(userRaw)) });
});

// ---- Categories & products
app.get("/categories", (_, res) => {
  const cats = uniq(global.PRODUCTS.map(p => p.category));
  res.json({ ok:true, categories: cats });
});

app.get("/products", (req, res) => {
  const cat = req.query.category;
  const items = cat ? global.PRODUCTS.filter(p => p.category === cat) : global.PRODUCTS;
  res.json({ ok:true, items });
});

// ---- Server pricing (and compliance flags)
app.post("/cart/price", (req, res) => {
  const { items = [] } = req.body || {};
  let total = 0;
  let ageRestricted = false;
  const detailed = items.map(({ id, qty = 1 }) => {
    const p = global.PRODUCTS.find(x => x.id === id);
    const price = p ? p.price : 0;
    total += price * qty;
    if (p?.ageRestricted) ageRestricted = true;
    return { id, qty, price, title: p?.title || id, ageRestricted: !!p?.ageRestricted };
  });

  // If any restricted item, disable ONLINE/UPI for safety; allow COD
  const payments = {
    onlineAllowed: !ageRestricted && !!process.env.PROVIDER_TOKEN,
    upiAllowed:    !ageRestricted,   // adjust to policy as needed
    codAllowed:    true
  };

  res.json({ ok:true, items: detailed, total, payments });
});

// ---- Place order for COD / UPI
app.post("/order", (req, res) => {
  try {
    const { initData, items = [], paymentMethod } = req.body || {};
    const check = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!check.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });

    let total = 0, ageRestricted=false;
    const priced = items.map(({ id, qty=1 }) => {
      const p = global.PRODUCTS.find(x => x.id === id);
      const price = p ? p.price : 0;
      total += price * qty;
      if (p?.ageRestricted) ageRestricted = true;
      return { id, qty, price };
    });
    if (total <= 0) return res.status(400).json({ ok:false, error:"EMPTY_CART" });

    const orderId = Date.now().toString();

    if (paymentMethod === "COD") {
      return res.json({ ok:true, orderId, total, method:"COD" });
    }
    if (paymentMethod === "UPI") {
      if (ageRestricted) return res.status(400).json({ ok:false, error:"RESTRICTED_UPI_BLOCKED" });
      const link = buildUpiLink({
        pa: process.env.UPI_PAYEE || "yourupi@okbank",
        pn: process.env.UPI_NAME  || "South Asia Mart",
        am: (total/100).toFixed(2),
        tn: `Order ${orderId}`
      });
      return res.json({ ok:true, orderId, total, method:"UPI", upi:{ link } });
    }
    return res.status(400).json({ ok:false, error:"UNSUPPORTED_METHOD" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

// ---- Online invoice (only if PROVIDER_TOKEN exists)
app.post("/checkout", async (req, res) => {
  try {
    if (!process.env.PROVIDER_TOKEN)
      return res.status(400).json({ ok:false, error:"ONLINE_DISABLED" });

    const { initData, items = [] } = req.body || {};
    const check = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!check.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });

    let total = 0, ageRestricted=false;
    const prices = items.map(({ id, qty=1 }) => {
      const p = global.PRODUCTS.find(x => x.id === id);
      if (p?.ageRestricted) ageRestricted = true;
      const amount = (p?.price || 0) * qty;
      total += amount;
      return { label: p?.title || id, amount };
    });
    if (total <= 0) return res.status(400).json({ ok:false, error:"EMPTY_CART" });
    if (ageRestricted) return res.status(400).json({ ok:false, error:"RESTRICTED_ONLINE_BLOCKED" });

    const resp = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        title: "South Asia Mart Order",
        description: "Groceries",
        payload: "order-" + Date.now(),
        provider_token: process.env.PROVIDER_TOKEN,
        currency: "INR",
        prices,
        need_name: true,
        need_shipping_address: true,
        is_flexible: false
      }),
    });
    const json = await resp.json();
    if (!json.ok) return res.status(500).json(json);
    res.json({ ok:true, link: json.result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
