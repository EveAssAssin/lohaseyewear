/* =============================================================
   客製眼鏡盒:結帳與「待確認」
   -------------------------------------------------------------
   2026-09-29

   流程:
     客人按「前往結帳」→ shop 函式把資料暫存在 design_submissions
                         (與太陽眼鏡同一張表,product = 'case')
     商城通知訂單成立 → shop-webhook 把那一個盒子搬進 cloth_designs,
                         狀態 'hold'(待確認)—— 師傅看不到
     後台人員去商城查訂單:付款了沒、取貨門市、數量
                       → 按「確認,開始製作」→ 狀態 'new',師傅才看得到

   === 為什麼要有 hold 這一關 ===
   商城無法針對單一商品關閉付款方式,而它的通知裡【沒有】付款狀態、
   取貨門市、數量(只有 8 個欄位,2026-09-25 實查)。所以:
     · 客人選取貨付款 → 還沒付錢,不能刻
     · 客人在商城選了跟官網不同的門市 → 會送錯店
     · 客人把數量改成 2 → 付兩個的錢,我們只知道要刻一個
   三件事我方都查不到,只能由人去商城後台看一眼。
   商城之後若在通知裡多帶這幾個欄位,這一關就可以改成自動。

   ⚠ 這支 SQL 要【早於】shop 與 shop-webhook 部署。
     順序反過來的話,shop 寫紀錄時找不到欄位(寫紀錄失敗不影響
     客人,但那一筆的門市就遺失了),shop-webhook 搬資料時會被
     狀態約束擋下而回 500。
   ============================================================= */

/* ---------- design_submissions:眼鏡盒要多記的 ----------
   太陽眼鏡的舊資料這幾欄都是 null,不影響。 */
alter table public.design_submissions
  add column if not exists product      text,
  add column if not exists source       text,
  add column if not exists member_name  text,
  add column if not exists store_erpid  text,
  add column if not exists store_name   text,
  add column if not exists store_city   text;

do $$
begin
  /* 只收 null(太陽眼鏡)或 'case'。
     ⚠ 用約束限制值域,不要只靠程式自律 —— 未來多品項時,
       'Case'、'case '、'眼鏡盒' 三種寫法並存的話,每一份查詢
       都只認得其中一種。 */
  if not exists (select 1 from pg_constraint where conname = 'design_submissions_product_check') then
    alter table public.design_submissions
      add constraint design_submissions_product_check
      check (product is null or product in ('case'));
  end if;

  /* 眼鏡盒一定要有取貨門市 —— 與 cloth_designs_store_required 同一個理由:
     做得出來卻不知道送去哪裡的工單,實務上沒有人會去補。
     (9/6 那件眼鏡布躺了八天。) */
  if not exists (select 1 from pg_constraint where conname = 'design_submissions_case_store') then
    alter table public.design_submissions
      add constraint design_submissions_case_store
      check (product is distinct from 'case' or store_erpid is not null);
  end if;
end $$;

/* ---------- cloth_designs:知道自己來自哪一筆訂單 ---------- */
alter table public.cloth_designs
  add column if not exists submission_id uuid,
  add column if not exists order_no      text;

do $$
begin
  /* 🚨 一筆送單只能變成一個盒子。
     商城的通知會重送(我方回 500 時它會重試),而重送時
     shop-webhook 會再搬一次 —— 沒有這條的話,師傅的清單上
     會出現兩個一模一樣的盒子,兩個都會被刻出來。
     ⚠ 用 unique 約束而不是「部分唯一索引」:PostgREST 的
       on_conflict 不認得部分索引。null 在 unique 裡可以重複,
       所以眼鏡布(沒有 submission_id)不受影響。 */
  if not exists (select 1 from pg_constraint where conname = 'cloth_designs_submission_id_key') then
    alter table public.cloth_designs
      add constraint cloth_designs_submission_id_key unique (submission_id);
  end if;
end $$;

/* 狀態多一個 hold(待確認訂單)。
   ⚠ 先 drop 再 add,中間沒有約束的那一瞬間不影響:
     這兩句在同一個交易裡執行。 */
alter table public.cloth_designs drop constraint if exists cloth_designs_status_check;
alter table public.cloth_designs
  add constraint cloth_designs_status_check
  check (status in ('hold', 'new', 'done', 'rejected', 'archived'));

comment on column public.cloth_designs.submission_id is
  '來自哪一筆送單(design_submissions.id)。眼鏡盒才有;眼鏡布是 null';
comment on column public.cloth_designs.order_no is
  '商城訂單編號。後台確認付款、門市、數量時用它去商城查';

/* ---------- 驗收 ---------- */
select '1 design_submissions 新欄位' as 項目,
       string_agg(column_name, ', ' order by column_name) as 內容
  from information_schema.columns
 where table_schema = 'public' and table_name = 'design_submissions'
   and column_name in ('product','source','member_name','store_erpid','store_name','store_city')
union all
select '2 cloth_designs 新欄位',
       string_agg(column_name, ', ' order by column_name)
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cloth_designs'
   and column_name in ('submission_id','order_no')
union all
select '3 狀態約束', pg_get_constraintdef(oid)
  from pg_constraint where conname = 'cloth_designs_status_check'
union all
select '4 既有資料沒被動到',
       (select count(*) from public.cloth_designs)::text || ' 筆眼鏡布,'
       || (select count(*) from public.design_submissions)::text || ' 筆送單';
