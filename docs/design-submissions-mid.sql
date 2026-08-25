-- =============================================================
-- design_submissions:讓未綁定門市的會員也記得下來
-- -------------------------------------------------------------
-- 2026-08-25。搭配 shop 函式的 ALLOW_MID_CHECKOUT。
--
-- 背景:商城確認可以接受用官網會員編號(mid)下單,不強制 ERP 客編。
-- 我方送單時 client_id 會變成「erpid 有就用 erpid,沒有就用 mid」。
--
-- 為什麼不把 mid 直接塞進 erpid 欄位:
--   那個欄位叫 erpid,塞進別種編號之後,任何人用 erpid 查客人
--   都會查到錯的結果 —— 而且不會報錯,只會安靜地對不起來。
--   2026-08-25 才剛在 sso_login_log 遇到同一件事:那張表的 erpid
--   混了兩種編號,花了一整輪查詢才確認沒出事。不要再做一次。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

-- 未綁定的人沒有客編,這一欄不能再是必填
alter table public.design_submissions
  alter column erpid drop not null;

alter table public.design_submissions
  add column if not exists mid text;

comment on column public.design_submissions.mid is
  '官網會員編號。門市綁定過的人這一欄是空的(用 erpid);'
  '官網註冊而未綁定的人反過來。兩者必有其一。';

/* 兩個都空的話這筆紀錄查不到是誰,那比沒有紀錄更糟 ——
   會以為「有人下單但查不出來」,實際上是寫入時就漏了。
   現有資料每一筆都有 erpid,所以這個約束加得上去。 */
alter table public.design_submissions
  drop constraint if exists design_submissions_who_present;
alter table public.design_submissions
  add constraint design_submissions_who_present
  check (erpid is not null or mid is not null);

create index if not exists design_submissions_mid_idx
  on public.design_submissions (mid) where mid is not null;

-- =============================================================
-- 驗證
-- =============================================================
select
  count(*)                                as 總筆數,
  count(*) filter (where erpid is not null) as 有客編,
  count(*) filter (where mid   is not null) as 有官網編號
from public.design_submissions;
