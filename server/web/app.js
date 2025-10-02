const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.MainButton.setText("Checkout");
  tg.MainButton.color = "#0F766E";
  tg.MainButton.textColor = "#ffffff";
  tg.MainButton.show();
  tg.MainButton.onClick(() => {
    tg.HapticFeedback.impactOccurred("medium");
    tg.showPopup({ title: "Order placed", message: "Thanks for shopping!", buttons: [{ type: "ok" }] });
  });
}

document.getElementById("ping")?.addEventListener("click", async () => {
  const initData = tg?.initData || "";
  const res = await fetch((window.API_URL || "") + "/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData })
  });
  const data = await res.json();
  alert(JSON.stringify(data, null, 2));
});
