const tg = window.Telegram?.WebApp ?? null;
const API = (p)=> (window.API_URL||"") + p;

let STATE = {
  categories: [], products: [], filter:"All",
  cart:{}, total:0, payments:{onlineAllowed:false, upiAllowed:true, codAllowed:true},
  hasRestricted:false
};

const el = (s)=>document.querySelector(s);
const rupees = (p)=>"₹"+(p/100).toFixed(2);
const cartCount = ()=>Object.values(STATE.cart).reduce((a,b)=>a+b,0);
const cartItems = ()=>Object.entries(STATE.cart).map(([id,qty])=>({id,qty}));

if (tg){ tg.ready(); tg.expand(); tg.MainButton.setText("View Cart"); tg.MainButton.onClick(()=>openDrawer()); tg.MainButton.show(); }

async function loadData(){
  const [cats, prods] = await Promise.all([
    fetch(API("/categories")).then(r=>r.json()),
    fetch(API("/products")).then(r=>r.json())
  ]);
  STATE.categories = ["All", ...cats.categories];
  STATE.products = prods.items;
  renderFilters(); renderGrid(); updateBadges();
}
loadData();

// ---------- Filters & Grid
function renderFilters(){
  const f = el("#filters"); f.innerHTML="";
  STATE.categories.forEach(c=>{
    const b = document.createElement("button");
    b.className = "filter" + (STATE.filter===c ? " active": "");
    b.textContent = c;
    b.onclick = ()=>{ STATE.filter=c; renderFilters(); renderGrid(); };
    f.appendChild(b);
  });
}
function filtered(){ return STATE.filter==="All" ? STATE.products : STATE.products.filter(p=>p.category===STATE.filter); }

function cardHtml(p){
  const qty = STATE.cart[p.id]||0;
  return `
    <article class="card" data-id="${p.id}">
      ${p.image ? `<img src="${p.image}" alt="">` : `<div style="height:110px;border-radius:10px;background:#101a2b;display:flex;align-items:center;justify-content:center;color:#7aa2ff;">${p.category}</div>`}
      <h3>${p.title}</h3>
      <div class="price">${rupees(p.price)}</div>
      <div class="actions">
        ${qty===0 ? `<button class="btn primary add">ADD</button>` :
          `<button class="btn minus">–</button><div class="btn">${qty}</div><button class="btn plus">+</button>`}
      </div>
    </article>`;
}

function renderGrid(){
  const g = el("#grid");
  g.innerHTML = filtered().map(cardHtml).join("");
  g.querySelectorAll(".card").forEach(card=>{
    const id = card.dataset.id;
    const add = card.querySelector(".add");
    const plus = card.querySelector(".plus");
    const minus= card.querySelector(".minus");
    add && (add.onclick = ()=>{ inc(id,1); });
    plus && (plus.onclick = ()=>{ inc(id,1); });
    minus&& (minus.onclick= ()=>{ inc(id,-1); });
  });
}
function inc(id, d){ const n=(STATE.cart[id]||0)+d; if(n<=0) delete STATE.cart[id]; else STATE.cart[id]=n; renderGrid(); updateBadges(); }

// ---------- Drawer & Pricing
function openDrawer(){ el("#drawer").classList.add("open"); renderCart(); }
function closeDrawer(){ el("#drawer").classList.remove("open"); }
el("#openDrawer").onclick = openDrawer;
el("#closeDrawer").onclick = closeDrawer;

async function renderCart(){
  const res = await fetch(API("/cart/price"), { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({items:cartItems()}) });
  const data = await res.json();
  STATE.total = data.total; STATE.payments = data.payments;
  STATE.hasRestricted = data.items.some(i=>i.ageRestricted);

  const list = el("#cartList");
  list.innerHTML = data.items.length ? data.items.map(i=>`
    <div class="row" data-id="${i.id}">
      <div style="flex:1">
        <div>${i.title}</div>
        <small>${rupees(i.price)} each ${i.ageRestricted?'<span class="warn">· age-restricted</span>':''}</small>
      </div>
      <div class="qty">
        <button class="btn minus">–</button>
        <div class="btn">${STATE.cart[i.id]||0}</div>
        <button class="btn plus">+</button>
      </div>
      <div>${rupees(i.price*(STATE.cart[i.id]||0))}</div>
    </div>
  `).join("") : `<div class="row"><span>Your cart is empty.</span></div>`;

  list.querySelectorAll(".row").forEach(r=>{
    const id = r.dataset.id;
    r.querySelector(".plus").onclick = ()=>{ inc(id,1); renderCart(); };
    r.querySelector(".minus").onclick= ()=>{ inc(id,-1); renderCart(); };
  });

  // Payment buttons & age gate behavior
  const pay = el("#payOptions");
  const onlineBtn = STATE.payments.onlineAllowed ? `<button class="paybtn online" id="payOnline">Pay Online · ${rupees(STATE.total)}</button>` : "";
  const upiBtn    = STATE.payments.upiAllowed    ? `<button class="paybtn upi" id="payUPI">Scan & Pay (UPI) · ${rupees(STATE.total)}</button>` : "";
  const codBtn    = STATE.payments.codAllowed    ? `<button class="paybtn cod" id="payCOD">Cash on Delivery · ${rupees(STATE.total)}</button>` : "";
  pay.innerHTML = onlineBtn + upiBtn + codBtn +
    (STATE.payments.onlineAllowed ? "" : `<small class="warn">Online pay hidden (restricted items or provider not connected).</small>`);

  el("#payOnline") && (el("#payOnline").onclick = () => proceed("ONLINE"));
  el("#payUPI")    && (el("#payUPI").onclick    = () => proceed("UPI"));
  el("#payCOD")    && (el("#payCOD").onclick    = () => proceed("COD"));
}

function updateBadges(){ el("#cartBadge").textContent = cartCount(); if (tg) tg.MainButton.setText(`View Cart (${cartCount()})`); }

// ---------- Collect form & dispatch by method
function formData(){
  return {
    name: el("#name").value.trim(),
    phone: el("#phone").value.trim(),
    address: el("#address").value.trim(),
    slot: el("#slot").value,
    note: el("#note").value.trim()
  };
}
function validateForm(f){
  if (!f.name || !f.phone || !f.address || !f.slot) return "Please fill name, phone, address and slot.";
  return "";
}

async function proceed(method){
  const f = formData();
  const err = validateForm(f);
  if (err) return alert(err);

  // Age gate: if cart has restricted items, show modal & only allow COD
  if (STATE.hasRestricted && method!=="COD"){
    el("#ageGate").classList.remove("hidden");
    el("#ageOk").onclick = ()=>{ el("#ageGate").classList.add("hidden"); }; // force user to press COD
    return;
  }

  if (method==="ONLINE"){ return payOnline(f); }
  if (method==="UPI"){ return payUPI(f); }
  if (method==="COD"){ return payCOD(f); }
}

// ---------- Payment handlers with form
async function payOnline(form){
  const res = await fetch(API("/checkout"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems(), form })
  });
  const data = await res.json();
  if (!data.ok) return alert("Online payment disabled or failed: " + (data.error||""));
  tg?.openInvoice(data.link, (status) => {
    tg.showPopup({ title:"Payment", message:`Status: ${status}`, buttons:[{type:"ok"}] });
  });
}

async function payUPI(form){
  const res = await fetch(API("/order"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems(), paymentMethod:"UPI", form })
  });
  const data = await res.json();
  if (!data.ok) return alert("UPI failed: " + (data.error||""));
  window.location.href = data.upi.link;
}

async function payCOD(form){
  const res = await fetch(API("/order"), {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", items: cartItems(), paymentMethod:"COD", form })
  });
  const data = await res.json();
  if (!data.ok) return alert("COD failed: " + (data.error||""));
  tg?.showPopup({ title:"Order placed", message:"COD selected. Pay at delivery.", buttons:[{type:"ok"}] });
  el("#drawer").classList.remove("open");
}
