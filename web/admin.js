let KEY = "";
const $ = (s)=>document.querySelector(s);

$("#login").onclick = async () => {
  KEY = $("#pw").value.trim();
  if (!KEY) return alert("Enter admin password");
  $("#tools").style.display = "block";
  $("#list").style.display = "block";
  load();
};

async function load() {
  const res = await fetch(`${window.API_URL}/admin/products`, { headers: { "x-admin-key": KEY } });
  const data = await res.json();
  if (!data.ok) return alert("Auth failed");
  $("#items").innerHTML = data.items.map(p => `
    <div class="row">
      <div style="flex:1">
        <div><b>${p.id}</b> — ${p.title}</div>
        <small>${p.category} · ₹${(p.price/100).toFixed(2)} · stock ${p.stock} ${p.age_restricted ? "· RESTRICTED" : ""}</small>
        ${p.image ? `<div><img src="${p.image}" alt="" style="max-width:120px;border-radius:8px;margin-top:6px"/></div>` : ""}
      </div>
      <button class="btn del" data-id="${p.id}">Delete</button>
    </div>
  `).join("");
  document.querySelectorAll(".del").forEach(b => b.onclick = del);
}

async function del(e){
  const id = e.currentTarget.dataset.id;
  if (!confirm("Delete " + id + "?")) return;
  await fetch(`${window.API_URL}/admin/products/${id}`, {
    method:"DELETE", headers:{ "x-admin-key": KEY }
  });
  load();
}

$("#save").onclick = async () => {
  const body = {
    id: $("#id").value.trim(),
    title: $("#title").value.trim(),
    price: +$("#price").value || 0,
    category: $("#category").value.trim(),
    image: $("#image").value.trim(),
    age_restricted: $("#restricted").checked,
    stock: +$("#stock").value || 0
  };
  const res = await fetch(`${window.API_URL}/admin/products`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-admin-key": KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) return alert("Save failed");
  ["#id","#title","#price","#category","#image","#stock"].forEach(s=>$(s).value="");
  $("#restricted").checked = false;
  load();
};
