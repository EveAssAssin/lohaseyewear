/* =============================================================
   客製眼鏡布:分享牆隱藏 + 同意他人使用
   -------------------------------------------------------------
   2026-09-14

   wall_hidden
     後台把某一件從分享牆上拿掉。
     ⚠ 這與 status 是【兩件事】:
       status='done' 決定「做好了沒」—— 沒做好本來就不會出現在牆上
       wall_hidden   決定「做好了,但我方不想展示」
     混在一起用 status 處理的話,會把「不想展示」變成「退回未完成」,
     製作端的清單就會多出一件已經做完的東西。

   allow_reuse
     客人是否同意別人使用他的圖案。預設同意,客人可以取消。
     ⚠ 目前【沒有任何功能會讀它】—— 這一版只是把答案記下來。
       之後真的要開放重用時,那個功能才去讀這一欄。
       先記錄的理由:同意必須是當下問的,事後補問拿不到已經送出的那些。

   ⚠ cloth_designs 是 RLS 全鎖、零政策的表(裡面有客編、姓名、門市)。
     這兩個欄位不改變那件事 —— 讀寫一律走 Edge Function。
   ============================================================= */

alter table public.cloth_designs
  add column if not exists wall_hidden boolean not null default false,
  add column if not exists allow_reuse boolean not null default true;

/* 既有資料:一律維持現況 —— 沒有人被隱藏,而且都當作同意。
   ⚠ 舊資料的 allow_reuse 是【推定】不是【同意】:那些客人送出時
     根本沒有被問過這個問題。所以真的要開放重用時,舊資料要另外
     處理,不能直接拿這一欄當依據。上面的預設值只是讓欄位有值。 */

comment on column public.cloth_designs.wall_hidden is
  '後台把這件從分享牆隱藏(與 status 無關;status 管的是有沒有做完)';
comment on column public.cloth_designs.allow_reuse is
  '客人是否同意他人使用此圖案。2026-09-14 之前的資料是預設值,不是本人的回答';

select
  (select count(*) from public.cloth_designs)                          as 總筆數,
  (select count(*) from public.cloth_designs where wall_hidden)        as 已隱藏,
  (select count(*) from public.cloth_designs where allow_reuse)        as 同意他人使用,
  (select count(*) from public.cloth_designs where status = 'done')    as 已完成;
