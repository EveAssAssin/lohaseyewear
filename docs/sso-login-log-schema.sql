-- =============================================================
-- sso_login_log — store-sso-login 的呼叫紀錄
-- -------------------------------------------------------------
-- 為什麼需要
--   store-sso-login 的金鑰等同於「可為任意會員產生官網登入連結,
--   不需要那位會員的帳號密碼」。持有它的人可以登入任何人的帳號。
--
--   商城 2026-08-17 來文點出關鍵的一件事:
--     「金鑰外洩時,我方這邊無從察覺 —— 對方拿去打的是貴方的端點。
--       只有貴方看得到異常。」
--
--   也就是說【偵測外洩的責任在我方】,而我方先前沒有任何紀錄。
--   真的被拿去掃帳號,我們不會知道,事後也查不出被存取過哪些帳號。
--
-- 這張表同時是速率限制的依據 —— 用資料庫而不是記憶體計數,
-- 因為 Edge Function 會有多個執行個體,各自記數等於沒有限制。
--
-- 貼法:Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- =============================================================

create table if not exists public.sso_login_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),

  -- 哪一把金鑰。app / shop / shop-test,驗證失敗時為 '(invalid)'
  -- ⚠ 絕不記錄對方送來的金鑰值本身 —— 那有可能就是真的那一把,
  --   記進資料庫等於多一個外洩點。
  key_label  text not null,

  -- 為誰產生登入連結。外洩調查時,這一欄回答「哪些帳號被存取過」
  erpid      text,

  ip         text,
  next_path  text,

  -- ok / invalid_key / rate_limited / bad_request / error
  result     text not null,
  note       text
);

comment on table public.sso_login_log is
  'store-sso-login 的呼叫紀錄。該金鑰等同帳號存取權,外洩時只有我方看得到異常。';
comment on column public.sso_login_log.key_label is
  '金鑰標籤,非金鑰本身。金鑰值任何情況下都不入庫。';
comment on column public.sso_login_log.erpid is
  '被產生登入連結的會員編號。外洩調查時用來回答「哪些帳號被存取過」。';

-- 速率限制每次呼叫都會查最近的紀錄,這個索引是熱路徑
create index if not exists sso_login_log_key_time_idx
  on public.sso_login_log (key_label, created_at desc);

-- 事後調查:某個會員編號被誰、在什麼時候產生過登入連結
create index if not exists sso_login_log_erpid_idx
  on public.sso_login_log (erpid, created_at desc)
  where erpid is not null;

-- 異常一眼撈出
create index if not exists sso_login_log_bad_idx
  on public.sso_login_log (created_at desc)
  where result <> 'ok';

-- RLS 全鎖:這張表逐筆記錄「誰在什麼時候能登入誰的帳號」,
-- 比多數業務資料更敏感。只有 Edge Function 的 service_role 進得去。
alter table public.sso_login_log enable row level security;


-- ---------- 確認 ----------
select
  (select relrowsecurity from pg_class
     where oid = 'public.sso_login_log'::regclass)                 as rls已啟用,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'sso_login_log')  as policy數量;
