// Telegram glue
const tg = window.Telegram?.WebApp;
tg?.ready?.();

// ===== State =====
const state = {
  products: [],
  categories: [],
  activeCategory: "All",
  cart: new Map(),              // id -> { id,title,price,qty,ageRestricted,image }
  ageAck: false,
  payments: { codAllowed:true, upiAllowed:false, onlineAllowed:false },
  photoBase64: null
};

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const el = {
  filters: $("filters"),
  grid: $("grid"),
  ageGate: $("ageGate"),
  ageOk: $("ageOk"),
  badge: $("cartBadge"),
  drawer: $("drawer"),
  openDrawer: $("openDrawer"),
  backShopping: $("backShopping"),
  closeDrawer: $("closeDrawer"),
  cartList: $("cartList"),
  totalBox: $("totalBox"),
  payBadges: $("payBadges"),
  payCOD: $("payCOD"),
  payUPI: $("payUPI"),
  payOnline: $("payOnline"),
  name: $("name"),
  phone: $("phone"),
  address: $("address"),
  slot: $("slot"),
  note: $("note"),
  photoInput: $("photoInput"),
  photoPreview: $("photoPreview"),
};

const fmt = (n) => `₹${(n/100).toFixed(2)}`;
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect width='96' height='96' fill='#0d1a24'/><g fill='#29465f'><circle cx='48' cy='38' r='18'/><rect x='18' y='64' width='60' height='12' rx='6'/></g></svg>`);

// ===== API =====
async function post(path, body) {
  const r = await fetch(`${window.API_URL}${path}`, {
    method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body||{})
  });
  return r.json();
}
async function get(path) {
  const r = await fetch(`${window.API_URL}${path}`);
  return r.json();
}

// ===== Load =====
async function loadAll(){
  const cats = await get("/categories");
  state.categories = ["All", ...(cats.categories||[])];
  renderTabs();

  const prod = await get("/products");
  state.products = prod.items || [];
  renderGrid();
  updateBadge();
  prefill();
}
loadAll();

// ===== Tabs =====
function renderTabs(){
  el.filters.innerHTML = "";
  for (const c of state.categories){
    const b = document.createElement("button");
    b.className = "tab" + (state.activeCategory===c ? " active":"");
    b.textContent = c;
    b.onclick = () => { state.activeCategory=c; renderTabs(); renderGrid(); };
    el.filters.appendChild(b);
  }
}

// ===== Grid =====
function filtered(){
  if (state.activeCategory==="All") return state.products;
  return state.products.filter(p => p.category === state.activeCategory);
}

function renderGrid(){
  el.grid.innerHTML = "";
  for (const p of filtered()){
    const card = document.createElement("div");
    card.className = "pcard";

    const img = document.createElement("img");
    img.className = "pimg";
    img.src = p.image || PLACEHOLDER;
    img.onerror = () => img.src = PLACEHOLDER;

    const title = document.createElement("div");
    title.className = "ptitle";
    title.textContent = p.title;

    const price = document.createElement("div");
    price.className = "pprice";
    price.textContent = fmt(p.price);

    const controls = document.createElement("div");
    controls.className = "pcontrols";

    const minus = document.createElement("button");
    minus.className = "qbtn"; minus.textContent = "−";
    minus.onclick = () => {
      const cur = state.cart.get(p.id);
      if (!cur) return;            // nothing to remove
      cur.qty = Math.max(0, cur.qty-1);
      if (cur.qty===0) state.cart.delete(p.id);
      renderGrid(); updateBadge();
    };

    const qtydisp = document.createElement("div");
    const currentQty = state.cart.get(p.id)?.qty || 0;
    qtydisp.className = "qtydisp";
    qtydisp.textContent = currentQty;

    const plus = document.createElement("button");
    plus.className = "qbtn"; plus.textContent = "+";
    plus.onclick = () => {
      const cur = state.cart.get(p.id) || { id:p.id, title:p.title, price:p.price, qty:0, ageRestricted:!!p.age_restricted, image:p.image||"" };
      cur.qty += 1;
      state.cart.set(p.id, cur);
      renderGrid(); updateBadge();
    };

    controls.append(minus, qtydisp, plus);
    card.append(img, title, price, controls);
    el.grid.appendChild(card);
  }
}

// ===== Badge / FAB =====
function updateBadge(){
  const n = [...state.cart.values()].reduce((s,i)=>s+i.qty,0);
  el.badge.textContent = n;
  el.openDrawer.style.display = n>0 ? "block" : "none";
}

// ===== Drawer / Cart =====
el.openDrawer.addEventListener("click", () => { renderCart(); el.drawer.classList.add("show"); });
el.closeDrawer.addEventListener("click", () => el.drawer.classList.remove("show"));
el.backShopping.addEventListener("click", () => el.drawer.classList.remove("show"));

function renderCart(){
  el.cartList.innerHTML = "";
  const items = [...state.cart.values()];
  if (!items.length){
    el.cartList.innerHTML = `<div class="card">Your cart is empty.</div>`;
  } else {
    for (const it of items){
      const row = document.createElement("div");
      row.className = "crow";
      const title = document.createElement("div");
      title.textContent = `${it.title} — ${fmt(it.price)}`;

      const qty = document.createElement("div");
      qty.className = "cqty";
      const minus = document.createElement("button");
      minus.className = "qbtn"; minus.textContent = "−";
      minus.onclick = () => {
        it.qty = Math.max(0, it.qty-1);
        if (it.qty===0) state.cart.delete(it.id);
        renderCart(); updateBadge();
      };
      const count = document.createElement("div"); count.textContent = it.qty;
      const plus = document.createElement("button");
      plus.className = "qbtn"; plus.textContent = "+";
      plus.onclick = () => { it.qty += 1; renderCart(); updateBadge(); };
      qty.append(minus, count, plus);

      const price = document.createElement("div");
      price.textContent = fmt(it.price * it.qty);
      row.append(title, qty, price);
      el.cartList.appendChild(row);
    }
  }
  refreshTotalsAndPayments();
}

// ===== Totals / payment options =====
async function refreshTotalsAndPayments(){
  const items = [...state.cart.values()].map(x => ({ id:x.id, qty:x.qty }));
  const r = await post("/cart/price", { items });
  state.payments = r.payments || { codAllowed:true };
  el.totalBox.textContent = `Total: ${fmt(r.total||0)}`;

  const b = [];
  if (state.payments.codAllowed) b.push(`<span class="badge ok">✅ COD available</span>`);
  if (state.payments.upiAllowed) b.push(`<span class="badge ok">✅ UPI available</span>`); else b.push(`<span class="badge no">❌ UPI blocked</span>`);
  if (state.payments.onlineAllowed) b.push(`<span class="badge online">💳 Online pay enabled</span>`); else b.push(`<span class="badge no">❌ Online pay disabled</span>`);
  el.payBadges.innerHTML = b.join(" ");

  el.payCOD.classList.toggle("hidden", !state.payments.codAllowed);
  el.payUPI.classList.toggle("hidden", !state.payments.upiAllowed);
  el.payOnline.classList.toggle("hidden", !state.payments.onlineAllowed);

  const anyRestricted = (r.items||[]).some(i => i.ageRestricted);
  if (anyRestricted && !state.ageAck) el.ageGate.classList.remove("hidden");
}
el.ageOk.addEventListener("click", () => { state.ageAck = true; el.ageGate.classList.add("hidden"); });

// ===== Photo preview (optional) =====
el.photoInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file){ state.photoBase64 = null; return; }
  const b64 = await fileToDataURL(file);
  state.photoBase64 = b64;
  // thumbnail
  const img = new Image();
  img.onload = () => {
    const c = el.photoPreview, max = 240;
    const scale = Math.min(max/img.width, max/img.height);
    c.width = Math.round(img.width*scale);
    c.height = Math.round(img.height*scale);
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(img,0,0,c.width,c.height);
  };
  img.src = b64;
});
function fileToDataURL(file){
  return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); });
}

// ===== Place order =====
el.payCOD.addEventListener("click", () => place("COD"));
el.payUPI.addEventListener("click", () => place("UPI"));
el.payOnline.addEventListener("click", () => place("ONLINE"));

async function place(method){
  const initData = tg?.initData || "";
  const items = [...state.cart.values()].map(x => ({ id:x.id, qty:x.qty }));
  if (!items.length) return alert("Your cart is empty.");

  const form = {
    name: el.name.value.trim() || "",
    phone: el.phone.value.trim() || "",
    address: el.address.value.trim() || "",
    slot: el.slot.value || "",
    note: el.note.value.trim() || "",
    photoBase64: state.photoBase64 || null
  };

  try {
    const r = await post("/order", { initData, items, paymentMethod: method, form });
    if (!r.ok) throw new Error(r.error || "SERVER_ERROR");

    if (method==="COD"){
      alert(`Order placed! #${r.orderId}\nTotal ${fmt(r.total)}`);
      state.cart.clear();
      renderCart(); updateBadge();
      el.drawer.classList.remove("show");
    } else if (method==="UPI"){
      window.location.href = r.upi.link;
    } else if (method==="ONLINE"){
      window.location.href = r.link;
    }
  } catch (e) {
    alert(e.message || "SERVER_ERROR");
  }
}

// ===== Prefill =====
async function prefill(){
  try {
    const r = await post("/me", { initData: tg?.initData || "" });
    if (r.ok && r.profile){
      el.name.value = r.profile.name || "";
      el.phone.value = r.profile.phone || "";
      el.address.value = r.profile.address || "";
      el.slot.value = r.profile.delivery_slot || "";
    }
  } catch {}
}
