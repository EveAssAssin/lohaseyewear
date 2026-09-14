-- =============================================================
-- cloth_designs:2026-09-14 起「取貨門市」必填(資料庫層)
-- -------------------------------------------------------------
-- 2026-09-14 已套用於正式專案 hqdmyxxrskvllkcedybl。
-- 本檔留存的是「為什麼」,不是還沒跑的東西。
--
-- ── 起因 ──
-- 9/6 有一件(會員 28357297「流星」)沒有取貨門市就進了加工後台。
-- 製作端拿到的是一張【做得出來、卻不知道要送去哪裡】的工單,
-- 在待製作裡躺了八天。169 件裡只有這 1 件 —— 不是常態失敗,
-- 是一條偶爾會通的旁路,而那種最容易被留著。
--
-- ── 為什麼要有這一層(cloth 函式的 save 已經擋了) ──
-- 那道守衛【沒有辦法從外部實測】:它要有效的 session token,
-- 而眼鏡布唯一的白名單測試帳號 28095839 已經沒有人登得進去。
-- 與其想辦法驗證守衛有沒有作用,不如讓資料庫保證「失效也進不來」。
--
-- ── 為什麼是 CHECK 而不是 NOT NULL ──
-- 9/6 那一筆(現已退件)還要留著給客人重做時對照,
-- NOT NULL 會讓它變成一筆不合法的資料。
-- 加上日期分界就兩者兼顧:舊的留著,新的擋住。
--
-- ⚠ 全庫只有一條 insert 路徑:cloth 函式的 save(cloth.ts:578)。
--   cloth-admin 是 update、cloth-feed / cloth-wall 是 select ——
--   2026-09-14 逐支確認過,加這條不會誤傷它們。
--   ⚠ 日後若新增第二條 insert 路徑,記得它也要帶 store_erpid。
--
-- ⚠ 副作用:Edge Function 的守衛萬一失效,客人看到的會是
--   「儲存失敗,請再試一次」而不是「請選擇門市」。
--   那是 fail-closed 的方向,而且 Supabase log 會留下
--   `cloth_designs_store_required` 這個名字,一眼看得出原因。
-- =============================================================

alter table public.cloth_designs
  add constraint cloth_designs_store_required
  check (
    store_erpid is not null
    or created_at < '2026-09-14 12:00:00+08'
  );

comment on constraint cloth_designs_store_required on public.cloth_designs is
  '2026-09-14 起取貨門市必填。分界之前的舊資料(1 筆,9/6 那件)刻意放行,'
  '它要留著給客人重做時對照。唯一的 insert 路徑是 cloth 函式的 save。';

-- =============================================================
-- 驗證(2026-09-14 實跑過,兩個方向都測)
-- =============================================================

-- ① 約束在不在、有沒有 validated
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.cloth_designs'::regclass
  and conname  = 'cloth_designs_store_required';

-- ② 現況分佈(當時:有門市 170、分界前無門市 1、分界後無門市 0)
select
  count(*) filter (where store_erpid is not null)                                        as 有門市,
  count(*) filter (where store_erpid is null and created_at <  '2026-09-14 12:00:00+08') as 無門市_分界前,
  count(*) filter (where store_erpid is null and created_at >= '2026-09-14 12:00:00+08') as 無門市_分界後
from public.cloth_designs;

-- ③ 兩個方向各試一次。
--    🚨 兩條路都 raise exception,所以整個 DO 一定回滾、不會留下資料 ——
--       訊息只是用來分辨結果。只測「擋得住」是不夠的:
--       一條「什麼都擋」的約束在那個測法下看起來也會是正常的。
do $$
declare no_store_blocked boolean := false; with_store_ok boolean := false; m1 text; m2 text;
begin
  begin   -- 沒門市 → 應該被擋
    insert into public.cloth_designs (erpid, source, design_name, svg_url, preview_url, placement, store_erpid)
    values ('__constraint_probe__','market','【約束測試】不應存在',
            'https://hqdmyxxrskvllkcedybl.supabase.co/probe.svg',
            'https://hqdmyxxrskvllkcedybl.supabase.co/probe.jpg','{}'::jsonb, null);
  exception
    when check_violation then no_store_blocked := true; m1 := sqlerrm;
    when others          then m1 := sqlstate || ' / ' || sqlerrm;
  end;

  begin   -- 有門市 → 應該寫得進去
    insert into public.cloth_designs (erpid, source, design_name, svg_url, preview_url, placement, store_erpid, store_name, store_city)
    values ('__constraint_probe__','market','【約束測試】不應存在',
            'https://hqdmyxxrskvllkcedybl.supabase.co/probe.svg',
            'https://hqdmyxxrskvllkcedybl.supabase.co/probe.jpg','{}'::jsonb, '120089','林口店','北區');
    with_store_ok := true;
  exception
    when others then m2 := sqlstate || ' / ' || sqlerrm;
  end;

  raise exception '沒門市被擋=% (%) ／ 有門市寫得進=% (%) ── 本交易已全部回滾',
    no_store_blocked, coalesce(m1,'-'), with_store_ok, coalesce(m2,'-');
end $$;
