/* =========================================================
   reserve.js — 商城取貨預約落地頁邏輯
   ---------------------------------------------------------
   流程：
     商城 /reserve 302 → reserve.html?from=cart&name&phone&cartType&cartPaymentMethod
     → 本檔擷取參數存 sessionStorage、清掉網址
     → 抓全部門市（getstoredatas，內含每店顧問）
     → 彈出 booking modal 的「先選門市 → 再選顧問」流程
     → 選完顧問 → modal 內 postBackToMall() 加密門市/顧問 → form POST 回商城
   注意：時段不在這裡選，回到商城那頁選（方向 B）。
   ========================================================= */
(function () {
  "use strict";

  var CART_KEY = "lohas_cart_prefill";

  /* 1) 擷取商城帶入的 query → sessionStorage，並把網址清乾淨（避免重整外露個資） */
  function captureCartPrefill() {
    var params = new URLSearchParams(location.search);
    if (params.get("from") !== "cart") return;
    var cart = {
      name: params.get("name") || "",
      phone: params.get("phone") || "",
      cartType: params.get("cartType") || "",
      cartPaymentMethod: params.get("cartPaymentMethod") || ""
    };
    try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  function hasCart() {
    try { return !!sessionStorage.getItem(CART_KEY); } catch (e) { return false; }
  }

  function setStatus(title, msg, isError) {
    var t = document.getElementById("rsv-status-title");
    var m = document.getElementById("rsv-status-msg");
    var sp = document.getElementById("rsv-spinner");
    if (t) t.textContent = title;
    if (m) m.textContent = msg || "";
    if (sp) sp.style.display = isError ? "none" : "";
  }

  /* 使用者把 modal 關掉、沒完成預約 → 顯示出路,避免卡在轉圈圈
     提供「重新選擇門市」+「回商城」兩個按鈕 */
  function showDismissedState(stores) {
    setStatus("尚未完成預約", "您可以重新選擇門市，或返回商城。", true);
    var card = document.querySelector(".rsv-card");
    if (!card) return;
    /* 避免重複加 */
    var existing = document.getElementById("rsv-actions");
    if (existing) existing.remove();

    var box = document.createElement("div");
    box.id = "rsv-actions";
    box.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-top:18px;";

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "重新選擇門市";
    retry.style.cssText = "padding:12px 18px;border:0;border-radius:999px;background:var(--lohas-brand,#50422D);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;";
    retry.addEventListener("click", function () {
      box.remove();
      setStatus("請選擇取貨門市", "在彈出的視窗中挑選門市與銷售顧問");
      var sp = document.getElementById("rsv-spinner");
      if (sp) sp.style.display = "";
      openModal(stores);
    });

    var back = document.createElement("a");
    back.textContent = "返回商城";
    back.href = "https://www.lohaseyewear.com/order/wear/cart";
    back.style.cssText = "padding:12px 18px;border:1px solid var(--lohas-bd,#E8DED1);border-radius:999px;background:#fff;color:var(--text-sub,#8a7e6d);font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;text-align:center;font-family:inherit;";

    box.appendChild(retry);
    box.appendChild(back);
    card.appendChild(box);
  }

  /* 開 modal,綁定 onClose:使用者沒完成就關 → 顯示出路 */
  function openModal(stores) {
    var modal = window.LohasBookingModal;
    modal.open({
      stores: stores,
      onClose: function (reason) {
        /* reason==="dismiss" 表示使用者主動關閉、沒完成預約
           (預約成功是走 postBackToMall 直接跳商城,不會觸發這裡) */
        if (reason === "dismiss") {
          showDismissedState(stores);
        }
      }
    });
  }

  async function init() {
    captureCartPrefill();

    /* 沒有商城帶入資料（直接打開 reserve.html）→ 導去一般門市頁 */
    if (!hasCart()) {
      location.replace("allstore.html");
      return;
    }

    var storeApi = window.LohasApi && window.LohasApi.store;
    var dataLib = window.LohasStore && window.LohasStore.data;
    var modal = window.LohasBookingModal;
    if (!storeApi || !dataLib || !modal) {
      setStatus("載入失敗", "頁面資源未正確載入，請重新整理。", true);
      return;
    }

    try {
      setStatus("正在載入門市…", "請稍候");
      var raw = await storeApi.getAllStores();
      var stores = (raw || [])
        .map(dataLib.normalizeStore)
        .filter(Boolean)
        .sort(function (a, b) {
          return (a.region.order - b.region.order) || ((a.sort || 0) - (b.sort || 0));
        });

      if (!stores.length) {
        setStatus("目前無法載入門市", "請稍後再試，或直接致電門市預約。", true);
        return;
      }

      setStatus("請選擇取貨門市", "在彈出的視窗中挑選門市與銷售顧問");
      openModal(stores);
    } catch (err) {
      console.error("[reserve] 載入門市失敗:", err);
      setStatus("載入失敗", "無法取得門市資料，請重新整理或稍後再試。", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
