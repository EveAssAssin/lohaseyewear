-- =============================================================
-- shop-webhook 需要的兩項結構調整
-- -------------------------------------------------------------
-- 一、design_submissions 補 order_no
--     商城在付款完成後回拋訂單編號,我方才能把「送出的設計」對應到
--     「成立的訂單」。這是門市查刻圖那一頁的必要條件 ——
--     沒有它,我方只知道客人送出過什麼,不知道哪一筆真的成交。
--
-- 二、webhook_events 冪等表
--     商城的重試策略是「失敗後退避重試,最多 24 小時」,
--     同一個事件會被送很多次。以 event_id 當主鍵,
--     插入衝突就代表處理過了,直接回 200 不重複執行。
--
-- 貼法:Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- =============================================================

-- ---------- 一、design_submissions.order_no ----------

alter table public.design_submissions
  add column if not exists order_no text;

comment on column public.design_submissions.order_no is
  '商城訂單編號。由 shop-webhook 於付款完成事件回填,cart/push 當下拿不到 —— 那時訂單還不存在。';

-- 門市查刻圖會用訂單編號反查,也用來判斷哪些送出的設計尚未成交
create index if not exists design_submissions_order_no_idx
  on public.design_submissions (order_no)
  where order_no is not null;


-- ---------- 二、webhook_events 冪等表 ----------

create table if not exists public.webhook_events (
  -- 商城提供的事件識別碼。設為主鍵,重複送就會插入失敗,
  -- 那正是我方判斷「這個事件處理過了」的依據。
  event_id    text primary key,

  event       text not null,
  received_at timestamptz not null default now(),

  -- 原始內容全留。事件對不上資料時(例如查無該筆禮物)我方會回 200
  -- 避免對方無謂重試 24 小時,但東西留在這裡可以事後補處理。
  payload     jsonb,

  -- 處理結果。ok / skipped / mismatch,查問題時比看 log 快
  result      text,
  note        text
);

comment on table public.webhook_events is
  '商城 webhook 的冪等紀錄。event_id 為主鍵,重複事件插入衝突即視為已處理。';

create index if not exists webhook_events_received_idx
  on public.webhook_events (received_at desc);

-- 對不上的事件要能一眼撈出來
create index if not exists webhook_events_mismatch_idx
  on public.webhook_events (received_at desc)
  where result <> 'ok';

-- RLS 全鎖:只有 Edge Function 的 service_role 進得到。
-- 這張表裡有訂單編號與會員編號,不能讓前端拿 anon key 撈。
alter table public.webhook_events enable row level security;


-- ---------- 確認 ----------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'design_submissions'
       and column_name = 'order_no')                                as order_no欄位,
  (select relrowsecurity from pg_class
     where oid = 'public.webhook_events'::regclass)                 as webhook表已鎖,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'webhook_events')  as policy數量;
