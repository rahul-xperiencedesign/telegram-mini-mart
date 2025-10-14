// ===== Imports & app bootstrap =====
import express from "express";
import cors from "cors";
import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;

// --- NEW: admin + upload libs ---
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import formidable from "formidable";
import { v2 as cloudinary } from "cloudinary";

// --- TEMP: JWT diagnostics helper ---
function readBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (!h) return { ok: false, reason: "NO_AUTH_HEADER" };
  const parts = h.split(/\s+/);
  if (parts.length < 2 || parts[0].toLowerCase() !== "bearer")
    return { ok: false, reason: "BAD_SCHEME", raw: h };
  const token = parts.slice(1).join(" ").trim();
  if (!token) return { ok: false, reason: "EMPTY_TOKEN" };
  return { ok: true, token };
}

// Node >=18 has global fetch. If your logs ever show "fetch is not defined",
// add:  import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "4mb" })); // allow base64 images comfortably
app.use(
  cors({
    origin: [/\.vercel\.app$/, /localhost:\d+$/],
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// --- NEW: Cloudinary config ONLY if set ---
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
}

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
app.get("/__envcheck", (_req, res) => {
  const s = process.env.DATABASE_URL || "";
  let info = null;
  try {
    const u = new URL(s);
    info = { protocol: u.protocol, host: u.hostname, port: u.port };
  } catch {}
  res.json({
    ok: true,
    hasDATABASE_URL: !!s,
    db: info,
    hasBOT: !!process.env.BOT_TOKEN,
    channel: process.env.CHANNEL_ID || null,
    hasCloudinary: !!process.env.CLOUDINARY_URL,
    hasJwtSecret: !!process.env.JWT_SECRET,
  });
});

app.get("/__dbping", async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok: true, result: r.rows[0] });
  } catch (e) {
    console.error("DB PING ERROR:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== Helpers (Telegram + auth) =====
const CHANNEL_ID = process.env.CHANNEL_ID || ""; // e.g. @SouthAsiaMartChannel or -100...

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
  }).catch(() => {});
}

async function tgSendMd(chatId, text) {
  if (!process.env.BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch (_) {}
}

// ----- Channel notify helpers -----
function formatOrderText({ id, name, phone, address, slot, total, payment_method }) {
  return [
    `🧾 *New Order #${id}*`,
    name ? `👤 ${name}` : "👤 —",
    phone ? `📞 ${phone}` : "📞 —",
    address ? `🏠 ${address}` : "🏠 —",
    slot ? `🗓 ${slot}` : "🗓 —",
    `💴 ₹${rupees(total)}`,
    payment_method || "",
  ].join("\n");
}

async function notifyChannelOrder(row) {
  try {
    if (!process.env.BOT_TOKEN || !CHANNEL_ID) return;
    const text = formatOrderText(row);
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (e) {
    console.warn("notifyChannelOrder failed:", e?.message || e);
  }
}

// ===== Admin JWT helpers (NEW) =====
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || "7", 10);

function signAdminJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${SESSION_TTL_DAYS}d` });
}
function readBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
function tryVerifyJwt(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
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

// --- NEW: separate admin schema (keeps your original constant intact) ---
const SCHEMA_ADMIN_SQL = `
create table if not exists admin_users (
  id bigserial primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
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

// ===== Admin auth middleware (REPLACED) =====
// Backward compatible: still accepts x-admin-key == ADMIN_PASSWORD
async function requireAdmin(req, res, next) {
  // 1) old header path
  const legacyKey = req.headers["x-admin-key"];
  if (legacyKey && legacyKey === process.env.ADMIN_PASSWORD) return next();

  // 2) JWT path
  const token = readBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

  const data = tryVerifyJwt(token);
  if (!data?.aid) return res.status(401).json({ ok: false, error: "BAD_TOKEN" });

  try {
    const r = await pool.query("select id,email,name,active from admin_users where id=$1", [data.aid]);
    if (!r.rowCount || !r.rows[0].active) return res.status(403).json({ ok:false, error:"ADMIN_DISABLED" });
    req.admin = r.rows[0];
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"AUTH_DB_ERROR" });
  }
}

// ===== Admin: schema + seed =====
app.post("/admin/init", async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    await pool.query(SCHEMA_SQL);
    await pool.query(SCHEMA_ADMIN_SQL);

    // Optional seed default admin from env the FIRST time
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const exists = await pool.query("select 1 from admin_users where email=$1", [process.env.ADMIN_EMAIL.toLowerCase()]);
      if (!exists.rowCount) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        await pool.query(
          "insert into admin_users(email,name,password_hash,active) values($1,$2,$3,true)",
          [process.env.ADMIN_EMAIL.toLowerCase(), "Owner", hash]
        );
        console.log("Seeded default admin:", process.env.ADMIN_EMAIL);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"INIT_FAILED" });
  }
});

app.post("/admin/seed", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  await pool.query(SEED_SQL);
  res.json({ ok: true });
});

// ===== Admin: auth (email+password -> JWT), plus admin-key exchange =====

// POST /admin/auth/login  (email+password -> JWT)
// Accepts ADMIN_EMAIL='*' (wildcard) or case-insensitive exact match
app.post("/admin/auth/login", async (req, res) => {
  try {
    const { email = "", password = "" } = req.body || {};
    const cfgEmail = (process.env.ADMIN_EMAIL || "").trim();
    const cfgPass = (process.env.ADMIN_PASSWORD || "").trim();
    const jwtSecret = process.env.JWT_SECRET || "dev-secret";

    // password must match exactly
    const passOk = password === cfgPass;

    // email: wildcard or case-insensitive exact match; if ADMIN_EMAIL unset, skip email check
    const emailOk =
      !cfgEmail ||
      cfgEmail === "*" ||
      email.trim().toLowerCase() === cfgEmail.toLowerCase();

    if (!passOk || !emailOk) {
      return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    const token = jwt.sign(
      { sub: "admin", email: email.trim(), role: "admin" },
      jwtSecret,
      { expiresIn: "7d" }
    );
    res.json({ ok: true, token });
  } catch (e) {
    console.error("ADMIN_LOGIN_FAILED:", e);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// POST /admin/auth/exchange  (x-admin-key == ADMIN_PASSWORD -> JWT)
app.post("/admin/auth/exchange", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    const cfgPass = (process.env.ADMIN_PASSWORD || "").trim();
    const jwtSecret = process.env.JWT_SECRET || "dev-secret";

    if (!key || key !== cfgPass) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const token = jwt.sign(
      { sub: "admin", email: process.env.ADMIN_EMAIL || "admin", role: "admin" },
      jwtSecret,
      { expiresIn: "7d" }
    );
    res.json({ ok: true, token });
  } catch (e) {
    console.error("ADMIN_EXCHANGE_FAILED:", e);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ===== Admin auth routes (NEW) =====
app.post("/admin/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:"MISSING_FIELDS" });

    const r = await pool.query(
      "select id,email,name,password_hash,active from admin_users where email=$1",
      [String(email).trim().toLowerCase()]
    );
    if (!r.rowCount) return res.status(401).json({ ok:false, error:"INVALID_CREDENTIALS" });

    const u = r.rows[0];
    if (!u.active) return res.status(403).json({ ok:false, error:"ADMIN_DISABLED" });

    const good = await bcrypt.compare(password, u.password_hash);
    if (!good) return res.status(401).json({ ok:false, error:"INVALID_CREDENTIALS" });

    const token = signAdminJwt({ aid: u.id });
    res.json({ ok:true, token, admin: { id: u.id, email: u.email, name: u.name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"LOGIN_FAILED" });
  }
});

app.get("/admin/auth/session", requireAdmin, async (req, res) => {
  res.json({ ok:true, admin: req.admin || null });
});

// --- TEMP: JWT verify endpoint (for debugging) ---
import jwt from "jsonwebtoken"; // ensure you have a single jwt import once in the file

app.get("/admin/auth/verify", (req, res) => {
  try {
    const r = readBearer(req);
    if (!r.ok) return res.status(401).json({ ok: false, error: r.reason, raw: r.raw });

    try {
      const payload = jwt.verify(r.token, process.env.JWT_SECRET);
      return res.json({ ok: true, payload });
    } catch (e) {
      // Log the exact reason on the server; send a safe message to client
      console.warn("JWT verify failed:", e?.message || e);
      return res.status(401).json({ ok: false, error: "BAD_TOKEN", message: e?.message || String(e) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: "VERIFY_ERROR" });
  }
});

// ===== Admin users CRUD (NEW) =====
app.get("/admin/users", requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(
      "select id,email,name,active,created_at from admin_users order by created_at desc"
    );
    res.json({ ok:true, items: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"LIST_ADMINS_FAILED" });
  }
});

app.post("/admin/users", requireAdmin, async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    if (!email || !name || !password) return res.status(400).json({ ok:false, error:"MISSING_FIELDS" });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `insert into admin_users(email,name,password_hash,active) values($1,$2,$3,true)`,
      [email.trim().toLowerCase(), name.trim(), hash]
    );
    res.json({ ok:true });
  } catch (e) {
    if (String(e).includes("unique")) return res.status(409).json({ ok:false, error:"EMAIL_EXISTS" });
    console.error(e);
    res.status(500).json({ ok:false, error:"CREATE_ADMIN_FAILED" });
  }
});

app.put("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    const { name, password, active } = req.body || {};
    const sets = [];
    const args = [];
    let i = 1;

    if (name != null) { sets.push(`name=$${i++}`); args.push(name); }
    if (password) { sets.push(`password_hash=$${i++}`); args.push(await bcrypt.hash(password, 10)); }
    if (active != null) { sets.push(`active=$${i++}`); args.push(!!active); }

    if (!sets.length) return res.json({ ok:true });

    args.push(id);
    await pool.query(`update admin_users set ${sets.join(",")} where id=$${i}`, args);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"UPDATE_ADMIN_FAILED" });
  }
});

app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    // soft-disable instead of hard delete
    await pool.query("update admin_users set active=false where id=$1", [id]);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"DELETE_ADMIN_FAILED" });
  }
});

// ===== OPTIONAL: Image upload (Cloudinary) =====
app.post("/admin/upload", requireAdmin, async (req, res) => {
  if (!process.env.CLOUDINARY_URL) {
    return res.status(400).json({ ok:false, error:"UPLOAD_NOT_CONFIGURED" });
  }
  try {
    const form = formidable({ multiples: false, allowEmptyFiles: false });
    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(400).json({ ok:false, error:"BAD_FORMDATA" });
      const fileField = files.file || files.image || files.photo;
      if (!fileField) return res.status(400).json({ ok:false, error:"NO_FILE" });

      const f = Array.isArray(fileField) ? fileField[0] : fileField;
      const filepath = f?.filepath || f?.path;
      if (!filepath) return res.status(400).json({ ok:false, error:"NO_TEMP_PATH" });

      try {
        const up = await cloudinary.uploader.upload(filepath, {
          folder: process.env.CLOUDINARY_FOLDER || "telegram-mini-mart",
          overwrite: true,
        });
        return res.json({ ok:true, url: up.secure_url, public_id: up.public_id });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ ok:false, error:"UPLOAD_FAILED" });
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"UPLOAD_ERROR" });
  }
});

// ===== Admin: products =====
app.get("/admin/products", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const q = await pool.query("select * from products order by title");
  res.json({ ok: true, items: q.rows });
});
app.post("/admin/products", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const { id, title, price, category, image = "", age_restricted = false, stock = 999 } =
    req.body || {};
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
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  await pool.query("delete from products where id=$1", [req.params.id]);
  res.json({ ok: true });
});
app.post("/admin/products/bulk", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const { items = [] } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const p of items) {
      const { id, title, price, category, image = "", age_restricted = false, stock = 999 } = p;
      if (!id || !title || !category) continue;
      await client.query(
        `insert into products(id,title,price,category,image,age_restricted,stock)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict(id) do update set
           title=$2, price=$3, category=$4, image=$5, age_restricted=$6, stock=$7`,
        [id, title, +price || 0, category, image, !!age_restricted, +stock || 0]
      );
    }
    await client.query("commit");
    res.json({ ok: true, upserted: items.length });
  } catch (e) {
    await client.query("rollback");
    console.error(e);
    res.status(500).json({ ok: false, error: "BULK_FAILED" });
  } finally {
    client.release();
  }
});

// ===== Admin: stats + orders + profiles =====
app.get("/admin/stats", requireAdmin, async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const prod = await pool.query("select count(*)::int as count from products");
    const rev = await pool.query(
      "select coalesce(sum(total),0)::int as revenue from orders where status in ('paid','placed')"
    );
    const last7 = await pool.query(`
      select to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day,
             count(*)::int as orders, coalesce(sum(total),0)::int as revenue
      from orders where created_at > now() - interval '7 days'
      group by 1 order by 1
    `);
    const low = await pool.query(
      "select id,title,stock from products where stock <= 20 order by stock asc limit 20"
    );
    res.json({
      ok: true,
      product_count: prod.rows[0].count,
      revenue: rev.rows[0].revenue,
      last7: last7.rows,
      low_stock: low.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "STATS_FAILED" });
  }
});
app.get("/admin/orders", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const { status, q, page = "1", pageSize = "20" } = req.query;
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);
    const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(name ilike $${i} or phone ilike $${i} or address ilike $${i})`);
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const items = (
      await pool.query(
        `select id, name, phone, address, slot, note, total, status, created_at, geo_lat, geo_lon
         from orders ${whereSql}
         order by created_at desc
         limit ${limit} offset ${offset}`,
        params
      )
    ).rows;

    const total = (
      await pool.query(`select count(*)::int as count from orders ${whereSql}`, params)
    ).rows[0].count;

    res.json({ ok: true, items, page: +page, pageSize: limit, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "ORDERS_FAILED" });
  }
});
app.put("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const allowed = ["placed", "paid", "shipped", "delivered", "cancelled"];
  const { status } = req.body || {};
  if (!allowed.includes(status))
    return res.status(400).json({ ok: false, error: "INVALID_STATUS" });
  await pool.query("update orders set status=$1 where id=$2", [status, req.params.id]);
  res.json({ ok: true });
});
app.get("/admin/profiles", requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const { page = "1", pageSize = "50", q } = req.query;
  const limit = Math.min(parseInt(pageSize, 10) || 50, 200);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;
  const params = [];
  let where = "";
  if (q) {
    params.push(`%${q}%`);
    where = `where (name ilike $1 or phone ilike $1 or username ilike $1)`;
  }
  const rows = (
    await pool.query(
      `select tg_user_id, name, username, phone, address, delivery_slot, geo_lat, geo_lon, updated_at
       from profiles ${where} order by updated_at desc limit ${limit} offset ${offset}`,
      params
    )
  ).rows;
  const total = (
    await pool.query(`select count(*)::int as c from profiles ${where}`, params)
  ).rows[0].c;
  res.json({ ok: true, items: rows, page: +page, pageSize: limit, total });
});

// ===== Public catalog =====
app.get("/categories", async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const q = await pool.query("select distinct category from products order by category");
  res.json({ ok: true, categories: q.rows.map((r) => r.category) });
});
app.get("/products", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const cat = req.query.category;
  const q = cat
    ? await pool.query("select * from products where category=$1 order by title", [cat])
    : await pool.query("select * from products order by title");
  res.json({ ok: true, items: q.rows });
});

// ===== Profiles API for WebApp (auto prefill) =====
app.post("/me", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const { initData } = req.body || {};
    const v = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!v.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });

    const tgUser = JSON.parse(
      decodeURIComponent(new URLSearchParams(initData).get("user") || "{}")
    );
    const id = tgUser?.id;
    const name =
      [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ").trim() ||
      tgUser?.username ||
      "Customer";

    await pool.query(
      `
      insert into profiles(tg_user_id, name, username)
      values($1,$2,$3)
      on conflict (tg_user_id) do update set
        name=coalesce(profiles.name, excluded.name),
        username=coalesce(excluded.username, profiles.username)
    `,
      [id, name, tgUser?.username || null]
    );

    const row = (await pool.query("select * from profiles where tg_user_id=$1", [id])).rows[0];
    res.json({
      ok: true,
      profile: {
        tg_user_id: id,
        name: row?.name || name,
        username: row?.username || tgUser?.username || null,
        phone: row?.phone || "",
        address: row?.address || "",
        delivery_slot: row?.delivery_slot || "",
        geo: row?.geo_lat && row?.geo_lon ? { lat: row.geo_lat, lon: row.geo_lon } : null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "ME_FAILED" });
  }
});

app.post("/me/update", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const { initData, phone, address, delivery_slot, geo } = req.body || {};
    const v = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!v.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });
    const id = JSON.parse(
      decodeURIComponent(new URLSearchParams(initData).get("user") || "{}")
    )?.id;

    await pool.query(
      `
      insert into profiles(tg_user_id, phone, address, delivery_slot, geo_lat, geo_lon, updated_at)
      values($1,$2,$3,$4,$5,$6, now())
      on conflict (tg_user_id) do update set
        phone = coalesce($2, profiles.phone),
        address = coalesce($3, profiles.address),
        delivery_slot = coalesce($4, profiles.delivery_slot),
        geo_lat = coalesce($5, profiles.geo_lat),
        geo_lon = coalesce($6, profiles.geo_lon),
        updated_at = now()
    `,
      [id, phone || null, address || null, delivery_slot || null, geo?.lat ?? null, geo?.lon ?? null]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "ME_UPDATE_FAILED" });
  }
});

// ===== Price cart on server =====
app.post("/cart/price", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  const { items = [] } = req.body || {};
  if (!items.length) {
    return res.json({
      ok: true,
      items: [],
      total: 0,
      payments: {
        onlineAllowed: !!process.env.PROVIDER_TOKEN,
        upiAllowed: true,
        codAllowed: true,
      },
    });
  }
  const ids = items.map((i) => i.id);
  const q = await pool.query("select id,title,price,age_restricted from products where id = any($1)", [
    ids,
  ]);
  const map = new Map(q.rows.map((r) => [r.id, r]));
  let total = 0,
    restricted = false;
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

// ===== Orders — for bot /myorders (secure: x-bot-key) =====
app.post("/myorders", async (req, res) => {
  try {
    if (!process.env.BOT_API_KEY) {
      return res.status(500).json({ ok: false, error: "BOT_API_KEY_MISSING" });
    }
    const key = req.headers["x-bot-key"];
    if (!key || key !== process.env.BOT_API_KEY) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { tg_user_id } = req.body || {};
    if (!tg_user_id) {
      return res.status(400).json({ ok: false, error: "MISSING_TG_USER_ID" });
    }
    if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });

    const q = await pool.query(
      `select id, total, payment_method, status, created_at
         from orders
        where tg_user_id = $1
        order by created_at desc
        limit 20`,
      [tg_user_id]
    );

    return res.json({ ok: true, items: q.rows });
  } catch (e) {
    console.error("MYORDERS_FAILED:", e);
    return res.status(500).json({ ok: false, error: "MYORDERS_FAILED" });
  }
});

// ===== Place order (COD / UPI) =====
app.post("/order", async (req, res) => {
  if (!pool) return res.status(500).json({ ok:false, error:"DB_NOT_CONFIGURED" });

  try {
    const { initData, items = [], paymentMethod, form } = req.body || {};
    const r = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!r.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });

    const ids = items.map(i => i.id);
    const q = await pool.query(
      "select id,title,price,age_restricted from products where id = any($1)",
      [ids]
    );
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
    if (paymentMethod === "UPI" && restricted) {
      return res.status(400).json({ ok: false, error: "RESTRICTED_UPI_BLOCKED" });
    }

    // Profile fallback
    const tgUser = JSON.parse(
      decodeURIComponent(new URLSearchParams(initData).get("user") || "{}")
    );
    const prof = (await pool.query(
      "select * from profiles where tg_user_id=$1",
      [tgUser?.id || null]
    )).rows[0];

    const ins = await pool.query(
      `insert into orders(tg_user_id,name,phone,address,slot,note,total,payment_method,status,geo_lat,geo_lon)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id`,
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

    // Channel notification (best-effort)
    notifyChannelOrder({
      id: orderId,
      name: form?.name || prof?.name || "",
      phone: form?.phone || prof?.phone || "",
      address: form?.address || prof?.address || "",
      slot: form?.slot || prof?.delivery_slot || "",
      total,
      payment_method: paymentMethod
    });

    // DM confirmation to the buyer
    if (tgUser?.id) {
      const msg = [
        "✅ *Order placed!*",
        `*Total:* *₹${rupees(total)}*`,
        `*Method:* *${paymentMethod || '—'}*`,
        "",
        `You can open the shop anytime: ${process.env.WEBAPP_URL || 'https://telegram-mini-mart.vercel.app/'}`,
        "Type /myorders to view your recent orders."
      ].join("\n");
      await tgSendMd(tgUser.id, msg);
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
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ===== Online invoice (needs PROVIDER_TOKEN) =====
app.post("/checkout", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    if (!process.env.PROVIDER_TOKEN)
      return res.status(400).json({ ok: false, error: "ONLINE_DISABLED" });
    const { initData, items = [], form } = req.body || {};
    const r = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!r.ok) return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA" });

    const ids = items.map((i) => i.id);
    const q = await pool.query("select id,title,price,age_restricted from products where id = any($1)", [
      ids,
    ]);
    const map = new Map(q.rows.map((r) => [r.id, r]));
    let total = 0,
      restricted = false;
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

// ===== Telegram webhook (optional) =====
app.post("/telegram/webhook", async (req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: "DB_NOT_CONFIGURED" });
  try {
    const up = req.body;
    const msg = up?.message;
    const chatId = msg?.chat?.id;
    const uid = msg?.from?.id;

    const txt = (msg?.text || "").trim();
    if (/^\/start(?:\s+sharephone)?$/i.test(txt)) {
      await tgSend(
        chatId,
        "Tap the button below to share your phone number.",
        { keyboard: [[{ text: "Share my phone", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
      );
    }

    if (msg?.contact && (msg.contact.user_id === uid || !msg.contact.user_id)) {
      await pool.query(
        `
        insert into profiles(tg_user_id, phone, updated_at)
        values($1,$2,now())
        on conflict (tg_user_id) do update set phone=$2, updated_at=now()
      `,
        [uid, msg.contact.phone_number || null]
      );
      await tgSend(chatId, "Thanks! Phone number saved ✅");
    }

    if (msg?.location) {
      await pool.query(
        `
        insert into profiles(tg_user_id, geo_lat, geo_lon, updated_at)
        values($1,$2,$3,now())
        on conflict (tg_user_id) do update set geo_lat=$2, geo_lon=$3, updated_at=now()
      `,
        [uid, msg.location.latitude, msg.location.longitude]
      );
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
