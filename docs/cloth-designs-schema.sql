-- =============================================================
-- cloth_designs:客製眼鏡布的作品紀錄
-- -------------------------------------------------------------
-- 2026-08-24。搭配 cloth.html 與後台的「客製眼鏡布」頁。
--
-- 第一階段【只做體驗,不成交】—— 沒有商城商品、沒有訂單、沒有金流。
-- 客人做完存檔,後台看得到並可下載 SVG / DXF 製作。
--
-- 為什麼 svg_url 一定要有:
--   後台要下載的 DXF 是從 SVG 轉出來的(在瀏覽器端轉,不另存一份)。
--   沒有 SVG 就產不出 DXF,所以這一欄不允許空值。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

create table if not exists public.cloth_designs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 誰做的。官網註冊而未綁定門市的會員只有 mid,兩欄擇一有值。
  erpid         text,
  mid           text,
  member_name   text,

  -- 圖的來源:market = 刻圖市集的作品,draw = 客人自己畫的
  source        text not null default 'market'
                check (source in ('market','draw')),
  design_id     uuid,            -- source = market 時對應 engraving_designs.id
  design_name   text,

  -- 檔案。svg 是製作用的線稿,preview 是給人看的合成圖
  svg_url       text not null,
  preview_url   text not null,

  -- 位置與大小,座標相對於眼鏡布底圖的寬高(與客製文創同一套慣例)
  placement     jsonb,

  -- 後台處理狀態。第一階段只做體驗,這欄先留著,不做流程
  status        text not null default 'new'
                check (status in ('new','done','archived')),
  note          text
);

-- 後台一律依時間新到舊列出
create index if not exists cloth_designs_created_idx
  on public.cloth_designs (created_at desc);

-- 門市/後台以會員編號查詢
create index if not exists cloth_designs_erpid_idx
  on public.cloth_designs (erpid) where erpid is not null;

/* RLS:全鎖,零政策 —— 只有 service_role(Edge Function)進得來。
   前端拿的 anon key 是公開的,這張表有會員編號與作品,不能讓它直接讀寫。 */
alter table public.cloth_designs enable row level security;

-- =============================================================
-- 驗證
-- =============================================================
select
  count(*)                                   as 目前筆數,
  count(*) filter (where source = 'draw')    as 手繪,
  count(*) filter (where source = 'market')  as 市集刻圖
from public.cloth_designs;
