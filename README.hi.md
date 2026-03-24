# ShyTalk

**वॉइस चैट रूम, नए अंदाज़ में।**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | **हिन्दी** | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## परिचय

ShyTalk एक सामाजिक वॉइस चैट ऐप है जहां उपयोगकर्ता रियल-टाइम वॉइस चैट रूम बना सकते हैं और उनमें शामिल हो सकते हैं। Kotlin Multiplatform (KMP) के साथ निर्मित, यह एक साझा कोडबेस के साथ Android और iOS दोनों को लक्षित करता है। चाहे आप बातचीत होस्ट करना चाहें, सुनना चाहें, या दुनिया भर के लोगों से जुड़ना चाहें, ShyTalk इसे आसान बनाता है।

## विशेषताएं

### वॉइस चैट रूम
- LiveKit द्वारा संचालित रियल-टाइम वॉइस के साथ रूम बनाएं या उनमें शामिल हों
- मालिक, होस्ट और उपस्थित व्यक्ति की भूमिकाओं के साथ संरचित सीटिंग प्रणाली
- सीट अनुरोध और निमंत्रण -- सीट पर बैठने का अनुरोध करें या श्रोताओं को बोलने के लिए आमंत्रित करें
- फ्लोटिंग चैटहेड -- ऐप के अन्य हिस्सों को ब्राउज़ करते हुए वॉइस चैट जारी रखें
- रूम समाप्ति -- जब मालिक अनुपस्थित हो तो रूम स्वचालित रूप से बंद हो जाते हैं, काउंटडाउन टाइमर के साथ

### मैसेजिंग
- हर रूम में वॉइस के साथ लाइव टेक्स्ट चैट
- 1-से-1 बातचीत के साथ प्राइवेट मैसेजिंग
- सदस्य प्रबंधन और अनुमतियों के साथ ग्रुप चैट
- रियल-टाइम में टाइपिंग इंडिकेटर
- स्टिकर सपोर्ट

### सामाजिक
- फोटो, कवर इमेज, राष्ट्रीयता के झंडे और बायो के साथ अनुकूलन योग्य उपयोगकर्ता प्रोफ़ाइल
- फॉलो सिस्टम -- अन्य उपयोगकर्ताओं को फॉलो करें और देखें कि वे कब सक्रिय हैं
- गिफ्ट वॉल -- अन्य उपयोगकर्ताओं से प्राप्त उपहार प्रदर्शित करें
- ब्लॉक सिस्टम -- रूम और प्रोफ़ाइल में उपयोगकर्ताओं को ब्लॉक करें

### वर्चुअल अर्थव्यवस्था
- वॉलेट और लेनदेन इतिहास के साथ सिक्का-आधारित अर्थव्यवस्था
- स्ट्रीक बोनस के साथ दैनिक लॉगिन पुरस्कार
- स्तरीय पुरस्कारों के साथ लकी स्पिन (गाचा) प्रणाली
- वर्चुअल उपहार -- वॉइस चैट के दौरान एनिमेटेड उपहार भेजें और प्राप्त करें
- उपहार संग्रहित करने के लिए बैकपैक इन्वेंटरी
- सिक्के खरीदने के लिए सिक्का पैकेज
- एनिमेटेड उपहार प्रभावों के साथ ब्रॉडकास्ट बैनर

### खाता और पहचान
- बहु-प्रदाता प्रमाणीकरण -- Google, Apple, या ईमेल (OTP) से साइन इन करें
- एक ही खाते से कई साइन-इन विधियां जोड़ें
- स्थिर उपयोगकर्ता पहचान (uniqueId) जो Firebase प्रोजेक्ट्स में बनी रहती है
- लिंक/अनलिंक सपोर्ट के साथ सेटिंग्स में लिंक्ड अकाउंट्स प्रबंधन
- डिवाइस बाइंडिंग -- प्रत्येक डिवाइस स्थायी रूप से एक खाते से जुड़ा होता है

### मॉडरेशन और सुरक्षा
- मॉडरेशन टूल्स -- म्यूट, किक, सीट मूव करें, और रूम मालिक के रूप में होस्ट प्रबंधित करें
- समीक्षा वर्कफ़्लो के साथ उपयोगकर्ता रिपोर्टिंग प्रणाली
- नीति उल्लंघनों के लिए चेतावनी और निलंबन प्रणाली
- सामुदायिक मानक, गोपनीयता नीति और सेवा की शर्तें स्क्रीन
- नए उपयोगकर्ताओं के लिए कानूनी स्वीकृति प्रवाह
- पुरानी ऐप संस्करणों के लिए बलपूर्वक अपडेट प्रवर्तन

### स्टार्टिंग स्क्रीन
- ऐप स्टार्टअप पर दिखाई जाने वाली कॉन्फ़िगर करने योग्य लॉन्च स्क्रीन
- शेड्यूलिंग और टार्गेटिंग विकल्पों के साथ एडमिन-प्रबंधित सामग्री

### सुरक्षा
- ऐप एक्सेस के लिए PIN कोड सुरक्षा
- बायोमेट्रिक प्रमाणीकरण -- फिंगरप्रिंट और चेहरे की पहचान
- संवेदनशील कार्यों के लिए OTP (वन-टाइम पासवर्ड) सत्यापन

### एडमिन पैनल
- प्रोजेक्ट की स्टैटिक साइट पर वेब-आधारित मॉडरेशन डैशबोर्ड
- उपयोगकर्ता प्रबंधन, सामग्री मॉडरेशन और कॉन्फ़िगरेशन
- लाइव प्रीव्यू के साथ टेम्पलेट और उपहार प्रबंधन
- रियल-टाइम लॉग स्ट्रीमिंग और अलर्टिंग

### इमेज कम्प्रेशन
- Express API के माध्यम से अपलोड पर स्वचालित इमेज कम्प्रेशन
- गुणवत्ता बनाए रखते हुए स्टोरेज और बैंडविड्थ लागत कम करता है

### अंतर्राष्ट्रीयकरण
- 19 भाषाएं बॉक्स से बाहर समर्थित
- सभी उपयोगकर्ता-सामना करने वाले स्ट्रिंग्स के लिए पूर्ण स्थानीयकरण

### लॉगिंग और मॉनिटरिंग
- Express API, मोबाइल ऐप्स और एडमिन पैनल में संरचित लॉगिंग
- एडमिन डैशबोर्ड में रियल-टाइम लॉग स्ट्रीमिंग
- स्वचालित प्रवर्तन के साथ डिवाइस और नेटवर्क बैनिंग
- गंभीर त्रुटियों और विसंगतियों के लिए अलर्टिंग सिस्टम
- एंड-टू-एंड रिक्वेस्ट ट्रैकिंग के लिए Trace ID प्रसार

## टेक स्टैक

| परत | तकनीक |
|-------|-----------|
| **फ्रेमवर्क** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **आर्किटेक्चर** | MVVM + Repository Pattern |
| **DI** | Koin |
| **प्रमाणीकरण** | Firebase Authentication (Google, Apple, Email+OTP) बहु-प्रदाता पहचान प्रणाली के साथ |
| **डेटाबेस** | Cloud Firestore |
| **रियल-टाइम** | Firebase Realtime Database |
| **स्टोरेज** | Cloudflare R2 (Express API प्रॉक्सी के माध्यम से) |
| **API सर्वर** | Express.js Oracle Cloud Free Tier पर |
| **वॉइस** | LiveKit |
| **पुश नोटिफिकेशन** | Firebase Cloud Messaging |
| **इमेज लोडिंग** | Coil 3 (KMP) |
| **एनिमेशन** | Lottie Compose |
| **दिनांक/समय** | kotlinx-datetime |
| **नेविगेशन** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## आर्किटेक्चर

ShyTalk एक स्वच्छ **Repository Pattern** के साथ **MVVM** का पालन करता है:

```
+---------------------------------------------+
|                    UI Layer                  |
|  Compose Screens -> ViewModels -> UI State   |
+---------------------------------------------+
|                  Domain Layer                |
|         Repository Interfaces                |
+---------------------------------------------+
|                  Data Layer                  |
|  Repository Impls -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **शेयर्ड मॉड्यूल** (`commonMain`) -- मॉडल, रिपॉजिटरी इंटरफेस, ViewModels, और प्लेटफ़ॉर्म में साझा UI
- **ऐप मॉड्यूल** -- Android-विशिष्ट स्क्रीन, रिपॉजिटरी कार्यान्वयन, और प्रवेश बिंदु
- **iosApp मॉड्यूल** -- iOS-विशिष्ट प्रवेश बिंदु
- **express-api** -- Oracle Cloud Free Tier पर चलने वाला Express.js बैकएंड

## प्रोजेक्ट संरचना

```
ShyTalk/
+-- app/                              # Android ऐप मॉड्यूल
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # एप्लिकेशन प्रवेश बिंदु
|       |   +-- MainActivity.kt       # मुख्य एक्टिविटी
|       |   +-- core/
|       |   |   +-- di/               # Koin DI मॉड्यूल
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit वॉइस, प्रेजेंस, नोटिफिकेशन
|       |   |   +-- repository/       # रिपॉजिटरी कार्यान्वयन
|       |   +-- feature/
|       |   |   +-- auth/             # Google साइन-इन स्क्रीन
|       |   |   +-- profile/          # प्रोफ़ाइल स्क्रीन
|       |   |   +-- room/             # रूम स्क्रीन
|       |   |   +-- settings/         # ऐप सेटिंग्स
|       |   +-- navigation/           # NavGraph और स्क्रीन रूट्स
|       +-- test/                     # यूनिट टेस्ट
|       +-- androidTest/              # E2E टेस्ट (Compose UI Test)
+-- shared/                           # KMP शेयर्ड मॉड्यूल
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # शेयर्ड Koin मॉड्यूल
|       |   +-- model/                # डेटा मॉडल (User, ChatRoom, Gift, आदि)
|       |   +-- ui/                   # शेयर्ड कंपोनेंट
|       |   +-- util/                 # यूटिलिटीज और कॉन्स्टेंट्स
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, आदि
|       |   +-- repository/           # रिपॉजिटरी इंटरफेस
|       +-- feature/                  # शेयर्ड फीचर मॉड्यूल
+-- iosApp/                           # iOS ऐप मॉड्यूल
+-- express-api/                      # Express.js API सर्वर
|   +-- src/
|       +-- routes/                   # API रूट हैंडलर
|       +-- middleware/               # Auth, लॉगिंग मिडलवेयर
|       +-- utils/                    # Firebase Admin, R2, लॉगर
|       +-- cron/                     # शेड्यूल्ड जॉब्स
+-- public/                           # स्टैटिक साइट और एडमिन पैनल
+-- local/                            # लोकल डेवलपमेंट एन्वायरनमेंट (एमुलेटर, सीड डेटा)
+-- tests/web/                        # Playwright ब्राउज़र टेस्ट
+-- scripts/                          # यूटिलिटी स्क्रिप्ट्स
+-- .github/workflows/                # CI/CD (PR चेक्स, Dev/Prod में डिप्लॉय, E2E, लिंट)
+-- firestore.rules                   # Firestore सुरक्षा नियम
+-- database.rules.json               # RTDB सुरक्षा नियम
+-- firestore.indexes.json            # Firestore कम्पोजिट इंडेक्स
+-- firebase.json                     # Firebase कॉन्फ़िगरेशन
```

## शुरू करना

### पूर्वापेक्षाएं

- **Android Studio** Ladybug या नया
- **JDK 17+**
- **Node.js 24+**
- **Docker** (लोकल LiveKit सर्वर के लिए)
- **Firebase CLI** (`npm install -g firebase-tools`)

### लोकल डेवलपमेंट (अनुशंसित)

शुरू करने का सबसे तेज़ तरीका। Firebase एमुलेटर और एक लोकल LiveKit Docker कंटेनर का उपयोग करता है -- क्लाउड खातों की आवश्यकता नहीं, कोई लागत नहीं, कोई कोटा सीमा नहीं।

1. **क्लोन और इंस्टॉल करें**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **लोकल सेवाएं शुरू करें**
   ```bash
   bash local/start.sh
   ```
   यह Firebase एमुलेटर (Firestore, Auth, RTDB) और एक LiveKit Docker कंटेनर शुरू करता है। पहली बार चलाने पर यह स्वचालित रूप से टेस्ट डेटा सीड करता है (एडमिन उपयोगकर्ता, नमूना उपहार, कॉन्फ़िगरेशन)।

   आप देखेंगे:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Express API शुरू करें** (एक नए टर्मिनल में)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # यदि आवश्यक हो तो R2/SMTP मान संपादित करें
   npm run local
   ```
   API `http://localhost:3000` पर शुरू होती है। परीक्षण: `curl http://localhost:3000/api/health`

4. **Android एमुलेटर पर चलाएं**
   ```bash
   ./gradlew installLocalDebug
   ```
   `local` बिल्ड फ्लेवर `10.0.2.2` से कनेक्ट होता है (Android एमुलेटर का आपकी मशीन पर लूपबैक)। यह बस काम करता है -- कोई अतिरिक्त कॉन्फ़िगरेशन आवश्यक नहीं।

5. **भौतिक डिवाइस पर चलाएं**

   आपका फोन आपकी डेवलपमेंट मशीन के **समान Wi-Fi नेटवर्क** पर होना चाहिए।

   अ. अपनी मशीन का लोकल IP खोजें:
   ```bash
   # Windows
   ipconfig    # अपने Wi-Fi एडाप्टर के तहत "IPv4 Address" खोजें (जैसे 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # या: ip addr show
   ```

   ब. `10.0.2.2` के बजाय अपना IP उपयोग करने के लिए लोकल बिल्ड फ्लेवर अपडेट करें। `app/build.gradle.kts` में, `local` फ्लेवर खोजें और बदलें:
   ```kotlin
   // 10.0.2.2 को अपनी मशीन के लोकल IP से बदलें
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   स. अपने डिवाइस को USB से कनेक्ट करें और USB डीबगिंग सक्षम करें, फिर:
   ```bash
   ./gradlew installLocalDebug
   ```

   द. वैकल्पिक रूप से, कोई कोड बदलने से बचने के लिए **adb reverse** का उपयोग करें (डिवाइस localhost को आपकी मशीन पर रूट करता है):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore एमुलेटर
   adb reverse tcp:9099 tcp:9099   # Auth एमुलेटर
   adb reverse tcp:9000 tcp:9000   # RTDB एमुलेटर
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   `adb reverse` के साथ, लोकल फ्लेवर में डिफ़ॉल्ट `10.0.2.2` पते भौतिक डिवाइस पर भी काम करेंगे -- बिल्ड कॉन्फ़िगरेशन में कोई बदलाव की आवश्यकता नहीं।

6. **साइन इन करें**
   - सीड किए गए टेस्ट खाते के साथ ईमेल साइन-इन प्रवाह का उपयोग करें: `claude-test@shytalk.dev` / `localdev123`
   - या एक नया खाता बनाएं -- यह लोकल एमुलेटर का उपयोग करेगा
   - Google/Apple साइन-इन लोकली काम नहीं करेगा (कोई वास्तविक OAuth नहीं) -- इसके बजाय ईमेल OTP का उपयोग करें

7. **लोकल सेवाएं बंद करें**
   ```bash
   bash local/stop.sh
   ```
   या `start.sh` टर्मिनल में `Ctrl+C` दबाएं। एमुलेटर डेटा स्वचालित रूप से सहेजा जाता है और अगली बार शुरू करने पर पुनर्स्थापित किया जाता है।

### लोकल डेवलपमेंट के लिए उपयोगी URLs

| सेवा | URL | उद्देश्य |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore डेटा, Auth उपयोगकर्ता, RTDB ब्राउज़ करें |
| Express API | http://localhost:3000 | बैकएंड API |
| हेल्थ चेक | http://localhost:3000/api/health | सत्यापित करें कि API चल रही है |

### क्लाउड डेवलपमेंट (वैकल्पिक)

यदि आपको वास्तविक क्लाउड सेवाओं के विरुद्ध परीक्षण करने की आवश्यकता है (जैसे वास्तविक पुश नोटिफिकेशन, वास्तविक Google साइन-इन):

1. **Firebase सेटअप**
   - [console.firebase.google.com](https://console.firebase.google.com) पर एक Firebase प्रोजेक्ट बनाएं
   - प्रमाणीकरण में **Google साइन-इन** और **Apple साइन-इन** सक्षम करें
   - **Firestore**, **Realtime Database**, और **Cloud Messaging** सक्षम करें
   - `google-services.json` डाउनलोड करें और इसे `app/src/dev/` में रखें

2. **Express API सेटअप**
   ```bash
   cd express-api
   cp .env.example .env  # अपने क्लाउड क्रेडेंशियल्स के साथ संपादित करें
   npm install
   npm start
   ```

3. **Firestore नियम डिप्लॉय करें**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android ऐप बिल्ड करें** (dev फ्लेवर)
   ```bash
   ./gradlew assembleDevDebug
   ```

### एन्वायरनमेंट वेरिएबल्स

| वेरिएबल | विवरण | कहां |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK सर्विस अकाउंट JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 अकाउंट ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 एक्सेस की | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 सीक्रेट की | Express API |
| `R2_BUCKET_NAME` | R2 बकेट नाम (डिफ़ॉल्ट: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API की | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API सीक्रेट | Express API |
| `LIVEKIT_URL` | LiveKit सर्वर URL | Android ऐप (BuildConfig) |
| `WORKER_URL` | Express API बेस URL | Android ऐप (BuildConfig) |

## परीक्षण

| सूट | कमांड | संख्या |
|-------|---------|-------|
| Kotlin यूनिट टेस्ट | `./gradlew test` | 100+ टेस्ट |
| Express API टेस्ट | `cd express-api && npm test` | 1,540+ टेस्ट |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 फ़ीचर फ़ाइलें |
| Playwright वेब टेस्ट | `npx playwright test` | 28 स्पेक्स |

```bash
# Kotlin/KMP यूनिट टेस्ट
./gradlew test

# Express API टेस्ट
cd express-api && npm test

# E2E टेस्ट (कनेक्टेड डिवाइस या एमुलेटर की आवश्यकता है)
./gradlew connectedDevDebugAndroidTest

# Playwright ब्राउज़र टेस्ट (एडमिन पैनल चालू होना आवश्यक है)
npx playwright test
```

## डिप्लॉयमेंट

डिप्लॉयमेंट GitHub Actions वर्कफ़्लो (`.github/workflows/`) के माध्यम से प्रबंधित किए जाते हैं:

| वर्कफ़्लो | ट्रिगर | यह क्या करता है |
|----------|---------|-------------|
| **PR Checks** | `main` में PRs पर स्वचालित | लिंट, Kotlin टेस्ट, Express API टेस्ट, Playwright टेस्ट चलाता है (बदली गई फ़ाइलों के आधार पर) |
| **Deploy to Dev** | मैनुअल (`workflow_dispatch`) | Express API + वेब को dev में डिप्लॉय करता है, टेस्टर्स को APK वितरित करता है, वैकल्पिक रूप से Playwright टेस्ट चलाता है |
| **Deploy to Prod** | मैनुअल (`workflow_dispatch`) | एक टैग किया गया रिलीज़ prod में डिप्लॉय करता है -- Express API, वेब, Play Store, और App Store |

अतिरिक्त वर्कफ़्लो: **E2E Tests** (Android एमुलेटर मैट्रिक्स), **SonarCloud** (स्टैटिक एनालिसिस), **Lint**, **Backend Tests**, **Dependabot Auto-merge**।

- **Express API:** SSH + PM2 के माध्यम से Oracle Cloud VMs पर डिप्लॉय (dev: लंदन, prod: सिंगापुर)
- **Android:** CI के माध्यम से बंडल और Google Play पर अपलोड
- **iOS:** CI के माध्यम से बिल्ड और App Store Connect / TestFlight पर अपलोड
- **एडमिन पैनल / वेब:** Cloudflare Pages पर डिप्लॉय

## योगदान करना

योगदान का स्वागत है! कृपया दिशानिर्देशों के लिए [CONTRIBUTING.md](CONTRIBUTING.md) देखें।

## लाइसेंस

यह प्रोजेक्ट Apache License 2.0 के तहत लाइसेंस प्राप्त है। विवरण के लिए [LICENSE](LICENSE) देखें।

## आभार

- [Firebase](https://firebase.google.com) -- प्रमाणीकरण, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- रियल-टाइम वॉइस कम्युनिकेशन
- [Cloudflare](https://www.cloudflare.com) -- R2 स्टोरेज, Pages होस्टिंग, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API के लिए फ्री टियर VM
- [Express.js](https://expressjs.com) -- API सर्वर फ्रेमवर्क
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- आधुनिक डिक्लेरेटिव UI
- [Koin](https://insert-koin.io) -- हल्का डिपेंडेंसी इंजेक्शन
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform के लिए इमेज लोडिंग
- [Lottie](https://airbnb.design/lottie/) -- एनिमेटेड उपहार और UI प्रभाव
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- मल्टीप्लेटफ़ॉर्म दिनांक/समय
