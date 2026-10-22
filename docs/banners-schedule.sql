/* =============================================================
   Banner 排程上架(2026-10-22)
   -------------------------------------------------------------
   banners 加兩個時間欄位,前台(js/index.js 首頁輪播、js/page-banner.js 分頁 Banner)
   只顯示「is_active 而且現在落在 [start_at, end_at) 之間」的 Banner:
     start_at 空 = 立即;end_at 空 = 不結束。兩個都空 = 跟以前一樣。

   後台寫入走 admin-write,白名單要同時加 start_at / end_at(另外部署)。

   ⚠ 順序:先跑這段 → 再部署 admin-write → 最後才推前台。
     前台先上的話,查詢條件裡的 start_at / end_at 欄位還不存在,
     Banner 會整個不見(查詢出錯就隱藏)。

   在 Supabase SQL Editor 整段一次執行,最後一段是驗收。
   ============================================================= */

alter table public.banners add column if not exists start_at timestamptz;
alter table public.banners add column if not exists end_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'banners_schedule_order') then
    alter table public.banners
      add constraint banners_schedule_order
      check (start_at is null or end_at is null or end_at > start_at);
  end if;
end $$;

comment on column public.banners.start_at is '排程:開始顯示的時間(空 = 立即)';
comment on column public.banners.end_at   is '排程:停止顯示的時間(空 = 不結束)';

/* ---------- 驗收 ---------- */
select '1 欄位' as 項目, string_agg(column_name || ' ' || data_type, ', ') as 內容
  from information_schema.columns
 where table_schema = 'public' and table_name = 'banners' and column_name in ('start_at', 'end_at')
union all
select '2 先後約束', pg_get_constraintdef(oid)
  from pg_constraint where conname = 'banners_schedule_order'
union all
select '3 目前 Banner(位置, 筆數)', string_agg(position || ': ' || n, ' / ')
  from (select position, count(*)::text n from public.banners group by position) t;
