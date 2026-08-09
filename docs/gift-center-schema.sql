-- =============================================================
-- LOHAS 禮物中心 — 資料表
-- -------------------------------------------------------------
-- ⚠ 這份檔案是「給人看、給人手動貼」的紀錄,不是自動化腳本。
--   請到 Supabase Dashboard → SQL Editor 貼上執行,
--   不要用 CLI 或程式跑。(見 CLAUDE.md 鐵則 2)
--
-- 專案:hqdmyxxrskvllkcedybl
-- 版本:2026-08-09 v1
--
-- 安全前提
--   gifts 內含收件人姓名/電話/地址與領取碼,
--   任何一筆外洩都等於個資外洩 + 禮物被冒領。
--   因此本表【完全不開放 anon】,前端一律經 Edge Function 存取
--   (作法與 coupon-list / coupon-lock 相同)。
-- =============================================================


-- ---------- 1. 禮物主表 ----------
create table if not exists public.gifts (
  id                uuid primary key default gen_random_uuid(),

  -- 送禮者(下單當下的登入者,由 Edge Function 從 session 取得,絕不信任前端)
  sender_erpid      text        not null,
  sender_name       text,

  -- 禮物內容:刻圖 + 商城商品
  design_id         uuid        references public.engraving_designs(id),
  design_name       text,                    -- 快照,刻圖日後改名不影響歷史禮物
  design_image_url  text,                    -- 快照
  product_nid       integer,                 -- 商城商品 nid
  product_sid       integer,                 -- 商城規格 sid
  product_title     text,                    -- 快照
  product_image     text,                    -- 快照

  message           text,                    -- 祝福語

  -- 收禮人:兩種指定方式
  --   'link'   → 產生 claim_code,送禮者自行把連結傳給對方
  --   'member' → 直接指定會員,禮物會出現在對方的禮物中心
  recipient_mode    text        not null default 'link'
                    check (recipient_mode in ('link','member')),
  recipient_erpid   text,                    -- recipient_mode='member' 時必填
  claim_code        text        unique,      -- recipient_mode='link' 時必填

  -- 狀態機
  --   pending_payment → paid → claimed → shipped
  --                  ↘ cancelled / expired
  status            text        not null default 'pending_payment'
                    check (status in ('pending_payment','paid','claimed','shipped','cancelled','expired')),

  -- 金流(由商城回拋 webhook 寫入,官網不自行填)
  order_trade_no    text,
  paid_at           timestamptz,

  -- 領取
  claimed_at        timestamptz,
  claimed_by_erpid  text,
  recipient_name    text,
  recipient_phone   text,
  recipient_address text,

  -- 出貨(商城回拋)
  shipped_at        timestamptz,

  expires_at        timestamptz,             -- 未領取的失效時間,建議 paid 起算 90 天
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.gifts is
  '禮物中心:A 會員送刻圖+商品給 B。全部經 Edge Function 存取,不開放 anon。';
comment on column public.gifts.claim_code is
  '領取碼,只在 recipient_mode=link 時產生。務必用足夠亂度(建議 22 字元 base62)避免被猜。';
comment on column public.gifts.order_trade_no is
  '商城訂單編號。付款完成的 webhook 進來時才寫入,同時把 status 推到 paid。';


-- ---------- 2. 索引 ----------
-- 領取頁用 claim_code 查(unique 已自帶索引,這裡不重複建)
create index if not exists gifts_sender_idx     on public.gifts (sender_erpid, created_at desc);
create index if not exists gifts_recipient_idx  on public.gifts (recipient_erpid, created_at desc);
create index if not exists gifts_claimed_by_idx on public.gifts (claimed_by_erpid, created_at desc);
create index if not exists gifts_status_idx     on public.gifts (status);
-- 對帳用:商城回拋時以 order_trade_no 反查
create index if not exists gifts_order_idx      on public.gifts (order_trade_no);


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
-- Edge Function 用 service_role key 連線,service_role 會繞過 RLS,不受影響。
alter table public.gifts enable row level security;

-- 保險:即使日後有人誤加 policy,也先明確收回直接授權
revoke all on public.gifts from anon, authenticated;


-- ---------- 5. 狀態流水帳(選用,但強烈建議) ----------
-- 金流相關的狀態變更必須留痕,日後對帳、客訴、退款都靠這張表。
create table if not exists public.gift_events (
  id         bigserial primary key,
  gift_id    uuid not null references public.gifts(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor       text,          -- 'sender' / 'recipient' / 'shop-webhook' / 'admin'
  note        text,
  payload     jsonb,         -- webhook 原始內容,保留供追查
  created_at timestamptz not null default now()
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
