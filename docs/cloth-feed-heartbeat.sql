-- =============================================================
-- cloth_feed_heartbeat:記下 cloth-feed 上一次被抓取的時間
-- -------------------------------------------------------------
-- 2026-08-27。用途是【偵測對方的排程有沒有停掉】。
--
-- 為什麼需要:
--   眼鏡布做好之後通知客人那條線,是對方每天 10:30 來抓 cloth-feed。
--   2026-08-27 對方確認那支排程(ClothFeedSync)與其他 28 支
--   都掛在同一個 Jenkins 觸發器上,而那台 Jenkins 是前包商的、
--   不在對方控制之下。
--
--   Jenkins 哪天停掉,29 個排程會【全部安靜地停止、不報錯】——
--   製作端在後台按了「完成」、官網資料也對、App 只是沒有人去抓,
--   三邊各自看都正常,而客人永遠收不到通知。
--
--   所以要偵測的不是「設定對不對」,是「有沒有東西在動」。
--
-- 為什麼只有一列:
--   要回答的問題只有一個 ——「上次被抓是什麼時候」。
--   存成歷史紀錄的話,那張表會無限長大,而且沒有人會去看第二筆。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

create table if not exists public.cloth_feed_heartbeat (
  -- 固定為 1。用 check 把它鎖成單列表,不必靠約定
  id            smallint primary key default 1 check (id = 1),
  last_fetch_at timestamptz not null default now(),
  -- 純粹給人看的:是誰來抓的、抓了什麼
  last_status   text,
  last_count    integer
);

-- 先塞好那一列,函式端就只需要 update,不必處理「不存在」的情況
insert into public.cloth_feed_heartbeat (id, last_fetch_at)
values (1, now())
on conflict (id) do nothing;

/* RLS:全鎖,零政策。
   只有 service_role(Edge Function)寫得進去。
   後台讀取也走 Edge Function,不讓 anon key 直接讀 ——
   雖然這張表沒有個資,但「哪時候被抓過」也不需要公開。 */
alter table public.cloth_feed_heartbeat enable row level security;

comment on table public.cloth_feed_heartbeat is
  'cloth-feed 上次被抓取的時間。用來偵測對方的排程是否停止 —— '
  '那 29 支排程共用同一個 Jenkins 觸發器,這一列實際上是整組的存活探針。';

-- =============================================================
-- 驗證
-- =============================================================
select
  last_fetch_at,
  round(extract(epoch from (now() - last_fetch_at)) / 3600, 1) as 幾小時前,
  last_status,
  last_count
from public.cloth_feed_heartbeat;
