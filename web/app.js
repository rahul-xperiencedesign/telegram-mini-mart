const tg = window.Telegram?.WebApp ?? null;
const API = (path) => (window.API_URL || "") + path;

let STATE = {
  categories: [],
  products: [],
  filter: "All",
  cart: {}, // { [id]: qty }
  payments: { onlineAllowed:false, upiAllowed:true, codAllowed:true },
  total: 0
};

function rupees(paise){ return "₹" + (paise/100).toFixed(2); }
function cartCount(){ return Object.values(STATE.cart).reduce((a,b)=>a+b,0); }
function cartItems(){ return Object.entries(STATE.cart).map(([id,qty]) => ({id, qty})); }

// ---- init Telegram UI
if (tg) {
  tg.ready();
  tg.expand();
  tg.MainButton.setText("View Cart");
  tg.MainButton.onClick(() => openDrawer());
  tg.MainButton.show();
}

// ---- fetch categories & products
async function loadData(){
  const [cats, prods] = await Promise.all([
    fetch(API("/categories")).then(r=>r.json()),
    fetch(API("/products")).then(r=>r.json())
  ]);
  STATE.categories = ["All", ...cats.categories];
  STATE.products   = prods.items;
  renderFilters(); renderGrid(); updateBadges();
}
loadData();

// ---- UI renderers
function renderFilters(){
  const el = document.getElementById("filters");
  el.innerHTML = "";
  STATE.categories.forEach(c => {
    const b = document.createElement("button");
    b.className = "filter" + (STATE.filter===c ? " active":"");
    b.textContent = c;
    b.onclick = () => { STATE.filter = c; renderFilters(); renderGrid(); };
    el.appendChild(b);
  });
}

function filtered(){
  if (STATE.filter==="All") return STATE.products;
  return STATE.products.filter(p => p.category===STATE.filter);
}

function renderGrid(){
  const g = document.getElementById("grid");
  g.innerHTML = filtered().map(p => cardHtml(p)).join("");
  attachCardHandlers();
}

function cardHtml(p){
  const qty = STATE.cart[p.id] || 0;
  return `
    <article class="card" data-id="${p.id}">
      <div style="height:100px;display:flex;align-items:center;justify-content:center;">
        <span class="badge">${p.category}</span>
      </div>
      <h3>${p.title}</h3>
      <div class="price">${rupees(p.price)}</div>
      <div class="actions">
        ${qty===0
          ? `<button class="btn primary add">ADD</button>`
          : `<button class="btn minus">–</button>
             <div class="btn">${qty}</div>
             <button class="btn plus">+</button>`
        }
      </div>
    </article>
  `;
}

function attachCardHandlers(){
  document.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    const add = card.querySelector(".add");
    const plus = card.querySelector(".plus");
    const minus = card.querySelector(".minus");
    add && (add.onclick = ()=>{ increment(id,1); });
    plus && (plus.onclick = ()=>{ increment(id,1); });
    minus && (minus.onclick = ()=>{ increment(id,-1); });
  });
}

function increment(id, delta){
  const next = (STATE.cart[id] || 0) + delta;
  if (next <= 0) delete STATE.cart[id]; else STATE.cart[id] = next;
  renderGrid(); updateBadges();
}

function updateBadges(){
  document.getElementById("cartBadge").textContent = cartCount();
  if (tg) tg.MainButton.setText(`View Cart (${cartCount()})`);
}

// ---- Drawer
function openDrawer(){ document.getElementById("drawer").classList.add("open"); renderCart(); }
function closeDrawer(){ document.getElementById("drawer").classList.remove("open"); }
document.getElementById("openDrawer").onclick = openDrawer;
document.getElementById("closeDrawer").onclick = closeDrawer;

// ---- Price cart on server and render
async function renderCart(){
  const res = await fetch(API("/cart/price"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ items: cartItems() })
  });
  const data = await res.json();
  if (!data.ok) return alert("Pricing failed");
  STATE.total = data.total;
  STATE.payments = data.payments;

  const list = document.getElementById("cartList");
  list.innerHTML = data.items.length ? data.items.map(i => `
    <div class="row" data-id="${i.id}">
      <div style="flex:1">
        <div>${i.title}</div>
        <small class="muted">${rupees(i.price)} each ${i.ageRestricted?'<span class="warn">· age-restricted</span>':''}</small>
      </div>
      <div class="qty">
        <button class="btn minus">–</button>
        <div class="btn">${STATE.cart[i.id]||0}</div>
        <button class="btn plus">+</button>
      </div>
      <div>${rupees(i.price * (STATE.cart[i.id]||0))}</div>
    </div>
  `).join("") : `<div class="row"><span>Your cart is empty.</span></div>`;

  // attach +/- inside drawer
  list.querySelectorAll(".row").forEach(r => {
    const id = r.dataset.id;
    r.querySelector(".plus").onclick = ()=>{ increment(id,1); renderCart(); };
    r.querySelector(".minus").onclick = ()=>{ increment(id,-1); renderCart(); };
  });

  // pay options
  const pay = document.getElementById("payOptions");
  const onlineBtn = STATE.payments.onlineAllowed ? `<button class="paybtn online" id="payOnline">Pay Online · ${rupees(STATE.total)}</button>` : "";
  const upiBtn    = STATE.payments.upiAllowed    ? `<button class="paybtn upi" id="payUPI">Scan & Pay (UPI) · ${rupees(STATE.total)}</button>` : "";
  const codBtn    = STATE.payments.codAllowed    ? `<button class="paybtn cod" id="payCOD">Cash on Delivery · ${rupees(STATE.total)}</button>` : "";
  pay.innerHTML = onlineBtn + upiBtn + codBtn +
    (STATE.payments.onlineAllowed ? "" : `<small class="warn">Online pay hidden (age-restricted items or provider not connected).</small>`);

  document.getElementById("payOnline") && (document.getElementById("payOnline").onclick = payOnline);
  document.getElementById("payUPI")    && (document.getElementById("payUPI").onclick    = payUPI);
  document.getElementById("payCOD")    && (document.getElementById("payCOD").onclick    = payCOD);
}

// ---- Payment handlers
async function payOnline(){
  const res = await fetch(API("/checkout"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems() })
  });
  const data = await res.json();
  if (!data.ok) return alert("Online payment disabled or failed: " + (data.error||""));
  tg?.openInvoice(data.link, (status) => {
    tg.showPopup({ title:"Payment", message:`Status: ${status}`, buttons:[{type:"ok"}] });
  });
}

async function payCOD(){
  const res = await fetch(API("/order"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems(), paymentMethod: "COD" })
  });
  const data = await res.json();
  if (!data.ok) return alert("COD failed: " + (data.error||""));
  tg?.showPopup({ title:"Order placed", message:"COD selected. Pay at delivery.", buttons:[{type:"ok"}] });
  closeDrawer();
}

async function payUPI(){
  const res = await fetch(API("/order"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems(), paymentMethod: "UPI" })
  });
  const data = await res.json();
  if (!data.ok) return alert("UPI failed: " + (data.error||""));
  // open UPI app
  window.location.href = data.upi.link;
}
