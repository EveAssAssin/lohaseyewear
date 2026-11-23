// LOHAS 樂活眼鏡 design tokens v1.0.0(2026-11-23)
// 由 design/build.mjs 從 design/tokens.json 產生,不要手改。說明:https://www.lohasglasses.com/design/
// 用法:tailwind.config.js 裡 presets: [require('./tailwind.preset.js')]
module.exports = {
  theme: {
    extend: {
      "colors": {
        "lohas-brand": "#50422D",
        "lohas-hover": "#765F4A",
        "lohas-light": "#CDBEA2",
        "lohas-bd": "#E8DED1",
        "bg-warm": "#F9F8F6",
        "bg-soft": "#F4F1EC",
        "bg-cream": "#FAF7F2",
        "text-main": "#2F2A24",
        "text-sub": "#6F665D",
        "text-muted": "#9B9186",
        "text-light": "#CDBEA2",
        "text-disabled": "#8A8178",
        "text-on-dark": "#FFFFFF",
        "m-bg": "#E8E5E0",
        "m-text": "#3D3D3D",
        "c-bg": "#EFE9F5",
        "c-text": "#6B5887",
        "c-solid": "#6B5887",
        "c-line": "#D5C7E5",
        "c-line-strong": "#C5B5DC",
        "collab-bg": "#3D2F2C",
        "collab-bg-2": "#2D2520",
        "collab-gold": "#D4B068",
        "ok": "#5F7A5A",
        "ok-bg": "#EEF1EC",
        "warn": "#B58A42",
        "warn-bg": "#F8F1E1",
        "err": "#A85A4A",
        "err-bg": "#F5E8E4",
        "err-line": "#E5C5C5",
        "danger": "#C0392B",
        "danger-bg": "#FDEDEC",
        "favorite": "#C85F5F",
        "notify": "#E5484D",
        "gold": "#9D7E3F",
        "gold-line": "#E8D8A8",
        "gold-star": "#FFD86B"
      },
      "fontFamily": {
        "tc": [
          "\"Noto Sans TC\"",
          "\"PingFang TC\"",
          "\"Microsoft JhengHei\"",
          "sans-serif"
        ]
      },
      "fontSize": {
        "2xs": "12px",
        "xs": "13px",
        "sm": "14px",
        "md": "16px",
        "lg": "18px",
        "xl": "22px",
        "2xl": "28px",
        "3xl": "clamp(30px, 4vw, 44px)"
      },
      "spacing": {
        "1": "4px",
        "2": "8px",
        "3": "12px",
        "4": "16px",
        "5": "24px",
        "6": "32px",
        "7": "48px",
        "8": "64px"
      },
      "borderRadius": {
        "xs": "4px",
        "sm": "8px",
        "md": "14px",
        "lg": "18px",
        "xl": "24px",
        "pill": "999px"
      },
      "boxShadow": {
        "soft": "0 12px 28px rgba(80,66,45,0.05)",
        "card": "0 18px 38px rgba(80,66,45,0.09)",
        "pop": "0 8px 24px rgba(80,66,45,0.16)",
        "modal": "0 24px 80px rgba(80,66,45,0.28)"
      },
      "zIndex": {
        "sticky": "80",
        "dropdown": "200",
        "fab": "9000",
        "header": "9999",
        "modal": "10000",
        "cookie": "10001",
        "toast": "10002",
        "dialog": "100100"
      },
      "screens": {
        "mobile": "480px",
        "tablet": "768px",
        "laptop": "1024px"
      }
    }
  }
};
