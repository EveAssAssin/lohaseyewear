-- =============================================================
-- cloth_designs:客人撤回生日眼鏡布(2026-11-03)
-- -------------------------------------------------------------
-- 在 Supabase Dashboard → SQL Editor 整段貼上執行。
--
-- ── 起因 ──
-- 2026-11-02 21:49 吳婉萍(1756218072)不小心送出一件
-- 「文字:耍廢是生活態度...」,要撤回。原本沒有撤回的方法:
--   · 「封存」仍然佔用一年一件的額度 → 她就不能重做了
--   · 「退件」會讓 App 推播「眼鏡布需要重新設計」→ 她沒有要重做也會被催
-- 所以多一個狀態 withdrawn(客人已撤回):
--   · 師傅的待製作清單看不到(那邊只看 new)
--   · App 的製作中快照會把它拿掉(cloth-feed 的 pending 只給 new)
--   · 不佔一年一件的額度(cloth 函式的 thisYearOne 排除它)
--   · 不推播
--
-- 客人自己按撤回:cloth 函式的 withdraw 動作
-- (只限生日眼鏡布、狀態仍是待製作、送出後 WITHDRAW_MINUTES 分鐘內)。
--
-- ⚠ 狀態約束原本是 ('hold','new','done','rejected','archived')
--   (docs/case-checkout.sql),這裡原樣保留再加一個。
-- =============================================================

alter table public.cloth_designs drop constraint if exists cloth_designs_status_check;
alter table public.cloth_designs
  add constraint cloth_designs_status_check
  check (status in ('hold', 'new', 'done', 'rejected', 'archived', 'withdrawn'));

alter table public.cloth_designs add column if not exists withdrawn_at timestamptz;
comment on column public.cloth_designs.withdrawn_at is
  '客人撤回的時間(status = withdrawn 時才有值)';

/* 吳婉萍 11/02 21:49 誤送的那一件。
   條件刻意寫得很窄(人 + 生日眼鏡布 + 待製作 + 那一個小時),
   不會動到別筆;回傳的列就是被撤回的那一件。 */
update public.cloth_designs
   set status = 'withdrawn', withdrawn_at = now(), done_at = null
 where (erpid = '1756218072' or mid = '1756218072')
   and product = 'cloth'
   and order_no is null
   and status = 'new'
   and created_at >= '2026-11-02 21:00:00+08'
   and created_at <  '2026-11-02 22:00:00+08'
returning id, member_name, design_name, status, created_at at time zone 'Asia/Taipei' as 送出時間;
