// ===== Imports & app bootstrap =====
import express from "express";
import cors from "cors";
import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: [/\.vercel\.app$/, /localhost:\d+$/],
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ===== DB pool (single instance) =====
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  console.warn("DATABASE_URL not set — DB endpoints will return DB_NOT_CONFIGURED.");
}

// ===== Debug routes =====
app.get("/", (_req, res) => res.json({ ok: true, service: "backend-alive" }));

app.get("/__envcheck", (_req, res) => {
  const s = process.env.DATABASE_URL || "";
  let info = null;
  try { const u = new URL(s); info = { protocol: u.protocol, host: u.hostname, port: u.port }; } catch {}
  res.json({ ok: true, hasDATABASE_URL: !!s, db: info });
});

app.get("/__dbping", async (_req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok:true, result:r.rows[0] });
  } catch (e) {
    console.error("DB PING ERROR:", e);
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

async function tgSend(chatId, text, replyMarkup = null) {
  if (!process.env.BOT_TOKEN) return;
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(()=>{});
}

// Optional photo helper used in admin notifications
async function tgSendPhoto(chatId, base64, caption = "") {
  if (!process.env.BOT_TOKEN || !base64) return { ok: false };
  try {
    const form = new FormData();
    const buf = Buffer.from(base64.split(",").pop(), "base64");
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("photo", new Blob([buf], { type: "image/jpeg" }), "location.jpg");

    const resp = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });
    return await resp.json();
  } catch {
    return { ok: false };
  }
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
  status text not null default 'placed',
  created_at timestamptz not null default now(),
  geo_lat double precision,
  geo_lon double precision
);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint references orders(id) on delete cascade,
  product_id text references products(id),
  title text,
  price integer not null,
  qty integer not null
);

create table if not exists profiles (
  tg_user_id bigint primary key,
  name text,
  username text,
  phone text,
  address text,
  geo_lat double precision,
  geo_lon double precision,
  delivery_slot text,
  updated_at timestamptz not null default now()
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

// ===== Admin auth =====
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

// ===== Admin: schema + seed =====
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

// ===== Admin: products (CRUD) =====
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

// ===== Profiles API for WebApp (auto prefill) =====
app.post("/me", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const { initData } = req.body || {};
    const v = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!v.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });

    const tgUser = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"));
    const id = tgUser?.id;
    const name = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ").trim() || tgUser?.username || "Customer";

    await pool.query(`
      insert into profiles(tg_user_id, name, username)
      values($1,$2,$3)
      on conflict (tg_user_id) do update set name=coalesce(profiles.name, excluded.name),
                                           username=coalesce(excluded.username, profiles.username)
    `, [id, name, tgUser?.username || null]);

    const row = (await pool.query("select * from profiles where tg_user_id=$1", [id])).rows[0];
    res.json({ ok:true, profile: {
      tg_user_id: id,
      name: row?.name || name,
      username: row?.username || tgUser?.username || null,
      phone: row?.phone || "",
      address: row?.address || "",
      delivery_slot: row?.delivery_slot || "",
      geo: (row?.geo_lat && row?.geo_lon) ? { lat: row.geo_lat, lon: row.geo_lon } : null
    }});
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"ME_FAILED" });
  }
});

app.post("/me/update", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const { initData, phone, address, delivery_slot, geo } = req.body || {};
    const v = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!v.ok) return res.status(401).json({ ok:false, error:"INVALID_INIT_DATA" });
    const id = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"))?.id;

    await pool.query(`
      insert into profiles(tg_user_id, phone, address, delivery_slot, geo_lat, geo_lon, updated_at)
      values($1,$2,$3,$4,$5,$6, now())
      on conflict (tg_user_id) do update set
        phone = coalesce($2, profiles.phone),
        address = coalesce($3, profiles.address),
        delivery_slot = coalesce($4, profiles.delivery_slot),
        geo_lat = coalesce($5, profiles.geo_lat),
        geo_lon = coalesce($6, profiles.geo_lon),
        updated_at = now()
    `, [id, phone || null, address || null, delivery_slot || null, geo?.lat ?? null, geo?.lon ?? null]);

    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"ME_UPDATE_FAILED" });
  }
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

// ===== Place order (COD / UPI) + DM user confirmation =====
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

    const tgUser = JSON.parse(decodeURIComponent(new URLSearchParams(initData).get("user") || "{}"));
    const prof = (await pool.query("select * from profiles where tg_user_id=$1", [tgUser?.id || null])).rows[0];

    const ins = await pool.query(
      `insert into orders(tg_user_id,name,phone,address,slot,note,total,payment_method,status,geo_lat,geo_lon)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        tgUser?.id || null,
        form?.name || prof?.name || "",
        form?.phone || prof?.phone || "",
        form?.address || prof?.address || "",
        form?.slot || prof?.delivery_slot || "",
        form?.note || "",
        total,
        paymentMethod,
        "placed",
        form?.geo?.lat ?? prof?.geo_lat ?? null,
        form?.geo?.lon ?? prof?.geo_lon ?? null
      ]
    );

    const orderId = ins.rows[0].id;

    for (const d of detailed) {
      await pool.query(
        "insert into order_items(order_id,product_id,title,price,qty) values($1,$2,$3,$4,$5)",
        [orderId, d.id, d.title, d.price, d.qty]
      );
    }

    // ✅ Send confirmation to the USER
    const totalFormatted = `₹${rupees(total)}`;
    const openLink = process.env.WEBAPP_URL || "https://telegram-mini-mart.vercel.app/";
    await tgSend(
      tgUser?.id,
      `✅ *Order #${orderId} placed!*  \nTotal: *${totalFormatted}*  \nMethod: *${paymentMethod}*  \n\nYou can open the shop anytime: ${openLink}\nType /myorders to view your recent orders.`,
    );

    // (Optional) forward a photo to admin/channel — safe-guard: do not fail on photo
    if (form?.photoBase64 && process.env.ADMIN_CHAT_ID) {
      await tgSendPhoto(process.env.ADMIN_CHAT_ID, form.photoBase64, `Order #${orderId} location photo`);
    }

    if (paymentMethod === "COD") {
      return res.json({ ok: true, orderId, total, method: "COD" });
    }

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

// ===== “Bot only” endpoint: get recent orders for a user (used by /myorders) =====
// GET /bot/user-orders?uid=123&key=SECRET
app.get("/bot/user-orders", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });

    const key = req.query.key || "";
    if (!process.env.BOT_API_KEY || key !== process.env.BOT_API_KEY) {
      return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
    }

    const uid = String(req.query.uid || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(400).json({ ok:false, error:"BAD_UID" });

    const rows = (await pool.query(
      `select id, total, payment_method, status, created_at
         from orders
        where tg_user_id = $1
        order by created_at desc
        limit 10`,
      [uid]
    )).rows;

    res.json({
      ok: true,
      items: rows.map(r => ({
        id: r.id,
        total: r.total,
        totalFormatted: `₹${rupees(r.total)}`,
        method: r.payment_method,
        status: r.status,
        created_at: r.created_at
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"ORDERS_FETCH_FAILED" });
  }
});

// ===== Telegram webhook (for phone/location sharing – unchanged) =====
app.post("/telegram/webhook", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });
  try {
    const up = req.body;
    const msg = up?.message;
    const chatId = msg?.chat?.id;
    const uid = msg?.from?.id;

    const txt = (msg?.text || "").trim();
    if (/^\/start(?:\s+sharephone)?$/i.test(txt)) {
      await tgSend(chatId,
        "Tap the button below to share your phone number.",
        { keyboard: [[{ text: "Share my phone", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
      );
    }

    if (msg?.contact && (msg.contact.user_id === uid || !msg.contact.user_id)) {
      await pool.query(`
        insert into profiles(tg_user_id, phone, updated_at)
        values($1,$2,now())
        on conflict (tg_user_id) do update set phone=$2, updated_at=now()
      `, [uid, msg.contact.phone_number || null]);
      await tgSend(chatId, "Thanks! Phone number saved ✅");
    }

    if (msg?.location) {
      await pool.query(`
        insert into profiles(tg_user_id, geo_lat, geo_lon, updated_at)
        values($1,$2,$3,now())
        on conflict (tg_user_id) do update set geo_lat=$2, geo_lon=$3, updated_at=now()
      `, [uid, msg.location.latitude, msg.location.longitude]);
      await tgSend(chatId, "Location saved ✅");
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
