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
| `shop` | 商城**正式站** `www.lohaseyewear.com` | `SHOP_SITE_API_KEY` |
| `coupon-list` | 主後端**正式站** `lohas.realtime.tw` | `SITE_API_KEY` |
| `coupon-lock` | 主後端**正式站** | `SITE_API_KEY` |
| `member-auth` | 主後端**正式站** `lohas.realtime.tw` | `SITE_API_KEY` |
| `gift` | 主後端**正式站** | `SITE_API_KEY`(**無 FALLBACK**,只讀 Secret) |
| `store-sso-login` | — | 三把:`app` / `shop` / `shop-test`,由我方發給對方 |
| `shop-webhook` | — | 一把,由我方發給商城 |
| `auth-session` | Render 代理 → 即時互動正式站 | `PROXY_KEY` ＋ `SESSION_SECRET` |
| `cloth` / `cloth-admin` | 官網自己的資料表 | 不需金鑰;`cloth-admin` 另有 `FALLBACK_LAB_KEY`(製作端簡易頁的通行碼) |
| `cloth-feed` | 供 App 抓眼鏡布紀錄 | `FALLBACK_APP_KEY` ＋ `FALLBACK_APP_KEY_OLD`(輪替用),與製作端那把**分開** |
| `bday-wall` | 主後端**正式站** | `SITE_API_KEY`(**無 FALLBACK**,只讀 Secret) |

⚠ **吃 `SITE_API_KEY` 的是五支,不是三支。** 2026-08-26 清點才發現
先前這張表漏了 `coupon-lock` 與 `gift` —— 輪替時漏掉那兩支,
症狀是「票券鎖定與禮物中心突然壞掉」,而人會去查票券本身。

`SITE_API_KEY` 是 Secret(2026-08-19 由對方在我方 Supabase 設定),
所以**輪替時對方改 Secret,五支同時生效,我方不必重新部署**。
但 `coupon-list` / `coupon-lock` / `member-auth` 的 `FALLBACK_SITE_KEY`
仍留著舊值 —— 那是已外流的值躺在線上程式碼裡,輪替時應一併清成空字串。

填錯金鑰的症狀是「改完之後全部回未授權」,很容易誤判成網址給錯。

2026-08-22 對方查證後更正:**兩台正式站的金鑰目前是同一個值**
(先前說「不同值、不能互推」是依據一份沒跟著更新的內部紀錄)。
即便如此,**兩個變數名稱仍然維持分開** —— 值相同純屬現況,
任一站輪替金鑰時就會再度分開,合併會害兩支函式同時壞掉而查不出原因。

2026-08-19 起 Secret 拆成兩個名稱(上表),原因是三支函式原本共用 `SITE_API_KEY`
卻打不同環境 —— 任一邊切換環境就會把另一邊弄斷。
**`shop` 不做 `|| SITE_API_KEY` 備援**:變數沒設時要明確地壞掉,
而不是安靜地拿主後端那把去打商城。

`store-sso-login` 那把等同於「可為任意會員產生官網登入連結,不需要密碼」——
它的敏感度高於一般 API 金鑰,呼叫紀錄寫在 `sso_login_log`。

### 輪替金鑰:用 -old 槽,不要直接覆蓋

`store-sso-login`(三個 `-old` 槽)與 `cloth-feed`(`FALLBACK_APP_KEY_OLD`)
都能**同時接受新舊兩把**。直接覆蓋會製造一段「我方已換、對方還沒換」的空窗,
期間全部回 401 / 403。正確做法是兩次部署:

```
第一次  新的填正槽、舊的填 -old 槽 → 兩把都能用,對方不必配合時間
        (對方從容換)
第二次  確認沒人用舊的之後,清空 -old 槽
```

`store-sso-login` 的舊槽 label 會寫進 `sso_login_log`,
查 `key_label like '%-old'` 就知道還有誰在用舊的。

⚠ **但商城那兩把(`shop` / `shop-test`)從來沒出現在紀錄裡** ——
到 2026-08-25 為止,`sso_login_log` 裡清一色是 `app`。
所以那兩把**不能靠看紀錄判斷有沒有換好**,必須明確問商城。
清舊槽之前沒問到答案的話,商城跳官網會全斷,而且要等客人踩到才會發現。

2026-08-26 對方說明原因:商城那條路的入口只出現在商城「客製刻圖」的 CTA
(`SiteDesign` 那一頁),而該功能 2026-08-22 才切到正式站。
所以「極少被使用」是對的,不是走了別的入口 —— **等不到訊號是正常現象。**

金鑰是從三個地方送出來的,變數名不只一個:

| 送出的一端 | 對方的環境變數 | 我方的 label |
|---|---|---|
| 主後端 | `SITE_SSO_KEY` | `app` |
| 商城正式站 | `SITE_DESIGN_SSO_KEY` | `shop` |
| 商城測試站 | `SITE_DESIGN_SSO_KEY`(Render) | `shop-test` |

**2026-08-26 現況:`app` 與 `cloth-feed` 已交付新金鑰,
商城那兩把對方尚未更換 —— `-old` 槽必須保留,等對方來信說換好了才能清。**

**2026-08-27:`cloth-feed` 的輪替已走完,`FALLBACK_APP_KEY_OLD` 已清空。**
之後再部署 `cloth-feed` 時**只要填回 `FALLBACK_APP_KEY` 一格**,
舊槽保持空白(空字串會被 `sameSecret` 擋掉,不是後門)。
槽位留著是為了下次輪替直接有地方放。

2026-08-25 對方(黃總)來文:內部查證作業把五把金鑰讀出來並留在工作紀錄裡,
要求全部輪替。同一封信裡**沒有列到 `SHOP_SITE_API_KEY`** ——
但 8/22 對方說「兩台正式站的金鑰是同一個值」,若那句話還成立,
商城那把等於也外流了。此題已去信詢問,未回覆前不要當作只有五把。

## 上游 `officialWed/login` 實際回什麼(2026-08-27 量到)

```
erpid, erpname, mid, is_erp_bound        ← 就這四個,【沒有 mobile】
```

`auth-session` 有一行 log 會印出每次登入的欄位名(不印值),
搜尋 `上游 login 回傳欄位` 就看得到,不必再猜。

**影響:「用手機指定收禮人」對【未綁定門市的會員】無效。**
已綁定的人可以退而求其次去查 `member/list`(吃 client_id),
未綁定的人兩個來源都拿不到手機 —— 而那正是這個功能唯一要服務的人。

我方這一側全部做完了(`gifts.recipient_mid`、比對不再限有客編、
領取守門、綁定後搬移、手機簽進 session token),**只等對方在
`login` 回應加上 `mobile`**,加了當天就通,我方不必再改。

⚠ 手機一定要由伺服器端從登入回應取得並簽進 token。
前端說「我的手機是 09xx」就能領走指名給那支號碼的禮物 ——
那不是驗證,是宣稱。

## 不要隨手改的東西

- **`js/register.js` 的 `NOT_READY`** — 2026-08-19 已對外開放(`false`)。
  `member-auth` 指向主後端**正式站**,所以**每一筆註冊都是真實會員、真的發簡訊、
  與 ERP 同步**,而正式站沒有測試站那條撈驗證碼的診斷路由(一律 404)。
  要測流程一律走 `register.html?internal=1`,用自己人的手機與 Email。
  **要再次關閉的話,`NOT_READY` 與 `login.html` 的「立即註冊」連結必須一起改** ——
  只拿掉連結擋不住任何人(網址會被分享、被收錄),只改旗標則會變成
  「連結點得到、進去說尚未開放」。改 `NOT_READY` 時 `register.html` 的
  `?v=` 版號也要跟著換,否則回訪者拿到的是快取裡的舊版。
- **`shop` 的 `ALLOW_MID_CHECKOUT`** — 2026-08-25 新增,預設 `false`。
  開啟後未綁定門市的會員可用官網會員編號(`mid`)當 `client_id` 下單,
  不再回 401。**開的順序:先跑 `docs/design-submissions-mid.sql`
  → `shop` 的旗標 → `js/design.js` 的同名旗標。**
  顛倒的話客人會等完產圖與上傳,才在最後一步被擋。
  商城已確認收得下 `mid`,但**營運端查不查得到那個客人是另一回事**,
  開之前要有人確認。
- **`shop` 的 `SHOP_BASE`** — 2026-08-22 已切至商城**正式站**
  (對方確認正式站為 v3.1.11,含 `placement` 白名單、`submission_id`、
  `items` 層合併、`site/entry` 建立登入狀態)。`SHOP_BASE_URL` 與
  `SHOP_SITE_API_KEY` 由對方在我方 Supabase 設定,**兩者綁環境,要換一起換**。

## 2026-08-25 這一天加的東西(容易漏看)

- `cloth` 函式多了 `list` 動作(會員中心「客製眼鏡布」那一頁在用),
  只回自己的,`erpid` 與 `mid` 兩欄都比 —— 綁定門市之前存的那幾筆只有 `mid`。
- `cloth-feed` 多了 `status` 參數(`done` / `pending` / `all`)。
  **`pending` 是快照不是增量**,回應帶 `pending_is_snapshot: true`。
  增量說不出「有東西離開」,對方的製作中清單會只增不減。
- `design_submissions` 多了 `mid` 欄位,`erpid` 改為可空,
  並加了「兩者必有其一」的約束。**不要把 mid 塞進 erpid** ——
  `sso_login_log` 就是因為混了兩種編號,花了一整輪查詢才確認沒出事。
- `store-sso-login` 與 `ssologin.html` 的 `next` 檢查改用 `new URL()` 判斷 origin。
  原本的字串比對(開頭是 `/` 且不是 `//`)被 `/\evil.com` 繞過 ——
  瀏覽器把反斜線正規化成斜線。**不要改回字串比對。**
- 上傳模組與 `cloth.html` 的輸入框在手機上一律 16px。
  iOS 在 focus 字級 <16px 的輸入框時會放大整頁**而且不縮回去**。
  不要用 `maximum-scale=1` 解 —— 那會讓所有人都不能自己放大。

## 環境的現實

官網與 Supabase **只有一套環境,沒有測試站**。

2026-08-22 起**全部走正式站** —— 商城、主後端、票券、會員都是。
所以現在任何一次操作都是真的:真實會員、真的發簡訊、真的訂單。
綠界一直都是正式收款(測試站接的也是),這一點沒有改變。

因此:
- **一律只用內部人員的 ERP 客編**(28095839)。`erpId` 是全公司共用的編號,
  拿別人的客編呼叫 `store-sso-login`,換到的是那位真實客人的官網登入連結;
  拿別人的券呼叫 `coupon-lock`,會把對方的券鎖住 30 分鐘。
- **不結帳**。要驗到訂單階段必須另外約時間,並用小額品項。
- 測試產生的資料(`design_submissions`、`gifts`)以 SQL 手動清除,
  `shop-webhook` 依金鑰標籤標記來源。

新功能一律**先上線但關著**(像 `register.js` 的 `NOT_READY`、
分享牆的 `?wall=preview`),自己跑過一遍再開 ——
沒有測試站的情況下,那是唯一能避免「第一個踩到 bug 的是真客人」的辦法。

## 對外文件

- `docs/串接現況.md` — 與商城共用的介面契約與現況,**公開**,雙方的工程與 AI 工具都會讀。
- `docs/給*.md`、`docs/回覆*.md`、`docs/廠商來文/` — 雙方往來信件,**已 gitignore**,
  不進 repo。裡面有雙方的檢討與內部推論,不該公開。
