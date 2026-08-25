-- =============================================================
-- cloth_designs:新增 done_at(完成製作的時間)
-- -------------------------------------------------------------
-- 2026-08-25。為了讓 App 能「每天抓取新完成的紀錄」。
--
-- 為什麼一定要有這一欄:
--   只有 status 的話,App 每天只能整包重抓再自己比對哪些是新的。
--   那種做法一旦比對邏輯出錯就會【重複推播】—— 客人收到兩三次
--   「你的眼鏡布做好了」,那比晚一天通知糟糕得多。
--   有了完成時間,App 帶一個 since 就只會拿到新的那些。
--
-- 既有已完成的資料:
--   done_at 補成 created_at,而不是 now()。
--   補成 now() 的話,App 第一次抓就會把所有舊資料當成「剛完成」,
--   一次推播給所有人。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是 Edge Functions 的編輯器)
-- =============================================================

alter table public.cloth_designs
  add column if not exists done_at timestamptz;

comment on column public.cloth_designs.done_at is
  '按下「完成製作」的時間。App 以此做增量抓取(since),沒有它就只能整包重抓並自行比對,容易重複推播。';

-- 既有的已完成資料補上時間,取 created_at(見上方說明)
update public.cloth_designs
   set done_at = created_at
 where status = 'done' and done_at is null;

-- App 會以 done_at 排序並帶 since,加索引
create index if not exists cloth_designs_done_at_idx
  on public.cloth_designs (done_at desc)
  where done_at is not null;

-- =============================================================
-- 驗證
-- =============================================================
select
  count(*)                                        as 總數,
  count(*) filter (where status = 'done')         as 已完成,
  count(done_at)                                  as 有完成時間,
  count(*) filter (
    where status = 'done' and done_at is null
  )                                               as 已完成但沒時間_應為零
from public.cloth_designs;
