/* =============================================================
   cloth_designs 多一個品項:客製眼鏡盒
   -------------------------------------------------------------
   2026-09-20

   決定:眼鏡盒與眼鏡布【共用同一張表、同一個加工中心】,
   用 product 欄位區分。理由是製作端要做的事幾乎一樣
   (拿線稿 → 轉 DXF → 雷刻 → 完成 → 送門市),而另開一張表
   等於把加工中心、退件、APP 抓取、儀表板全部複製一份,
   之後每改一次都要記得改兩邊 —— 那種「記得」從來沒有成功過。

   === 🚨 這支 SQL 本身是安全的,危險的是【它之後那幾步】 ===
   欄位有預設值 'cloth',所以:
     · 既有的 172 筆全部變成 cloth(它們本來就是)
     · cloth 函式沒有送 product,新存的眼鏡布也是 cloth
     · 現有程式完全不讀這一欄,跑起來沒有任何差別

   但是【在第一筆 case 出現之前】,下面這兩支一定要先補上
   product = 'cloth' 的條件,否則眼鏡盒會混進去:

     cloth-feed   APP 的「我的眼鏡布」會多出幾個盒子
     cloth-wall   眼鏡布分享牆會出現盒子

   兩者都不會報錯,要等客人來問才會發現。
   ============================================================= */

alter table public.cloth_designs
  add column if not exists product text not null default 'cloth';

/* ⚠ 用 CHECK 限制值域,不要只靠程式自律。
   這張表【有外部寫入方】(門市那條路不在我方 repo 裡),
   而且未來還會多品項 —— 沒有約束的話,某一天會出現
   'Case'、'case '、'眼鏡盒' 三種寫法同時存在,
   而每一份查詢都只認得其中一種。 */
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cloth_designs_product_check'
  ) then
    alter table public.cloth_designs
      add constraint cloth_designs_product_check
      check (product in ('cloth', 'case'));
  end if;
end $$;

/* 加工中心與 APP 幾乎每一次查詢都會帶 product + status,
   兩欄一起建索引。171 筆時當然看不出差別,
   但這張表只會愈來愈大,而補索引通常是在慢了以後才想到。 */
create index if not exists cloth_designs_product_status_idx
  on public.cloth_designs (product, status, created_at desc);

comment on column public.cloth_designs.product is
  '品項:cloth 客製眼鏡布(生日禮,免費) / case 客製眼鏡盒(付費,走商城金流)。2026-09-20 新增,既有資料一律為 cloth';

/* ---------- 驗收 ---------- */
select
  product,
  status,
  count(*) as 筆數,
  max(created_at) as 最新一筆
from public.cloth_designs
group by product, status
order by product, status;
