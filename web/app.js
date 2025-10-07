// ===== Telegram WebApp glue =====
const tg = window.Telegram?.WebApp;
tg?.ready?.();

// ===== State =====
const state = {
  products: [],
  categories: [],
  cart: new Map(),                 // id -> { id, title, price, qty, ageRestricted, image }
  ageAck: false,                   // age gate confirmed once
  profile: null,                   // prefill cache
  payments: { onlineAllowed:false, upiAllowed:false, codAllowed:true },
  photoBase64: null,               // optional location photo
};

// ===== DOM =====
const el = {
  grid: document.getElementById("grid"),
  filters: document.getElementById("filters"),
  badge: document.getElementById("cartBadge"),
  drawer: document.getElementById("drawer"),
  openDrawer: document.getElementById("openDrawer"),
  closeDrawer: document.getElementById("closeDrawer"),
  cartList: document.getElementById("cartList"),
  totalBox: document.getElementById("totalBox"),
  payBadges: document.getElementById("payBadges"),
  payCOD: document.getElementById("payCOD"),
  payUPI: document.getElementById("payUPI"),
  payOnline: document.getElementById("payOnline"),
  name: document.getElementById("name"),
  phone: document.getElementById("phone"),
  address: document.getElementById("address"),
  slot: document.getElementById("slot"),
  note: document.getElementById("note"),
  ageGate: document.getElementById("ageGate"),
  ageOk: document.getElementById("ageOk"),
  photoInput: document.getElementById("photoInput"),
  photoPreview: document.getElementById("photoPreview"),
};

const fmt = n => `₹${(n/100).toFixed(2)}`;
const placeholder =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect width='96' height='96' fill='#0d1a24'/><g fill='#29465f'><circle cx='48' cy='38' r='18'/><rect x='18' y='64' width='60' height='12' rx='6'/></g></svg>`);

// ===== API helpers =====
async function api(path, body) {
  const r = await fetch(`${window.API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  return r.json();
}
async function getJSON(path) {
  const r = await fetch(`${window.API_URL}${path}`);
  return r.json();
}

// ===== Load catalog =====
async function loadCatalog() {
  const cats = await getJSON("/categories");
  state.categories = cats.categories || [];
  renderFilters();

  const prod = await getJSON("/products");
  state.products = prod.items || [];
  renderGrid(state.products);
}

// ===== Filters =====
function renderFilters() {
  el.filters.innerHTML = "";
  const any = btn("All", () => renderGrid(state.products), true);
  el.filters.appendChild(any);
  for (const c of state.categories) {
    el.filters.appendChild(btn(c, () => {
      const list = state.products.filter(p => p.category === c);
      renderGrid(list);
    }));
  }
  function btn(label, on, active=false){
    const b = document.createElement("button");
    b.className = "badge" + (active? " ok" : "");
    b.textContent = label;
    b.onclick = () => { [...el.filters.children].forEach(x=>x.classList.remove("ok")); b.classList.add("ok"); on(); };
    return b;
  }
}

// ===== Grid =====
function renderGrid(items) {
  el.grid.innerHTML = "";
  for (const p of items) {
    const card = document.createElement("div");
    card.className = "pcard";

    const img = document.createElement("img");
    img.className = "pimg";
    img.src = p.image || placeholder;
    img.onerror = () => { img.src = placeholder; };

    const title = document.createElement("div");
    title.className = "ptitle";
    title.textContent = p.title;

    const meta = document.createElement("div");
    meta.className = "pmeta";
    meta.innerHTML = `<span>${fmt(p.price)}</span><span>${p.category}</span>`;

    const qty = document.createElement("div");
    qty.className = "qty";

    const minus = document.createElement("button");
    minus.className = "qbtn";
    minus.textContent = "−";
    minus.onclick = () => updateQty(p, -1);

    const count = document.createElement("div");
    count.textContent = getQty(p.id);

    const plus = document.createElement("button");
    plus.className = "qbtn";
    plus.textContent = "+";
    plus.onclick = () => updateQty(p, +1);

    qty.append(minus, count, plus);

    const add = document.createElement("button");
    add.className = "addbtn";
    add.textContent = "Add to cart";
    add.onclick = () => updateQty(p, +1);

    card.append(img, title, meta, qty, add);
    el.grid.appendChild(card);
  }
  updateBadge();
}

function getQty(id) { return state.cart.get(id)?.qty || 0; }
function updateQty(p, delta) {
  const cur = state.cart.get(p.id) || { id:p.id, title:p.title, price:p.price, qty:0, ageRestricted:!!p.age_restricted, image:p.image || "" };
  cur.qty = Math.max(0, cur.qty + delta);
  if (cur.qty === 0) state.cart.delete(p.id);
  else state.cart.set(p.id, cur);
  renderGrid(state.products);      // refresh counts in grid
  if (el.drawer.classList.contains("show")) renderCart(); // keep drawer fresh if open
}

// ===== Drawer / cart =====
function renderCart() {
  el.cartList.innerHTML = "";
  const items = [...state.cart.values()];
  if (!items.length) {
    el.cartList.innerHTML = `<div class="card">Your cart is empty.</div>`;
  } else {
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "crow";
      const title = document.createElement("div");
      title.textContent = `${it.title} — ${fmt(it.price)}`;

      const qty = document.createElement("div");
      qty.className = "cqty";
      const minus = document.createElement("button");
      minus.className = "qbtn"; minus.textContent = "−";
      minus.onclick = () => { updateQty({id:it.id, title:it.title, price:it.price, age_restricted:it.ageRestricted, image:it.image}, -1); renderCart(); };
      const count = document.createElement("div"); count.textContent = it.qty;
      const plus = document.createElement("button");
      plus.className = "qbtn"; plus.textContent = "+";
      plus.onclick = () => { updateQty({id:it.id, title:it.title, price:it.price, age_restricted:it.ageRestricted, image:it.image}, +1); renderCart(); };
      qty.append(minus, count, plus);

      const price = document.createElement("div");
      price.textContent = fmt(it.price * it.qty);

      row.append(title, qty, price);
      el.cartList.appendChild(row);
    }
  }
  refreshTotalsAndPayments();
  updateBadge();
}

function updateBadge() {
  const n = [...state.cart.values()].reduce((s,i)=>s+i.qty,0);
  el.badge.textContent = n;
  el.openDrawer.style.display = n>0 ? "block" : "none";
}

async function refreshTotalsAndPayments() {
  const items = [...state.cart.values()].map(x => ({ id:x.id, qty:x.qty }));
  const resp = await api("/cart/price", { items });
  // show badges
  const b = [];
  if (resp.payments?.codAllowed) b.push(`<span class="badge ok">✅ COD available</span>`);
  if (resp.payments?.upiAllowed) b.push(`<span class="badge ok">✅ UPI available</span>`);
  else b.push(`<span class="badge no">❌ UPI blocked</span>`);
  if (resp.payments?.onlineAllowed) b.push(`<span class="badge online">💳 Online pay enabled</span>`);
  else b.push(`<span class="badge no">❌ Online pay disabled</span>`);
  el.payBadges.innerHTML = b.join(" ");

  state.payments = resp.payments || { codAllowed:true };
  el.totalBox.textContent = `Total: ${fmt(resp.total||0)}`;

  // buttons
  el.payCOD.classList.toggle("hidden", !(resp.payments?.codAllowed));
  el.payUPI.classList.toggle("hidden", !(resp.payments?.upiAllowed));
  el.payOnline.classList.toggle("hidden", !(resp.payments?.onlineAllowed));

  // Age modal only once if any restricted in cart and not yet acknowledged
  const anyRestricted = (resp.items||[]).some(i => i.ageRestricted);
  if (anyRestricted && !state.ageAck) {
    el.ageGate.classList.remove("hidden");
  }
}

// ===== Photo upload -> base64 (small preview) =====
el.photoInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) { state.photoBase64 = null; return; }
  const img = await readFileAsDataURL(file);
  state.photoBase64 = img;

  // preview small thumbnail
  const c = el.photoPreview;
  const image = new Image();
  image.onload = () => {
    const max = 240;
    const scale = Math.min(max/image.width, max/image.height);
    c.width = Math.round(image.width*scale);
    c.height = Math.round(image.height*scale);
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(image,0,0,c.width,c.height);
  };
  image.src = img;
});
function readFileAsDataURL(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// ===== Checkout =====
async function placeOrder(method) {
  const initData = tg?.initData || "";
  const items = [...state.cart.values()].map(x => ({ id:x.id, qty:x.qty }));
  const form = {
    name: el.name.value.trim() || "",
    phone: el.phone.value.trim() || "",
    address: el.address.value.trim() || "",
    slot: el.slot.value,
    note: el.note.value.trim() || "",
    photoBase64: state.photoBase64 || null
  };
  try {
    const r = await api("/order", { initData, items, paymentMethod: method, form });
    if (!r.ok) throw new Error(r.error || "SERVER_ERROR");
    if (method === "COD") {
      alert(`Order placed! #${r.orderId}\nTotal ${fmt(r.total)}`);
      state.cart.clear();
      renderCart();
      el.drawer.classList.remove("show");
    } else if (method === "UPI") {
      // open UPI link
      window.location.href = r.upi.link;
    } else if (method === "ONLINE") {
      window.location.href = r.link;
    }
  } catch (e) {
    alert(e.message || "SERVER_ERROR");
  }
}

// ===== Prefill (optional) =====
async function prefill() {
  try {
    const r = await api("/me", { initData: tg?.initData || "" });
    if (r.ok && r.profile) {
      state.profile = r.profile;
      el.name.value = r.profile.name || "";
      el.phone.value = r.profile.phone || "";
      el.address.value = r.profile.address || "";
      el.slot.value = r.profile.delivery_slot || "";
    }
  } catch {}
}

// ===== Events =====
el.openDrawer.addEventListener("click", () => {
  renderCart();
  el.drawer.classList.add("show");
});
el.closeDrawer.addEventListener("click", () => el.drawer.classList.remove("show"));
el.payCOD.addEventListener("click", () => placeOrder("COD"));
el.payUPI.addEventListener("click", () => placeOrder("UPI"));
el.payOnline.addEventListener("click", () => placeOrder("ONLINE"));
el.ageOk.addEventListener("click", () => { state.ageAck = true; el.ageGate.classList.add("hidden"); });

loadCatalog();
prefill();
