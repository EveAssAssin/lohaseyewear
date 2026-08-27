-- =============================================================
-- gifts.recipient_mid:讓【還不是會員的人】也能被指定為收禮人
-- -------------------------------------------------------------
-- 2026-08-27。
--
-- 要做到的效果:
--   送禮人填對方的手機 → 對方拿那支手機到官網註冊、登入
--   → 這份禮物自動出現在他的會員中心。全程不需要門市客編。
--
-- 為什麼原本做不到:
--   比對成功後只有一個欄位可以寫 —— recipient_erpid。
--   而官網註冊的會員【沒有客編】,只有 mid,於是無處可寫,
--   比對那段程式也就整段被 `if (erpid)` 擋在門外。
--
--   結果是:最可能還不是會員的那一群(收禮人),
--   正好是這個功能唯一照顧不到的人。
--
-- 兩欄不同時寫:
--   有客編寫 recipient_erpid,沒有寫 recipient_mid。
--   同時有值的話,這個人日後解除綁定,兩個身分會各自
--   從不同欄位都看得到同一份禮物。
--   (claimed_by_erpid / claimed_by_mid 早先也是這個取捨)
--
-- 執行:Supabase Dashboard → SQL Editor → 貼上 → Run
--       (不是瀏覽器 Console)
-- =============================================================

alter table public.gifts
  add column if not exists recipient_mid text;

comment on column public.gifts.recipient_mid is
  '尚未綁定門市的收禮人。比對手機成功、但對方沒有客編時寫這裡;'
  '他日後到門市綁定時由 backfillMidGifts() 搬成 recipient_erpid 並清空。';

-- 列「我收到的禮物」時會用到
create index if not exists gifts_recipient_mid_idx
  on public.gifts (recipient_mid, created_at desc)
  where recipient_mid is not null;

/* ⚠ 待比對索引的條件要一起改。
   -------------------------------------------------------------
   原本是 `where recipient_erpid is null` —— 那是「還沒對上的」。
   但現在對上的人可能寫在 recipient_mid,那種列的 recipient_erpid
   仍然是 null,會【繼續留在待比對集合裡】,每次有人登入都被掃一次,
   而且會被重複比對到。

   索引改不了條件,只能重建。這張表很小,重建是瞬間的事。 */
drop index if exists gifts_recipient_key_idx;
create index if not exists gifts_recipient_key_idx
  on public.gifts (recipient_key)
  where recipient_erpid is null and recipient_mid is null;

-- =============================================================
-- 驗證
-- =============================================================
select
  column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'gifts'
  and column_name in ('recipient_key', 'recipient_erpid', 'recipient_mid')
order by column_name;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'gifts'
  and indexname in ('gifts_recipient_key_idx', 'gifts_recipient_mid_idx');
