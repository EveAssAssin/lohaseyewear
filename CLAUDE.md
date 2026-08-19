# CLAUDE.md

本檔案為 Claude Code 在此 repo 的工作準則。每個 session 會自動讀取,以下規則一律遵守。

## 專案簡介

LOHAS 樂活眼鏡官方網站,靜態網頁專案,透過 GitHub Pages 部署,正式網域為 `www.lohasglasses.com`(見根目錄 `CNAME`)。主要為 HTML 頁面搭配 `css/`、`js/`、`data/`、`images/`、`components/` 等資源。

## 鐵則(務必遵守)

1. **對外連結一律使用 `www.lohasglasses.com`**
   任何指向本站的對外連結、正式網址、範例網址,都用 `https://www.lohasglasses.com`,不要用其他網域、GitHub Pages 預設網址或裸網域。

2. **Supabase 只走 Dashboard**
   涉及 Supabase 的任何設定、資料表、政策(RLS)、金鑰、儲存桶等操作,一律引導使用者到 Supabase Dashboard 手動完成,不透過 CLI、SQL 腳本或程式自動改動線上專案設定。

3. **輸出一律使用繁體中文**
   所有回覆、說明、註解與溝通都用繁體中文。

4. **提供完整檔案,不給 patch/diff**
   需要修改檔案時,輸出「完整的檔案內容」讓使用者可以整份取代,不要只給片段 patch、diff 或「在第 N 行插入」這類局部指示。

---

## Edge Function 的金鑰與環境(踩過坑,務必先讀)

使用者**沒有 Supabase Secrets 權限**,金鑰多半填在程式碼裡的 `FALLBACK_*` 常數,
而那個值**只存在於線上部署的那一份** —— repo 裡永遠是空字串(公開 repo,不能放金鑰)。

**但 Secrets 確實有人在動。** 2026-08-19 對方(商城工程方)自行設定了
`SITE_API_KEY` 與 `SHOP_SITE_API_KEY`,並且**直接改了線上 `shop` 函式的程式碼**。
所以線上那一份與 repo 這一份可能不一致,而且不是使用者改的。

因此:**動任何 Edge Function 之前,先 Download 看線上實際長什麼樣**,
不要假設 repo 這份就是線上跑的那份。程式碼讀 `Deno.env.get(...) || FALLBACK_*`,
env 優先 —— Secret 一旦被設定,`FALLBACK_*` 就再也沒有作用,
但它仍然要留著填對的值(Secret 被刪掉時那是唯一的救命索)。

### 給部署步驟時,第一步一定要是「先按 Download」

```
1. 函式頁面右上角按 Download(下載的是含金鑰的線上版)
2. 貼上新版程式碼
3. 從下載的檔案複製金鑰,填回 FALLBACK_*
4. Deploy
```

2026-08-17 整份取代 `shop.ts` 時漏掉第 1 步,金鑰被洗掉,市集、商品頁、
客製文創同時中斷,而 git 全歷史都是空值、救不回來。

下載檔不要放進 repo 資料夾,會被 commit 到公開 repo。

### 各支函式打哪一台、用哪一把金鑰(不可互換)

| 函式 | 對接 | 金鑰(Secret 名稱) |
|---|---|---|
| `shop` | 商城**測試站** `lohas-shop-test.onrender.com` | `SHOP_SITE_API_KEY` |
| `coupon-list` | 主後端**正式站** `lohas.realtime.tw` | `SITE_API_KEY` |
| `member-auth` | 主後端**正式站** `lohas.realtime.tw` | `SITE_API_KEY` |
| `store-sso-login` | — | 三把:`app` / `shop` / `shop-test`,由我方發給對方 |
| `shop-webhook` | — | 一把,由我方發給商城 |
| `auth-session` | Render 代理 → 即時互動正式站 | `PROXY_KEY` ＋ `SESSION_SECRET` |

**商城的金鑰與主後端的金鑰是不同的兩把**,主後端的測試站與正式站又是不同的兩把。
填錯的症狀是「改完之後全部回未授權」,很容易誤判成網址給錯。

2026-08-19 起 Secret 拆成兩個名稱(上表),原因是三支函式原本共用 `SITE_API_KEY`
卻打不同環境 —— 任一邊切換環境就會把另一邊弄斷。
**`shop` 不做 `|| SITE_API_KEY` 備援**:變數沒設時要明確地壞掉,
而不是安靜地拿主後端那把去打商城。

`store-sso-login` 那把等同於「可為任意會員產生官網登入連結,不需要密碼」——
它的敏感度高於一般 API 金鑰,呼叫紀錄寫在 `sso_login_log`。

## 不要隨手改的東西

- **`js/register.js` 的 `NOT_READY`** — 2026-08-19 已對外開放(`false`)。
  `member-auth` 指向主後端**正式站**,所以**每一筆註冊都是真實會員、真的發簡訊、
  與 ERP 同步**,而正式站沒有測試站那條撈驗證碼的診斷路由(一律 404)。
  要測流程一律走 `register.html?internal=1`,用自己人的手機與 Email。
  **要再次關閉的話,`NOT_READY` 與 `login.html` 的「立即註冊」連結必須一起改** ——
  只拿掉連結擋不住任何人(網址會被分享、被收錄),只改旗標則會變成
  「連結點得到、進去說尚未開放」。改 `NOT_READY` 時 `register.html` 的
  `?v=` 版號也要跟著換,否則回訪者拿到的是快取裡的舊版。
- **`shop` 的 `SHOP_BASE`** — 商城正式站尚未部署修正,對方明確要求維持在測試站驗證。

## 環境的現實

官網與 Supabase **只有一套環境,沒有測試站**。商城測試站的操作會寫進我方的正式資料表
(`design_submissions`、`gifts` 等)。測試資料以 SQL 手動清除,
`shop-webhook` 依金鑰標籤標記來源。

因此:**在商城測試站操作時,一律只用內部人員的 ERP 客編**。
`erpId` 是全公司共用的編號,拿別人的客編呼叫 `store-sso-login`,
換到的是那位真實客人的官網登入連結。

## 對外文件

- `docs/串接現況.md` — 與商城共用的介面契約與現況,**公開**,雙方的工程與 AI 工具都會讀。
- `docs/給*.md`、`docs/回覆*.md`、`docs/廠商來文/` — 雙方往來信件,**已 gitignore**,
  不進 repo。裡面有雙方的檢討與內部推論,不該公開。
