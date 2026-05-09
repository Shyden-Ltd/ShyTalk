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
  es: { tagline: "Salas de chat de voz, reinventadas.", coming_soon: "Pr\u00f3ximamente", app_store: "App Store (Pr\u00f3ximamente)", app_store_title: "Pr\u00f3ximamente en iOS", roadmap_cta: "Ver lo que viene", roadmap_label: "Explora nuestra hoja de ruta" },
  fr: { tagline: "Salons vocaux, r\u00e9invent\u00e9s.", coming_soon: "Bient\u00f4t disponible", app_store: "App Store (Bient\u00f4t)", app_store_title: "Bient\u00f4t sur iOS", roadmap_cta: "Voir ce qui arrive", roadmap_label: "Explorez notre feuille de route" },
  de: { tagline: "Sprachchatr\u00e4ume, neu gedacht.", coming_soon: "Demnächst", app_store: "App Store (Demnächst)", app_store_title: "Bald für iOS", roadmap_cta: "Entdecke was kommt", roadmap_label: "Unsere \u00f6ffentliche Roadmap" },
  pt: { tagline: "Salas de bate-papo por voz, reinventadas.", coming_soon: "Em breve", app_store: "App Store (Em breve)", app_store_title: "Em breve no iOS", roadmap_cta: "Veja o que vem por aí", roadmap_label: "Explore nosso roteiro público" },
  it: { tagline: "Chat vocali, reinventate.", coming_soon: "In arrivo", app_store: "App Store (In arrivo)", app_store_title: "Presto su iOS", roadmap_cta: "Scopri cosa sta arrivando", roadmap_label: "Esplora la nostra roadmap pubblica" },
  ja: { tagline: "\u30dc\u30a4\u30b9\u30c1\u30e3\u30c3\u30c8\u30eb\u30fc\u30e0\u3001\u65b0\u3057\u3044\u5f62\u3067\u3002", coming_soon: "\u8fd1\u65e5\u516c\u958b", app_store: "App Store (\u8fd1\u65e5\u516c\u958b)", app_store_title: "iOS\u7248\u8fd1\u65e5\u516c\u958b", roadmap_cta: "今後の予定を見る", roadmap_label: "公開ロードマップを見る" },
  ko: { tagline: "\uc74c\uc131 \ucc44\ud305\ubc29, \uc0c8\ub86d\uac8c.", coming_soon: "\ucd9c\uc2dc \uc608\uc815", app_store: "App Store (\ucd9c\uc2dc \uc608\uc815)", app_store_title: "iOS \ucd9c\uc2dc \uc608\uc815", roadmap_cta: "출시 예정 보기", roadmap_label: "공개 로드맵 살펴보기" },
  zh: { tagline: "\u8bed\u97f3\u804a\u5929\u5ba4\uff0c\u91cd\u65b0\u5b9a\u4e49\u3002", coming_soon: "\u5373\u5c06\u63a8\u51fa", app_store: "App Store (\u5373\u5c06\u63a8\u51fa)", app_store_title: "iOS\u7248\u5373\u5c06\u63a8\u51fa", roadmap_cta: "查看即将推出", roadmap_label: "探索我们的公开路线图" },
  ar: { tagline: "\u063a\u0631\u0641 \u0627\u0644\u062f\u0631\u062f\u0634\u0629 \u0627\u0644\u0635\u0648\u062a\u064a\u0629\u060c \u0628\u0634\u0643\u0644 \u062c\u062f\u064a\u062f.", coming_soon: "\u0642\u0631\u064a\u0628\u064b\u0627", app_store: "App Store (\u0642\u0631\u064a\u0628\u064b\u0627)", app_store_title: "\u0642\u0631\u064a\u0628\u064b\u0627 \u0639\u0644\u0649 iOS", roadmap_cta: "شاهد ما هو قادم", roadmap_label: "استكشف خارطة طريقنا العامة" },
  hi: { tagline: "\u0935\u0949\u0907\u0938 \u091a\u0948\u091f \u0930\u0942\u092e, \u0928\u090f \u0905\u0902\u0926\u093e\u091c\u093c \u092e\u0947\u0902\u0964", coming_soon: "\u091c\u0932\u094d\u0926 \u0906 \u0930\u0939\u093e \u0939\u0948", app_store: "App Store (\u091c\u0932\u094d\u0926 \u0906 \u0930\u0939\u093e \u0939\u0948)", app_store_title: "iOS \u092a\u0930 \u091c\u0932\u094d\u0926 \u0906 \u0930\u0939\u093e \u0939\u0948", roadmap_cta: "देखें क्या आ रहा है", roadmap_label: "हमारा सार्वजनिक रोडमैप एक्सप्लोर करें" },
  tr: { tagline: "Sesli sohbet odalar\u0131, yeniden tasarland\u0131.", coming_soon: "Yak\u0131nda", app_store: "App Store (Yak\u0131nda)", app_store_title: "Yak\u0131nda iOS'ta", roadmap_cta: "Yakında gelecekleri görün", roadmap_label: "Genel yol haritamızı keşfedin" },
  ru: { tagline: "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u044b\u0435 \u0447\u0430\u0442-\u043a\u043e\u043c\u043d\u0430\u0442\u044b, \u043f\u043e-\u043d\u043e\u0432\u043e\u043c\u0443.", coming_soon: "\u0421\u043a\u043e\u0440\u043e", app_store: "App Store (\u0421\u043a\u043e\u0440\u043e)", app_store_title: "\u0421\u043a\u043e\u0440\u043e \u043d\u0430 iOS", roadmap_cta: "Что скоро появится", roadmap_label: "Изучите нашу публичную дорожную карту" },
  uk: { tagline: "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u0456 \u0447\u0430\u0442-\u043a\u0456\u043c\u043d\u0430\u0442\u0438, \u043f\u043e-\u043d\u043e\u0432\u043e\u043c\u0443.", coming_soon: "\u041d\u0435\u0437\u0430\u0431\u0430\u0440\u043e\u043c", app_store: "App Store (\u041d\u0435\u0437\u0430\u0431\u0430\u0440\u043e\u043c)", app_store_title: "\u041d\u0435\u0437\u0430\u0431\u0430\u0440\u043e\u043c \u043d\u0430 iOS", roadmap_cta: "Що скоро з'явиться", roadmap_label: "Перегляньте нашу публічну дорожню карту" },
  th: { tagline: "\u0e2b\u0e49\u0e2d\u0e07\u0e2a\u0e19\u0e17\u0e19\u0e32\u0e40\u0e2a\u0e35\u0e22\u0e07 \u0e2a\u0e23\u0e49\u0e32\u0e07\u0e2a\u0e23\u0e23\u0e04\u0e4c\u0e43\u0e2b\u0e21\u0e48", coming_soon: "\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49", app_store: "App Store (\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49)", app_store_title: "\u0e40\u0e23\u0e47\u0e27\u0e46 \u0e19\u0e35\u0e49\u0e1a\u0e19 iOS", roadmap_cta: "ดูสิ่งที่กำลังจะมา", roadmap_label: "สำรวจแผนที่สาธารณะของเรา" },
  vi: { tagline: "Ph\u00f2ng tr\u00f2 chuy\u1ec7n tho\u1ea1i, t\u00e1i \u0111\u1ecbnh ngh\u0129a.", coming_soon: "S\u1eafp ra m\u1eaft", app_store: "App Store (S\u1eafp ra m\u1eaft)", app_store_title: "S\u1eafp c\u00f3 tr\u00ean iOS", roadmap_cta: "Xem những gì sắp ra mắt", roadmap_label: "Khám phá lộ trình công khai của chúng tôi" },
  id: { tagline: "Ruang obrolan suara, diciptakan ulang.", coming_soon: "Segera Hadir", app_store: "App Store (Segera Hadir)", app_store_title: "Segera hadir di iOS", roadmap_cta: "Lihat apa yang akan datang", roadmap_label: "Jelajahi peta jalan publik kami" },
  pl: { tagline: "Pokoje czat\u00f3w g\u0142osowych, na nowo.", coming_soon: "Wkr\u00f3tce", app_store: "App Store (Wkr\u00f3tce)", app_store_title: "Wkr\u00f3tce na iOS", roadmap_cta: "Zobacz, co nadchodzi", roadmap_label: "Zobacz naszą publiczną mapę drogową" },
  nl: { tagline: "Spraakchatrooms, opnieuw uitgevonden.", coming_soon: "Binnenkort", app_store: "App Store (Binnenkort)", app_store_title: "Binnenkort op iOS", roadmap_cta: "Bekijk wat eraan komt", roadmap_label: "Verken onze openbare roadmap" },
  sv: { tagline: "R\u00f6stchattrum, nyt\u00e4nkt.", coming_soon: "Kommer snart", app_store: "App Store (Kommer snart)", app_store_title: "Kommer snart till iOS", roadmap_cta: "Se vad som är på gång", roadmap_label: "Utforska vår offentliga färdplan" },
  km: { tagline: "បន្ទប់ជជែកសំឡេង បានរចនាឡើងវិញ។", coming_soon: "មកដល់ឆាប់ៗ", app_store: "App Store (មកដល់ឆាប់ៗ)", app_store_title: "មកដល់ឆាប់ៗនៅលើ iOS", roadmap_cta: "មើលអ្វីដែលនឹងមកដល់", roadmap_label: "ស្វែងយល់ផែនទីបង្ហាញផ្លូវសាធារណៈរបស់យើង" },
};
