-- =============================================================
-- gifts 補上合成圖與加工位置圖
-- -------------------------------------------------------------
-- 為什麼
--   禮物領取頁原本用的是【原始商品照】—— 收禮人看到一副乾淨的眼鏡,
--   加一行字說刻圖叫「貓」。而客製化的賣點正是「刻上去的樣子」。
--
--   我方在 cart/push 那條路早就會產合成圖(design.js 的 buildImages),
--   只是送禮這條路沒接上。這兩個欄位就是把它接起來。
--
-- guide_url 一併加的理由
--   buildImages() 本來就同時產出兩張,存一張跟存兩張成本相同。
--   而門市兌換時加工人員需要位置指示圖 —— 等商城的 gift 區塊接上時
--   才回頭補,就得為舊資料重新產圖。現在存下來比較省事。
--
-- 貼法:Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- =============================================================

alter table public.gifts
  add column if not exists preview_url text,
  add column if not exists guide_url   text;

comment on column public.gifts.preview_url is
  '合成圖(商品照 + 刻圖)。領取頁與禮物中心的主視覺,讓收禮人看得到成品長相。';
comment on column public.gifts.guide_url is
  '加工位置指示圖。門市兌換時供雕刻人員參考,收禮人端不顯示。';


-- ---------- 確認 ----------
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'gifts'
  and column_name in ('preview_url', 'guide_url')
order by column_name;
