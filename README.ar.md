# ShyTalk

**غرف الدردشة الصوتية، بمفهوم جديد.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | **العربية** | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## حول التطبيق

ShyTalk هو تطبيق دردشة صوتية اجتماعي يتيح للمستخدمين إنشاء غرف دردشة صوتية والانضمام إليها في الوقت الفعلي. تم بناؤه باستخدام Kotlin Multiplatform (KMP)، ويستهدف كلاً من Android وiOS بقاعدة شفرة مشتركة. سواء كنت ترغب في استضافة محادثة، أو الاستماع، أو التواصل مع أشخاص من جميع أنحاء العالم، فإن ShyTalk يجعل ذلك سهلاً.

## الميزات

### غرف الدردشة الصوتية
- إنشاء غرف أو الانضمام إليها مع صوت في الوقت الفعلي مدعوم من LiveKit
- نظام مقاعد منظم مع أدوار المالك والمضيف والحاضر
- طلبات المقاعد والدعوات -- اطلب الانضمام إلى مقعد أو ادعُ المستمعين للتحدث
- فقاعة عائمة -- تابع الدردشة الصوتية أثناء تصفح أجزاء أخرى من التطبيق
- انتهاء صلاحية الغرفة -- تُغلق الغرف تلقائياً عندما يكون المالك غائباً، مع مؤقتات العد التنازلي

### المراسلة
- دردشة نصية حية بجانب الصوت في كل غرفة
- مراسلة خاصة مع محادثات فردية
- دردشات جماعية مع إدارة الأعضاء والصلاحيات
- مؤشرات الكتابة في الوقت الفعلي
- دعم الملصقات

### اجتماعي
- ملفات تعريف مستخدمين قابلة للتخصيص مع صور وصور غلاف وأعلام الجنسية والسير الذاتية
- نظام المتابعة -- تابع مستخدمين آخرين وشاهد متى يكونون نشطين
- جدار الهدايا -- اعرض الهدايا المستلمة من مستخدمين آخرين
- نظام الحظر -- احظر المستخدمين عبر الغرف والملفات الشخصية

### الاقتصاد الافتراضي
- اقتصاد قائم على العملات مع محفظة وسجل المعاملات
- مكافآت تسجيل الدخول اليومية مع مكافآت السلسلة
- نظام الدوران المحظوظ (gacha) مع جوائز متدرجة
- هدايا افتراضية -- أرسل واستقبل هدايا متحركة أثناء الدردشات الصوتية
- مخزون الحقيبة لتخزين الهدايا
- حزم العملات لشراء العملات
- لافتات البث مع تأثيرات هدايا متحركة

### الحساب والهوية
- مصادقة متعددة المزودين -- سجل الدخول باستخدام Google أو Apple أو البريد الإلكتروني (OTP)
- ربط طرق تسجيل دخول متعددة بحساب واحد
- هوية مستخدم مستقرة (uniqueId) تستمر عبر مشاريع Firebase
- إدارة الحسابات المرتبطة في الإعدادات مع دعم الربط/إلغاء الربط
- ربط الجهاز -- كل جهاز مرتبط بشكل دائم بحساب واحد

### الإشراف والسلامة
- أدوات الإشراف -- كتم الصوت، طرد، نقل المقاعد، وإدارة المضيفين كمالك غرفة
- نظام الإبلاغ عن المستخدمين مع سير عمل المراجعة
- نظام التحذير والتعليق لمخالفات السياسات
- شاشات معايير المجتمع وسياسة الخصوصية وشروط الخدمة
- تدفق القبول القانوني للمستخدمين الجدد
- فرض التحديث الإجباري لإصدارات التطبيق القديمة

### شاشات البدء
- شاشات إطلاق قابلة للتكوين تُعرض عند بدء تشغيل التطبيق
- محتوى يديره المسؤولون مع خيارات الجدولة والاستهداف

### الأمان
- حماية برمز PIN للوصول إلى التطبيق
- المصادقة البيومترية -- بصمة الإصبع والتعرف على الوجه
- التحقق بكلمة مرور لمرة واحدة (OTP) للإجراءات الحساسة

### لوحة الإدارة
- لوحة إشراف قائمة على الويب في الموقع الثابت للمشروع
- إدارة المستخدمين والإشراف على المحتوى والتكوين
- إدارة القوالب والهدايا مع معاينة حية
- بث السجلات والتنبيهات في الوقت الفعلي

### ضغط الصور
- ضغط تلقائي للصور عند الرفع عبر Express API
- يقلل تكاليف التخزين وعرض النطاق الترددي مع الحفاظ على الجودة

### التدويل
- دعم 19 لغة جاهزة للاستخدام
- ترجمة كاملة لجميع النصوص الموجهة للمستخدم

### السجلات والمراقبة
- تسجيل منظم عبر Express API والتطبيقات المحمولة ولوحة الإدارة
- بث السجلات في الوقت الفعلي في لوحة الإدارة
- حظر الأجهزة والشبكات مع التطبيق التلقائي
- نظام تنبيهات للأخطاء الحرجة والشذوذ
- نشر معرف التتبع لتتبع الطلبات من البداية للنهاية

## المكدس التقني

| الطبقة | التقنية |
|-------|-----------|
| **إطار العمل** | Kotlin Multiplatform (KMP) |
| **واجهة المستخدم** | Compose Multiplatform |
| **البنية** | MVVM + Repository Pattern |
| **حقن التبعيات** | Koin |
| **المصادقة** | Firebase Authentication (Google, Apple, Email+OTP) مع نظام هوية متعدد المزودين |
| **قاعدة البيانات** | Cloud Firestore |
| **الوقت الفعلي** | Firebase Realtime Database |
| **التخزين** | Cloudflare R2 (عبر وكيل Express API) |
| **خادم API** | Express.js على Oracle Cloud Free Tier |
| **الصوت** | LiveKit |
| **الإشعارات الفورية** | Firebase Cloud Messaging |
| **تحميل الصور** | Coil 3 (KMP) |
| **الرسوم المتحركة** | Lottie Compose |
| **التاريخ/الوقت** | kotlinx-datetime |
| **التنقل** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## البنية المعمارية

يتبع ShyTalk نمط **MVVM** مع نمط **Repository** نظيف:

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

- **الوحدة المشتركة** (`commonMain`) -- النماذج، واجهات المستودعات، ViewModels، وواجهة المستخدم المشتركة عبر المنصات
- **وحدة التطبيق** -- شاشات خاصة بـ Android، تطبيقات المستودعات، ونقطة الدخول
- **وحدة iosApp** -- نقطة الدخول الخاصة بـ iOS
- **express-api** -- واجهة خلفية Express.js تعمل على Oracle Cloud Free Tier

## هيكل المشروع

```
ShyTalk/
+-- app/                              # وحدة تطبيق Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # نقطة دخول التطبيق
|       |   +-- MainActivity.kt       # النشاط الرئيسي
|       |   +-- core/
|       |   |   +-- di/               # وحدة Koin DI
|       |   |   +-- room/             # ActiveRoomManager و RoomService
|       |   +-- data/
|       |   |   +-- remote/           # صوت LiveKit، الحضور، الإشعارات
|       |   |   +-- repository/       # تطبيقات المستودعات
|       |   +-- feature/
|       |   |   +-- auth/             # شاشة تسجيل الدخول بـ Google
|       |   |   +-- profile/          # شاشة الملف الشخصي
|       |   |   +-- room/             # شاشة الغرفة
|       |   |   +-- settings/         # إعدادات التطبيق
|       |   +-- navigation/           # NavGraph ومسارات الشاشات
|       +-- test/                     # اختبارات الوحدة
|       +-- androidTest/              # اختبارات E2E (Compose UI Test)
+-- shared/                           # وحدة KMP المشتركة
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # وحدات Koin المشتركة
|       |   +-- model/                # نماذج البيانات (User, ChatRoom, Gift، إلخ)
|       |   +-- ui/                   # المكونات المشتركة
|       |   +-- util/                 # الأدوات والثوابت
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService، إلخ
|       |   +-- repository/           # واجهات المستودعات
|       +-- feature/                  # وحدات الميزات المشتركة
+-- iosApp/                           # وحدة تطبيق iOS
+-- express-api/                      # خادم Express.js API
|   +-- src/
|       +-- routes/                   # معالجات مسارات API
|       +-- middleware/               # المصادقة، وسيط التسجيل
|       +-- utils/                    # Firebase Admin, R2, المسجل
|       +-- cron/                     # المهام المجدولة
+-- public/                           # الموقع الثابت ولوحة الإدارة
+-- local/                            # بيئة التطوير المحلية (المحاكيات، بيانات البذر)
+-- tests/web/                        # اختبارات متصفح Playwright
+-- scripts/                          # سكريبتات الأدوات
+-- .github/workflows/                # CI/CD (فحوصات PR، النشر إلى Dev/Prod، E2E، فحص الشفرة)
+-- firestore.rules                   # قواعد أمان Firestore
+-- database.rules.json               # قواعد أمان RTDB
+-- firestore.indexes.json            # فهارس Firestore المركبة
+-- firebase.json                     # تكوين Firebase
```

## البدء

### المتطلبات الأساسية

- **Android Studio** Ladybug أو أحدث
- **JDK 17+**
- **Node.js 24+**
- **Docker** (لخادم LiveKit المحلي)
- **Firebase CLI** (`npm install -g firebase-tools`)

### التطوير المحلي (موصى به)

أسرع طريقة للبدء. يستخدم محاكيات Firebase وحاوية LiveKit Docker محلية -- لا حاجة لحسابات سحابية، بدون تكاليف، بدون حدود حصص.

1. **الاستنساخ والتثبيت**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **بدء الخدمات المحلية**
   ```bash
   bash local/start.sh
   ```
   يقوم هذا بتشغيل محاكيات Firebase (Firestore, Auth, RTDB) وحاوية LiveKit Docker. عند التشغيل الأول يقوم تلقائياً ببذر بيانات الاختبار (مستخدم مسؤول، هدايا نموذجية، التكوين).

   سترى:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **بدء Express API** (في نافذة طرفية جديدة)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # عدّل قيم R2/SMTP إذا لزم الأمر
   npm run local
   ```
   تبدأ واجهة API على `http://localhost:3000`. للاختبار: `curl http://localhost:3000/api/health`

4. **التشغيل على محاكي Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   يتصل نكهة بناء `local` بـ `10.0.2.2` (الاسترجاع الداخلي لمحاكي Android إلى جهازك). يعمل مباشرة -- لا حاجة لتكوين إضافي.

5. **التشغيل على جهاز حقيقي**

   يجب أن يكون هاتفك على **نفس شبكة Wi-Fi** مثل جهاز التطوير الخاص بك.

   أ. ابحث عن عنوان IP المحلي لجهازك:
   ```bash
   # Windows
   ipconfig    # ابحث عن "IPv4 Address" تحت محول Wi-Fi الخاص بك (مثلاً 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # أو: ip addr show
   ```

   ب. حدّث نكهة البناء المحلية لاستخدام عنوان IP الخاص بك بدلاً من `10.0.2.2`. في `app/build.gradle.kts`، ابحث عن نكهة `local` وغيّر:
   ```kotlin
   // استبدل 10.0.2.2 بعنوان IP المحلي لجهازك
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   ج. وصّل جهازك عبر USB وفعّل تصحيح USB، ثم:
   ```bash
   ./gradlew installLocalDebug
   ```

   د. بدلاً من ذلك، استخدم **adb reverse** لتجنب تغيير أي شفرة (يوجه الجهاز localhost إلى جهازك):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # محاكي Firestore
   adb reverse tcp:9099 tcp:9099   # محاكي Auth
   adb reverse tcp:9000 tcp:9000   # محاكي RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   مع `adb reverse`، ستعمل عناوين `10.0.2.2` الافتراضية في نكهة local على الجهاز الحقيقي أيضاً -- لا حاجة لتغيير تكوين البناء.

6. **تسجيل الدخول**
   - استخدم تدفق تسجيل الدخول بالبريد الإلكتروني مع حساب الاختبار المبذور: `claude-test@shytalk.dev` / `localdev123`
   - أو أنشئ حساباً جديداً -- سيستخدم المحاكيات المحلية
   - لن يعمل تسجيل الدخول بـ Google/Apple محلياً (لا يوجد OAuth حقيقي) -- استخدم OTP بالبريد الإلكتروني بدلاً من ذلك

7. **إيقاف الخدمات المحلية**
   ```bash
   bash local/stop.sh
   ```
   أو اضغط `Ctrl+C` في نافذة `start.sh`. يتم حفظ بيانات المحاكي تلقائياً واستعادتها عند البدء التالي.

### عناوين URL مفيدة للتطوير المحلي

| الخدمة | الرابط | الغرض |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | تصفح بيانات Firestore ومستخدمي Auth وRTDB |
| Express API | http://localhost:3000 | واجهة API الخلفية |
| فحص الصحة | http://localhost:3000/api/health | التحقق من أن API يعمل |

### التطوير السحابي (اختياري)

إذا كنت بحاجة للاختبار مع خدمات سحابية حقيقية (مثل الإشعارات الفورية الحقيقية، تسجيل الدخول الحقيقي بـ Google):

1. **إعداد Firebase**
   - أنشئ مشروع Firebase في [console.firebase.google.com](https://console.firebase.google.com)
   - فعّل **تسجيل الدخول بـ Google** و**تسجيل الدخول بـ Apple** في المصادقة
   - فعّل **Firestore** و**Realtime Database** و**Cloud Messaging**
   - حمّل `google-services.json` وضعه في `app/src/dev/`

2. **إعداد Express API**
   ```bash
   cd express-api
   cp .env.example .env  # عدّل ببيانات اعتمادك السحابية
   npm install
   npm start
   ```

3. **نشر قواعد Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **بناء تطبيق Android** (نكهة dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### متغيرات البيئة

| المتغير | الوصف | الموقع |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | حساب خدمة Firebase Admin SDK بصيغة JSON | Express API |
| `R2_ACCOUNT_ID` | معرف حساب Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | مفتاح وصول R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | مفتاح R2 السري | Express API |
| `R2_BUCKET_NAME` | اسم حاوية R2 (الافتراضي: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | مفتاح LiveKit API | Express API |
| `LIVEKIT_API_SECRET` | سر LiveKit API | Express API |
| `LIVEKIT_URL` | رابط خادم LiveKit | تطبيق Android (BuildConfig) |
| `WORKER_URL` | رابط قاعدة Express API | تطبيق Android (BuildConfig) |

## الاختبار

| المجموعة | الأمر | العدد |
|-------|---------|-------|
| اختبارات Kotlin الوحدوية | `./gradlew test` | أكثر من 100 اختبار |
| اختبارات Express API | `cd express-api && npm test` | أكثر من 1,540 اختبار |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 ملف ميزة |
| اختبارات Playwright للويب | `npx playwright test` | 28 مواصفة |

```bash
# اختبارات Kotlin/KMP الوحدوية
./gradlew test

# اختبارات Express API
cd express-api && npm test

# اختبارات E2E (تتطلب جهازاً متصلاً أو محاكي)
./gradlew connectedDevDebugAndroidTest

# اختبارات متصفح Playwright (تتطلب لوحة الإدارة قيد التشغيل)
npx playwright test
```

## النشر

تتم إدارة عمليات النشر من خلال سير عمل GitHub Actions (`.github/workflows/`):

| سير العمل | المشغل | ما يفعله |
|----------|---------|-------------|
| **PR Checks** | تلقائي على PRs إلى `main` | يشغل فحص الشفرة، اختبارات Kotlin، اختبارات Express API، اختبارات Playwright (بناءً على الملفات المتغيرة) |
| **Deploy to Dev** | يدوي (`workflow_dispatch`) | ينشر Express API + الويب إلى dev، يوزع APK على المختبرين، يشغل اختبارات Playwright اختيارياً |
| **Deploy to Prod** | يدوي (`workflow_dispatch`) | ينشر إصداراً موسوماً إلى prod -- Express API، الويب، Play Store، وApp Store |

سير عمل إضافية: **E2E Tests** (مصفوفة محاكيات Android)، **SonarCloud** (تحليل ثابت)، **Lint**، **Backend Tests**، **Dependabot Auto-merge**.

- **Express API:** يُنشر على أجهزة Oracle Cloud الافتراضية عبر SSH + PM2 (dev: لندن، prod: سنغافورة)
- **Android:** يُحزم ويُرفع إلى Google Play عبر CI
- **iOS:** يُبنى ويُرفع إلى App Store Connect / TestFlight عبر CI
- **لوحة الإدارة / الويب:** يُنشر على Cloudflare Pages

## المساهمة

المساهمات مرحب بها! يرجى الاطلاع على [CONTRIBUTING.md](CONTRIBUTING.md) للإرشادات.

## الترخيص

هذا المشروع مرخص بموجب رخصة Apache 2.0. انظر [LICENSE](LICENSE) للتفاصيل.

## شكر وتقدير

- [Firebase](https://firebase.google.com) -- المصادقة، Firestore، Realtime Database، Cloud Messaging
- [LiveKit](https://livekit.io) -- الاتصال الصوتي في الوقت الفعلي
- [Cloudflare](https://www.cloudflare.com) -- تخزين R2، استضافة Pages، CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- الطبقة المجانية للأجهزة الافتراضية لـ Express API
- [Express.js](https://expressjs.com) -- إطار عمل خادم API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- واجهة مستخدم تعريفية حديثة
- [Koin](https://insert-koin.io) -- حقن تبعيات خفيف الوزن
- [Coil](https://coil-kt.github.io/coil/) -- تحميل الصور لـ Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- تأثيرات الهدايا وواجهة المستخدم المتحركة
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- التاريخ/الوقت متعدد المنصات
