# ShyTalk

**Голосовые чат-комнаты, переосмысленные.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [العربية](README.ar.md) | [Deutsch](README.de.md) | [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | **Русский** | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## О проекте

ShyTalk -- социальное приложение голосового чата, где пользователи могут создавать и присоединяться к голосовым комнатам в реальном времени. Построено на Kotlin Multiplatform (KMP) для Android и iOS с общей кодовой базой. Хотите ли вы вести беседу, слушать или общаться с людьми по всему миру -- ShyTalk делает это просто.

## Возможности

### Голосовые чат-комнаты
- Создавайте или присоединяйтесь к комнатам с голосом в реальном времени на базе LiveKit
- Структурированная система мест с ролями владельца, ведущего и участника
- Запросы и приглашения на место -- попросите слово или пригласите слушателей
- Плавающий chathead -- продолжайте голосовой чат, просматривая другие разделы
- Истечение комнаты -- комнаты автоматически закрываются при отсутствии владельца

### Сообщения
- Текстовый чат в реальном времени в каждой комнате
- Личные сообщения с беседами 1-на-1
- Групповые чаты с управлением участниками и правами
- Индикаторы набора текста в реальном времени
- Поддержка стикеров

### Социальные функции
- Настраиваемые профили с фото, обложками, флагами национальностей и биографиями
- Система подписок -- подписывайтесь на пользователей и видите их активность
- Стена подарков -- демонстрируйте полученные подарки
- Система блокировки -- блокируйте пользователей в комнатах и профилях

### Виртуальная экономика
- Экономика на основе монет с кошельком и историей транзакций
- Ежедневные награды за вход с бонусами за серию
- Система Lucky Spin (гача) с призами по уровням
- Виртуальные подарки -- отправляйте и получайте анимированные подарки во время чатов
- Инвентарь рюкзака для хранения подарков
- Пакеты монет для покупки
- Баннеры трансляции с анимированными эффектами подарков

### Аккаунт и идентификация
- Мультипровайдерная аутентификация -- вход через Google, Apple или Email (OTP)
- Привязка нескольких методов входа к одному аккаунту
- Стабильная идентификация пользователя (uniqueId), сохраняющаяся между проектами Firebase
- Управление привязанными аккаунтами в Настройках с поддержкой привязки/отвязки
- Привязка устройства -- каждое устройство навсегда связано с одним аккаунтом

### Модерация и безопасность
- Инструменты модерации -- заглушить, выгнать, переместить и управлять ведущими
- Система жалоб с рабочим процессом проверки
- Система предупреждений и блокировок за нарушения правил
- Экраны правил сообщества, политики конфиденциальности и условий использования
- Процесс принятия правовых условий для новых пользователей
- Принудительное обновление для устаревших версий приложения

### Стартовые экраны
- Настраиваемые экраны запуска, отображаемые при старте приложения
- Контент, управляемый администратором, с опциями расписания и таргетинга

### Безопасность
- Защита PIN-кодом для доступа к приложению
- Биометрическая аутентификация -- отпечаток пальца и распознавание лица
- OTP-верификация (одноразовый пароль) для чувствительных действий

### Панель администратора
- Веб-панель модерации на статическом сайте проекта
- Управление пользователями, модерация контента и конфигурация
- Управление шаблонами и подарками с предпросмотром в реальном времени
- Потоковая передача логов и оповещения в реальном времени

### Сжатие изображений
- Автоматическое сжатие изображений при загрузке через Express API
- Снижение затрат на хранение и трафик с сохранением качества

### Интернационализация
- 19 языков поддерживаются из коробки
- Полная локализация всех пользовательских строк

### Логирование и мониторинг
- Структурированное логирование в Express API, мобильных приложениях и панели администратора
- Потоковая передача логов в реальном времени в панели администратора
- Блокировка устройств и сетей с автоматическим применением
- Система оповещений для критических ошибок и аномалий
- Распространение Trace ID для сквозного отслеживания запросов

## Технологический стек

| Уровень | Технология |
|---------|-----------|
| **Фреймворк** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Архитектура** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Аутентификация** | Firebase Authentication (Google, Apple, Email+OTP) с мультипровайдерной системой идентификации |
| **База данных** | Cloud Firestore |
| **Реальное время** | Firebase Realtime Database |
| **Хранилище** | Cloudflare R2 (через Express API proxy) |
| **API-сервер** | Express.js on Oracle Cloud Free Tier |
| **Голос** | LiveKit |
| **Push-уведомления** | Firebase Cloud Messaging |
| **Загрузка изображений** | Coil 3 (KMP) |
| **Анимации** | Lottie Compose |
| **Дата/Время** | kotlinx-datetime |
| **Навигация** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Архитектура

ShyTalk следует паттерну **MVVM** с чистым **Repository Pattern**:

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

- **shared module** (`commonMain`) -- Модели, интерфейсы репозиториев, ViewModels и UI, общие для платформ
- **app module** -- Android-специфичные экраны, реализации репозиториев и точка входа
- **iosApp module** -- iOS-специфичная точка входа
- **express-api** -- Бэкенд Express.js на Oracle Cloud Free Tier

## Структура проекта

```
ShyTalk/
+-- app/                              # Модуль Android-приложения
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Точка входа приложения
|       |   +-- MainActivity.kt       # Главная activity
|       |   +-- core/
|       |   |   +-- di/               # Модуль Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # Реализации репозиториев
|       |   +-- feature/
|       |   |   +-- auth/             # Экран Google Sign-In
|       |   |   +-- profile/          # Экран профиля
|       |   |   +-- room/             # Экран комнаты
|       |   |   +-- settings/         # Настройки приложения
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # Модульные тесты
|       +-- androidTest/              # E2E-тесты (Compose UI Test)
+-- shared/                           # Общий модуль KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Общие модули Koin
|       |   +-- model/                # Модели данных (User, ChatRoom, Gift и т.д.)
|       |   +-- ui/                   # Общие компоненты
|       |   +-- util/                 # Утилиты и константы
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService и т.д.
|       |   +-- repository/           # Интерфейсы репозиториев
|       +-- feature/                  # Общие модули функций
+-- iosApp/                           # Модуль iOS-приложения
+-- express-api/                      # Сервер Express.js API
|   +-- src/
|       +-- routes/                   # Обработчики маршрутов API
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Запланированные задачи
+-- public/                           # Статический сайт и панель администратора
+-- local/                            # Локальная среда разработки (эмуляторы, тестовые данные)
+-- tests/web/                        # Тесты Playwright для браузера
+-- scripts/                          # Утилитарные скрипты
+-- .github/workflows/                # CI/CD (PR Checks, Deploy to Dev/Prod, E2E, lint)
+-- firestore.rules                   # Правила безопасности Firestore
+-- database.rules.json               # Правила безопасности RTDB
+-- firestore.indexes.json            # Составные индексы Firestore
+-- firebase.json                     # Конфигурация Firebase
```

## Начало работы

### Предварительные требования

- **Android Studio** Ladybug или новее
- **JDK 17+**
- **Node.js 24+**
- **Docker** (для локального сервера LiveKit)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Локальная разработка (Рекомендуется)

Самый быстрый способ начать. Использует Firebase Emulators и локальный Docker-контейнер LiveKit -- без облачных аккаунтов, без затрат, без лимитов квот.

1. **Клонировать и установить**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Запустить локальные сервисы**
   ```bash
   bash local/start.sh
   ```
   Запускает Firebase Emulators (Firestore, Auth, RTDB) и Docker-контейнер LiveKit. При первом запуске автоматически заполняет тестовыми данными (администратор, примеры подарков, конфигурация).

   Вы увидите:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Запустить Express API** (в новом терминале)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Отредактируйте значения R2/SMTP при необходимости
   npm run local
   ```
   API запускается на `http://localhost:3000`. Проверка: `curl http://localhost:3000/api/health`

4. **Запустить на эмуляторе Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Build flavor `local` подключается к `10.0.2.2` (loopback эмулятора Android на вашу машину). Работает сразу -- без дополнительной настройки.

5. **Запустить на физическом устройстве**

   Ваш телефон должен быть в **той же Wi-Fi сети**, что и машина разработки.

   a. Найдите локальный IP вашей машины:
   ```bash
   # Windows
   ipconfig    # Ищите "IPv4 Address" в адаптере Wi-Fi (например, 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # или: ip addr show
   ```

   b. Обновите build flavor local, используя ваш IP вместо `10.0.2.2`. В `app/build.gradle.kts` найдите flavor `local` и измените:
   ```kotlin
   // Замените 10.0.2.2 на локальный IP вашей машины
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Подключите устройство через USB и включите отладку USB, затем:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Как альтернатива, используйте **adb reverse**, чтобы не менять код (устройство перенаправляет localhost на вашу машину):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   С `adb reverse` адреса по умолчанию `10.0.2.2` в локальном flavor будут работать и на физическом устройстве -- без изменений в build config.

6. **Войти в аккаунт**
   - Используйте вход по email с тестовым аккаунтом: `claude-test@shytalk.dev` / `localdev123`
   - Или создайте новый аккаунт -- он будет использовать локальные эмуляторы
   - Google/Apple sign-in не работает локально (нет реального OAuth) -- используйте email OTP

7. **Остановить локальные сервисы**
   ```bash
   bash local/stop.sh
   ```
   Или нажмите `Ctrl+C` в терминале `start.sh`. Данные эмулятора сохраняются автоматически и восстанавливаются при следующем запуске.

### Полезные URL для локальной разработки

| Сервис | URL | Назначение |
|--------|-----|-----------|
| Firebase Emulator UI | http://localhost:4000 | Просмотр данных Firestore, пользователей Auth, RTDB |
| Express API | http://localhost:3000 | Бэкенд API |
| Health check | http://localhost:3000/api/health | Проверка работы API |

### Облачная разработка (Опционально)

Если нужно тестировать с реальными облачными сервисами (например, реальные push-уведомления, реальный Google Sign-In):

1. **Настройка Firebase**
   - Создайте проект Firebase на [console.firebase.google.com](https://console.firebase.google.com)
   - Включите **Google Sign-In** и **Apple Sign-In** в Authentication
   - Включите **Firestore**, **Realtime Database** и **Cloud Messaging**
   - Скачайте `google-services.json` и поместите в `app/src/dev/`

2. **Настройка Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Отредактируйте с вашими облачными учетными данными
   npm install
   npm start
   ```

3. **Развернуть правила Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Собрать Android-приложение** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Переменные окружения

| Переменная | Описание | Где |
|------------|----------|-----|
| `FIREBASE_SERVICE_ACCOUNT` | JSON сервисного аккаунта Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID аккаунта Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Ключ доступа R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Секретный ключ R2 | Express API |
| `R2_BUCKET_NAME` | Имя бакета R2 (по умолчанию: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | API-ключ LiveKit | Express API |
| `LIVEKIT_API_SECRET` | API-секрет LiveKit | Express API |
| `LIVEKIT_URL` | URL сервера LiveKit | Android app (BuildConfig) |
| `WORKER_URL` | Базовый URL Express API | Android app (BuildConfig) |

## Тестирование

| Набор | Команда | Количество |
|-------|---------|-----------|
| Модульные тесты Kotlin | `./gradlew test` | 100+ тестов |
| Тесты Express API | `cd express-api && npm test` | 1,540+ тестов |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature files |
| Веб-тесты Playwright | `npx playwright test` | 28 specs |

```bash
# Модульные тесты Kotlin/KMP
./gradlew test

# Тесты Express API
cd express-api && npm test

# E2E-тесты (требуется подключенное устройство или эмулятор)
./gradlew connectedDevDebugAndroidTest

# Тесты Playwright для браузера (требуется запущенная панель администратора)
npx playwright test
```

## Развёртывание

Развёртывания управляются через workflows GitHub Actions (`.github/workflows/`):

| Workflow | Триггер | Что делает |
|----------|---------|-----------|
| **PR Checks** | Автоматически при PR в `main` | Запускает lint, тесты Kotlin, тесты Express API, тесты Playwright (на основе изменённых файлов) |
| **Deploy to Dev** | Вручную (`workflow_dispatch`) | Развёртывает Express API + web на dev, распространяет APK тестерам, опционально запускает тесты Playwright |
| **Deploy to Prod** | Вручную (`workflow_dispatch`) | Развёртывает tagged-релиз на prod -- Express API, web, Play Store и App Store |

Дополнительные workflows: **E2E Tests** (матрица эмуляторов Android), **SonarCloud** (статический анализ), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Развёрнута на VM Oracle Cloud через SSH + PM2 (dev: Лондон, prod: Сингапур)
- **Android:** Собран и загружен в Google Play через CI
- **iOS:** Собран и загружен в App Store Connect / TestFlight через CI
- **Панель администратора / web:** Развёрнута на Cloudflare Pages

## Содействие

Мы рады вкладу! Смотрите [CONTRIBUTING.md](CONTRIBUTING.md) для руководства.

## Лицензия

Этот проект лицензирован под Apache License 2.0. Подробности в [LICENSE](LICENSE).

## Благодарности

- [Firebase](https://firebase.google.com) -- Аутентификация, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Голосовая связь в реальном времени
- [Cloudflare](https://www.cloudflare.com) -- Хранилище R2, хостинг Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM Free Tier для Express API
- [Express.js](https://expressjs.com) -- Фреймворк API-сервера
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Современный декларативный UI
- [Koin](https://insert-koin.io) -- Лёгкая инъекция зависимостей
- [Coil](https://coil-kt.github.io/coil/) -- Загрузка изображений для Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Анимированные эффекты подарков и UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Мультиплатформенная дата/время
