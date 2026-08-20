-- =============================================================
-- gifts:新增 claimed_by_mid,讓未綁定門市的會員也能領禮物
-- -------------------------------------------------------------
-- 2026-08-20。搭配 gift.ts 的同日改動一起上。
--
-- 為什麼需要這一欄:
--   官網註冊的會員沒有 ERP 客編(要到門市才綁定),而收禮人正是
--   最可能還不是會員的一群。在此之前他們連領取都做不到,
--   B 路線「讓未綁定的人也收得到禮物、再把他帶進門市」因此失效。
--
-- 為什麼不是兩欄都填:
--   claimed_by_erpid 與 claimed_by_mid 同時有值的話,這個人日後
--   解除綁定,兩個身分會各自從不同欄位看到同一份禮物。
--   所以是【搬過去並清空】—— 綁定時由 gift.ts 的 backfillMidGifts()
--   把 mid 那筆搬進客編並清空 mid。主後端的 owner_mid 回填同理。
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

alter table public.gifts
  add column if not exists claimed_by_mid text;

comment on column public.gifts.claimed_by_mid is
  '未綁定門市會員領取時的 App 會員編號(mid)。綁定後由 backfillMidGifts 搬到 claimed_by_erpid 並清空。與 claimed_by_erpid 互斥,不可同時有值。';

-- 禮物中心的「我收到的」會以這一欄查詢,加索引。
-- partial index:只有未綁定領取的那一小部分有值,不必為整張表建。
create index if not exists gifts_claimed_by_mid_idx
  on public.gifts (claimed_by_mid)
  where claimed_by_mid is not null;

-- =============================================================
-- 驗證:跑完應該看到新欄位存在、且目前全部為 null
-- =============================================================
select
  count(*)                                          as 禮物總數,
  count(claimed_by_erpid)                           as 已用客編領取,
  count(claimed_by_mid)                             as 已用mid領取,
  count(*) filter (
    where claimed_by_erpid is not null
      and claimed_by_mid is not null
  )                                                 as 兩欄都有值_應為零
from public.gifts;
