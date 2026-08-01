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
