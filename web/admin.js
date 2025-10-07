const API = window.API_URL || "";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const key = localStorage.getItem("adminkey");
if (!key) location.href = "./admin-login.html";

// Sidebar nav
$$(".navlink").forEach(b => b.onclick = () => {
  $$(".navlink").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $$(".view").forEach(v => v.classList.add("hidden"));
  $("#view-" + b.dataset.view).classList.remove("hidden");
  if (b.dataset.view === "dashboard") loadDashboard();
  if (b.dataset.view === "products")  loadProducts();
  if (b.dataset.view === "orders")    loadOrders();
  if (b.dataset.view === "users")     loadUsers();
});

$("#logout").onclick = () => { localStorage.removeItem("adminkey"); location.href = "./admin-login.html"; };

// ----- Dashboard
async function loadDashboard(){
  const r = await fetch(API + "/admin/stats", { headers: { "x-admin-key": key } }).then(r=>r.json());
  if (!r.ok) return alert("Stats error");
  $("#kpi-products").textContent = r.product_count;
  $("#kpi-revenue").textContent  = "₹" + (r.revenue/100).toFixed(2);
  $("#lowstock").innerHTML = `
    <div class="thead"><div>ID</div><div>Title</div><div>Stock</div></div>
    ${r.low_stock.map(x=>`<div class="trow"><div>${x.id}</div><div>${x.title}</div><div class="chip warn">${x.stock}</div></div>`).join("")}
  `;
}

// ----- Products
let P_PAGE = 1, P_SIZE = 20, P_QUERY = "";
$("#pPageSize").onchange = () => { P_SIZE = +$("#pPageSize").value; P_PAGE = 1; renderProducts(); };
$("#pSearch").oninput = (e) => { P_QUERY = e.target.value.trim().toLowerCase(); P_PAGE = 1; renderProducts(); };
$("#pReload").onclick = ()=> loadProducts();

$("#productForm").onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    id: $("#pid").value.trim(),
    title: $("#ptitle").value.trim(),
    price: +$("#pprice").value || 0,
    category: $("#pcat").value.trim(),
    image: $("#pimg").value.trim(),
    age_restricted: $("#prestrict").checked,
    stock: +$("#pstock").value || 0
  };
  if (!body.id || !body.title || !body.category) return alert("ID, Title, Category are required");
  const res = await fetch(API + "/admin/products", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-admin-key": key },
    body: JSON.stringify(body)
  }).then(r=>r.json());
  if (!res.ok) return alert("Save failed");
  ["#pid","#ptitle","#pprice","#pcat","#pimg","#pstock"].forEach(s=>$(s).value="");
  $("#prestrict").checked = false;
  loadProducts();
};

$("#csvFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  // CSV: id,title,price,category,image,age_restricted,stock
  const rows = text.trim().split(/\r?\n/);
  const headers = rows.shift().split(",").map(h=>h.trim().toLowerCase());
  const items = rows.map(line => {
    const cols = line.split(",").map(x=>x.trim());
    const obj = {}; headers.forEach((h,i)=>obj[h]=cols[i]);
    obj.price = +obj.price || 0;
    obj.stock = +obj.stock || 0;
    obj.age_restricted = (obj.age_restricted||"").toLowerCase()==="true";
    return obj;
  });
  const res = await fetch(API + "/admin/products/bulk", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-admin-key": key },
    body: JSON.stringify({ items })
  }).then(r=>r.json());
  if (!res.ok) return alert("Bulk import failed");
  alert("Imported: " + res.upserted);
  loadProducts();
};

let _allProducts = [];
async function loadProducts(){
  const r = await fetch(API + "/products").then(r=>r.json());
  if (!r.ok) return alert("Failed to load products");
  _allProducts = r.items;
  renderProducts();
}
function renderProducts(){
  let list = _allProducts;
  if (P_QUERY) list = list.filter(p =>
    (p.title||"").toLowerCase().includes(P_QUERY) ||
    (p.id||"").toLowerCase().includes(P_QUERY)
  );
  const total = list.length;
  const start = (P_PAGE-1)*P_SIZE;
  const pageItems = list.slice(start, start + P_SIZE);

  $("#pTable").innerHTML = `
    <div class="thead"><div>ID</div><div>Title</div><div>Category</div><div>Price</div><div>Stock</div><div>Flags</div><div>Actions</div></div>
    ${pageItems.map(p => `
      <div class="trow">
        <div>${p.id}</div>
        <div>${p.title}</div>
        <div>${p.category}</div>
        <div>₹${(p.price/100).toFixed(2)}</div>
        <div>${p.stock}</div>
        <div>${p.age_restricted ? '<span class="chip warn">AGE</span>' : ''}</div>
        <div>
          <button class="btn sm" data-act="edit" data-id="${p.id}">Edit</button>
          <button class="btn sm danger" data-act="del" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `).join("")}
  `;

  $("#pPageInfo").textContent = `Page ${P_PAGE} of ${Math.max(1, Math.ceil(total/P_SIZE))} — ${total} items`;
  $("#pPrev").onclick = () => { if (P_PAGE>1){ P_PAGE--; renderProducts(); } };
  $("#pNext").onclick = () => { if (start + P_SIZE < total){ P_PAGE++; renderProducts(); } };

  $("#pTable").querySelectorAll("button").forEach(b => {
    const id = b.dataset.id;
    if (b.dataset.act === "edit") {
      b.onclick = () => {
        const p = _allProducts.find(x=>x.id===id);
        $("#pid").value = p.id; $("#ptitle").value = p.title; $("#pprice").value = p.price;
        $("#pcat").value = p.category; $("#pimg").value = p.image||""; $("#prestrict").checked = !!p.age_restricted;
        $("#pstock").value = p.stock;
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    } else {
      b.onclick = async () => {
        if (!confirm("Delete " + id + "?")) return;
        const res = await fetch(API + "/admin/products/" + id, { method:"DELETE", headers:{ "x-admin-key": key } }).then(r=>r.json());
        if (!res.ok) return alert("Delete failed");
        loadProducts();
      };
    }
  });
}

// ----- Orders
let O_PAGE = 1, O_STAT = "", O_QUERY = "";
$("#oStatus").onchange = e => { O_STAT = e.target.value; O_PAGE = 1; loadOrders(); };
$("#oQuery").oninput = e => { O_QUERY = e.target.value.trim(); O_PAGE = 1; loadOrders(); };
$("#oReload").onclick = ()=> loadOrders();

async function loadOrders(){
  const params = new URLSearchParams({ page: O_PAGE, pageSize: 20 });
  if (O_STAT) params.set("status", O_STAT);
  if (O_QUERY) params.set("q", O_QUERY);
  const r = await fetch(API + "/admin/orders?" + params.toString(), { headers:{ "x-admin-key": key } }).then(r=>r.json());
  if (!r.ok) return alert("Orders error");
  $("#oTable").innerHTML = `
    <div class="thead"><div>ID</div><div>When</div><div>Name</div><div>Phone</div><div>Total</div><div>Status</div><div>Actions</div></div>
    ${r.items.map(o => `
      <div class="trow">
        <div>${o.id}</div>
        <div>${new Date(o.created_at).toLocaleString()}</div>
        <div>${o.name||""}</div>
        <div>${o.phone||""}</div>
        <div>₹${(o.total/100).toFixed(2)}</div>
        <div><span class="chip ${chipClass(o.status)}">${o.status}</span></div>
        <div>
          ${["placed","paid","shipped","delivered","cancelled"].map(s=>`
            <button class="btn sm ${s===o.status?'active':''}" data-id="${o.id}" data-s="${s}">${s}</button>
          `).join("")}
        </div>
      </div>
    `).join("")}
  `;
  $("#oPageInfo").textContent = `Page ${r.page} of ${Math.max(1, Math.ceil(r.total/20))} — ${r.total} orders`;
  $("#oPrev").onclick = () => { if (O_PAGE>1){ O_PAGE--; loadOrders(); } };
  $("#oNext").onclick = () => { if (r.page*20 < r.total){ O_PAGE++; loadOrders(); } };

  $("#oTable").querySelectorAll("button[data-s]").forEach(b=>{
    b.onclick = async () => {
      const id = b.dataset.id, status = b.dataset.s;
      const res = await fetch(API + "/admin/orders/" + id + "/status", {
        method:"PUT",
        headers:{ "Content-Type":"application/json", "x-admin-key": key },
        body: JSON.stringify({ status })
      }).then(r=>r.json());
      if (!res.ok) return alert("Update failed");
      loadOrders();
    };
  });
}
function chipClass(s){ return {placed:"info", paid:"ok", shipped:"info", delivered:"ok", cancelled:"danger"}[s] || ""; }

// ----- Users (profiles)
let U_QUERY = "";
$("#uReload").onclick = ()=> loadUsers();
$("#uQuery").oninput = e => { U_QUERY = e.target.value.trim(); loadUsers(); };
async function loadUsers(page=1){
  const params = new URLSearchParams({ page, pageSize: 50 });
  if (U_QUERY) params.set("q", U_QUERY);
  const r = await fetch(API + "/admin/profiles?" + params.toString(), { headers:{ "x-admin-key": key } }).then(r=>r.json());
  if (!r.ok) return alert("Users error");
  $("#uTable").innerHTML = `
    <div class="thead"><div>TG User</div><div>Name</div><div>Username</div><div>Phone</div><div>Address</div><div>Slot</div><div>Geo</div><div>Updated</div></div>
    ${r.items.map(p => `
      <div class="trow">
        <div>${p.tg_user_id}</div>
        <div>${p.name||""}</div>
        <div>@${p.username||""}</div>
        <div>${p.phone||""}</div>
        <div>${p.address||""}</div>
        <div>${p.delivery_slot||""}</div>
        <div>${(p.geo_lat && p.geo_lon) ? `${p.geo_lat.toFixed(5)}, ${p.geo_lon.toFixed(5)}` : ""}</div>
        <div>${new Date(p.updated_at).toLocaleString()}</div>
      </div>
    `).join("")}
  `;
}

// default
loadDashboard();
