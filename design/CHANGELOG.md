# LOHAS 設計規範 更新紀錄

版本規則:

- **v1.x**:只會「新增」token 或修正元件 bug,**不改、不刪既有 token 的值**。引用 `/design/v1/` 的平台不必做任何事。
- **v2**:要改既有的值或刪除 token 時才出,放在新的 `/design/v2/`,v1 保留不動。會事先通知各平台。

說明頁:https://www.lohasglasses.com/design/

## v1.1.0(2026-11-24)

只新增,既有 76 個 token 的值都沒變,已引用 v1 的平台不必做任何事。新增 16 個(共 92 個),
來源是各平台盤點時回報「規範裡缺」的項目:

- **白底** `bg-white`:白色原本只有 `text-on-dark`(深色底上的字),不能拿來當底色。
- **狀態深字** `ok-strong` / `warn-strong` / `err-strong` / `danger-strong`:狀態標籤「淡底配字」用,
  放在對應的 `*-bg` 上對比都在 5.5 以上。`warn` 原色在白底上只有 3.1,小字請用 `warn-strong`。
- **資訊藍** `info` / `info-bg` / `info-strong`:資訊、說明、即將開始、處理中。刻意調得柔和,配合品牌暖色。
- **AI / 樂維斯** `ai` / `ai-bg` / `ai-strong`:新的一組,與創作者紫刻意分開。
- **字級** `fs-15`、`fs-20`;**圓角** `r-6`、`r-10`、`r-12`。官網本身也大量在用(15px 129 處、20px 47 處、
  圓角 6 / 10 / 12 共 178 處),補上之後才能「值完全相同直接換」。

修正:`tailwind.preset.js` 的字級、間距、圓角、陰影、層級改成 `lohas-` 前綴
(`text-lohas-xl`、`p-lohas-5`、`rounded-lohas-md`、`shadow-lohas-card`、`z-lohas-modal`)。
1.0.0 用的是 `xl`、`5` 這種名字,會蓋掉 Tailwind 內建的同名值(`p-5` 20px → 24px、`text-xl` 20px → 22px),
專案一接上 preset,沒改到的畫面也會跟著變。發布當天還沒有平台接上,所以直接修。顏色沒有撞名,不變。

## v1.0.0(2026-11-23)

第一版。內容取自官網實際使用中的 `css/lohas-tokens.css`(43 頁中 40 頁載入),共 76 個 token:

- 顏色 37 個:品牌、底色、文字、身份(會員 / 創作者 / 聯名)、狀態、金色系
- 字體 1、字級 8、間距 8、圓角 6、陰影 4、層級 8、動態 4
- 斷點約定:480 / 768 / 1024

檔案:`tokens.css`、`tokens.scss`、`tokens.js`、`tokens.json`、`tailwind.preset.js`、`lohas-ui.js`(提示框元件,樣式自動載入)。
