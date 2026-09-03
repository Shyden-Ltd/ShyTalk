/**
 * Translations for the public homepage (index.html).
 *
 * Loaded BEFORE legal-translations.js + the inline IIFE that wires
 * window.applyLanguage. The chain order on the homepage is:
 *
 *   homepage-translations.js  -> defines window.HOMEPAGE_T global
 *   legal-translations.js     -> footer keys + replaces window.applyLanguage
 *   inline IIFE in index.html -> reads HOMEPAGE_T, wraps applyLanguage
 *                                with chain that calls _prev (legal) at end
 *
 * Keys: tagline, coming_soon, app_store, app_store_title, roadmap_cta,
 * roadmap_label. English defaults live inline in index.html — listed
 * here for the orphan-keys checker to consider them defined.
 *
 * Extracted from inline `var t = {...}` in index.html so the orphan
 * data-i18n keys checker (scripts/check-orphan-i18n-keys.sh) can see
 * the definitions — the checker only scans .js files, never inline
 * <script> blocks.
 */
/* eslint-disable */
var HOMEPAGE_T = {
  en: { tagline: "Voice chat rooms, reimagined.", coming_soon: "Coming Soon", app_store: "App Store (Coming Soon)", app_store_title: "Coming soon to iOS", roadmap_cta: "See What's Coming", roadmap_label: "Explore our public roadmap", roadmap_sparkle: "✨" },
  zh: { tagline: "\u8bed\u97f3\u804a\u5929\u5ba4\uff0c\u91cd\u65b0\u5b9a\u4e49\u3002", coming_soon: "\u5373\u5c06\u63a8\u51fa", app_store: "App Store (\u5373\u5c06\u63a8\u51fa)", app_store_title: "iOS\u7248\u5373\u5c06\u63a8\u51fa", roadmap_cta: "查看即将推出", roadmap_label: "探索我们的公开路线图" },
  th: { tagline: "\u0e2b\u0e49\u0e2d\u0e07\u0e2a\u0e19\u0e17\u0e19\u0e32\u0e40\u0e2a\u0e35\u0e22\u0e07 \u0e2a\u0e23\u0e49\u0e32\u0e07\u0e2a\u0e23\u0e23\u0e04\u0e4c\u0e43\u0e2b\u0e21\u0e48", coming_soon: "\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49", app_store: "App Store (\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49)", app_store_title: "\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49\u0e1a\u0e19 iOS", roadmap_cta: "ดูสิ่งที่กำลังจะมา", roadmap_label: "สำรวจแผนที่สาธารณะของเรา" },
  vi: { tagline: "Ph\u00f2ng tr\u00f2 chuy\u1ec7n tho\u1ea1i, t\u00e1i \u0111\u1ecbnh ngh\u0129a.", coming_soon: "S\u1eafp ra m\u1eaft", app_store: "App Store (S\u1eafp ra m\u1eaft)", app_store_title: "S\u1eafp c\u00f3 tr\u00ean iOS", roadmap_cta: "Xem những gì sắp ra mắt", roadmap_label: "Khám phá lộ trình công khai của chúng tôi" },
  id: { tagline: "Ruang obrolan suara, diciptakan ulang.", coming_soon: "Segera Hadir", app_store: "App Store (Segera Hadir)", app_store_title: "Segera hadir di iOS", roadmap_cta: "Lihat apa yang akan datang", roadmap_label: "Jelajahi peta jalan publik kami" },
};
