# ShyTalk

**वॉइस चैट रूम, नए अंदाज़ में।**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | **हिन्दी** | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## परिचय

ShyTalk एक सोशल वॉइस चैट ऐप है जहां उपयोगकर्ता रियल-टाइम वॉइस चैट रूम बना सकते हैं और उनमें शामिल हो सकते हैं। Kotlin Multiplatform (KMP) से निर्मित, यह एक साझा कोडबेस के साथ Android और iOS दोनों को सपोर्ट करता है। चाहे आप बातचीत होस्ट करना चाहें, सुनना चाहें, या दुनिया भर के लोगों से जुड़ना चाहें, ShyTalk इसे आसान बनाता है।

iOS एक समर्थित प्लेटफॉर्म है लेकिन यह गाइड Android डेवलपमेंट पर केंद्रित है, जो प्राथमिक डेवलपमेंट लक्ष्य है।

## सुविधाएं

### वॉइस चैट रूम
- LiveKit द्वारा संचालित रियल-टाइम वॉइस के साथ रूम बनाएं या जॉइन करें
- मालिक, होस्ट और श्रोता भूमिकाओं के साथ संरचित सीटिंग सिस्टम
- सीट अनुरोध और आमंत्रण -- सीट पर बैठने का अनुरोध करें या श्रोताओं को बोलने के लिए आमंत्रित करें
- फ्लोटिंग चैटहेड -- ऐप के अन्य भागों को ब्राउज़ करते हुए वॉइस चैट जारी रखें
- रूम समाप्ति -- मालिक की अनुपस्थिति में काउंटडाउन टाइमर के साथ रूम स्वतः बंद होते हैं

### मैसेजिंग
- हर रूम में वॉइस के साथ लाइव टेक्स्ट चैट
- 1-से-1 बातचीत के साथ प्राइवेट मैसेजिंग
- सदस्य प्रबंधन और अनुमतियों के साथ ग्रुप चैट
- रियल-टाइम टाइपिंग इंडिकेटर
- स्टिकर सपोर्ट

### सोशल
- फोटो, कवर इमेज, राष्ट्रीयता फ्लैग और बायो के साथ कस्टमाइज़ेबल यूज़र प्रोफाइल
- फॉलो सिस्टम -- अन्य उपयोगकर्ताओं को फॉलो करें और देखें कब वे एक्टिव हैं
- गिफ्ट वॉल -- अन्य उपयोगकर्ताओं से प्राप्त गिफ्ट्स दिखाएं
- ब्लॉक सिस्टम -- रूम और प्रोफाइल में उपयोगकर्ताओं को ब्लॉक करें

### वर्चुअल इकोनॉमी
- वॉलेट और ट्रांज़ैक्शन हिस्ट्री के साथ कॉइन-आधारित इकोनॉमी
- स्ट्रीक बोनस के साथ डेली लॉगिन रिवॉर्ड्स
- टियर्ड प्राइज़ के साथ लकी स्पिन (गाचा) सिस्टम
- वर्चुअल गिफ्ट्स -- वॉइस चैट के दौरान एनिमेटेड गिफ्ट्स भेजें और प्राप्त करें
- गिफ्ट्स स्टोर करने के लिए बैकपैक इन्वेंटरी
- कॉइन खरीदने के लिए कॉइन पैकेज
- एनिमेटेड गिफ्ट इफेक्ट्स के साथ ब्रॉडकास्ट बैनर

### अकाउंट और पहचान
- मल्टी-प्रोवाइडर ऑथेंटिकेशन -- Google, Apple, या ईमेल (OTP) से साइन इन करें
- एक ही अकाउंट में मल्टीपल साइन-इन मेथड लिंक करें
- स्थिर यूज़र आइडेंटिटी (uniqueId) जो Firebase प्रोजेक्ट्स में बनी रहती है
- सेटिंग्स में लिंक/अनलिंक सपोर्ट के साथ लिंक्ड अकाउंट्स मैनेजमेंट
- डिवाइस बाइंडिंग -- प्रत्येक डिवाइस स्थायी रूप से एक अकाउंट से जुड़ा होता है

### मॉडरेशन और सुरक्षा
- मॉडरेशन टूल्स -- रूम मालिक के रूप में म्यूट, किक, सीट मूव और होस्ट प्रबंधन
- रिव्यू वर्कफ्लो के साथ यूज़र रिपोर्टिंग सिस्टम
- पॉलिसी उल्लंघन के लिए चेतावनी और सस्पेंशन सिस्टम
- सामुदायिक मानक, प्राइवेसी पॉलिसी और सेवा की शर्तें स्क्रीन
- नए उपयोगकर्ताओं के लिए कानूनी स्वीकृति फ्लो
- पुरानी ऐप वर्शन के लिए फोर्स अपडेट

### स्टार्टिंग स्क्रीन
- ऐप स्टार्टअप पर दिखाई जाने वाली कॉन्फिगरेबल लॉन्च स्क्रीन
- शेड्यूलिंग और टार्गेटिंग विकल्पों के साथ एडमिन-प्रबंधित कंटेंट

### सुरक्षा
- ऐप एक्सेस के लिए PIN कोड प्रोटेक्शन
- बायोमेट्रिक ऑथेंटिकेशन -- फिंगरप्रिंट और फेस रिकग्निशन
- संवेदनशील कार्यों के लिए OTP (वन-टाइम पासवर्ड) वेरिफिकेशन

### एडमिन पैनल
- प्रोजेक्ट की स्टैटिक साइट पर वेब-बेस्ड मॉडरेशन डैशबोर्ड
- यूज़र मैनेजमेंट, कंटेंट मॉडरेशन और कॉन्फिगरेशन
- लाइव प्रीव्यू के साथ टेम्पलेट और गिफ्ट मैनेजमेंट
- रियल-टाइम लॉग स्ट्रीमिंग और अलर्टिंग

### इमेज कंप्रेशन
- Express API के माध्यम से अपलोड पर ऑटोमैटिक इमेज कंप्रेशन
- गुणवत्ता बनाए रखते हुए स्टोरेज और बैंडविड्थ लागत कम करता है

### अंतर्राष्ट्रीयकरण
- 19 भाषाएं बिल्ट-इन सपोर्ट
- सभी यूज़र-फेसिंग स्ट्रिंग्स का पूर्ण लोकलाइज़ेशन

### लॉगिंग और मॉनिटरिंग
- Express API, मोबाइल ऐप्स और एडमिन पैनल में स्ट्रक्चर्ड लॉगिंग
- एडमिन डैशबोर्ड में रियल-टाइम लॉग स्ट्रीमिंग
- ऑटोमैटिक एनफोर्समेंट के साथ डिवाइस और नेटवर्क बैनिंग
- क्रिटिकल एरर और एनोमलीज़ के लिए अलर्टिंग सिस्टम
- एंड-टू-एंड रिक्वेस्ट ट्रैकिंग के लिए Trace ID प्रोपेगेशन

## टेक स्टैक

| लेयर | टेक्नोलॉजी |
|-------|-----------|
| **फ्रेमवर्क** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **आर्किटेक्चर** | MVVM + Repository Pattern |
| **DI** | Koin |
| **ऑथेंटिकेशन** | Firebase Authentication (Google, Apple, Email+OTP) मल्टी-प्रोवाइडर आइडेंटिटी सिस्टम के साथ |
| **डेटाबेस** | Cloud Firestore |
| **रियल-टाइम** | Firebase Realtime Database |
| **स्टोरेज** | Cloudflare R2 (Express API प्रॉक्सी के माध्यम से) |
| **API सर्वर** | Express.js on Oracle Cloud Free Tier |
| **वॉइस** | LiveKit (self-hosted on Oracle Cloud) |
| **पुश नोटिफिकेशन** | Firebase Cloud Messaging |
| **इमेज लोडिंग** | Coil 3 (KMP) |
| **एनिमेशन** | Lottie Compose |
| **दिनांक/समय** | kotlinx-datetime |
| **नेविगेशन** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## आर्किटेक्चर

ShyTalk एक स्वच्छ **Repository Pattern** के साथ **MVVM** का अनुसरण करता है:

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

- **shared module** (`commonMain`) -- मॉडल, रिपॉज़िटरी इंटरफेस, ViewModels, और प्लेटफॉर्म में साझा UI
- **app module** -- Android-विशिष्ट स्क्रीन, रिपॉज़िटरी इम्प्लीमेंटेशन और एंट्री पॉइंट
- **iosApp module** -- iOS-विशिष्ट एंट्री पॉइंट
- **express-api** -- Oracle Cloud Free Tier पर चलने वाला Express.js बैकएंड

## प्रोजेक्ट संरचना

```
ShyTalk/
+-- app/                              # Android ऐप मॉड्यूल
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # एप्लिकेशन एंट्री पॉइंट
|       |   +-- MainActivity.kt       # मुख्य एक्टिविटी
|       |   +-- core/
|       |   |   +-- di/               # Koin DI मॉड्यूल
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit वॉइस, प्रेज़ेंस, नोटिफिकेशन
|       |   |   +-- repository/       # रिपॉज़िटरी इम्प्लीमेंटेशन
|       |   +-- feature/
|       |   |   +-- auth/             # Google साइन-इन स्क्रीन
|       |   |   +-- profile/          # प्रोफाइल स्क्रीन
|       |   |   +-- room/             # रूम स्क्रीन
|       |   |   +-- settings/         # ऐप सेटिंग्स
|       |   +-- navigation/           # NavGraph & स्क्रीन रूट्स
|       +-- test/                     # यूनिट टेस्ट
|       +-- androidTest/              # E2E टेस्ट (Compose UI Test)
+-- shared/                           # KMP शेयर्ड मॉड्यूल
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # शेयर्ड Koin मॉड्यूल
|       |   +-- model/                # डेटा मॉडल (User, ChatRoom, Gift, आदि)
|       |   +-- ui/                   # शेयर्ड कंपोनेंट्स
|       |   +-- util/                 # यूटिलिटीज़ & कॉन्स्टेंट्स
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, आदि
|       |   +-- repository/           # रिपॉज़िटरी इंटरफेस
|       +-- feature/                  # शेयर्ड फीचर मॉड्यूल
+-- iosApp/                           # iOS ऐप मॉड्यूल
+-- express-api/                      # Express.js API सर्वर
|   +-- src/
|       +-- routes/                   # API रूट हैंडलर
|       +-- middleware/               # ऑथ, लॉगिंग मिडलवेयर
|       +-- utils/                    # Firebase Admin, R2, लॉगर
|       +-- cron/                     # शेड्यूल्ड जॉब्स
+-- public/                           # स्टैटिक साइट & एडमिन पैनल
+-- local/                            # लोकल डेवलपमेंट एनवायरनमेंट (एमुलेटर, सीड डेटा)
+-- tests/web/                        # Playwright ब्राउज़र टेस्ट
+-- scripts/                          # यूटिलिटी स्क्रिप्ट्स
+-- .github/workflows/                # CI/CD (PR चेक्स, Dev/Prod डिप्लॉय, E2E, lint)
+-- firestore.rules                   # Firestore सिक्योरिटी रूल्स
+-- database.rules.json               # RTDB सिक्योरिटी रूल्स
+-- firestore.indexes.json            # Firestore कंपोज़िट इंडेक्स
+-- firebase.json                     # Firebase कॉन्फिगरेशन
```

## शुरुआत करें

### पूर्वापेक्षाएं

- **Android Studio** Ladybug या नया
- **JDK 21+**
- **Node.js 24+**
- **Docker** (LiveKit वॉइस सर्वर, MinIO स्टोरेज, Mailpit ईमेल के लिए)
- **Firebase CLI** (`npm install -g firebase-tools`)

शुरू करने के लिए किसी क्लाउड अकाउंट की आवश्यकता नहीं है -- लोकल एनवायरनमेंट पूरी तरह ऑफलाइन चलता है।

### लोकल डेवलपमेंट (अनुशंसित)

शुरू करने का सबसे तेज़ तरीका। एक कमांड सब कुछ शुरू करती है -- Firebase एमुलेटर, Docker कंटेनर, Express API, और Android ऐप बिल्ड करती है। कोई क्लाउड अकाउंट नहीं, कोई लागत नहीं, कोई कोटा सीमा नहीं।

1. **क्लोन और इंस्टॉल करें**
   ```bash
   git clone https://github.com/Shyden-Ltd/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **सब कुछ शुरू करें**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   यह एकल कमांड:
   - Docker कंटेनर शुरू करती है (LiveKit वॉइस सर्वर, MinIO स्टोरेज, Mailpit ईमेल)
   - Firebase एमुलेटर शुरू करती है (Firestore, Auth, RTDB)
   - टेस्ट डेटा सीड करती है और MinIO स्टोरेज बकेट बनाती है
   - Express API शुरू करती है
   - Android ऐप बिल्ड और इंस्टॉल करती है (यदि कोई डिवाइस कनेक्ट है)

   तैयार होने पर, आप देखेंगे:
   ```
   Local environment ready (fully offline):

     Services:
       Firebase UI:    http://localhost:4000
       Express API:    http://localhost:3000
       Mailpit UI:     http://localhost:8025
       MinIO Console:  http://localhost:9001
       LiveKit:        localhost:7880

     Credentials:
       Test admin:     claude-test@shytalk.dev / localdev123
       Test user:      user@test.com / localdev123
       MinIO:          minioadmin / minioadmin
   ```

3. **साइन इन करें**
   - सीडेड टेस्ट अकाउंट के साथ ईमेल साइन-इन फ्लो का उपयोग करें: `claude-test@shytalk.dev` / `localdev123`
   - या नया अकाउंट बनाएं -- यह लोकल एमुलेटर का उपयोग करेगा
   - Google/Apple साइन-इन लोकली काम नहीं करेगा (कोई असली OAuth नहीं) -- इसके बजाय ईमेल OTP का उपयोग करें
   - OTP कोड Mailpit द्वारा कैप्चर किए जाते हैं -- http://localhost:8025 चेक करें

4. **फिजिकल डिवाइस पर चलाएं**

   आपका फोन आपकी डेवलपमेंट मशीन के **समान Wi-Fi नेटवर्क** पर होना चाहिए।

   a. अपनी मशीन का लोकल IP खोजें:
   ```bash
   # Windows
   ipconfig    # अपने Wi-Fi अडैप्टर के तहत "IPv4 Address" देखें (जैसे 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # या: ip addr show
   ```

   b. `10.0.2.2` के बजाय अपना IP उपयोग करने के लिए लोकल बिल्ड फ्लेवर अपडेट करें। `app/build.gradle.kts` में `local` फ्लेवर खोजें और बदलें:
   ```kotlin
   // 10.0.2.2 को अपनी मशीन के लोकल IP से बदलें
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. अपने डिवाइस को USB से कनेक्ट करें और USB डीबगिंग सक्षम करें, फिर:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. वैकल्पिक रूप से, कोड बदलने से बचने के लिए **adb reverse** का उपयोग करें (डिवाइस localhost को आपकी मशीन पर रूट करता है):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore एमुलेटर
   adb reverse tcp:9099 tcp:9099   # Auth एमुलेटर
   adb reverse tcp:9000 tcp:9000   # RTDB एमुलेटर
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (इमेज स्टोरेज)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   `adb reverse` के साथ, लोकल फ्लेवर में डिफॉल्ट `10.0.2.2` एड्रेस फिजिकल डिवाइस पर भी काम करेंगे -- बिल्ड कॉन्फिग में कोई बदलाव आवश्यक नहीं।

5. **लोकल सर्विसेज बंद करें**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   या स्टार्ट स्क्रिप्ट टर्मिनल में `Ctrl+C` दबाएं। एमुलेटर डेटा ऑटोमैटिकली सेव होता है और अगले स्टार्ट पर रिस्टोर होता है।

### उपयोगी लोकल डेव URLs

| सर्विस | URL | उद्देश्य |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore डेटा, Auth यूज़र, RTDB ब्राउज़ करें |
| Express API | http://localhost:3000 | बैकएंड API |
| Health check | http://localhost:3000/api/health | API चल रही है यह सत्यापित करें |
| Mailpit | http://localhost:8025 | कैप्चर्ड ईमेल और OTP कोड देखें |
| MinIO Console | http://localhost:9001 | अपलोड की गई इमेज और फाइलें ब्राउज़ करें |

### वैकल्पिक सर्विसेज

**LibreTranslate (मैसेज ट्रांसलेशन)**

ट्रांसलेशन फीचर को लोकली टेस्ट करने के लिए वैकल्पिक 6GB+ Docker इमेज:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
बड़े इमेज साइज़ के कारण डिफॉल्ट सेटअप में शामिल नहीं। ट्रांसलेशन इसके बिना भी काम करता है -- मैसेज बस अनट्रांसलेटेड रहते हैं।

### क्लाउड डेवलपमेंट (वैकल्पिक)

यदि आपको असली क्लाउड सर्विसेज के साथ टेस्ट करना है (जैसे असली पुश नोटिफिकेशन, असली Google साइन-इन):

1. **Firebase सेटअप**
   - [console.firebase.google.com](https://console.firebase.google.com) पर Firebase प्रोजेक्ट बनाएं
   - Authentication में **Google साइन-इन** और **Apple साइन-इन** सक्षम करें
   - **Firestore**, **Realtime Database** और **Cloud Messaging** सक्षम करें
   - `google-services.json` डाउनलोड करें और `app/src/dev/` में रखें

2. **Express API सेटअप**
   ```bash
   cd express-api
   cp .env.example .env  # अपने क्लाउड क्रेडेंशियल्स से एडिट करें
   npm install
   npm start
   ```

3. **Firestore रूल्स डिप्लॉय करें**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android ऐप बिल्ड करें** (dev फ्लेवर)
   ```bash
   ./gradlew assembleDevDebug
   ```

### एनवायरनमेंट वेरिएबल्स

| वेरिएबल | विवरण | कहां |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK सर्विस अकाउंट JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 अकाउंट ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 एक्सेस की | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 सीक्रेट की | Express API |
| `R2_BUCKET_NAME` | R2 बकेट नाम (डिफॉल्ट: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | LiveKit API की (एशिया/सिंगापुर) | Express API |
| `LIVEKIT_SECRET_ASIA` | LiveKit API सीक्रेट (एशिया/सिंगापुर) | Express API |
| `LIVEKIT_URL_ASIA` | LiveKit सर्वर URL (एशिया) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | LiveKit API की (EU/लंदन) | Express API |
| `LIVEKIT_SECRET_EU` | LiveKit API सीक्रेट (EU/लंदन) | Express API |
| `LIVEKIT_URL_EU` | LiveKit सर्वर URL (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | LiveKit API की (फॉलबैक जब क्षेत्रीय कीज़ सेट नहीं हैं) | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API सीक्रेट (फॉलबैक जब क्षेत्रीय कीज़ सेट नहीं हैं) | Express API |
| `LIVEKIT_URL` | LiveKit सर्वर URL (Android ऐप में बिल्ड टाइम पर एम्बेड) | Android ऐप (BuildConfig) |
| `WORKER_URL` | Express API बेस URL | Android ऐप (BuildConfig) |

## टेस्टिंग

### लोकली टेस्ट चलाएं

```bash
# इंटरैक्टिव टेस्ट मेनू (चुनें क्या चलाना है):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# या इंडिविजुअल सूट्स चलाएं:
bash local/test-unit.sh       # Kotlin + Express API यूनिट टेस्ट
bash local/test-playwright.sh # Playwright वेब टेस्ट (लोकल एन्व चाहिए)
bash local/test-e2e.sh        # Android E2E टेस्ट (लोकल एन्व + डिवाइस चाहिए)
bash local/test-lint.sh       # ktlint + ESLint

# Allure टेस्ट रिपोर्ट देखें:
npx allure serve allure-results
```

### टेस्ट सूट्स

| सूट | कमांड | संख्या |
|-------|---------|-------|
| Kotlin यूनिट टेस्ट | `./gradlew test` | 100+ टेस्ट |
| Express API टेस्ट | `cd express-api && npm test` | 1,540+ टेस्ट |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 फीचर फाइलें |
| Playwright वेब टेस्ट | `npx playwright test` | 28 स्पेक्स |

```bash
# Kotlin/KMP यूनिट टेस्ट
./gradlew test

# Express API टेस्ट
cd express-api && npm test

# E2E टेस्ट (कनेक्टेड डिवाइस या एमुलेटर चाहिए)
./gradlew connectedDevDebugAndroidTest

# Playwright ब्राउज़र टेस्ट (एडमिन पैनल चलना चाहिए)
npx playwright test
```

### CI में टेस्टिंग

CI में, Playwright और Android E2E टेस्ट उसी लोकल एनवायरनमेंट (एमुलेटर + Docker) के विरुद्ध चलते हैं -- कोई क्लाउड सर्विसेज उपयोग नहीं होती। यह सुनिश्चित करता है कि टेस्ट कभी भी लाइव टेस्टर्स में हस्तक्षेप न करें।

## समस्या निवारण

- **पोर्ट पहले से उपयोग में**: `lsof -i :<port>` (Linux/macOS) या `netstat -ano | findstr :<port>` (Windows) से पता करें कि पोर्ट क्या उपयोग कर रहा है।
- **Docker नहीं चल रहा**: सुनिश्चित करें कि Docker Desktop शुरू है। सत्यापित करने के लिए `docker ps` चलाएं।
- **Firebase एमुलेटर शुरू नहीं होते**: Java 21+ आवश्यक है। `java -version` से जांचें।
- **Android बिल्ड फेल होता है**: सुनिश्चित करें कि JDK 21+ और Android SDK इंस्टॉल हैं। `./gradlew clean` आज़माएं।
- **adb डिवाइस नहीं दिखता**: USB डीबगिंग सक्षम करें। जांचने के लिए `adb devices` चलाएं।
- **इमेज लोड नहीं होतीं**: MinIO बकेट शायद नहीं बना। `cd express-api && NODE_ENV=local node ../local/seed.js` चलाएं। फिजिकल डिवाइस के लिए, `adb reverse tcp:9002 tcp:9002` चलाएं।
- **OTP नहीं आ रहा**: कंसोल आउटपुट में `[OTP-LOCAL]` लाइनें चेक करें। http://localhost:8025 पर Mailpit UI भी चेक करें।
- **एमुलेटर डेटा रीसेट करें**: `local/firebase-emulator-data/` डायरेक्टरी हटाएं और रीस्टार्ट करें।
- **MinIO डेटा रीसेट करें**: वॉल्यूम हटाने के लिए `docker compose -f local/docker-compose.yml down -v` चलाएं।

## डिप्लॉयमेंट

डिप्लॉयमेंट GitHub Actions वर्कफ्लो (`.github/workflows/`) के माध्यम से प्रबंधित होते हैं:

| वर्कफ्लो | ट्रिगर | क्या करता है |
|----------|---------|-------------|
| **PR Checks** | `main` के PRs पर ऑटोमैटिक | lint, Kotlin टेस्ट, Express API टेस्ट, Playwright टेस्ट चलाता है (बदली गई फाइलों के आधार पर) |
| **Deploy to Dev** | मैनुअल (`workflow_dispatch`) | Express API + web को dev पर डिप्लॉय करता है, टेस्टर्स को APK वितरित करता है, वैकल्पिक रूप से Playwright टेस्ट चलाता है |
| **Deploy to Prod** | मैनुअल (`workflow_dispatch`) | टैग की गई रिलीज़ को prod पर डिप्लॉय करता है -- Express API, web, Play Store और App Store |

अतिरिक्त वर्कफ्लो: **E2E Tests** (Android एमुलेटर मैट्रिक्स), **SonarCloud** (स्टैटिक एनालिसिस), **Lint**, **Backend Tests**, **Dependabot Auto-merge**।

- **Express API:** SSH + PM2 के माध्यम से Oracle Cloud VMs पर डिप्लॉय (dev: लंदन, prod: सिंगापुर)
- **Android:** CI के माध्यम से बंडल और Google Play पर अपलोड
- **iOS:** CI के माध्यम से बिल्ड और App Store Connect / TestFlight पर अपलोड
- **एडमिन पैनल / web:** Cloudflare Pages पर डिप्लॉय

## योगदान करें

योगदान का स्वागत है! दिशानिर्देशों के लिए कृपया [CONTRIBUTING.md](CONTRIBUTING.md) देखें।

## लाइसेंस

यह प्रोजेक्ट Apache License 2.0 के तहत लाइसेंस प्राप्त है। विवरण के लिए [LICENSE](LICENSE) देखें।

## आभार

- [Firebase](https://firebase.google.com) -- ऑथेंटिकेशन, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- रियल-टाइम वॉइस कम्युनिकेशन
- [Cloudflare](https://www.cloudflare.com) -- R2 स्टोरेज, Pages होस्टिंग, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API के लिए फ्री टियर VM
- [Express.js](https://expressjs.com) -- API सर्वर फ्रेमवर्क
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- मॉडर्न डिक्लेरेटिव UI
- [Koin](https://insert-koin.io) -- लाइटवेट डिपेंडेंसी इंजेक्शन
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform के लिए इमेज लोडिंग
- [Lottie](https://airbnb.design/lottie/) -- एनिमेटेड गिफ्ट और UI इफेक्ट्स
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- मल्टीप्लेटफॉर्म दिनांक/समय
