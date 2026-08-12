-- =============================================================
-- design_submissions — 客製文創送單紀錄
-- -------------------------------------------------------------
-- 用途
--   客人在 design.html 按下「加入購物車」時,shop Edge Function
--   會在把資料送給商城的同時,在這裡留一筆紀錄。
--
-- 為什麼需要
--   在此之前,送單資料整包交給商城之後我方什麼都不剩:
--     - 門市要查「這個客人要刻什麼、刻在哪」沒有資料來源
--     - 客人問「我上次刻的是哪一張」答不出來
--     - 送單失敗時只能請客人開瀏覽器 console,實務上不可行
--   Storage 裡雖然有合成圖,但檔名只有 {design_id}-{時間戳},
--   沒有會員編號也沒有商品,無法反查。
--
-- 重要:成功與失敗都會寫一筆。失敗的那些才是排查用得上的。
--
-- 貼法:Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- =============================================================

create table if not exists public.design_submissions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- === 誰 ===
  -- 由 shop 函式從 session token 換出來的,不接受前端傳入
  erpid        text not null,

  -- === 買什麼 ===
  nid          integer not null,
  sid          integer,               -- 無規格商品為 null

  -- === 刻什麼 ===
  design_id    text,
  design_name  text,
  engraving_url text,                 -- 雕刻檔 SVG,給師傅進雕刻軟體
  preview_url  text,                  -- 合成圖,給客人看
  guide_url    text,                  -- 加工位置指示圖
  placement    jsonb,                 -- {lens, scale, x, y, basis}

  -- === 票券 ===
  -- 只存 coupon_id。lock_token 是憑證,不落地。
  coupon_id    bigint,

  -- === 商城怎麼回的 ===
  succeeded    boolean not null default false,
  shop_code    text,
  shop_message text,
  cart_url     text
);

comment on table public.design_submissions is
  '客製文創送單紀錄。shop 函式在呼叫商城 cart/push 時寫入,成功與失敗都留。';
comment on column public.design_submissions.erpid is
  '會員編號。來源為 auth-session 驗證後的結果,非前端傳入值。';
comment on column public.design_submissions.coupon_id is
  '票券編號。lock_token 為憑證,刻意不儲存。';

-- 門市查刻圖會用「會員編號 + 最近的在前」查,這是主要存取路徑
create index if not exists design_submissions_erpid_idx
  on public.design_submissions (erpid, created_at desc);

-- 排查時會用「最近失敗的有哪些」
create index if not exists design_submissions_failed_idx
  on public.design_submissions (created_at desc)
  where succeeded = false;

-- =============================================================
-- RLS:全鎖。
-- -------------------------------------------------------------
-- 啟用 RLS 但不建立任何 policy,等於「anon 與 authenticated 都讀不到、
-- 寫不了」,只有 service_role 能存取 —— 那是 Edge Function 用的身分。
--
-- 這裡放的是會員編號與他買了什麼,屬個資,不能讓前端拿 anon key 直接撈。
-- 日後門市查刻圖那頁要讀,也是走 Edge Function,不是開 policy 給前端。
-- =============================================================
alter table public.design_submissions enable row level security;

-- 確認結果:應該看到 rowsecurity = true、policy 數為 0
select
  (select relrowsecurity from pg_class where oid = 'public.design_submissions'::regclass) as rls_啟用,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'design_submissions') as policy_數量;
