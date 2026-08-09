-- =============================================================
-- LOHAS 禮物中心 — 資料表
-- -------------------------------------------------------------
-- ⚠ 這份檔案是「給人看、給人手動貼」的紀錄,不是自動化腳本。
--   請到 Supabase Dashboard → SQL Editor 貼上執行,
--   不要用 CLI 或程式跑。(見 CLAUDE.md 鐵則 2)
--
-- 專案:hqdmyxxrskvllkcedybl
-- 版本:2026-08-09 v2
--
-- v2 變更(履約方式定案為兩條路之後)
--   · 新增 fulfillment:ship 宅配到府 / store 門市兌換
--   · 【移除所有收件地址欄位】。宅配的地址由送禮者在商城結帳時填,
--     門市兌換根本沒有地址。官網不碰、不存,少一份個資責任。
--   · 新增 coupon_id:門市兌換路徑發券後回填,對應票券系統
--   · 新增商品規格快照 product_spec_title
--   · 狀態機改為分岔式(見下方註解)
--
--   若已建過 v1 的表且尚無正式資料,直接:
--     drop table if exists public.gift_events;
--     drop table if exists public.gifts;
--   再執行本檔。
--
-- 安全前提
--   gifts 含領取碼與收禮人聯絡方式,RLS 全鎖、anon 完全讀不到,
--   前端一律經 Edge Function 存取(作法與 coupon-list / coupon-lock 相同)。
-- =============================================================


-- ---------- 1. 禮物主表 ----------
create table if not exists public.gifts (
  id                uuid primary key default gen_random_uuid(),

  -- 送禮者(由 Edge Function 從 session 取得,絕不信任前端傳入)
  sender_erpid      text        not null,
  sender_name       text,

  -- ===== 禮物內容 =====
  -- 全部存快照:刻圖改名、商品下架、規格調價都不該影響已送出的禮物
  design_id          uuid       references public.engraving_designs(id),
  design_name        text,
  design_image_url   text,

  product_nid        integer,               -- 商城商品 nid
  product_sid        integer,               -- 商城規格 sid
  product_title      text,
  product_spec_title text,                  -- 例:霧黑 / 54mm
  product_image      text,

  -- 刻圖在鏡片上的位置。門市雷刻與商城後台都要看這個。
  -- 由 engrave-preview 產出,單位為「雙眼間距的倍數」,與畫面解析度無關。
  --   { "size":0.38, "dx":-0.24, "dy":-0.08, "lens":"right", "preview_url":"..." }
  engrave_placement  jsonb,

  message            text,                  -- 祝福語

  -- ===== 履約方式 =====
  --   ship  宅配到府 —— 送禮者在商城結帳時填收件地址,官網不經手
  --   store 門市兌換 —— 付款後發一張兌換券到收禮人帳號,到門市核銷
  fulfillment       text        not null default 'store'
                    check (fulfillment in ('ship','store')),

  -- ===== 收禮人 =====
  --   'link'   產生 claim_code,送禮者自行把連結傳給對方
  --   'member' 直接指定。recipient_key 存會員編號或手機,
  --            官網【不對外回報這支號碼是不是會員】,避免變成探測工具;
  --            查不到就退回連結模式,讓送禮者自己傳。
  recipient_mode    text        not null default 'link'
                    check (recipient_mode in ('link','member')),
  recipient_key     text,                   -- 會員編號 或 手機(指定用,非收件用)
  recipient_erpid   text,                   -- 比對成功後回填
  recipient_label   text,                   -- 送禮者填的稱呼,領取頁顯示以防轉傳誤領
  claim_code        text        unique,

  -- ===== 狀態機 =====
  --   pending_payment → paid ─┬─ (ship)  shipped
  --                           └─ (store) claimed → issued → redeemed
  --                    ↘ cancelled / expired
  --
  --   claimed  收禮人已把禮物綁到自己帳號(指定會員時自動,連結模式需本人點領)
  --   issued   門市兌換券已發到收禮人帳號(coupon_id 有值)
  --   shipped  商城已出貨(宅配路徑,由 webhook 推進)
  --   redeemed 門市已核銷
  status            text        not null default 'pending_payment'
                    check (status in ('pending_payment','paid','claimed',
                                      'issued','shipped','redeemed',
                                      'cancelled','expired')),

  -- ===== 金流 / 履約(皆由商城回拋寫入,官網不自行填) =====
  order_trade_no    text,
  paid_at           timestamptz,
  shipped_at        timestamptz,
  coupon_id         bigint,                 -- 門市兌換券編號,對應票券系統
  issued_at         timestamptz,
  redeemed_at       timestamptz,

  claimed_at        timestamptz,
  claimed_by_erpid  text,

  expires_at        timestamptz,            -- 未領取的失效時間,建議 paid 起算 90 天
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.gifts is
  '禮物中心:A 買刻圖+眼鏡送給 B。宅配走商城原有流程,門市兌換發票券。全部經 Edge Function 存取,不開放 anon。';
comment on column public.gifts.claim_code is
  '領取碼,只在 recipient_mode=link 時產生。務必用足夠亂度(22 字元 base62)避免被猜。';
comment on column public.gifts.engrave_placement is
  '刻圖位置參數,門市雷刻依此定位。以雙眼間距為單位,不綁定任何解析度。';
comment on column public.gifts.recipient_key is
  '送禮者填的會員編號或手機。查得到就回填 recipient_erpid,查不到也【不回報】,退回連結模式。';


-- ---------- 2. 索引 ----------
create index if not exists gifts_sender_idx     on public.gifts (sender_erpid, created_at desc);
create index if not exists gifts_recipient_idx  on public.gifts (recipient_erpid, created_at desc);
create index if not exists gifts_claimed_by_idx on public.gifts (claimed_by_erpid, created_at desc);
create index if not exists gifts_status_idx     on public.gifts (status);
create index if not exists gifts_order_idx      on public.gifts (order_trade_no);
-- 收禮人尚未註冊時,禮物先掛在 recipient_key 上,等對方登入再比對
create index if not exists gifts_recipient_key_idx on public.gifts (recipient_key)
  where recipient_erpid is null;


-- ---------- 3. updated_at 自動更新 ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists gifts_touch on public.gifts;
create trigger gifts_touch
  before update on public.gifts
  for each row execute function public.touch_updated_at();


-- ---------- 4. RLS:全鎖 ----------
-- 開啟 RLS 但【不建立任何 policy】= anon 與 authenticated 都讀不到、寫不了。
-- Edge Function 用 service_role 連線,service_role 繞過 RLS,不受影響。
alter table public.gifts enable row level security;
revoke all on public.gifts from anon, authenticated;


-- ---------- 5. 狀態流水帳 ----------
-- 金流相關的狀態變更必須留痕,日後對帳、客訴、退款都靠這張表。
create table if not exists public.gift_events (
  id          bigserial primary key,
  gift_id     uuid not null references public.gifts(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor       text,          -- 'sender' / 'recipient' / 'shop-webhook' / 'admin'
  note        text,
  payload     jsonb,         -- webhook 原始內容,保留供追查
  created_at  timestamptz not null default now()
);

create index if not exists gift_events_gift_idx on public.gift_events (gift_id, created_at);

alter table public.gift_events enable row level security;
revoke all on public.gift_events from anon, authenticated;


-- =============================================================
-- 執行後檢查
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename in ('gifts','gift_events');
--   → rowsecurity 兩筆都要是 true
--
--   select count(*) from pg_policies
--   where schemaname='public' and tablename in ('gifts','gift_events');
--   → 要是 0(沒有任何 policy = 全鎖)
-- =============================================================
