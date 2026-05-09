/**
 * ShyTalk Roadmap App
 *
 * Fetches roadmap-data.json and renders:
 * - SVG donut chart with completion stats
 * - Per-phase collapsible cards with progress bars
 * - Feature lists with status icons and bell (notify) buttons
 * - Sticky nav active state on scroll
 * - Deep linking (#roadmap, #suggestions, #suggestion-{id})
 *
 * Vanilla JS, no frameworks. Works without suggestions board JS (graceful degradation).
 */
(function () {
  "use strict";

  // ── State ──
  var roadmapData = null;
  var currentLang = "en";

  // ── i18n labels (minimal set used by this script) ──
  var LABELS = {
    en: {
      inProgress: "In Progress",
      comingSoon: "Coming Soon",
      planned: "Planned",
      complete: "Complete",
      done: "Done",
      inProg: "In Progress",
      plan: "Planned",
      lastUpdated: "Last updated",
      loadFail: "Could not load the roadmap.",
      tryAgain: "Try again",
      notifyPrompt: "Sign in to the app to get notified about this feature.",
      disclaimer: "Features and priorities may change as development progresses and user feedback is received.",
      copyright: "© Shyden Ltd",
    },
    ar: {
      inProgress:
        "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630",
      comingSoon: "\u0642\u0631\u064A\u0628\u064B\u0627",
      planned: "\u0645\u062E\u0637\u0637",
      complete: "مكتمل",
      done: "\u0645\u0643\u062A\u0645\u0644",
      inProg: "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630",
      plan: "\u0645\u062E\u0637\u0637",
      lastUpdated: "\u0622\u062E\u0631 \u062A\u062D\u062F\u064A\u062B",
      loadFail:
        "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062E\u0627\u0631\u0637\u0629.",
      tryAgain:
        "\u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649",
      notifyPrompt:
        "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u064A\u0635\u0644\u0643 \u0625\u0634\u0639\u0627\u0631.",
    },
    de: {
      inProgress: "In Arbeit",
      comingSoon: "Kommt bald",
      planned: "Geplant",
      complete: "Abgeschlossen",
      done: "Fertig",
      inProg: "In Arbeit",
      plan: "Geplant",
      lastUpdated: "Zuletzt aktualisiert",
      loadFail: "Roadmap konnte nicht geladen werden.",
      tryAgain: "Erneut versuchen",
      notifyPrompt: "Melde dich in der App an, um benachrichtigt zu werden.",
    },
    es: {
      inProgress: "En progreso",
      comingSoon: "Pr\u00F3ximamente",
      planned: "Planificado",
      complete: "Completado",
      done: "Hecho",
      inProg: "En progreso",
      plan: "Planificado",
      lastUpdated: "\u00DAltima actualizaci\u00F3n",
      loadFail: "No se pudo cargar la hoja de ruta.",
      tryAgain: "Intentar de nuevo",
      notifyPrompt: "Inicia sesi\u00F3n en la app para recibir notificaciones.",
    },
    fr: {
      inProgress: "En cours",
      comingSoon: "Bient\u00F4t",
      planned: "Planifi\u00E9",
      complete: "Terminé",
      done: "Fait",
      inProg: "En cours",
      plan: "Planifi\u00E9",
      lastUpdated: "Derni\u00E8re mise \u00E0 jour",
      loadFail: "Impossible de charger la feuille de route.",
      tryAgain: "R\u00E9essayer",
      notifyPrompt:
        "Connectez-vous \u00E0 l\u2019appli pour \u00EAtre notifi\u00E9.",
    },
    hi: {
      inProgress: "\u091C\u093E\u0930\u0940 \u0939\u0948",
      comingSoon:
        "\u091C\u0932\u094D\u0926 \u0906 \u0930\u0939\u093E \u0939\u0948",
      planned: "\u092F\u094B\u091C\u0928\u093E\u092C\u0926\u094D\u0927",
      complete: "पूर्ण",
      done: "\u092A\u0942\u0930\u094D\u0923",
      inProg: "\u091C\u093E\u0930\u0940",
      plan: "\u092F\u094B\u091C\u0928\u093E",
      lastUpdated:
        "\u0905\u0902\u0924\u093F\u092E \u0905\u092A\u0921\u0947\u091F",
      loadFail:
        "\u0930\u094B\u0921\u092E\u0948\u092A \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E\u0964",
      tryAgain:
        "\u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u092F\u093E\u0938 \u0915\u0930\u0947\u0902",
      notifyPrompt:
        "\u0938\u0942\u091A\u0928\u093E \u092A\u093E\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0910\u092A \u092E\u0947\u0902 \u0932\u0949\u0917 \u0907\u0928 \u0915\u0930\u0947\u0902\u0964",
    },
    id: {
      inProgress: "Sedang berjalan",
      comingSoon: "Segera hadir",
      planned: "Direncanakan",
      complete: "Selesai",
      done: "Selesai",
      inProg: "Sedang berjalan",
      plan: "Direncanakan",
      lastUpdated: "Terakhir diperbarui",
      loadFail: "Gagal memuat peta jalan.",
      tryAgain: "Coba lagi",
      notifyPrompt: "Masuk ke aplikasi untuk mendapat notifikasi.",
    },
    it: {
      inProgress: "In corso",
      comingSoon: "Prossimamente",
      planned: "Pianificato",
      complete: "Completato",
      done: "Fatto",
      inProg: "In corso",
      plan: "Pianificato",
      lastUpdated: "Ultimo aggiornamento",
      loadFail: "Impossibile caricare la roadmap.",
      tryAgain: "Riprova",
      notifyPrompt: "Accedi all\u2019app per ricevere notifiche.",
    },
    ja: {
      inProgress: "\u9032\u884C\u4E2D",
      comingSoon: "\u8FD1\u65E5\u516C\u958B",
      planned: "\u8A08\u753B\u4E2D",
      complete: "完了",
      done: "\u5B8C\u4E86",
      inProg: "\u9032\u884C\u4E2D",
      plan: "\u8A08\u753B",
      lastUpdated: "\u6700\u7D42\u66F4\u65B0",
      loadFail:
        "\u30ED\u30FC\u30C9\u30DE\u30C3\u30D7\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      tryAgain: "\u518D\u8A66\u884C",
      notifyPrompt:
        "\u901A\u77E5\u3092\u53D7\u3051\u53D6\u308B\u306B\u306F\u30A2\u30D7\u30EA\u306B\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    },
    km: {
      inProgress: "\u1780\u17C6\u1796\u17BB\u1784\u178A\u17C6\u178E\u17BE\u179A\u1780\u17B6\u179A",
      comingSoon: "\u1798\u1780\u178A\u179B\u17CB\u17A2\u17CA\u17B8\u1785\u17B7\u179A\u17C9\u17C2",
      planned: "\u1794\u17B6\u1793\u1782\u17D2\u179A\u17C4\u1784\u1791\u17BB\u1780",
      complete: "\u1794\u17B6\u1793\u1794\u1789\u17D2\u1785\u1794\u17CB",
      done: "\u179A\u17BD\u1785\u179A\u17B6\u179B\u17CB",
      inProg: "\u1780\u17C6\u1796\u17BB\u1784\u178A\u17C6\u178E\u17BE\u179A\u1780\u17B6\u179A",
      plan: "\u1782\u17D2\u179A\u17C4\u1784\u1791\u17BB\u1780",
      lastUpdated: "\u1780\u17C2\u179F\u1798\u17D2\u179A\u17BD\u179B\u1785\u17BB\u1784\u1780\u17D2\u179A\u17C4\u1799",
      loadFail: "\u1798\u17B7\u1793\u17A2\u17B6\u1785\u1795\u17D2\u1791\u17BB\u1780\u1795\u17C2\u1793\u1791\u17B8\u1794\u17B6\u1793\u17D4",
      tryAgain: "\u179F\u17B6\u1780\u179B\u17D2\u1794\u1784\u1798\u17D2\u178F\u1784\u1791\u17C0\u178F",
      notifyPrompt:
        "\u1785\u17BC\u179B\u1780\u17D2\u1793\u17BB\u1784\u1780\u1798\u17D2\u1798\u179C\u17B7\u1792\u17B8\u178A\u17BE\u1798\u17D2\u1794\u17B8\u1791\u1791\u17BD\u179B\u1780\u17B6\u179A\u1787\u17BC\u1793\u178A\u17C6\u178E\u17B9\u1784\u17D4",
    },
    ko: {
      inProgress: "\uC9C4\uD589 \uC911",
      comingSoon: "\uACE7 \uCD9C\uC2DC",
      planned: "\uACC4\uD68D\uB428",
      complete: "완료",
      done: "\uC644\uB8CC",
      inProg: "\uC9C4\uD589 \uC911",
      plan: "\uACC4\uD68D",
      lastUpdated: "\uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8",
      loadFail:
        "\uB85C\uB4DC\uB9F5\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      tryAgain: "\uB2E4\uC2DC \uC2DC\uB3C4",
      notifyPrompt:
        "\uC54C\uB9BC\uC744 \uBC1B\uC73C\uB824\uBA74 \uC571\uC5D0 \uB85C\uADF8\uC778\uD558\uC138\uC694.",
    },
    nl: {
      inProgress: "Bezig",
      comingSoon: "Binnenkort",
      planned: "Gepland",
      complete: "Voltooid",
      done: "Klaar",
      inProg: "Bezig",
      plan: "Gepland",
      lastUpdated: "Laatst bijgewerkt",
      loadFail: "Kan roadmap niet laden.",
      tryAgain: "Opnieuw proberen",
      notifyPrompt: "Log in de app om meldingen te ontvangen.",
    },
    pl: {
      inProgress: "W toku",
      comingSoon: "Wkr\u00F3tce",
      planned: "Zaplanowano",
      complete: "Ukończone",
      done: "Gotowe",
      inProg: "W toku",
      plan: "Plan",
      lastUpdated: "Ostatnia aktualizacja",
      loadFail: "Nie mo\u017Cna za\u0142adowa\u0107 mapy drogowej.",
      tryAgain: "Spr\u00F3buj ponownie",
      notifyPrompt:
        "Zaloguj si\u0119 w aplikacji, aby otrzymywa\u0107 powiadomienia.",
    },
    pt: {
      inProgress: "Em andamento",
      comingSoon: "Em breve",
      planned: "Planejado",
      complete: "Concluído",
      done: "Feito",
      inProg: "Em andamento",
      plan: "Planejado",
      lastUpdated: "\u00DAltima atualiza\u00E7\u00E3o",
      loadFail: "N\u00E3o foi poss\u00EDvel carregar o roadmap.",
      tryAgain: "Tentar novamente",
      notifyPrompt: "Entre no app para receber notifica\u00E7\u00F5es.",
    },
    ru: {
      inProgress: "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435",
      comingSoon: "\u0421\u043A\u043E\u0440\u043E",
      planned:
        "\u0417\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
      complete: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E",
      done: "\u0413\u043E\u0442\u043E\u0432\u043E",
      inProg: "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435",
      plan: "\u041F\u043B\u0430\u043D",
      lastUpdated:
        "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435",
      loadFail:
        "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u043E\u0440\u043E\u0436\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443.",
      tryAgain:
        "\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0441\u043D\u043E\u0432\u0430",
      notifyPrompt:
        "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F.",
    },
    sv: {
      inProgress: "P\u00E5g\u00E5r",
      comingSoon: "Kommer snart",
      planned: "Planerat",
      complete: "Klart",
      done: "Klart",
      inProg: "P\u00E5g\u00E5r",
      plan: "Planerat",
      lastUpdated: "Senast uppdaterad",
      loadFail: "Kunde inte ladda f\u00E4rdplanen.",
      tryAgain: "F\u00F6rs\u00F6k igen",
      notifyPrompt: "Logga in i appen f\u00F6r att f\u00E5 aviseringar.",
    },
    th: {
      inProgress:
        "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E01\u0E32\u0E23",
      comingSoon: "\u0E40\u0E23\u0E47\u0E27\u0E46 \u0E19\u0E35\u0E49",
      planned: "\u0E27\u0E32\u0E07\u0E41\u0E1C\u0E19",
      complete: "เสร็จสมบูรณ์",
      done: "\u0E40\u0E2A\u0E23\u0E47\u0E08",
      inProg: "\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E01\u0E32\u0E23",
      plan: "\u0E27\u0E32\u0E07\u0E41\u0E1C\u0E19",
      lastUpdated:
        "\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14",
      loadFail:
        "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E42\u0E2B\u0E25\u0E14\u0E41\u0E1C\u0E19\u0E07\u0E32\u0E19\u0E44\u0E14\u0E49",
      tryAgain:
        "\u0E25\u0E2D\u0E07\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07",
      notifyPrompt:
        "\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E2D\u0E1B\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19",
    },
    tr: {
      inProgress: "Devam ediyor",
      comingSoon: "Yak\u0131nda",
      planned: "Planland\u0131",
      complete: "Tamamlandı",
      done: "Tamam",
      inProg: "Devam ediyor",
      plan: "Planland\u0131",
      lastUpdated: "Son g\u00FCncelleme",
      loadFail: "Yol haritas\u0131 y\u00FCklenemedi.",
      tryAgain: "Tekrar dene",
      notifyPrompt:
        "Bildirim almak i\u00E7in uygulamaya giri\u015F yap\u0131n.",
    },
    uk: {
      inProgress: "\u0412 \u0440\u043E\u0431\u043E\u0442\u0456",
      comingSoon: "\u041D\u0435\u0437\u0430\u0431\u0430\u0440\u043E\u043C",
      planned:
        "\u0417\u0430\u043F\u043B\u0430\u043D\u043E\u0432\u0430\u043D\u043E",
      complete: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E",
      done: "\u0413\u043E\u0442\u043E\u0432\u043E",
      inProg: "\u0412 \u0440\u043E\u0431\u043E\u0442\u0456",
      plan: "\u041F\u043B\u0430\u043D",
      lastUpdated:
        "\u041E\u0441\u0442\u0430\u043D\u043D\u0454 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F",
      loadFail:
        "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 \u0434\u043E\u0440\u043E\u0436\u043D\u044E \u043A\u0430\u0440\u0442\u0443.",
      tryAgain:
        "\u0421\u043F\u0440\u043E\u0431\u0443\u0432\u0430\u0442\u0438 \u0437\u043D\u043E\u0432\u0443",
      notifyPrompt:
        "\u0423\u0432\u0456\u0439\u0434\u0456\u0442\u044C \u0443 \u0434\u043E\u0434\u0430\u0442\u043E\u043A, \u0449\u043E\u0431 \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0442\u0438 \u0441\u043F\u043E\u0432\u0456\u0449\u0435\u043D\u043D\u044F.",
    },
    vi: {
      inProgress: "\u0110ang ti\u1EBFn h\u00E0nh",
      comingSoon: "S\u1EAFp ra m\u1EAFt",
      planned: "\u0110\u00E3 l\u00EAn k\u1EBF ho\u1EA1ch",
      complete: "Hoàn thành",
      done: "Ho\u00E0n th\u00E0nh",
      inProg: "\u0110ang ti\u1EBFn h\u00E0nh",
      plan: "K\u1EBF ho\u1EA1ch",
      lastUpdated: "C\u1EADp nh\u1EADt l\u1EA7n cu\u1ED1i",
      loadFail: "Kh\u00F4ng th\u1EC3 t\u1EA3i l\u1ED9 tr\u00ECnh.",
      tryAgain: "Th\u1EED l\u1EA1i",
      notifyPrompt:
        "\u0110\u0103ng nh\u1EADp v\u00E0o \u1EE9ng d\u1EE5ng \u0111\u1EC3 nh\u1EADn th\u00F4ng b\u00E1o.",
    },
    zh: {
      inProgress: "\u8FDB\u884C\u4E2D",
      comingSoon: "\u5373\u5C06\u63A8\u51FA",
      planned: "\u5DF2\u8BA1\u5212",
      complete: "已完成",
      done: "\u5B8C\u6210",
      inProg: "\u8FDB\u884C\u4E2D",
      plan: "\u5DF2\u8BA1\u5212",
      lastUpdated: "\u6700\u540E\u66F4\u65B0",
      loadFail: "\u65E0\u6CD5\u52A0\u8F7D\u8DEF\u7EBF\u56FE\u3002",
      tryAgain: "\u91CD\u8BD5",
      notifyPrompt:
        "\u767B\u5F55\u5E94\u7528\u4EE5\u63A5\u6536\u901A\u77E5\u3002",
    },
  };

  // Disclaimer translations (added separately to avoid touching every language block)
  var DISCLAIMER = {
    ar: "\u0642\u062f \u062a\u062a\u063a\u064a\u0631 \u0627\u0644\u0645\u064a\u0632\u0627\u062a \u0648\u0627\u0644\u0623\u0648\u0644\u0648\u064a\u0627\u062a \u0645\u0639 \u062a\u0642\u062f\u0645 \u0627\u0644\u062a\u0637\u0648\u064a\u0631 \u0648\u062a\u0644\u0642\u064a \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646.",
    de: "Funktionen und Priorit\u00e4ten k\u00f6nnen sich im Laufe der Entwicklung und durch Nutzerfeedback \u00e4ndern.",
    es: "Las funciones y prioridades pueden cambiar a medida que avanza el desarrollo y se reciben comentarios.",
    fr: "Les fonctionnalit\u00e9s et priorit\u00e9s peuvent changer au fil du d\u00e9veloppement et des retours utilisateurs.",
    hi: "\u0935\u093f\u0915\u093e\u0938 \u0914\u0930 \u0909\u092a\u092f\u094b\u0917\u0915\u0930\u094d\u0924\u093e \u092a\u094d\u0930\u0924\u093f\u0915\u094d\u0930\u093f\u092f\u093e \u0915\u0947 \u0906\u0927\u093e\u0930 \u092a\u0930 \u0938\u0941\u0935\u093f\u0927\u093e\u090f\u0901 \u0914\u0930 \u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915\u0924\u093e\u090f\u0901 \u092c\u0926\u0932 \u0938\u0915\u0924\u0940 \u0939\u0948\u0902\u0964",
    id: "Fitur dan prioritas dapat berubah seiring perkembangan dan masukan pengguna.",
    it: "Le funzionalit\u00e0 e le priorit\u00e0 possono cambiare con lo sviluppo e il feedback degli utenti.",
    ja: "\u958b\u767a\u306e\u9032\u884c\u3084\u30e6\u30fc\u30b6\u30fc\u30d5\u30a3\u30fc\u30c9\u30d0\u30c3\u30af\u306b\u3088\u308a\u3001\u6a5f\u80fd\u3084\u512a\u5148\u9806\u4f4d\u304c\u5909\u66f4\u3055\u308c\u308b\u5834\u5408\u304c\u3042\u308a\u307e\u3059\u3002",
    km: "មុខងារ និងអាទិភាពអាចនឹងផ្លាស់ប្តូរតាមវឌ្ណនៃការបង្កើត និងមតិរាប់ការរបស់អ្នកប្រើប្រាស់។",
    ko: "\uac1c\ubc1c \uc9c4\ud589 \ubc0f \uc0ac\uc6a9\uc790 \ud53c\ub4dc\ubc31\uc5d0 \ub530\ub77c \uae30\ub2a5\uacfc \uc6b0\uc120\uc21c\uc704\uac00 \ubcc0\uacbd\ub420 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
    nl: "Functies en prioriteiten kunnen veranderen naarmate de ontwikkeling vordert en gebruikersfeedback wordt ontvangen.",
    pl: "Funkcje i priorytety mog\u0105 si\u0119 zmieni\u0107 w miar\u0119 post\u0119pu prac i opinii u\u017cytkownik\u00f3w.",
    pt: "Recursos e prioridades podem mudar conforme o desenvolvimento avan\u00e7a e o feedback dos usu\u00e1rios \u00e9 recebido.",
    ru: "\u0424\u0443\u043d\u043a\u0446\u0438\u0438 \u0438 \u043f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442\u044b \u043c\u043e\u0433\u0443\u0442 \u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c\u0441\u044f \u043f\u043e \u043c\u0435\u0440\u0435 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0438 \u0438 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u043e\u0442\u0437\u044b\u0432\u043e\u0432.",
    sv: "Funktioner och prioriteringar kan \u00e4ndras allt eftersom utvecklingen fortskrider och anv\u00e4ndarfeedback tas emot.",
    th: "\u0e04\u0e38\u0e13\u0e2a\u0e21\u0e1a\u0e31\u0e15\u0e34\u0e41\u0e25\u0e30\u0e25\u0e33\u0e14\u0e31\u0e1a\u0e04\u0e27\u0e32\u0e21\u0e2a\u0e33\u0e04\u0e31\u0e0d\u0e2d\u0e32\u0e08\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e41\u0e1b\u0e25\u0e07\u0e15\u0e32\u0e21\u0e04\u0e27\u0e32\u0e21\u0e04\u0e37\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e25\u0e30\u0e04\u0e27\u0e32\u0e21\u0e04\u0e34\u0e14\u0e40\u0e2b\u0e47\u0e19\u0e02\u0e2d\u0e07\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49",
    tr: "\u00d6zellikler ve \u00f6ncelikler, geli\u015ftirme ilerledik\u00e7e ve kullan\u0131c\u0131 geri bildirimleri al\u0131nd\u0131k\u00e7a de\u011fi\u015febilir.",
    uk: "\u0424\u0443\u043d\u043a\u0446\u0456\u0457 \u0442\u0430 \u043f\u0440\u0456\u043e\u0440\u0438\u0442\u0435\u0442\u0438 \u043c\u043e\u0436\u0443\u0442\u044c \u0437\u043c\u0456\u043d\u044e\u0432\u0430\u0442\u0438\u0441\u044f \u0432 \u043c\u0456\u0440\u0443 \u0440\u043e\u0437\u0432\u0438\u0442\u043a\u0443 \u0442\u0430 \u043e\u0442\u0440\u0438\u043c\u0430\u043d\u043d\u044f \u0432\u0456\u0434\u0433\u0443\u043a\u0456\u0432.",
    vi: "T\u00ednh n\u0103ng v\u00e0 \u01b0u ti\u00ean c\u00f3 th\u1ec3 thay \u0111\u1ed5i khi qu\u00e1 tr\u00ecnh ph\u00e1t tri\u1ec3n ti\u1ebfn tri\u1ec3n v\u00e0 nh\u1eadn \u0111\u01b0\u1ee3c ph\u1ea3n h\u1ed3i t\u1eeb ng\u01b0\u1eddi d\u00f9ng.",
    zh: "\u529f\u80fd\u548c\u4f18\u5148\u7ea7\u53ef\u80fd\u4f1a\u968f\u7740\u5f00\u53d1\u8fdb\u5c55\u548c\u7528\u6237\u53cd\u9988\u800c\u53d8\u5316\u3002",
  };
  // Merge disclaimer into each language block
  for (var lang in DISCLAIMER) {
    if (LABELS[lang]) LABELS[lang].disclaimer = DISCLAIMER[lang];
  }

  function t(key) {
    var labels = LABELS[currentLang] || LABELS.en;
    return labels[key] || LABELS.en[key] || key;
  }

  // ── Helpers ──

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  // ── Donut chart ──

  function renderDonutChart(done, inProgress, planned) {
    var total = done + inProgress + planned;
    if (total === 0) return;

    var percent = Math.round((done / total) * 100);
    var svg = document.getElementById("donut-chart");
    if (!svg) return;

    var cx = 70;
    var cy = 70;
    var radius = 56;
    var strokeWidth = 14;
    var circumference = 2 * Math.PI * radius;

    // Calculate arc lengths
    var doneLen = (done / total) * circumference;
    var ipLen = (inProgress / total) * circumference;
    var plannedLen = (planned / total) * circumference;

    // Gap between segments (2px visual gap)
    var gap = total > 1 ? 4 : 0;
    var segments = [];
    if (done > 0) segments.push({ len: doneLen, color: "#4caf50" });
    if (inProgress > 0) segments.push({ len: ipLen, color: "#ff9800" });
    if (planned > 0) segments.push({ len: plannedLen, color: "#64b5f6" });

    // Adjust segment lengths for gaps
    var totalGap = gap * segments.length;
    var scale =
      segments.length > 1 ? (circumference - totalGap) / circumference : 1;

    var html = "";

    // Background track
    html +=
      '<circle cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      radius +
      '" fill="none" stroke="#2a2e3a" stroke-width="' +
      strokeWidth +
      '"/>';

    var offset = -circumference * 0.25; // Start from top (rotate -90deg equivalent)
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var segLen = seg.len * scale;
      var dasharray = segLen + " " + (circumference - segLen);
      html +=
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="' +
        radius +
        '" fill="none" ';
      html += 'stroke="' + seg.color + '" stroke-width="' + strokeWidth + '" ';
      html += 'stroke-dasharray="' + dasharray + '" ';
      html += 'stroke-dashoffset="' + -offset + '" ';
      html += 'stroke-linecap="round" ';
      html +=
        'style="transition: stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease;"/>';
      offset += segLen + gap;
    }

    svg.innerHTML = html;

    // Update center text
    var percentEl = document.getElementById("donut-percent");
    if (percentEl) percentEl.textContent = percent + "%";

    // Update legend counts
    var countDone = document.getElementById("count-done");
    var countIp = document.getElementById("count-in-progress");
    var countPlanned = document.getElementById("count-planned");
    if (countDone) countDone.textContent = done;
    if (countIp) countIp.textContent = inProgress;
    if (countPlanned) countPlanned.textContent = planned;
  }

  // ── Phase rendering ──

  function getStatusIcon(status) {
    switch (status) {
      case "done":
        return { icon: "\u2713", cls: "feature-status-icon--done" };
      case "in-progress":
        return { icon: "\u25C9", cls: "feature-status-icon--in-progress" };
      case "next":
        return { icon: "\u25C9", cls: "feature-status-icon--in-progress" };
      default:
        return { icon: "\u25CB", cls: "feature-status-icon--planned" };
    }
  }

  function getPhaseStatusLabel(status) {
    switch (status) {
      case "active":
        return t("inProgress");
      case "soon":
        return t("comingSoon");
      default:
        return t("planned");
    }
  }

  function getPhaseStatusClass(status) {
    switch (status) {
      case "active":
        return "phase-status-badge--active";
      case "soon":
        return "phase-status-badge--soon";
      default:
        return "phase-status-badge--planned";
    }
  }

  var BELL_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
  var CHEVRON_SVG =
    '<svg class="phase-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  function renderPhases(data) {
    var container = document.getElementById("roadmap-container");
    if (!container) return;

    var phases = data.phases;
    if (!phases || phases.length === 0) {
      container.innerHTML =
        '<div class="error-state"><p>' +
        escapeHtml(t("loadFail")) +
        "</p></div>";
      return;
    }

    var html = "";
    var totalDone = 0;
    var totalIp = 0;
    var totalPlanned = 0;

    // Collect all in-progress items from all phases into a top section
    var inProgressItems = [];
    for (var ip = 0; ip < phases.length; ip++) {
      var ipFeatures = phases[ip].features || [];
      for (var ifi = 0; ifi < ipFeatures.length; ifi++) {
        var ipStatus = ipFeatures[ifi].status;
        if (ipStatus === "in-progress" || ipStatus === "next") {
          inProgressItems.push({
            feature: ipFeatures[ifi],
            phaseTitle: phases[ip].title,
            phaseI18n: phases[ip].titleI18n,
          });
        }
      }
    }

    // Render "In Progress" section at the top
    if (inProgressItems.length > 0) {
      html += '<div id="in-progress-section" class="phase-card" data-testid="in-progress-section" style="border-left: 3px solid var(--in-progress, #ff9800);">';
      html += '<button class="phase-header" aria-expanded="true">';
      html += CHEVRON_SVG;
      html += '<span class="phase-title">' + escapeHtml(t("inProgress") || "In Progress") + '</span>';
      html += '<span class="phase-progress">';
      html += '<span class="phase-progress-text">' + inProgressItems.length + ' ' + escapeHtml(t("inProg") || "In Progress") + '</span>';
      html += '</span>';
      html += '</button>';
      html += '<div class="phase-body">';
      html += '<ul class="feature-list" data-testid="feature-list">';
      for (var ipi = 0; ipi < inProgressItems.length; ipi++) {
        var ipItem = inProgressItems[ipi];
        var ipStatusInfo = getStatusIcon(ipItem.feature.status);
        var ipFeatI18n = ipItem.feature.i18n && ipItem.feature.i18n[currentLang];
        var ipFeatName = (ipFeatI18n && ipFeatI18n.n) || ipItem.feature.name;
        var ipFeatDesc = (ipFeatI18n && ipFeatI18n.d) || ipItem.feature.description;
        var ipPhaseLabel = (ipItem.phaseI18n && ipItem.phaseI18n[currentLang]) || ipItem.phaseTitle;

        html += '<li class="feature-item">';
        html += '<span class="feature-status-icon ' + ipStatusInfo.cls + '" aria-hidden="true">' + ipStatusInfo.icon + '</span>';
        html += '<div class="feature-info">';
        html += '<div class="feature-name">' + escapeHtml(ipFeatName) + '</div>';
        if (ipFeatDesc) html += '<div class="feature-desc">' + escapeHtml(ipFeatDesc) + '</div>';
        html += '<div class="feature-desc" style="font-size:0.75rem;opacity:0.6;margin-top:2px;">' + escapeHtml(ipPhaseLabel) + '</div>';
        html += '</div>';
        html += '<button class="feature-bell" aria-label="Notify me about ' + escapeHtml(ipFeatName) + '" data-testid="feature-bell" data-log="bell-' + escapeHtml(ipItem.feature.name) + '">' + BELL_SVG + '</button>';
        html += '</li>';
      }
      html += '</ul></div></div>';
    }

    for (var p = 0; p < phases.length; p++) {
      var phase = phases[p];
      var features = phase.features || [];
      if (features.length === 0) continue;

      var phaseDone = 0;
      var phaseIp = 0;
      for (var f = 0; f < features.length; f++) {
        var s = features[f].status;
        if (s === "done") {
          phaseDone++;
          totalDone++;
        } else if (s === "in-progress" || s === "next") {
          phaseIp++;
          totalIp++;
        } else {
          totalPlanned++;
        }
      }

      var phaseTitle =
        (phase.titleI18n && phase.titleI18n[currentLang]) || phase.title;
      var progressPct =
        features.length > 0
          ? Math.round((phaseDone / features.length) * 100)
          : 0;
      var isCollapsed = phase.status !== "in-progress" && phase.status !== "active";
      var delay = p * 0.06;

      html +=
        '<div class="phase-card' +
        (isCollapsed ? " collapsed" : "") +
        '" data-phase="' +
        p +
        '" data-testid="phase-card"' +
        ' style="animation-delay:' +
        delay +
        's">';

      // Header button
      html +=
        '<button class="phase-header" aria-expanded="' +
        !isCollapsed +
        '" data-log="phase-toggle-' +
        p +
        '">';
      html += CHEVRON_SVG;
      html += '<span class="phase-title">' + escapeHtml(phaseTitle) + "</span>";
      var fillClass =
        phaseDone === features.length ? "phase-progress-fill--complete" :
        (phaseDone > 0 || phaseIp > 0) ? "phase-progress-fill--in-progress" :
        "phase-progress-fill--planned";
      var phaseStatusLabel =
        phaseDone === features.length ? (t("complete") || "Complete") :
        (phaseDone > 0 || phaseIp > 0) ? (t("inProgress") || "In Progress") :
        (t("planned") || "Planned");
      html +=
        '<span class="phase-progress-text">' +
        escapeHtml(phaseStatusLabel) +
        " (" + phaseDone + "/" + features.length + ")" +
        "</span>";
      html += "</button>";
      // Full-width progress bar below the header
      html +=
        '<div class="phase-progress-bar"><span class="phase-progress-fill ' + fillClass + '" style="width:' +
        progressPct +
        '%"></span></div>';

      // Body
      html += '<div class="phase-body">';
      html += '<ul class="feature-list" data-testid="feature-list">';

      for (var fi = 0; fi < features.length; fi++) {
        var feat = features[fi];
        // Skip in-progress items — they're shown in the top "In Progress" section
        if (feat.status === "in-progress" || feat.status === "next") continue;
        var statusInfo = getStatusIcon(feat.status);
        var featI18n = feat.i18n && feat.i18n[currentLang];
        var featName = (featI18n && featI18n.n) || feat.name;
        var featDesc = (featI18n && featI18n.d) || feat.description;

        html += '<li class="feature-item">';
        html +=
          '<span class="feature-status-icon ' +
          statusInfo.cls +
          '" aria-hidden="true">' +
          statusInfo.icon +
          "</span>";
        html += '<div class="feature-info">';
        html += '<div class="feature-name">' + escapeHtml(featName) + "</div>";
        if (featDesc) {
          html +=
            '<div class="feature-desc">' + escapeHtml(featDesc) + "</div>";
        }
        html += "</div>";
        html +=
          '<button class="feature-bell" aria-label="Notify me about ' +
          escapeHtml(featName) +
          '" data-testid="feature-bell"' +
          ' data-log="bell-' +
          escapeHtml(feat.name) +
          '">' +
          BELL_SVG +
          "</button>";
        html += "</li>";
      }

      html += "</ul>";
      html += "</div>"; // phase-body
      html += "</div>"; // phase-card
    }

    container.innerHTML = html;

    // Render donut chart
    renderDonutChart(totalDone, totalIp, totalPlanned);

    // Update footer date
    if (data.lastUpdated) {
      var updatedEl = document.getElementById("footer-updated");
      if (updatedEl) {
        updatedEl.textContent = t("lastUpdated") + ": " + data.lastUpdated;
      }
    }

    // Update footer disclaimer translation
    var disclaimerEl = document.querySelector("[data-i18n='disclaimer']");
    if (disclaimerEl) {
      disclaimerEl.textContent = t("disclaimer");
    }

    // Update footer copyright translation
    var copyrightEl = document.querySelector("[data-i18n='copyright']");
    if (copyrightEl) {
      copyrightEl.textContent = t("copyright");
    }

    // Attach collapse/expand handlers
    setupCollapseHandlers();

    // Attach bell handlers
    setupBellHandlers();
  }

  // ── Collapse/expand ──

  function setupCollapseHandlers() {
    var headers = document.querySelectorAll(".phase-header");
    for (var i = 0; i < headers.length; i++) {
      headers[i].addEventListener("click", function () {
        var card = this.closest(".phase-card");
        if (!card) return;
        var isCollapsed = card.classList.contains("collapsed");
        card.classList.toggle("collapsed");
        this.setAttribute("aria-expanded", isCollapsed ? "true" : "false");
      });
    }
  }

  // ── Bell handlers ──

  var toastTimer = null;

  function showLoginToast() {
    var toast = document.getElementById("login-toast");
    if (!toast) return;
    toast.textContent = t("notifyPrompt");
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("visible");
    }, 3500);
  }

  function setupBellHandlers() {
    var bells = document.querySelectorAll(".feature-bell");
    for (var i = 0; i < bells.length; i++) {
      bells[i].addEventListener("click", function (e) {
        e.stopPropagation();
        var auth = window.shytalkAuth;
        if (auth && auth.currentUser && auth.profile) {
          // Authenticated — open subscribe modal
          if (window.shytalkOpenSubscribeModal) {
            window.shytalkOpenSubscribeModal();
          }
        } else if (window.shytalkShowLoginModal) {
          window.shytalkShowLoginModal("subscribe to feature updates");
        } else {
          showLoginToast();
        }
      });
    }
  }

  // ── Sticky nav active state on scroll ──

  function setupScrollSpy() {
    var navLinks = document.querySelectorAll(".nav-link[data-nav]");
    var sections = [];
    for (var i = 0; i < navLinks.length; i++) {
      var id = navLinks[i].getAttribute("data-nav");
      var el = document.getElementById(id);
      if (el) sections.push({ id: id, el: el, link: navLinks[i] });
    }

    if (sections.length === 0) return;

    var ticking = false;

    function updateActiveNav() {
      var scrollY = window.scrollY || window.pageYOffset;
      var offset = 120; // Account for sticky nav height + some padding
      var activeId = sections[0].id;

      for (var i = sections.length - 1; i >= 0; i--) {
        if (sections[i].el.offsetTop - offset <= scrollY) {
          activeId = sections[i].id;
          break;
        }
      }

      for (var j = 0; j < sections.length; j++) {
        if (sections[j].id === activeId) {
          sections[j].link.classList.add("active");
        } else {
          sections[j].link.classList.remove("active");
        }
      }

      // Update URL hash silently (no scroll jump)
      var newHash = "#" + activeId;
      if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash);
      }

      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          requestAnimationFrame(updateActiveNav);
          ticking = true;
        }
      },
      { passive: true },
    );

    // Run once on load
    updateActiveNav();
  }

  // ── Deep linking ──

  function handleDeepLink() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    var targetId = hash.substring(1);
    var target = document.getElementById(targetId);
    if (target) {
      // Use instant scroll so the initial position is set before scroll spy runs
      target.scrollIntoView({ behavior: "auto", block: "start" });
      // Re-scroll after suggestions board loads (it renders asynchronously)
      if (targetId === "suggestions") {
        setTimeout(function () {
          target.scrollIntoView({ behavior: "auto", block: "start" });
        }, 500);
      }
    }
  }

  // ── Subscribe button ──

  function setupSubscribeButton() {
    var btn = document.getElementById("subscribe-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      showLoginToast();
    });
  }

  // ── Language integration ──

  function resolveLanguage() {
    if (
      window.ShyTalkLanguage &&
      typeof window.ShyTalkLanguage.get === "function"
    ) {
      return window.ShyTalkLanguage.get();
    }
    return (navigator.language || "en").split("-")[0];
  }

  // Called by language-selector.js when user changes language.
  // Chains with any prior applyLanguage handler (e.g. legal-translations.js
  // for footer link i18n) so multiple translation modules can co-exist
  // without overwriting each other.
  (function () {
    var _prev = window.applyLanguage;
    window.applyLanguage = function (lang) {
      currentLang = lang;
      if (roadmapData) {
        renderPhases(roadmapData);
        setupScrollSpy();
      }
      if (typeof _prev === "function") _prev(lang);
    };
  })();

  // ── Fetch and init ──

  function loadRoadmap() {
    var container = document.getElementById("roadmap-container");

    fetch("/roadmap-data.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        roadmapData = data;
        currentLang = resolveLanguage();
        renderPhases(data);
        // Deep link FIRST — scrolls to target before scroll spy overwrites hash
        handleDeepLink();
        // Scroll spy last — runs updateActiveNav() which reads the now-scrolled position
        setupScrollSpy();
      })
      .catch(function () {
        if (container) {
          container.innerHTML =
            '<div class="error-state">' +
            "<p>" +
            escapeHtml(t("loadFail")) +
            "</p>" +
            '<p style="margin-top:12px"><a href="https://github.com/ShydenMcM/ShyTalk" data-log="github-fallback">' +
            "Visit our GitHub</a></p></div>";
        }
      });
  }

  // ── Bootstrap ──

  function init() {
    currentLang = resolveLanguage();
    setupSubscribeButton();
    loadRoadmap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
