# ShyTalk

**Голосові чат-кімнати, переосмислені.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | **Українська** | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Про додаток

ShyTalk — соціальний додаток для голосового чату, де користувачі можуть створювати та приєднуватися до кімнат чату в реальному часі. Побудований на Kotlin Multiplatform (KMP), він працює як на Android, так і на iOS з загальною кодовою базою. Незалежно від того, хочете ви провести розмову, прослухати або зв'язатися з людьми з усього світу, ShyTalk робить це легко.

iOS — підтримувана платформа, але цей посібник сфокусований на розробці для Android, що є основною метою розробки.

## Особливості

### Голосові кімнати чату
- Створення або приєднання до кімнат з голосом у реальному часі за допомогою LiveKit
- Структурована система посадочних місць з ролями власника, ведучого та учасника
- Запити на місця та запрошення — попросіть місце або запросіть слухачів говорити
- Плаваючий чатхед — продовжуйте голосовий чат під час перегляду інших частин додатку
- Закінчення кімнати — кімнати автоматично закриваються, коли власник відсутній, з таймерами зворотного відліку

### Обмін повідомленнями
- Прямий текстовий чат поряд із голосом у кожній кімнаті
- Приватна переписка з 1-на-1 розмовами
- Групові чати з управлінням членами та дозволами
- Індикатори введення в реальному часі
- Підтримка наклейок

### Соціальні функції
- Налаштовувані профілі користувачів з фотографіями, зображеннями обкладинок, прапорами країн та біографіями
- Система слідування — слідкуйте за іншими користувачами та бачте, коли вони активні
- Стіна подарунків — покажіть подарунки, отримані від інших користувачів
- Система блокування — блокуйте користувачів у кімнатах і профілях

### Віртуальна економіка
- Монетна економіка з гаманцем та історією транзакцій
- Щоденні винагороди за вхід зі стрик-бонусами
- Lucky Spin (gacha) система з багаторівневими призами
- Віртуальні подарунки — відправляйте та отримуйте анімовані подарунки під час голосового чату
- Інвентар рюкзака для зберігання подарунків
- Пакети монет для покупки монет
- Рекламні банери з анімованими ефектами подарунків

### Акаунт та ідентичність
- Багатопровайдерна аутентифікація — вхід за допомогою Google, Apple або Email (OTP)
- Посилання кількох методів входу на один акаунт
- Стабільна ідентичність користувача (uniqueId), яка зберігається між проектами Firebase
- Управління пов'язаними акаунтами в параметрах із підтримкою посилання/розпосилання
- Прив'язка пристрою — кожен пристрій постійно пов'язаний з одним акаунтом

### Модерація та безпека
- Інструменти модерації — приглушення, виключення, переміщення місць та управління ведучими як власник кімнати
- Система звітування користувачів з робочим процесом перегляду
- Система попередження та призупинення за порушення політики
- Екрани стандартів спільноти, політики конфіденційності та умов обслуговування
- Юридичний процес прийняття для нових користувачів
- Примусове оновлення для застарілих версій додатку

### Запуск екранів
- Налаштовувані екрани запуску, показані при запуску додатку
- Контент, керований адміністратором, з опціями планування та спрямування

### Безпека
- PIN-захист доступу до додатку
- Біометрична аутентифікація — відбитки пальців та розпізнавання облич
- OTP (одноразовий пароль) для чутливих операцій

### Панель адміністратора
- Веб-базована інформаційна панель модерації на статичному сайті проекту
- Управління користувачами, модерація контенту та конфігурація
- Управління шаблонами та подарунками з живим переглядом
- Потокова трансляція логів у реальному часі та оповіщення

### Стиснення зображень
- Автоматичне стиснення зображень при завантаженні через Express API
- Зменшує витрати на зберігання та пропускну спроможність, зберігаючи якість

### Інтернаціоналізація
- 19 мов підтримуються «з коробки»
- Повна локалізація для всіх рядків користувача

### Логування та моніторинг
- Структурованого логування у Express API, мобільних додатках та панелі адміністратора
- Потокова трансляція логів у реальному часі на інформаційній панелі адміністратора
- Блокування пристроїв та мереж з автоматичним застосуванням
- Система оповіщень для критичних помилок та аномалій
- РозповсюдженняTrace ID для наскрізного відстеження запитів

## Технологічний стек

| Шар | Технологія |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Google, Apple, Email+OTP) with multi-provider identity system |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database |
| **Storage** | Cloudflare R2 (via Express API proxy) |
| **API Server** | Express.js on Oracle Cloud Free Tier |
| **Voice** | LiveKit (self-hosted on Oracle Cloud) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Архітектура

ShyTalk дотримується **MVVM** з чистим **Repository Pattern**:

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

- **shared module** (`commonMain`) — моделі, інтерфейси репозиторію, ViewModels та UI, спільні для всіх платформ
- **app module** — екрани, специфічні для Android, реалізація репозиторію та точка входу
- **iosApp module** — точка входу, специфічна для iOS
- **express-api** — бекенд Express.js, що працює на Oracle Cloud Free Tier

## Структура проекту

```
ShyTalk/
+-- app/                              # Android app module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Application entry point
|       |   +-- MainActivity.kt       # Main activity
|       |   +-- core/
|       |   |   +-- di/               # Koin DI module
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # Repository implementations
|       |   +-- feature/
|       |   |   +-- auth/             # Google Sign-In screen
|       |   |   +-- profile/          # Profile screen
|       |   |   +-- room/             # Room screen
|       |   |   +-- settings/         # App settings
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # Unit tests
|       +-- androidTest/              # E2E tests (Compose UI Test)
+-- shared/                           # KMP shared module
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Shared Koin modules
|       |   +-- model/                # Data models (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Shared components
|       |   +-- util/                 # Utilities & constants
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Repository interfaces
|       +-- feature/                  # Shared feature modules
+-- iosApp/                           # iOS app module
+-- express-api/                      # Express.js API server
|   +-- src/
|       +-- routes/                   # API route handlers
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Scheduled jobs
+-- public/                           # Static site & admin panel
+-- local/                            # Local development environment (emulators, seed data)
+-- tests/web/                        # Playwright browser tests
+-- scripts/                          # Utility scripts
+-- .github/workflows/                # CI/CD (PR Checks, Deploy to Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestore security rules
+-- database.rules.json               # RTDB security rules
+-- firestore.indexes.json            # Firestore composite indexes
+-- firebase.json                     # Firebase configuration
```

## Початок роботи

### Передумови

- **Android Studio** Ladybug або новіша
- **JDK 21+**
- **Node.js 24+**
- **Docker** (для сервера голосу LiveKit, сховища MinIO, Mailpit email)
- **Firebase CLI** (`npm install -g firebase-tools`)

Для початку роботи не потрібні облікові записи в хмарі — локальне середовище працює повністю в автономному режимі.

### Локальна розробка (рекомендується)

Найшвидший спосіб розпочати. Однією командою запускається все — Firebase Emulators, контейнери Docker, Express API та збирається додаток Android. Не потрібні облікові записи в хмарі, без витрат, без обмежень квоти.

1. **Клонування та установка**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Запуск всього**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Ця однієї команди:
   - Запускає контейнери Docker (сервер голосу LiveKit, сховище MinIO, Mailpit email)
   - Запускає Firebase Emulators (Firestore, Auth, RTDB)
   - Насичує тестові дані та створює сховище MinIO bucket
   - Запускає Express API
   - Збирає та встановлює додаток Android (якщо пристрій підключений)

   Коли готово, ви побачите:
   ```
   Local environment ready (fully offline):

     Сервіси:
       Firebase UI:    http://localhost:4000
       Express API:    http://localhost:3000
       Mailpit UI:     http://localhost:8025
       MinIO Console:  http://localhost:9001
       LiveKit:        localhost:7880

     Облікові дані:
       Test admin:     claude-test@shytalk.dev / localdev123
       Test user:      user@test.com / localdev123
       MinIO:          minioadmin / minioadmin
   ```

3. **Вхід**
   - Використовуйте потік входу електронної пошти з насіченим тестовим акаунтом: `claude-test@shytalk.dev` / `localdev123`
   - Або створіть новий акаунт — він використовуватиме локальні емулятори
   - Вхід Google/Apple не працює локально (без реального OAuth) — замість цього використовуйте электронну пошту OTP
   - Коди OTP захоплюються Mailpit — перевірте http://localhost:8025

4. **Запуск на фізичному пристрої**

   Ваш телефон повинен бути на **тій же мережі Wi-Fi**, що і ваш комп'ютер розробки.

   a. Знайдіть локальну IP вашого комп'ютера:
   ```bash
   # Windows
   ipconfig    # Look for "IPv4 Address" under your Wi-Fi adapter (e.g. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # or: ip addr show
   ```

   b. Оновіть локальний смак збірки, щоб використовувати вашу IP-адресу замість `10.0.2.2`. У `app/build.gradle.kts`, знайдіть смак `local` та змініть:
   ```kotlin
   // Replace 10.0.2.2 with your machine's local IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Підключіть пристрій через USB та увімкніть налагодження USB, потім:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Альтернативно, використовуйте **adb reverse**, щоб уникнути змін коду (пристрій маршрутизує localhost на ваш комп'ютер):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (image storage)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   З `adb reverse`, стандартні адреси `10.0.2.2` у локальному смаку також працюватимуть на фізичному пристрої — змінювати конфігурацію збірки не потрібно.

5. **Зупинка локальних сервісів**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Або натисніть `Ctrl+C` у терміналі сценарію запуску. Дані емулятора автоматично зберігаються та відновлюються при наступному запуску.

### Корисні URL локальної розробки

| Сервіс | URL | Мета |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Переглядайте дані Firestore, користувачів Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Перевірте, чи працює API |
| Mailpit | http://localhost:8025 | Переглядайте захоплені електронні листи та коди OTP |
| MinIO Console | http://localhost:9001 | Переглядайте завантажені зображення та файли |

### Додаткові послуги

**LibreTranslate (Message Translation)**

Додатковий образ Docker розміром 6GB+ для локального тестування функції перекладу:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Не включено в стандартний набір через великий розмір образу. Переклад працює без нього — повідомлення просто залишаються невідкладеними.

### Розробка в хмарі (додатково)

Якщо вам потрібно протестувати проти реальних хмарних послуг (наприклад, реальні push-сповіщення, реальний вхід Google):

1. **Налаштування Firebase**
   - Створіть проект Firebase на [console.firebase.google.com](https://console.firebase.google.com)
   - Увімкніть **Google Sign-In** та **Apple Sign-In** в Аутентифікації
   - Увімкніть **Firestore**, **Realtime Database** та **Cloud Messaging**
   - Завантажте `google-services.json` та розмістіть його в `app/src/dev/`

2. **Налаштування Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edit with your cloud credentials
   npm install
   npm start
   ```

3. **Розгортання правил Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Побудуйте додаток Android** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Змінні середовища

| Змінна | Опис | Де |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 access key | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | Express API |
| `R2_BUCKET_NAME` | R2 bucket name (default: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | LiveKit API key (Asia/Singapore) | Express API |
| `LIVEKIT_SECRET_ASIA` | LiveKit API secret (Asia/Singapore) | Express API |
| `LIVEKIT_URL_ASIA` | LiveKit server URL (Asia) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | LiveKit API key (EU/London) | Express API |
| `LIVEKIT_SECRET_EU` | LiveKit API secret (EU/London) | Express API |
| `LIVEKIT_URL_EU` | LiveKit server URL (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | API-ключ LiveKit (резервний, коли регіональні ключі не задані) | Express API |
| `LIVEKIT_API_SECRET` | API-секрет LiveKit (резервний, коли регіональні ключі не задані) | Express API |
| `LIVEKIT_URL` | URL сервера LiveKit (вбудовується в Android-додаток під час збірки) | Android app (BuildConfig) |
| `WORKER_URL` | Express API base URL | Android app (BuildConfig) |

## Тестування

### Запуск тестів локально

```bash
# Interactive test menu (choose what to run):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Or run individual suites:
bash local/test-unit.sh       # Kotlin + Express API unit tests
bash local/test-playwright.sh # Playwright web tests (needs local env)
bash local/test-e2e.sh        # Android E2E tests (needs local env + device)
bash local/test-lint.sh       # ktlint + ESLint

# View Allure test report:
npx allure serve allure-results
```

### Набори тестів

| Набір | Команда | Кількість |
|-------|---------|-------|
| Kotlin unit tests | `./gradlew test` | 100+ tests |
| Express API tests | `cd express-api && npm test` | 1,540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature files |
| Playwright web tests | `npx playwright test` | 28 specs |

```bash
# Kotlin/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (requires connected device or emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright browser tests (requires admin panel running)
npx playwright test
```

### Тестування в CI

У CI тесты Playwright та Android E2E запускаються проти того самого локального середовища (емулятори + Docker) — хмарні сервіси не використовуються. Це гарантує, що тести ніколи не взаємодіятимуть з реальними тестерами.

## Розв'язування проблем

- **Port already in use**: `lsof -i :<port>` (Linux/macOS) або `netstat -ano | findstr :<port>` (Windows) для пошуку того, що використовує порт.
- **Docker not running**: Переконайтесь, що Docker Desktop запущено. Запустіть `docker ps`, щоб перевірити.
- **Firebase emulators fail to start**: Вимагає Java 21+. Перевірте за допомогою `java -version`.
- **Android build fails**: Переконайтесь, що JDK 21+ та Android SDK встановлені. Спробуйте `./gradlew clean`.
- **adb device not detected**: Увімкніть налагодження USB. Запустіть `adb devices` для перевірки.
- **Images not loading**: MinIO bucket не може бути створено. Запустіть `cd express-api && NODE_ENV=local node ../local/seed.js`. Для фізичних пристроїв запустіть `adb reverse tcp:9002 tcp:9002`.
- **OTP not arriving**: Перевірте вивід консолі на наявність рядків `[OTP-LOCAL]`. Також перевірте UI Mailpit на http://localhost:8025.
- **Reset emulator data**: Видаліть каталог `local/firebase-emulator-data/` та перезавантажте.
- **Reset MinIO data**: Запустіть `docker compose -f local/docker-compose.yml down -v` для видалення томів.

## Розгортання

Розгортання здійснюються через робочі процеси GitHub Actions (`.github/workflows/`):

| Робочий процес | Спусок | Що він робить |
|----------|---------|-------------|
| **PR Checks** | Автоматично на PRs до `main` | Запускає lint, Kotlin тести, Express API тести, Playwright тести (на основі змінених файлів) |
| **Deploy to Dev** | Ручний (`workflow_dispatch`) | Розгортає Express API + web на dev, розповсюджує APK до тестерів, додатково запускає тести Playwright |
| **Deploy to Prod** | Ручний (`workflow_dispatch`) | Розгортає позначений випуск на prod — Express API, web, Play Store та App Store |

Додаткові робочі процеси: **E2E Tests** (матриця емулятора Android), **SonarCloud** (статичний аналіз), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Розгорнуто на Oracle Cloud VMs через SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Упаковано та завантажено на Google Play через CI
- **iOS:** Побудовано та завантажено на App Store Connect / TestFlight через CI
- **Admin panel / web:** Розгорнуто на Cloudflare Pages

## Внески

Вклади вітаються! Будь ласка, дивіться [CONTRIBUTING.md](CONTRIBUTING.md) для отримання рекомендацій.

## Ліцензія

Цей проект ліцензований під Apache License 2.0. Дивіться [LICENSE](LICENSE) для отримання деталей.

## Подяки

- [Firebase](https://firebase.google.com) — аутентифікація, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) — Real-time голосова комунікація
- [Cloudflare](https://www.cloudflare.com) — R2 сховище, Pages hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) — Free tier VM для Express API
- [Express.js](https://expressjs.com) — API server framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) — Modern declarative UI
- [Koin](https://insert-koin.io) — Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) — Image loading для Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) — Animated gift and UI effects
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) — Multiplatform date/time
