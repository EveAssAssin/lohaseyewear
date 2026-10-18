/* =============================================================
   刻圖送審:著作權聲明與簽名(2026-10-16)
   -------------------------------------------------------------
   客人在刻圖市集送審(新作品、修改後重新送審)之前,要先閱讀
   著作權聲明、勾選同意並手寫簽名。這張表存「誰、在什麼時候、
   看到哪一版聲明、簽了什麼」。

   寫入只有 design 函式(service_role)—— 它從 session token 取
   客編與姓名,不看前端傳的;沒有簽名或聲明版本對不上就拒收。
   讀取只有後台走 admin-read(驗管理員)。

   🔒 RLS 開著、【一條政策都沒有】:anon 讀不到也寫不進來。
      簽名圖是個人資料,而 engraving_designs 是公開可讀的,
      所以不能放在那張表上。

   ⚠ 在 Supabase SQL Editor 整段一次執行。最後一段是驗收,結果貼回來。
   ============================================================= */

create table if not exists public.design_agreements (
  id              uuid primary key default gen_random_uuid(),
  design_id       uuid references public.engraving_designs(id) on delete set null,
  erpid           text not null,
  signer_name     text,                       -- 由 token 取得,不是前端填的
  version         text not null,              -- 聲明版本,例:2026-10-16-v1
  agreement_text  text not null,              -- 簽署當下那一版聲明的全文(伺服器存的那份)
  action          text not null check (action in ('submit', 'update_own')),
  signature_png   text not null
                  check (signature_png like 'data:image/png;base64,%'
                         and length(signature_png) <= 400000),
  user_agent      text,
  ip              text,
  created_at      timestamptz not null default now()
);

create index if not exists design_agreements_design_idx on public.design_agreements (design_id);
create index if not exists design_agreements_erpid_idx  on public.design_agreements (erpid, created_at desc);

alter table public.design_agreements enable row level security;
-- 刻意不建任何政策:只有 service_role(design / admin-read 函式)碰得到。

comment on table public.design_agreements is
  '刻圖送審的著作權聲明簽署紀錄。只由 design 函式寫入、admin-read 讀取;RLS 開啟且無政策。';

/* ---------- 驗收(只有這一段會顯示結果) ---------- */
select '1 資料表' as 項目,
       case when to_regclass('public.design_agreements') is not null then '已建立' else '沒有(不對)' end as 內容
union all
select '2 RLS', case when relrowsecurity then '已開啟' else '沒開(不對)' end
  from pg_class where oid = 'public.design_agreements'::regclass
union all
select '3 政策數(應為 0)', count(*)::text
  from pg_policies where schemaname = 'public' and tablename = 'design_agreements'
union all
select '4 欄位', string_agg(column_name, ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and table_name = 'design_agreements';
