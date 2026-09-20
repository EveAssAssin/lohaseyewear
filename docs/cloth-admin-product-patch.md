# cloth-admin：加一個 product 篩選（手動補三行，不要整份取代）

2026-09-20

---

## 🚨 為什麼這一支不給你整份檔案

**線上那份 `cloth-admin` 比 repo 新。** `js/cloth-lab.js` 裡就寫著這件事：
線上版認得 `rejected` 狀態，repo 這份不認。

整份貼上去的話，退件功能會**安靜地消失**——師傅按退件不會報錯，
只是那一件不會進「已退件」那一格，而沒有人會發現，
因為那些件本來就會從「待製作」消失。

所以這一支請照下面的方式手動補：

```
1. Supabase Dashboard → Edge Functions → cloth-admin → 右上角 Download
2. 在【下載下來的那一份】上面改（不是 repo 這一份）
3. 貼回去 → Deploy
```

⚠ 這支不需要金鑰，但它有 `FALLBACK_LAB_KEY`（製作端簡易頁的通行碼）。
Download 之後先確認那一格有值，貼回去時要留著。

---

## 要改的地方

在 `list` 那一段，`status` 篩選的**下面**加三行。

### 改之前

```ts
  // 後台預設只想看還沒處理的。要看全部就不帶這個參數。
  const status = String(body.status || '');
  if (['new', 'done', 'archived'].indexOf(status) >= 0) q = q.eq('status', status);

  const keyword = String(body.q || '').trim();
```

（線上那份因為認得退件，這一行的陣列裡可能還有 `'rejected'`。
**以你下載到的那一份為準，不要照抄我這邊的陣列。**）

### 改之後

```ts
  // 後台預設只想看還沒處理的。要看全部就不帶這個參數。
  const status = String(body.status || '');
  if (['new', 'done', 'archived'].indexOf(status) >= 0) q = q.eq('status', status);

  /* 品項。2026-09-20 起眼鏡盒與眼鏡布共用這張表(共用同一個加工中心)。
     ⚠ 沒帶就是【全部】—— 製作端一天要把兩種都做完,預設只給一種的話,
       另一種會安靜地堆在看不到的地方。
     ⚠ 用白名單比對,不要把前端字串直接丟進查詢。 */
  const product = String(body.product || '');
  if (['cloth', 'case'].indexOf(product) >= 0) q = q.eq('product', product);

  const keyword = String(body.q || '').trim();
```

**就這樣，其他一個字都不要動。**

---

## 為什麼不用在前端篩就好

`list` 一次只抓 100 筆。在前端篩的話，「眼鏡盒」那一頁看到的其實是
**「前 100 筆裡剛好是盒子的那幾件」**，而總數還是全部的——
數字與清單對不起來，而且不會有任何錯誤訊息。

---

## 不必改的部分

`list` 用的是 `select('*')`，所以 **`product` 欄位會自動出現在回傳裡**，
不必另外加。加工中心那一頁的品項標籤已經靠這一點在運作了。

---

## 驗收

部署後開 https://www.lohasglasses.com/cloth-lab.html ，輸入通行碼：

1. 上面多一排「品項：全部／眼鏡布／眼鏡盒」，預設停在「全部」
2. 每張卡片最前面多一個深色標籤，現在應該全部都是「眼鏡布」
3. 按「眼鏡盒」→ 清單是空的（還沒有任何盒子）
4. 按「眼鏡布」→ 與「全部」筆數相同

第 3、4 點如果**兩邊筆數一樣**，代表那三行沒有生效
（函式沒部署，或改到了別的地方）。
