// ===== Imports & app bootstrap =====
import express from "express";
import cors from "cors";
import crypto from "crypto";
import pkg from "pg";                 // postgres client (pg)
const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: [/\.vercel\.app$/, /localhost:\d+$/],
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ===== Single pool declaration (do NOT redeclare anywhere) =====
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // required for Render external PG
  });
} else {
  console.warn("DATABASE_URL not set — DB endpoints will return DB_NOT_CONFIGURED.");
}

// ===== TEMP debug routes (remove later) =====
app.get("/__envcheck", (req, res) => {
  const s = process.env.DATABASE_URL || "";
  let info = null;
  try {
    const u = new URL(s);
    info = { protocol: u.protocol, host: u.hostname, port: u.port };
  } catch { info = null; }
  res.json({ ok: true, hasDATABASE_URL: !!s, db: info });
});

app.get("/__dbping", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok:true, result:r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// ===== Helpers =====
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
const rupees = (p) => (p / 100).toFixed(2);
function buildUpiLink({ pa, pn, am, cu = "INR", tn = "South Asia Mart order" }) {
  const params = new URLSearchParams({ pa, pn, am, cu, tn });
  return `upi://pay?${params.toString()}`;
}

// ===== Schema & seed =====
const SCHEMA_SQL = `
create table if not exists products (
  id text primary key,
  title text not null,
  price integer not null check (price >= 0),
  category text not null,
  image text default '',
  age_restricted boolean not null default false,
  stock integer not null default 999
);

create table if not exists orders (
  id bigserial primary key,
  tg_user_id bigint,
  name text,
  phone text,
  address text,
  slot text,
  note text,
  total integer not null,
  payment_method text not null,
  status text not null default 'placed', -- placed, paid, cancelled
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint references orders(id) on delete cascade,
  product_id text references products(id),
  title text,
  price integer not null,
  qty integer not null
);
`;

const SEED_SQL = `
insert into products(id,title,price,category,image,age_restricted,stock) values
('RICE5','Basmati Rice 5kg',89900,'Rice & Grains','',false,500),
('ATTA5','Wheat Flour 5kg',34900,'Flour & Atta','',false,500),
('DAL1','Toor Dal 1kg',19900,'Pulses','',false,500),
('CHAITEA','Masala Tea 250g',24900,'Tea & Beverages','',false,500),
('NP_MIX','South Mix 400g',14900,'Snacks & Namkeen','',false,500),
('BIS1','Marie Biscuits 500g',11900,'Snacks & Namkeen','',false,500),
('BEER6','Lager Beer 6-pack',79900,'Alcohol','',true,200),
('SMOKPK','Cigarette Pack',34900,'Tobacco','',true,200)
on conflict (id) do nothing;
`;

// ===== Health =====
app.get("/", (_req, res) => res.json({ ok: true, service: "backend-alive" }));

// ===== Verify test =====
app.post("/verify", (req, res) => {
  const { initData } = req.body || {};
  const r = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!r.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });
  const userRaw = new URLSearchParams(initData).get("user") || "{}";
  res.json({ ok: true, user: JSON.parse(decodeURIComponent(userRaw)) });
});

// ===== Admin (init/seed, secure by header) =====
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

app.post("/admin/init", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  await pool.query(SCHEMA_SQL);
  res.json({ ok: true });
});

app.post("/admin/seed", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  await pool.query(SEED_SQL);
  res.json({ ok: true });
});

app.get("/admin/products", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  const q = await pool.query("select * from products order by title");
  res.json({ ok: true, items: q.rows });
});

app.post("/admin/products", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  const { id, title, price, category, image = "", age_restricted = false, stock = 999 } = req.body || {};
  if (!id || !title || !category) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  await pool.query(
    `insert into products(id,title,price,category,image,age_restricted,stock)
     values($1,$2,$3,$4,$5,$6,$7)
     on conflict(id) do update set title=$2,price=$3,category=$4,image=$5,age_restricted=$6,stock=$7`,
    [id, title, +price || 0, category, image, !!age_restricted, +stock || 0]
  );
  res.json({ ok: true });
});

app.delete("/admin/products/:id", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  await pool.query("delete from products where id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ===== Public catalog =====
app.get("/categories", async (_req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  const q = await pool.query("select distinct category from products order by category");
  res.json({ ok: true, categories: q.rows.map(r => r.category) });
});

app.get("/products", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  const cat = req.query.category;
  const q = cat
    ? await pool.query("select * from products where category=$1 order by title", [cat])
    : await pool.query("select * from products order by title");
  res.json({ ok: true, items: q.rows });
});

// ===== Price cart on server =====
app.post("/cart/price", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  const { items = [] } = req.body || {};
  if (!items.length) {
    return res.json({
      ok: true, items: [], total: 0,
      payments: { onlineAllowed: !!process.env.PROVIDER_TOKEN, upiAllowed: true, codAllowed: true }
    });
  }
  const ids = items.map(i => i.id);
  const q = await pool.query("select id,title,price,age_restricted from products where id = any($1)", [ids]);
  const map = new Map(q.rows.map(r => [r.id, r]));
  let total = 0, restricted = false;
  const detailed = items.map(({ id, qty = 1 }) => {
    const p = map.get(id);
    const price = p ? p.price : 0;
    total += price * qty;
    if (p?.age_restricted) restricted = true;
    return { id, qty, price, title: p?.title || id, ageRestricted: !!p?.age_restricted };
  });
  const payments = {
    onlineAllowed: !restricted && !!process.env.PROVIDER_TOKEN,
    upiAllowed: !restricted,
    codAllowed: true,
  };
  res.json({ ok: true, items: detailed, total, payments });
});

// ===== Place order (COD / UPI) =====
app.post("/order", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const { initData, items = [], paymentMethod, form } = req.body || {};
    const r = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!r.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });

    const ids = items.map(i => i.id);
    const q = await pool.query("select id,title,price,age_restricted from products where id = any($1)", [ids]);
    const map = new Map(q.rows.map(r => [r.id, r]));
    let total = 0, restricted = false;
    const detailed = items.map(({ id, qty = 1 }) => {
      const p = map.get(id);
      const price = p ? p.price : 0;
      total += price * qty;
      if (p?.age_restricted) restricted = true;
      return { id, title: p?.title || id, price, qty };
    });
    if (total <= 0) return res.status(400).json({ ok: false, error: "EMPTY_CART" });
    if (paymentMethod === "UPI" && restricted) return res.status(400).json({ ok: false, error: "RESTRICTED_UPI_BLOCKED" });

    const user = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"));
    const ins = await pool.query(
      `insert into orders(tg_user_id,name,phone,address,slot,note,total,payment_method,status)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [user?.id || null, form?.name || "", form?.phone || "", form?.address || "", form?.slot || "", form?.note || "", total, paymentMethod, "placed"]
    );
    const orderId = ins.rows[0].id;
    for (const d of detailed) {
      await pool.query("insert into order_items(order_id,product_id,title,price,qty) values($1,$2,$3,$4,$5)", [orderId, d.id, d.title, d.price, d.qty]);
    }

    if (paymentMethod === "COD") return res.json({ ok: true, orderId, total, method: "COD" });

    if (paymentMethod === "UPI") {
      const link = buildUpiLink({
        pa: process.env.UPI_PAYEE || "yourupi@okbank",
        pn: process.env.UPI_NAME || "South Asia Mart",
        am: rupees(total),
        tn: `Order ${orderId}`,
      });
      return res.json({ ok: true, orderId, total, method: "UPI", upi: { link } });
    }

    return res.status(400).json({ ok: false, error: "UNSUPPORTED_METHOD" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ===== Online invoice (needs PROVIDER_TOKEN) =====
app.post("/checkout", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    if (!process.env.PROVIDER_TOKEN) return res.status(400).json({ ok: false, error: "ONLINE_DISABLED" });
    const { initData, items = [], form } = req.body || {};
    const r = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!r.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });

    const ids = items.map(i => i.id);
    const q = await pool.query("select id,title,price,age_restricted from products where id = any($1)", [ids]);
    const map = new Map(q.rows.map(r => [r.id, r]));
    let total = 0, restricted = false;
    const prices = items.map(({ id, qty = 1 }) => {
      const p = map.get(id);
      if (p?.age_restricted) restricted = true;
      const amount = (p?.price || 0) * qty;
      total += amount;
      return { label: p?.title || id, amount };
    });
    if (total <= 0) return res.status(400).json({ ok: false, error: "EMPTY_CART" });
    if (restricted) return res.status(400).json({ ok: false, error: "RESTRICTED_ONLINE_BLOCKED" });

    const resp = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "South Asia Mart Order",
        description: `${form?.name || ""} · ${form?.phone || ""}`,
        payload: "order-" + Date.now(),
        provider_token: process.env.PROVIDER_TOKEN,
        currency: "INR",
        prices,
        need_name: true,
        need_shipping_address: true,
        is_flexible: false,
      }),
    });
    const json = await resp.json();
    if (!json.ok) return res.status(500).json(json);
    res.json({ ok: true, link: json.result, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ===== Telegram paid webhook =====
app.post("/telegram/webhook", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const update = req.body;
    const sp = update?.message?.successful_payment;
    if (sp) {
      const uid = update?.message?.from?.id || null;
      await pool.query(
        "update orders set status='paid' where tg_user_id=$1 and status='placed' order by created_at desc limit 1",
        [uid]
      );
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

// ===== Start server =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
