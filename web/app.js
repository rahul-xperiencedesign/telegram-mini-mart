const API = window.API_URL;
const tg = window.Telegram?.WebApp;

// state
let products = [];
let categories = [];
let cart = [];              // { id, title, price, qty, ageRestricted }
let photoBase64 = "";       // optional upload
let payments = { onlineAllowed:false, upiAllowed:true, codAllowed:true };
let cartTotal = 0;

const el = (id) => document.getElementById(id);

// UI refs
const grid = el("grid");
const filters = el("filters");
const cartBadge = el("cartBadge");
const drawer = el("drawer");
const overlay = el("drawerOverlay");
const openDrawerBtn = el("openDrawer");
const closeDrawerBtn = el("closeDrawer");
const backToShopBtn = el("backToShop");

const cartList = el("cartList");
const nameInp = el("name");
const phoneInp = el("phone");
const addrInp = el("address");
const slotSel = el("slot");
const noteInp = el("note");

const photoInput = el("photo");
const photoPreview = el("photoPreview");

const payOptions = el("payOptions");
const totalRow = el("totalRow");
const btnCOD = el("placeCOD");
const btnUPI = el("payUPI");
const btnOnline = el("payOnline");

const ageGate = el("ageGate");
const ageOk = el("ageOk");

// ---------- helpers ----------
function rupees(paise){ return "₹" + (paise/100).toFixed(2); }
function updateBadge(){
  const count = cart.reduce((s,i)=>s+i.qty,0);
  cartBadge.textContent = count;
}

// ---------- data ----------
async function fetchJSON(url, opts){
  const r = await fetch(url, opts);
  return r.json();
}

async function load(){
  // categories
  const catResp = await fetchJSON(`${API}/categories`);
  if (catResp.ok) categories = catResp.categories || [];

  // products
  const proResp = await fetchJSON(`${API}/products`);
  if (proResp.ok) products = proResp.items || [];

  renderFilters();
  renderGrid(products);
  prefillFromTelegram();
}

function prefillFromTelegram(){
  try{
    const initStr = tg?.initData || "";
    if (!initStr) return;
    const usp = new URLSearchParams(initStr);
    const userRaw = usp.get("user") || "{}";
    const user = JSON.parse(decodeURIComponent(userRaw));
    const parts = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
    if (parts && !nameInp.value) nameInp.value = parts;
  }catch{}
}

function renderFilters(){
  filters.innerHTML = "";
  const make = (label, value) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      [...filters.children].forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      renderGrid(value ? products.filter(p=>p.category===value) : products);
    };
    return b;
  };
  filters.appendChild(make("All", ""));
  categories.forEach(c => filters.appendChild(make(c, c)));
}

function renderGrid(list){
  grid.innerHTML = list.map(p => `
    <article class="card product">
      <h4>${p.title}</h4>
      <div class="muted">${p.category}</div>
      <div class="price">${rupees(p.price)}</div>
      <div class="cta">
        <button class="btn" data-add="${p.id}">Add</button>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      addToCart(btn.dataset.add);
    });
  });
}

function addToCart(id){
  const p = products.find(x=>x.id===id);
  if (!p) return;
  const found = cart.find(x=>x.id===id);
  if (found) found.qty += 1;
  else cart.push({ id:p.id, title:p.title, price:p.price, qty:1, ageRestricted: !!p.age_restricted });
  updateBadge();
}

function changeQty(id, delta){
  const it = cart.find(x=>x.id===id);
  if (!it) return;
  it.qty += delta;
  if (it.qty <= 0) cart = cart.filter(x=>x.id!==id);
  updateBadge();
  renderCart();
}

// ---------- drawer ----------
function openCart(){
  renderCart(); // also recalculates server-side totals
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden","false");
}
function closeCart(){
  overlay.classList.add("hidden");
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden","true");
}

openDrawerBtn?.addEventListener("click", openCart);
overlay?.addEventListener("click", closeCart);
closeDrawerBtn?.addEventListener("click", closeCart);
backToShopBtn?.addEventListener("click", closeCart);
document.addEventListener("keydown", (e)=>{ if(e.key==="Escape") closeCart(); });

// photo upload → base64 preview
photoInput?.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) { photoBase64=""; photoPreview.classList.add("hidden"); photoPreview.innerHTML=""; return; }
  if (f.size > 1.5*1024*1024) { alert("Photo is large (~>1.5MB). Please choose a smaller image."); return; }
  const b64 = await fileToBase64(f);
  photoBase64 = b64;
  photoPreview.innerHTML = `<img src="${b64}" alt="location photo"/>`;
  photoPreview.classList.remove("hidden");
});
function fileToBase64(file){
  return new Promise(res=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.readAsDataURL(file);
  });
}

async function renderCart(){
  cartList.innerHTML = cart.length ? cart.map(it=>`
    <div class="line">
      <div>
        <div><b>${it.title}</b></div>
        <div class="muted">${rupees(it.price)} ${it.ageRestricted ? "· <span class='warn'>RESTRICTED</span>" : ""}</div>
      </div>
      <div class="qty">
        <button class="iconbtn" data-dec="${it.id}">–</button>
        <div>${it.qty}</div>
        <button class="iconbtn" data-inc="${it.id}">+</button>
      </div>
    </div>
  `).join("") : `<div class="muted">Your cart is empty.</div>`;

  cartList.querySelectorAll("[data-inc]").forEach(b=>b.addEventListener("click",()=>{changeQty(b.dataset.inc, +1)}));
  cartList.querySelectorAll("[data-dec]").forEach(b=>b.addEventListener("click",()=>{changeQty(b.dataset.dec, -1)}));

  // Ask server for price + allowed payment methods
  const body = { items: cart.map(i=>({ id:i.id, qty:i.qty })) };
  const priceResp = await fetchJSON(`${API}/cart/price`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  payments = priceResp.ok ? priceResp.payments : { onlineAllowed:false, upiAllowed:true, codAllowed:true };
  cartTotal = priceResp.ok ? (priceResp.total || 0) : 0;
  totalRow.textContent = `Total: ${rupees(cartTotal)}`;

  // Render button visibility
  btnCOD.classList.toggle("hidden", !payments.codAllowed);
  btnUPI.classList.toggle("hidden", !payments.upiAllowed);
  btnOnline.classList.toggle("hidden", !payments.onlineAllowed);

  // Show chips
  payOptions.innerHTML = `
    <span class="chip">${payments.codAllowed ? "✅ COD available" : "❌ COD disabled"}</span>
    <span class="chip">${payments.upiAllowed ? "✅ UPI allowed" : "❌ UPI blocked"}</span>
    <span class="chip">${payments.onlineAllowed ? "✅ Online pay" : "❌ Online pay disabled"}</span>
  `;

  // age-restricted banner → show age gate once per open
  if (cart.some(i=>i.ageRestricted)) {
    ageGate.classList.remove("hidden");
  } else {
    ageGate.classList.add("hidden");
  }
}
ageOk?.addEventListener("click", ()=> ageGate.classList.add("hidden"));

// ---------- order flows ----------
function getForm(){
  return {
    name: nameInp.value.trim(),
    phone: phoneInp.value.trim(),
    address: addrInp.value.trim(),
    slot: slotSel.value.trim(),
    note: noteInp.value.trim(),
    photoBase64 // optional
  };
}
function getItems(){
  return cart.map(i=>({ id:i.id, qty:i.qty }));
}
function initHeaders(){
  const initData = tg?.initData || "";
  const h = { "Content-Type": "application/json" };
  if (initData) h["x-telegram-initdata"] = initData; // server will also accept in body
  return h;
}

async function placeOrder(paymentMethod){
  if (!cart.length) return alert("Cart is empty.");
  const form = getForm();
  if (!form.name || !form.phone || !form.address || !form.slot)
    return alert("Please fill name, phone, address and slot.");

  const resp = await fetchJSON(`${API}/order`, {
    method:"POST",
    headers: initHeaders(),
    body: JSON.stringify({
      initData: tg?.initData || "",
      items: getItems(),
      paymentMethod,
      form
    })
  });

  if (!resp.ok) return alert(resp.error || "Order failed");

  if (paymentMethod === "COD") {
    alert(`Order #${resp.orderId} placed. Pay cash on delivery.`);
    cart = []; updateBadge(); closeCart();
  } else if (paymentMethod === "UPI") {
    if (resp.upi?.link) {
      window.location.href = resp.upi.link; // opens UPI app
    } else {
      alert("Could not get UPI link.");
    }
  } else if (paymentMethod === "ONLINE") {
    if (resp.link) {
      window.location.href = resp.link; // opens Telegram invoice page
    } else {
      alert("Could not create invoice link.");
    }
  }
}

btnCOD?.addEventListener("click", ()=>placeOrder("COD"));
btnUPI?.addEventListener("click", ()=>placeOrder("UPI"));
btnOnline?.addEventListener("click", ()=>placeOrder("ONLINE"));

// ---------- init ----------
load().catch(()=>{});
updateBadge();
