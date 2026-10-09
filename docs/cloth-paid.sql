/* =============================================================
   付費客製眼鏡布(商城 2884「雷刻小物｜創作眼鏡布」NT$200)
   2026-10-09
   -------------------------------------------------------------
   有別於生日的免費眼鏡布:走商城結帳(與客製眼鏡盒同一條路),
   付款完成後由 shop-webhook 搬進 cloth_designs(product = 'cloth'),
   之後的製作、製作單、門市掃碼登錄到店、App 取件按鈕都跟生日眼鏡布一樣。

   與生日眼鏡布的區分:cloth_designs.order_no 有值 = 付費(商城訂單)。
   cloth 函式的「一年一件」只算 order_no 是 null 的那些(生日的)。

   這段做三件事:
     ① design_submissions.product 放寬成也收 'cloth'
        (原本只收 null = 太陽眼鏡 與 'case')
     ② 「要有取貨門市」從只管眼鏡盒,改成管所有付費客製品
     ③ 兩張表都加 variant:客人選的款式/顏色(卡其、粉紅、灰色、咖啡)。
        師傅要知道拿哪一條布 —— 沒有這一欄,他只能去商城翻訂單。

   ⚠ 在 Supabase SQL Editor 整段一次執行。最後一段是驗收,
     結果貼回來確認。
   ============================================================= */

do $$
begin
  -- ① 品項值域
  alter table public.design_submissions drop constraint if exists design_submissions_product_check;
  alter table public.design_submissions
    add constraint design_submissions_product_check
    check (product is null or product in ('case', 'cloth'));

  -- ② 付費客製品一定要有取貨門市(原本只管 case)
  alter table public.design_submissions drop constraint if exists design_submissions_case_store;
  if not exists (select 1 from pg_constraint where conname = 'design_submissions_paid_store') then
    alter table public.design_submissions
      add constraint design_submissions_paid_store
      check (product is null or store_erpid is not null);
  end if;
end $$;

-- ③ 款式
alter table public.design_submissions add column if not exists variant text;
alter table public.cloth_designs      add column if not exists variant text;

comment on column public.design_submissions.variant is
  '客人選的款式(例:卡其)。付費客製眼鏡布才有;對應商城規格 sid 已送在 cart/push 的 main.sid';
comment on column public.cloth_designs.variant is
  '款式(例:卡其)。付費客製眼鏡布才有,師傅據此拿布;生日眼鏡布與眼鏡盒是 null';

/* ---------- 驗收(只有這一段會顯示結果) ---------- */
select '1 送單品項值域' as 項目, pg_get_constraintdef(oid) as 內容
  from pg_constraint where conname = 'design_submissions_product_check'
union all
select '2 付費品要有門市', pg_get_constraintdef(oid)
  from pg_constraint where conname = 'design_submissions_paid_store'
union all
select '3 舊的眼鏡盒門市約束已移除', case when exists
  (select 1 from pg_constraint where conname = 'design_submissions_case_store') then '還在(不對)' else '已移除' end
union all
select '4 variant 欄位', string_agg(table_name, ', ' order by table_name)
  from information_schema.columns
 where table_schema = 'public' and column_name = 'variant'
   and table_name in ('design_submissions', 'cloth_designs')
union all
select '5 既有送單(品項, 筆數)', coalesce(string_agg(p || ': ' || n, ' / '), '(無)')
  from (select coalesce(product, '太陽眼鏡') p, count(*)::text n
          from public.design_submissions group by product) t;
