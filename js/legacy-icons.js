/* =========================================================================
   legacy-icons.js
   -------------------------------------------------------------------------
   舊作品來源(icons.json)的比對與即時匯入模組

   用途:
   在 member-portal 的 Auto-Creator 流程中,當 Supabase engraving_designs
   找不到該會員姓名的孤兒作品時,改去查 icons.json。若有比對到作品,
   即時匯入 Supabase 並把該會員升級成 Creator。

   設計原則:
   1. 純前端 fallback、不需 service_role key
   2. icons.json 用 sessionStorage 快取,避免每位會員都 fetch
   3. 匯入時帶 legacy_icons_id 防重複(若該欄位不存在會 fallback)
   4. 失敗不阻斷登入流程,只 console.warn

   提供:
     window.LohasLegacyIcons.findByDesigner(name)
     window.LohasLegacyIcons.importForMember(supabaseClient, member)
   ========================================================================= */

(function (window) {
  'use strict';

  const CONFIG = {
    ICONS_URL: 'data/icons.json',
    SESSION_KEY: 'lohasLegacyIcons',
    SESSION_TTL_MS: 30 * 60 * 1000   // 30 分鐘
  };

  /* ---------------------------------------------------------------------
     讀 icons.json,session 內快取
     --------------------------------------------------------------------- */
  let _memoryCache = null;   // 同一 page load 共用,避免重複 parse

  async function loadIcons() {
    if (_memoryCache) return _memoryCache;

    // 試 sessionStorage
    try {
      const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && cached.ts && (Date.now() - cached.ts) < CONFIG.SESSION_TTL_MS) {
          _memoryCache = cached.data;
          return _memoryCache;
        }
      }
    } catch (e) {
      // session 損壞就忽略,改 fetch
    }

    // fetch 後寫回 cache
    try {
      const res = await fetch(CONFIG.ICONS_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('fetch icons.json failed: ' + res.status);
      const data = await res.json();

      _memoryCache = data;

      try {
        sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
          ts: Date.now(),
          data: data
        }));
      } catch (e) {
        // sessionStorage 滿了或被禁用就略過,不影響功能
      }

      return data;
    } catch (err) {
      console.warn('[legacy-icons] 載入 icons.json 失敗:', err);
      return [];
    }
  }

  /* ---------------------------------------------------------------------
     依設計師姓名找作品(完全相符)
     --------------------------------------------------------------------- */
  async function findByDesigner(designerName) {
    if (!designerName) return [];

    const icons = await loadIcons();
    if (!Array.isArray(icons) || icons.length === 0) return [];

    // 完全字串相符
    return icons.filter(function (item) {
      return item && item.designer === designerName;
    });
  }

  /* ---------------------------------------------------------------------
     把 icons.json 一筆轉成 engraving_designs payload
     --------------------------------------------------------------------- */
  function iconToPayload(icon, member) {
    // timestamp 格式: YYYYMMDDHHMMSS
    let listedAt = null;
    if (icon.timestamp && /^\d{14}$/.test(String(icon.timestamp))) {
      const t = String(icon.timestamp);
      // 轉 ISO 8601
      const iso = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) +
                  'T' + t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14);
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        listedAt = d.toISOString();
      }
    }

    const payload = {
      name:          icon.name || '',
      slogan:        icon.slogan || '',
      category:      icon.category || '',
      keywords:      icon.keywords || '',
      creator_id:    String(member.erpid),
      designer_name: icon.designer || '',
      status:        'approved',    // 舊作品直接視為已上架
      type:          'legacy'
    };

    // 圖檔
    if (icon.image_jpg) payload.image_url = icon.image_jpg;
    if (icon.image_png) payload.image_url_png = icon.image_png;

    // 上架時間(讓統計圖表正確分月)
    if (listedAt) payload.listed_at = listedAt;

    return payload;
  }

  /* ---------------------------------------------------------------------
     檢查 Supabase 內是否已存在這筆 legacy 作品
     用 designer_name + name + type='legacy' 三鍵判定
     --------------------------------------------------------------------- */
  async function existsInDb(sb, icon) {
    try {
      const res = await sb
        .from('engraving_designs')
        .select('id')
        .eq('designer_name', icon.designer || '')
        .eq('name', icon.name || '')
        .eq('type', 'legacy')
        .limit(1);

      if (res.error) {
        console.warn('[legacy-icons] 查重失敗,當作不存在繼續寫入:', res.error);
        return false;
      }
      return !!(res.data && res.data.length > 0);
    } catch (e) {
      console.warn('[legacy-icons] 查重 throw:', e);
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     把該會員姓名底下所有 icons.json 作品匯入 Supabase
     回傳 { imported: n, skipped: m, total: t } 或 null(無作品)
     --------------------------------------------------------------------- */
  async function importForMember(sb, member) {
    if (!sb || !member || !member.name || !member.erpid) return null;

    const icons = await findByDesigner(member.name);
    if (icons.length === 0) return null;

    let imported = 0;
    let skipped = 0;

    for (const icon of icons) {
      // 先查重
      const exists = await existsInDb(sb, icon);
      if (exists) {
        skipped++;
        continue;
      }

      const payload = iconToPayload(icon, member);

      try {
        const insRes = await sb
          .from('engraving_designs')
          .insert(payload)
          .select('id')
          .maybeSingle();

        if (insRes.error) {
          console.warn('[legacy-icons] 寫入失敗 (' + (icon.name || '?') + '):', insRes.error);
          continue;
        }
        imported++;
      } catch (e) {
        console.warn('[legacy-icons] 寫入 throw:', e);
      }
    }

    return {
      imported: imported,
      skipped: skipped,
      total: icons.length
    };
  }

  /* ---------------------------------------------------------------------
     匯出
     --------------------------------------------------------------------- */
  window.LohasLegacyIcons = {
    loadIcons,
    findByDesigner,
    importForMember
  };
})(window);
