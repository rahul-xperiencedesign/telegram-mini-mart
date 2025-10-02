import express from "express";
import cors from "cors";
import crypto from "crypto";

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
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Backend running on :" + PORT));
