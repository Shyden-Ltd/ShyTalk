# ShyTalk

**Голосовые чат-комнаты, переосмысленные.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | **Русский** | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## О проекте

ShyTalk -- это социальное приложение для голосового общения, где пользователи могут создавать и присоединяться к голосовым чат-комнатам в реальном времени. Построенное на Kotlin Multiplatform (KMP), оно поддерживает как Android, так и iOS с единой кодовой базой. Хотите ли вы вести беседу, слушать или общаться с людьми со всего мира, ShyTalk делает это просто.

iOS является поддерживаемой платформой, но данное руководство сосредоточено на разработке под Android, который является основной целью разработки.

## Возможности

### Голосовые чат-комнаты
- Создавайте или присоединяйтесь к комнатам с голосом в реальном времени на базе LiveKit
- Структурированная система мест с ролями владельца, ведущего и участника
- Запросы мест и приглашения -- запросите место или пригласите слушателей выступить
- Плавающее окно чата -- продолжайте голосовой чат, просматривая другие части приложения
- Истечение срока комнаты -- комнаты автоматически закрываются при отсутствии владельца с таймерами обратного отсчёта

### Сообщения
- Текстовый чат в реальном времени наряду с голосом в каждой комнате
- Личные сообщения с беседами 1-на-1
- Групповые чаты с управлением участниками и разрешениями
- Индикаторы набора текста в реальном времени
- Поддержка стикеров

### Социальное
- Настраиваемые профили пользователей с фотографиями, обложками, флагами национальности и биографиями
- Система подписок -- подписывайтесь на других пользователей и видите, когда они активны
- Стена подарков -- демонстрируйте подарки, полученные от других пользователей
- Система блокировки -- блокируйте пользователей в комнатах и профилях

### Виртуальная экономика
- Экономика на основе монет с кошельком и историей транзакций
- Ежедневные награды за вход с бонусами за серию
- Система Lucky Spin (гача) с призами по уровням
- Виртуальные подарки -- отправляйте и получайте анимированные подарки во время голосовых чатов
- Инвентарь рюкзака для хранения подарков
- Пакеты монет для покупки монет
- Баннеры трансляций с анимированными эффектами подарков

### Аккаунт и идентификация
- Мультипровайдерная аутентификация -- войдите через Google, Apple или Email (OTP)
- Привяжите несколько методов входа к одному аккаунту
- Стабильная идентификация пользователя (uniqueId), сохраняющаяся между проектами Firebase
- Управление привязанными аккаунтами в Настройках с поддержкой привязки/отвязки
- Привязка устройства -- каждое устройство постоянно привязано к одному аккаунту

### Модерация и безопасность
- Инструменты модерации -- отключение звука, кик, перемещение мест и управление ведущими как владелец комнаты
- Система жалоб на пользователей с процессом проверки
- Система предупреждений и приостановок за нарушение правил
- Экраны стандартов сообщества, политики конфиденциальности и условий использования
- Процесс принятия правовых условий для новых пользователей
- Принудительное обновление для устаревших версий приложения

### Стартовые экраны
- Настраиваемые экраны запуска, отображаемые при старте приложения
- Контент, управляемый администратором, с опциями планирования и таргетирования

### Безопасность
- Защита PIN-кодом для доступа к приложению
- Биометрическая аутентификация -- отпечаток пальца и распознавание лица
- Верификация OTP (одноразовый пароль) для чувствительных действий

### Панель администратора
- Веб-панель модерации на статическом сайте проекта
- Управление пользователями, модерация контента и конфигурация
- Управление шаблонами и подарками с предварительным просмотром
- Потоковая передача логов и оповещения в реальном времени

### Сжатие изображений
- Автоматическое сжатие изображений при загрузке через Express API
- Снижает затраты на хранение и пропускную способность, сохраняя качество

### Интернационализация
- 19 языков поддерживаются из коробки
- Полная локализация всех строк, видимых пользователю

### Логирование и мониторинг
- Структурированное логирование в Express API, мобильных приложениях и панели администратора
- Потоковая передача логов в реальном времени в административной панели
- Блокировка устройств и сетей с автоматическим применением
- Система оповещений о критических ошибках и аномалиях
- Распространение Trace ID для сквозного отслеживания запросов

## Технологический стек

| Уровень | Технология |
|-------|-----------|
| **Фреймворк** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Архитектура** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Аутентификация** | Firebase Authentication (Google, Apple, Email+OTP) с мультипровайдерной системой идентификации |
| **База данных** | Cloud Firestore |
| **Реальное время** | Firebase Realtime Database |
| **Хранилище** | Cloudflare R2 (через прокси Express API) |
| **API-сервер** | Express.js на Oracle Cloud Free Tier |
| **Голос** | LiveKit (self-hosted on Oracle Cloud) |
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

- **Модуль shared** (`commonMain`) -- Модели, интерфейсы репозиториев, ViewModel и UI, общие между платформами
- **Модуль app** -- Экраны, специфичные для Android, реализации репозиториев и точка входа
- **Модуль iosApp** -- Точка входа, специфичная для iOS
- **express-api** -- Бэкенд Express.js, работающий на Oracle Cloud Free Tier

## Структура проекта

```
ShyTalk/
+-- app/                              # Модуль Android-приложения
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Точка входа приложения
|       |   +-- MainActivity.kt       # Главная активность
|       |   +-- core/
|       |   |   +-- di/               # Модуль Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Голос LiveKit, присутствие, уведомления
|       |   |   +-- repository/       # Реализации репозиториев
|       |   +-- feature/
|       |   |   +-- auth/             # Экран входа через Google
|       |   |   +-- profile/          # Экран профиля
|       |   |   +-- room/             # Экран комнаты
|       |   |   +-- settings/         # Настройки приложения
|       |   +-- navigation/           # NavGraph & маршруты экранов
|       +-- test/                     # Юнит-тесты
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
|       +-- middleware/               # Middleware аутентификации и логирования
|       +-- utils/                    # Firebase Admin, R2, логгер
|       +-- cron/                     # Запланированные задачи
+-- public/                           # Статический сайт и панель администратора
+-- local/                            # Локальная среда разработки (эмуляторы, начальные данные)
+-- tests/web/                        # Браузерные тесты Playwright
+-- scripts/                          # Вспомогательные скрипты
+-- .github/workflows/                # CI/CD (Проверки PR, Деплой на Dev/Prod, E2E, линт)
+-- firestore.rules                   # Правила безопасности Firestore
+-- database.rules.json               # Правила безопасности RTDB
+-- firestore.indexes.json            # Составные индексы Firestore
+-- firebase.json                     # Конфигурация Firebase
```

## Начало работы

### Предварительные требования

- **Android Studio** Ladybug или новее
- **JDK 21+**
- **Node.js 24+**
- **Docker** (для голосового сервера LiveKit, хранилища MinIO, почты Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Облачные аккаунты не нужны для начала работы -- локальная среда работает полностью офлайн.

### Локальная разработка (Рекомендуется)

Самый быстрый способ начать. Одна команда запускает всё -- эмуляторы Firebase, Docker-контейнеры, Express API и собирает Android-приложение. Без облачных аккаунтов, без затрат, без лимитов квот.

1. **Клонирование и установка**
   ```bash
   git clone https://github.com/Shyden-Ltd/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Запуск всего**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Эта одна команда:
   - Запускает Docker-контейнеры (голосовой сервер LiveKit, хранилище MinIO, почта Mailpit)
   - Запускает эмуляторы Firebase (Firestore, Auth, RTDB)
   - Заполняет тестовые данные и создаёт бакет хранилища MinIO
   - Запускает Express API
   - Собирает и устанавливает Android-приложение (если устройство подключено)

   Когда всё готово, вы увидите:
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

3. **Вход**
   - Используйте поток входа по email с тестовым аккаунтом: `claude-test@shytalk.dev` / `localdev123`
   - Или создайте новый аккаунт -- он будет использовать локальные эмуляторы
   - Вход через Google/Apple не работает локально (нет настоящего OAuth) -- используйте email OTP
   - OTP-коды перехватываются Mailpit -- проверьте http://localhost:8025

4. **Запуск на физическом устройстве**

   Ваш телефон должен быть в **той же Wi-Fi сети**, что и ваша машина разработки.

   a. Найдите локальный IP вашей машины:
   ```bash
   # Windows
   ipconfig    # Ищите "IPv4 Address" под вашим Wi-Fi адаптером (напр. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # или: ip addr show
   ```

   b. Обновите локальный build flavor для использования вашего IP вместо `10.0.2.2`. В `app/build.gradle.kts` найдите flavor `local` и измените:
   ```kotlin
   // Замените 10.0.2.2 на локальный IP вашей машины
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Подключите устройство через USB и включите отладку по USB, затем:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Альтернативно используйте **adb reverse**, чтобы избежать изменения кода (устройство направляет localhost на вашу машину):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Эмулятор Firestore
   adb reverse tcp:9099 tcp:9099   # Эмулятор Auth
   adb reverse tcp:9000 tcp:9000   # Эмулятор RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (хранилище изображений)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   С `adb reverse` адреса по умолчанию `10.0.2.2` в локальном flavor будут работать и на физическом устройстве -- изменения конфигурации сборки не нужны.

5. **Остановка локальных сервисов**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Или нажмите `Ctrl+C` в терминале скрипта запуска. Данные эмулятора автоматически сохраняются и восстанавливаются при следующем запуске.

### Полезные URL для локальной разработки

| Сервис | URL | Назначение |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Просмотр данных Firestore, пользователей Auth, RTDB |
| Express API | http://localhost:3000 | Бэкенд API |
| Health check | http://localhost:3000/api/health | Проверка работы API |
| Mailpit | http://localhost:8025 | Просмотр перехваченных писем и OTP-кодов |
| MinIO Console | http://localhost:9001 | Просмотр загруженных изображений и файлов |

### Дополнительные сервисы

**LibreTranslate (Перевод сообщений)**

Опциональный Docker-образ 6ГБ+ для локального тестирования функции перевода:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Не включён в стандартную установку из-за большого размера образа. Перевод работает и без него -- сообщения просто остаются непереведёнными.

### Облачная разработка (Опционально)

Если вам нужно тестировать с реальными облачными сервисами (напр. реальные push-уведомления, реальный вход через Google):

1. **Настройка Firebase**
   - Создайте проект Firebase на [console.firebase.google.com](https://console.firebase.google.com)
   - Включите **Вход через Google** и **Вход через Apple** в Аутентификации
   - Включите **Firestore**, **Realtime Database** и **Cloud Messaging**
   - Скачайте `google-services.json` и поместите в `app/src/dev/`

2. **Настройка Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Отредактируйте с вашими облачными учётными данными
   npm install
   npm start
   ```

3. **Развёртывание правил Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Сборка Android-приложения** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Переменные окружения

| Переменная | Описание | Где |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON сервисного аккаунта Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID аккаунта Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Ключ доступа R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Секретный ключ R2 | Express API |
| `R2_BUCKET_NAME` | Имя бакета R2 (по умолчанию: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | API-ключ LiveKit (Азия/Сингапур) | Express API |
| `LIVEKIT_SECRET_ASIA` | API-секрет LiveKit (Азия/Сингапур) | Express API |
| `LIVEKIT_URL_ASIA` | URL сервера LiveKit (Азия) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | API-ключ LiveKit (ЕС/Лондон) | Express API |
| `LIVEKIT_SECRET_EU` | API-секрет LiveKit (ЕС/Лондон) | Express API |
| `LIVEKIT_URL_EU` | URL сервера LiveKit (ЕС) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | API-ключ LiveKit (резервный, когда региональные ключи не заданы) | Express API |
| `LIVEKIT_API_SECRET` | API-секрет LiveKit (резервный, когда региональные ключи не заданы) | Express API |
| `LIVEKIT_URL` | URL сервера LiveKit (встраивается в Android-приложение при сборке) | Android-приложение (BuildConfig) |
| `WORKER_URL` | Базовый URL Express API | Android-приложение (BuildConfig) |

## Тестирование

### Запуск тестов локально

```bash
# Интерактивное меню тестов (выберите что запустить):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Или запустите отдельные наборы:
bash local/test-unit.sh       # Юнит-тесты Kotlin + Express API
bash local/test-playwright.sh # Веб-тесты Playwright (нужна локальная среда)
bash local/test-e2e.sh        # E2E-тесты Android (нужна локальная среда + устройство)
bash local/test-lint.sh       # ktlint + ESLint

# Просмотр отчёта тестов Allure:
npx allure serve allure-results
```

### Наборы тестов

| Набор | Команда | Количество |
|-------|---------|-------|
| Юнит-тесты Kotlin | `./gradlew test` | 100+ тестов |
| Тесты Express API | `cd express-api && npm test` | 1 540+ тестов |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 файла функций |
| Веб-тесты Playwright | `npx playwright test` | 28 спецификаций |

```bash
# Юнит-тесты Kotlin/KMP
./gradlew test

# Тесты Express API
cd express-api && npm test

# E2E-тесты (требуется подключённое устройство или эмулятор)
./gradlew connectedDevDebugAndroidTest

# Браузерные тесты Playwright (требуется работающая панель администратора)
npx playwright test
```

### Тестирование в CI

В CI тесты Playwright и Android E2E запускаются в той же локальной среде (эмуляторы + Docker) -- облачные сервисы не используются. Это гарантирует, что тесты никогда не мешают реальным тестировщикам.

## Устранение неполадок

- **Порт уже используется**: `lsof -i :<port>` (Linux/macOS) или `netstat -ano | findstr :<port>` (Windows) чтобы найти, что использует порт.
- **Docker не запущен**: Убедитесь, что Docker Desktop запущен. Выполните `docker ps` для проверки.
- **Эмуляторы Firebase не запускаются**: Требуется Java 21+. Проверьте `java -version`.
- **Сборка Android не удалась**: Убедитесь, что JDK 21+ и Android SDK установлены. Попробуйте `./gradlew clean`.
- **Устройство adb не обнаружено**: Включите отладку по USB. Выполните `adb devices` для проверки.
- **Изображения не загружаются**: Бакет MinIO мог быть не создан. Выполните `cd express-api && NODE_ENV=local node ../local/seed.js`. Для физических устройств выполните `adb reverse tcp:9002 tcp:9002`.
- **OTP не приходит**: Проверьте вывод консоли на наличие строк `[OTP-LOCAL]`. Также проверьте UI Mailpit по адресу http://localhost:8025.
- **Сброс данных эмулятора**: Удалите директорию `local/firebase-emulator-data/` и перезапустите.
- **Сброс данных MinIO**: Выполните `docker compose -f local/docker-compose.yml down -v` для удаления томов.

## Развёртывание

Развёртывание управляется через рабочие процессы GitHub Actions (`.github/workflows/`):

| Рабочий процесс | Триггер | Что делает |
|----------|---------|-------------|
| **PR Checks** | Автоматически при PR в `main` | Запускает линт, тесты Kotlin, тесты Express API, тесты Playwright (на основе изменённых файлов) |
| **Deploy to Dev** | Вручную (`workflow_dispatch`) | Развёртывает Express API + веб на dev, распространяет APK тестировщикам, опционально запускает тесты Playwright |
| **Deploy to Prod** | Вручную (`workflow_dispatch`) | Развёртывает отмеченный релиз на prod -- Express API, веб, Play Store и App Store |

Дополнительные рабочие процессы: **E2E Tests** (матрица эмуляторов Android), **SonarCloud** (статический анализ), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Развёртывается на VM Oracle Cloud через SSH + PM2 (dev: Лондон, prod: Сингапур)
- **Android:** Упаковывается и загружается в Google Play через CI
- **iOS:** Собирается и загружается в App Store Connect / TestFlight через CI
- **Панель администратора / веб:** Развёртывается на Cloudflare Pages

## Участие в проекте

Вклады приветствуются! Пожалуйста, ознакомьтесь с [CONTRIBUTING.md](CONTRIBUTING.md) для руководства.

## Лицензия

Этот проект лицензирован под Apache License 2.0. Подробности в [LICENSE](LICENSE).

## Благодарности

- [Firebase](https://firebase.google.com) -- Аутентификация, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Голосовая связь в реальном времени
- [Cloudflare](https://www.cloudflare.com) -- Хранилище R2, хостинг Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Бесплатная VM для Express API
- [Express.js](https://expressjs.com) -- Фреймворк API-сервера
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Современный декларативный UI
- [Koin](https://insert-koin.io) -- Лёгкое внедрение зависимостей
- [Coil](https://coil-kt.github.io/coil/) -- Загрузка изображений для Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Анимированные эффекты подарков и UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Мультиплатформенная дата/время
