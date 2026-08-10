-- =============================================================
-- LINE 工作日誌 — 資料表
-- -------------------------------------------------------------
-- ⚠ 請到 Supabase Dashboard → SQL Editor 貼上執行。(CLAUDE.md 鐵則 2)
--
-- 專案:hqdmyxxrskvllkcedybl
-- 版本:2026-08-10 v1
--
-- 用途:LINE 官方帳號「樂活工作日誌」收到的群組訊息與轉傳訊息,
--       每週彙整成工作週報。
--
-- ⚠ 這張表存的是【同事的對話內容】,屬於個人資料。
--   · RLS 全鎖,只有 Edge Function 的 service_role 進得去
--   · 週報產出後請刪除原始訊息(檔尾有清理語法)
--   · 不要把這張表接到任何前端頁面
-- =============================================================


-- ---------- 1. 訊息 ----------
create table if not exists public.line_messages (
  id           bigserial primary key,

  -- 來源:group 群組 / room 多人聊天 / user 一對一(你自己轉傳給 bot 的)
  source_type  text not null,
  source_id    text not null,
  source_label text,                    -- 群組看不到名稱,由你在 line_sources 標註

  sender_id    text,                    -- LINE userId
  sender_name  text,                    -- 取自 LINE profile API

  message_type text not null,           -- text / sticker / image / file ...
  text         text,                    -- 只有 text 型別有內容

  sent_at      timestamptz not null,    -- LINE 事件時間(不是寫入時間)
  created_at   timestamptz not null default now()
);

comment on table public.line_messages is
  'LINE 工作日誌原始訊息。含他人個資,週報產出後應清除。RLS 全鎖。';

create index if not exists line_messages_sent_idx on public.line_messages (sent_at desc);
create index if not exists line_messages_src_idx  on public.line_messages (source_id, sent_at desc);


-- ---------- 2. 來源標註 ----------
-- LINE 的 webhook【不會給群組名稱】,只給一串 groupId。
-- 這張表讓你把 id 對應成看得懂的名字,週報才知道「這段是哪個群講的」。
create table if not exists public.line_sources (
  source_id   text primary key,
  label       text,                     -- 例:企劃部工作群
  enabled     boolean not null default true,   -- 設 false 就不再記錄
  first_seen  timestamptz not null default now()
);

comment on table public.line_sources is
  '群組/聊天室對照表。bot 第一次收到訊息時自動建立,再由你補上 label。';


-- ---------- 3. 成員名稱快取 ----------
-- 每則訊息都去打一次 LINE profile API 太浪費,查過就記起來。
create table if not exists public.line_members (
  user_id      text primary key,
  display_name text,
  updated_at   timestamptz not null default now()
);


-- ---------- 4. RLS:全鎖 ----------
alter table public.line_messages enable row level security;
alter table public.line_sources  enable row level security;
alter table public.line_members  enable row level security;

revoke all on public.line_messages from anon, authenticated;
revoke all on public.line_sources  from anon, authenticated;
revoke all on public.line_members  from anon, authenticated;


-- =============================================================
-- 常用語法
--
-- 【找出群組 ID】把 bot 拉進群、隨便發一則訊息後執行:
--   select source_id, source_type, count(*), max(sent_at)
--   from public.line_messages group by 1,2 order by 4 desc;
--
-- 【標註群組名稱】
--   update public.line_sources set label='企劃部工作群'
--   where source_id='Cxxxxxxxx';
--
-- 【停止記錄某個來源】
--   update public.line_sources set enabled=false where source_id='Cxxxxxxxx';
--
-- 【取出本週內容(產週報用)】
--   select coalesce(s.label, m.source_id) as 來源,
--          to_char(m.sent_at at time zone 'Asia/Taipei','MM/DD HH24:MI') as 時間,
--          m.sender_name as 發話者, m.text as 內容
--   from public.line_messages m
--   left join public.line_sources s on s.source_id = m.source_id
--   where m.sent_at >= now() - interval '7 days' and m.message_type = 'text'
--   order by m.source_id, m.sent_at;
--
-- 【週報產完後清除原始訊息】—— 個資不要留著養
--   delete from public.line_messages where sent_at < now() - interval '14 days';
-- =============================================================
