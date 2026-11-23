# LOHAS 設計規範 更新紀錄

版本規則:

- **v1.x**:只會「新增」token 或修正元件 bug,**不改、不刪既有 token 的值**。引用 `/design/v1/` 的平台不必做任何事。
- **v2**:要改既有的值或刪除 token 時才出,放在新的 `/design/v2/`,v1 保留不動。會事先通知各平台。

說明頁:https://www.lohasglasses.com/design/

## v1.0.0(2026-11-23)

第一版。內容取自官網實際使用中的 `css/lohas-tokens.css`(43 頁中 40 頁載入),共 76 個 token:

- 顏色 37 個:品牌、底色、文字、身份(會員 / 創作者 / 聯名)、狀態、金色系
- 字體 1、字級 8、間距 8、圓角 6、陰影 4、層級 8、動態 4
- 斷點約定:480 / 768 / 1024

檔案:`tokens.css`、`tokens.scss`、`tokens.js`、`tokens.json`、`tailwind.preset.js`、`lohas-ui.js`(提示框元件,樣式自動載入)。
