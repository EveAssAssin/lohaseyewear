// LOHAS 樂活眼鏡 design tokens v1.1.0(2026-11-24)
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
        "bg-white": "#FFFFFF",
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
        "ok-strong": "#495E45",
        "warn": "#B58A42",
        "warn-bg": "#F8F1E1",
        "warn-strong": "#785C2B",
        "err": "#A85A4A",
        "err-bg": "#F5E8E4",
        "err-strong": "#794035",
        "err-line": "#E5C5C5",
        "danger": "#C0392B",
        "danger-bg": "#FDEDEC",
        "danger-strong": "#8D2B20",
        "info": "#4D6B89",
        "info-bg": "#EBF0F4",
        "info-strong": "#3B5268",
        "favorite": "#C85F5F",
        "notify": "#E5484D",
        "gold": "#9D7E3F",
        "gold-line": "#E8D8A8",
        "gold-star": "#FFD86B",
        "ai": "#794E97",
        "ai-bg": "#F3EEF7",
        "ai-strong": "#5B3B72"
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
        "lohas-2xs": "12px",
        "lohas-xs": "13px",
        "lohas-sm": "14px",
        "lohas-15": "15px",
        "lohas-md": "16px",
        "lohas-lg": "18px",
        "lohas-20": "20px",
        "lohas-xl": "22px",
        "lohas-2xl": "28px",
        "lohas-3xl": "clamp(30px, 4vw, 44px)"
      },
      "spacing": {
        "lohas-1": "4px",
        "lohas-2": "8px",
        "lohas-3": "12px",
        "lohas-4": "16px",
        "lohas-5": "24px",
        "lohas-6": "32px",
        "lohas-7": "48px",
        "lohas-8": "64px"
      },
      "borderRadius": {
        "lohas-xs": "4px",
        "lohas-6": "6px",
        "lohas-sm": "8px",
        "lohas-10": "10px",
        "lohas-12": "12px",
        "lohas-md": "14px",
        "lohas-lg": "18px",
        "lohas-xl": "24px",
        "lohas-pill": "999px"
      },
      "boxShadow": {
        "lohas-soft": "0 12px 28px rgba(80,66,45,0.05)",
        "lohas-card": "0 18px 38px rgba(80,66,45,0.09)",
        "lohas-pop": "0 8px 24px rgba(80,66,45,0.16)",
        "lohas-modal": "0 24px 80px rgba(80,66,45,0.28)"
      },
      "zIndex": {
        "lohas-sticky": "80",
        "lohas-dropdown": "200",
        "lohas-fab": "9000",
        "lohas-header": "9999",
        "lohas-modal": "10000",
        "lohas-cookie": "10001",
        "lohas-toast": "10002",
        "lohas-dialog": "100100"
      },
      "screens": {
        "mobile": "480px",
        "tablet": "768px",
        "laptop": "1024px"
      }
    }
  }
};
