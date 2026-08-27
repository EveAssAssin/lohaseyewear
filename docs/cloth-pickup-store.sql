-- =============================================================
-- cloth_designs:客人自己選的取貨門市
-- -------------------------------------------------------------
-- 2026-08-27。
--
-- 用途有兩個,第二個才是主因:
--   ① 客人知道自己要去哪裡拿
--   ② 製作端(cloth-lab.html)要依區域分流 ——
--      台中以北一組、台南以南一組,各自只看自己要做的那些。
--
-- 為什麼三個欄位都存下來,而不是只存 erpid 再去查:
--   cloth-lab.html 是一頁憑通行碼進入的獨立頁面,它【不登入】、
--   也不該為了顯示一個店名去打門市 API —— 那台一掛,整張製作單
--   就變成一排「未知門市」,而製作是不能停的。
--
-- ⚠ store_city 是【下單當時】的區域,不跟著門市異動。
--   一件已經排進「台南以南」那條線的工作,不應該因為總部把
--   某家店改劃到別區,隔天就跳到另一組人的清單裡。
--   要重新分配的話是人為決定,不是資料自己漂移。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

alter table public.cloth_designs
  add column if not exists store_erpid text,
  add column if not exists store_name  text,
  add column if not exists store_city  text;

comment on column public.cloth_designs.store_erpid is
  '客人選的取貨門市 ERP 編號。舊資料為 null —— 那些是這個功能上線前存的。';
comment on column public.cloth_designs.store_name is
  '取貨門市名稱。冗餘存放:製作端那一頁不登入,不能為了顯示店名去打門市 API。';
comment on column public.cloth_designs.store_city is
  '下單當時的門市區域(北區/台中區一/台南區…)。製作端據此分成'
  '「台中以北」與「台南以南」兩條線。⚠ 刻意不跟著門市異動。';

/* 製作端最常問的問題就是「我這一區還有幾件沒做」,
   而那正好是 status + store_city 這個組合。 */
create index if not exists cloth_designs_store_city_idx
  on public.cloth_designs (store_city, status, created_at desc);

-- =============================================================
-- 驗證
-- =============================================================
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'cloth_designs'
  and column_name like 'store_%'
order by column_name;

-- 上線後拿來看分流狀況(現在應該全部是 null = 尚未指定)
select coalesce(store_city, '(舊資料/未指定)') as 區域,
       status, count(*) as 件數
from public.cloth_designs
group by 1, 2
order by 1, 2;
