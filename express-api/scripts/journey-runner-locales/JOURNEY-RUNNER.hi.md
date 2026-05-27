# ShyTalk डिवाइस-पर journey-test रनर

_यह JOURNEY-RUNNER.md का अनुवाद है।_

`device-journey-runner.js` **जुड़े हुए फ़ोन पर असली ShyTalk ऐप** को
एंड-टू-एंड यूज़र journeys के ज़रिए चलाता है और एक **विस्तृत pass/fail रिपोर्ट** लिखता है जिसे
आप पढ़ सकते हैं — तो आप हर चरण को हाथ से टैप करने के बजाय एक कमांड चलाते हैं और एक रिपोर्ट पढ़ते हैं।

यह एक **hybrid** रनर है। हर journey एक साथ तीन परतों पर assert कर सकती है:

1. **UI** — `adb` + `uiautomator` के ज़रिए लाइव ऐप को टैप/निरीक्षण करता है (Compose
   `testTag`s डंप में `resource-id`s के रूप में दिखते हैं; डायलॉग उनके दृश्यमान टेक्स्ट से मैच होते हैं)।
2. **Firestore** — हर action के पीछे के डेटाबेस state की पुष्टि करने के लिए लोकल एमुलेटर को सीधे (via `firebase-admin`) पढ़ता है।
3. **Server / API** — हर persona के रूप में साइन इन करता है (Auth एमुलेटर से असली Firebase ID token) और
   `express-api` को कॉल करता है, ताकि यह उन **नियमों की पुष्टि करे जिन्हें सर्वर लागू करता है**
   (OSA cohort gate, admin override, moderation) — जो अकेले UI में _दिखाई नहीं देते_।

> इस गाइड के अनुवाद `journey-runner-locales/` में रहते हैं (20 भाषाएँ)।

---

## 1. पूर्व-आवश्यकताएँ

| आपको चाहिए                  | कैसे                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Docker Desktop** चालू     | Firebase एमुलेटर + LiveKit/MinIO के लिए                                                                                                                      |
| **लोकल स्टैक चालू**         | `bash local/start.sh` (repo root से) — Firebase एमुलेटर + express-api शुरू करता है। इसे चलता हुआ छोड़ दें।                                                   |
| **Personas seed किए हुए**   | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; पासवर्ड `localdev123` के साथ P‑02…P‑19 test cast को seed करता है) |
| **एक फ़ोन जुड़ा हुआ**       | `adb devices` में एक सूचीबद्ध होना चाहिए (USB केबल **या** wireless `adb`)। एक Android एमुलेटर भी काम करता है।                                                |
| **Java 21+ और Android SDK** | केवल पहली बार ज़रूरी, ताकि APK गायब होने पर रनर ऐप बना सके                                                                                                   |

रनर खुद `local` debug APK बना लेता है अगर वह पहले से नहीं बना है।

---

## 2. इसे चलाएँ

repo root से:

```sh
# लोकल स्टैक के विरुद्ध पूरी सूट चलाएँ
node express-api/scripts/device-journey-runner.js

# कुछ भी चलाए बिना journeys की सूची देखें
node express-api/scripts/device-journey-runner.js --list

# केवल विशिष्ट journeys चलाएँ
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# पहले एक नया APK बिल्ड करने के लिए बाध्य करें
node express-api/scripts/device-journey-runner.js --rebuild

# पूरी option सूची
node express-api/scripts/device-journey-runner.js --help
```

Options: `--target local|dev` (default `local`) · `--serial <adb-serial>`
(default: auto-select) · `--journeys <ids>` · `--rebuild` · `--no-reset` (smoke
journey में clean reinstall छोड़ देता है) · `--out <dir>` · `--list` · `--help`।

रनर हर कमांड के लिए **एक** adb serial पिन करता है, इसलिए यह तब भी काम करता है जब कोई
फ़ोन दो बार दिखे (USB + wireless)। `local` target के लिए यह
`adb reverse` टनल सेट करता है ताकि डिवाइस-पर ऐप आपकी मशीन पर स्टैक तक पहुँच सके।

---

## 3. परिणाम देखें

जब यह समाप्त होता है तो यह एक सारांश प्रिंट करता है और `journey-results/` के अंतर्गत लिखता है:

| फ़ाइल                           | क्या                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **इसे पढ़ें** — प्रति-journey, प्रति-step ✅/❌ कारण के साथ, ऑन-स्क्रीन testTags, और हर step के लिए एक स्क्रीनशॉट लिंक |
| `latest-report.json`            | वही डेटा, मशीन-पठनीय                                                                                                   |
| `runs/<runId>/*.png`            | हर step का एक स्क्रीनशॉट (pass _और_ fail दोनों)                                                                        |
| `runs/<runId>/report.{md,json}` | उस विशिष्ट run के लिए संग्रहीत रिपोर्ट                                                                                 |

Exit code `0` होता है जब हर journey pass हुई, `1` जब कोई fail हुई। fail होने पर
step ठीक वही रिकॉर्ड करता है जो स्क्रीन पर था, ताकि आप फ़ोन को दोबारा चलाए बिना देख सकें कि _क्यों_।

---

## 4. journeys क्या कवर करती हैं

लाइव सेट के लिए `--list` चलाएँ। एक नज़र में सूट कवर करता है:

- **Smoke** — clean install → legal acceptance → sign-in, backend तक पहुँच योग्य।
- **Cohort sign-in** — adult / minor / admin personas इन-ऐप
  dev persona picker के ज़रिए साइन इन करते हैं; identity की पुष्टि debug overlay और
  Firestore `cohort` field के विरुद्ध की जाती है।
- **OSA cohort gate** — एक minor किसी adult को न तो follow कर सकता है न देख सकता है (सर्वर
  `404` लौटाता है, और Firestore write कभी नहीं होता), जबकि same-cohort actions
  सफल होती हैं — यह साबित करते हुए कि gate cohort-specific है, कोई blanket block नहीं।
- **Admin** — cohort-override केवल staff के लिए है (एक सामान्य member
  `422` के साथ अस्वीकृत होता है; एक staff account सफल होता है और एक regulatory audit row लिखता है)।
- **Moderation** — report → admin suspend (+ audit) → appeal → unsuspend, पूरी तरह
  server-enforced, idempotent cleanup के साथ।

journeys में authentication हमेशा **इन-ऐप dev persona picker** का उपयोग करता है — कभी
असली Google/Apple sign-in नहीं।

> **journey specs पर एक नोट।**
> `.project/test-plans/manual/j01-j19` में Gherkin plans आंशिक रूप से _aspirational_ हैं: वे
> ऐसे UI का संदर्भ देते हैं जो शिप किए गए ऐप में नहीं है (उदा. एक email/password signup स्क्रीन, छिपे हुए
> minor tabs, एक discovery स्क्रीन)। इसलिए रनर हर journey के असली
> इरादे को **वास्तविक** ऐप + Firestore + API के विरुद्ध मैप करता है, और ऐसी
> भिन्नताओं को कल्पना पर fail होने के बजाय findings के रूप में रिकॉर्ड करता है।

---

## 5. समस्या-निवारण

| लक्षण                                                               | समाधान                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                               | फ़ोन प्लग इन / pair करें; `adb devices` जाँचें।                                                                   |
| SignIn तक पहुँचने में अटका / "backend NOT reachable"                | लोकल स्टैक चालू नहीं है या `adb reverse` टनल सेट नहीं हुए — `bash local/start.sh` को पुनः आरंभ करें और फिर चलाएँ। |
| `persona "<email>" not found in picker`                             | Personas seed नहीं हैं — §1 में seed कमांड चलाएँ।                                                                 |
| `Firestore assertions: ON` गायब / DB steps छूट गए                   | DB asserts केवल `--target local` के लिए चलते हैं।                                                                 |
| APK build विफल                                                      | प्रिंट किया गया `gradle-build.log` खोलें; सुनिश्चित करें कि Java 21+ और Android SDK इंस्टॉल हैं।                  |
| एक step एक ऐसी स्क्रीन पर fail होती है जिसकी आपने उम्मीद नहीं की थी | उस step के लिए `latest-report.md` में नामित स्क्रीनशॉट खोलें।                                                     |

---

## 6. एक journey जोड़ना

journeys सादे objects हैं जिनमें एक `run(device, reporter, ctx)` मेथड होता है, जो
साझा helpers से बना है:

- `signInAs(device, reporter, ctx, email, nameToken)` — picker के ज़रिए एक persona को
  साइन इन करें और Home तक first-launch interstitials से गुज़रें।
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, और `dump(device)` + `byId` / `byText` / `byTextContains`।
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`।
- Server: `getIdToken(email)` → एक persona का ID token, फिर
  `apiCall(method, path, { token, body })`।

हर assertion को `reporter.step(device, 'name', async () => { … })` में लपेटें — यह
step को टाइम करता है, स्क्रीनशॉट लेता है, pass/fail रिकॉर्ड करता है, और fail होने पर
ऑन-स्क्रीन testTags कैप्चर करता है। नए object को `buildJourneys` में `all` array में जोड़ें।

शुद्ध logic (parsing, selectors, arg handling) की यूनिट-टेस्टिंग
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`) में होती है;
device/Firestore/API परतों की integration-testing सूट को असली डिवाइस पर चलाकर की जाती है।
