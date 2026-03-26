# ShyTalk

**Salas de chat de voz, reimaginadas.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | **Español** | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Acerca de

ShyTalk es una aplicacion social de chat de voz donde los usuarios pueden crear y unirse a salas de chat de voz en tiempo real. Construida con Kotlin Multiplatform (KMP), soporta tanto Android como iOS con una base de codigo compartida. Ya sea que quieras organizar una conversacion, escuchar o conectar con personas de todo el mundo, ShyTalk lo hace facil.

iOS es una plataforma soportada, pero esta guia se centra en el desarrollo de Android, que es el objetivo principal de desarrollo.

## Caracteristicas

### Salas de Chat de Voz
- Crea o unete a salas con voz en tiempo real impulsada por LiveKit
- Sistema de asientos estructurado con roles de propietario, anfitrion y asistente
- Solicitudes de asiento e invitaciones -- solicita unirte a un asiento o invita a oyentes a hablar
- Burbuja flotante -- continua el chat de voz mientras navegas por otras partes de la app
- Expiracion de sala -- las salas se cierran automaticamente cuando el propietario esta ausente, con temporizadores de cuenta regresiva

### Mensajeria
- Chat de texto en vivo junto con la voz en cada sala
- Mensajeria privada con conversaciones 1 a 1
- Chats grupales con gestion de miembros y permisos
- Indicadores de escritura en tiempo real
- Soporte de stickers

### Social
- Perfiles de usuario personalizables con fotos, imagenes de portada, banderas de nacionalidad y biografias
- Sistema de seguimiento -- sigue a otros usuarios y ve cuando estan activos
- Muro de regalos -- muestra los regalos recibidos de otros usuarios
- Sistema de bloqueo -- bloquea usuarios en salas y perfiles

### Economia Virtual
- Economia basada en monedas con billetera e historial de transacciones
- Recompensas diarias de inicio de sesion con bonos por racha
- Sistema Lucky Spin (gacha) con premios escalonados
- Regalos virtuales -- envia y recibe regalos animados durante los chats de voz
- Inventario de mochila para almacenar regalos
- Paquetes de monedas para comprar monedas
- Banners de transmision con efectos de regalos animados

### Cuenta e Identidad
- Autenticacion multi-proveedor -- inicia sesion con Google, Apple o correo electronico (OTP)
- Vincula multiples metodos de inicio de sesion a una sola cuenta
- Identidad de usuario estable (uniqueId) que persiste entre proyectos de Firebase
- Gestion de cuentas vinculadas en Configuracion con soporte de vincular/desvincular
- Vinculacion de dispositivo -- cada dispositivo esta permanentemente vinculado a una cuenta

### Moderacion y Seguridad
- Herramientas de moderacion -- silenciar, expulsar, mover asientos y gestionar anfitriones como propietario de sala
- Sistema de reportes de usuarios con flujo de revision
- Sistema de advertencias y suspensiones por violaciones de politicas
- Pantallas de estandares comunitarios, politica de privacidad y terminos de servicio
- Flujo de aceptacion legal para nuevos usuarios
- Actualizacion forzada para versiones obsoletas de la app

### Pantallas de Inicio
- Pantallas de lanzamiento configurables mostradas al iniciar la app
- Contenido gestionado por administradores con opciones de programacion y segmentacion

### Seguridad
- Proteccion con codigo PIN para acceso a la app
- Autenticacion biometrica -- huella dactilar y reconocimiento facial
- Verificacion OTP (contrasena de un solo uso) para acciones sensibles

### Panel de Administracion
- Dashboard de moderacion basado en web en el sitio estatico del proyecto
- Gestion de usuarios, moderacion de contenido y configuracion
- Gestion de plantillas y regalos con vista previa en vivo
- Streaming de logs y alertas en tiempo real

### Compresion de Imagenes
- Compresion automatica de imagenes al subir via Express API
- Reduce costos de almacenamiento y ancho de banda manteniendo la calidad

### Internacionalizacion
- 19 idiomas soportados de serie
- Localizacion completa de todos los textos visibles para el usuario

### Logs y Monitoreo
- Logging estructurado en Express API, apps moviles y panel de administracion
- Streaming de logs en tiempo real en el dashboard de administracion
- Bloqueo de dispositivos y redes con aplicacion automatica
- Sistema de alertas para errores criticos y anomalias
- Propagacion de Trace ID para seguimiento de solicitudes de extremo a extremo

## Stack Tecnologico

| Capa | Tecnologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arquitectura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autenticacion** | Firebase Authentication (Google, Apple, Email+OTP) con sistema de identidad multi-proveedor |
| **Base de datos** | Cloud Firestore |
| **Tiempo real** | Firebase Realtime Database |
| **Almacenamiento** | Cloudflare R2 (via proxy de Express API) |
| **Servidor API** | Express.js en Oracle Cloud Free Tier |
| **Voz** | LiveKit (self-hosted on Oracle Cloud) |
| **Notificaciones push** | Firebase Cloud Messaging |
| **Carga de imagenes** | Coil 3 (KMP) |
| **Animaciones** | Lottie Compose |
| **Fecha/Hora** | kotlinx-datetime |
| **Navegacion** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arquitectura

ShyTalk sigue el patron **MVVM** con un **Repository Pattern** limpio:

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

- **Modulo shared** (`commonMain`) -- Modelos, interfaces de repositorio, ViewModels y UI compartidos entre plataformas
- **Modulo app** -- Pantallas especificas de Android, implementaciones de repositorio y punto de entrada
- **Modulo iosApp** -- Punto de entrada especifico de iOS
- **express-api** -- Backend Express.js ejecutandose en Oracle Cloud Free Tier

## Estructura del Proyecto

```
ShyTalk/
+-- app/                              # Modulo de app Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Punto de entrada de la aplicacion
|       |   +-- MainActivity.kt       # Actividad principal
|       |   +-- core/
|       |   |   +-- di/               # Modulo Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Voz LiveKit, presencia, notificaciones
|       |   |   +-- repository/       # Implementaciones de repositorio
|       |   +-- feature/
|       |   |   +-- auth/             # Pantalla de inicio de sesion Google
|       |   |   +-- profile/          # Pantalla de perfil
|       |   |   +-- room/             # Pantalla de sala
|       |   |   +-- settings/         # Configuracion de la app
|       |   +-- navigation/           # NavGraph & rutas de pantalla
|       +-- test/                     # Tests unitarios
|       +-- androidTest/              # Tests E2E (Compose UI Test)
+-- shared/                           # Modulo compartido KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Modulos Koin compartidos
|       |   +-- model/                # Modelos de datos (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Componentes compartidos
|       |   +-- util/                 # Utilidades & constantes
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Interfaces de repositorio
|       +-- feature/                  # Modulos de funcionalidades compartidas
+-- iosApp/                           # Modulo de app iOS
+-- express-api/                      # Servidor Express.js API
|   +-- src/
|       +-- routes/                   # Manejadores de rutas API
|       +-- middleware/               # Middleware de auth y logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tareas programadas
+-- public/                           # Sitio estatico & panel de administracion
+-- local/                            # Entorno de desarrollo local (emuladores, datos de prueba)
+-- tests/web/                        # Tests de navegador Playwright
+-- scripts/                          # Scripts de utilidad
+-- .github/workflows/                # CI/CD (Checks de PR, Deploy a Dev/Prod, E2E, lint)
+-- firestore.rules                   # Reglas de seguridad de Firestore
+-- database.rules.json               # Reglas de seguridad de RTDB
+-- firestore.indexes.json            # Indices compuestos de Firestore
+-- firebase.json                     # Configuracion de Firebase
```

## Primeros Pasos

### Requisitos Previos

- **Android Studio** Ladybug o posterior
- **JDK 21+**
- **Node.js 24+**
- **Docker** (para servidor de voz LiveKit, almacenamiento MinIO, correo Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

No se necesitan cuentas en la nube para comenzar -- el entorno local funciona completamente sin conexion.

### Desarrollo Local (Recomendado)

La forma mas rapida de comenzar. Un comando inicia todo -- emuladores de Firebase, contenedores Docker, Express API y construye la app Android. Sin cuentas en la nube, sin costos, sin limites de cuota.

1. **Clonar e instalar**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Iniciar todo**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Este unico comando:
   - Inicia contenedores Docker (servidor de voz LiveKit, almacenamiento MinIO, correo Mailpit)
   - Inicia emuladores de Firebase (Firestore, Auth, RTDB)
   - Siembra datos de prueba y crea el bucket de almacenamiento MinIO
   - Inicia la Express API
   - Construye e instala la app Android (si hay un dispositivo conectado)

   Cuando este listo, veras:
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

3. **Iniciar sesion**
   - Usa el flujo de inicio de sesion por correo electronico con la cuenta de prueba: `claude-test@shytalk.dev` / `localdev123`
   - O crea una nueva cuenta -- usara los emuladores locales
   - El inicio de sesion con Google/Apple no funciona localmente (sin OAuth real) -- usa OTP por correo electronico en su lugar
   - Los codigos OTP son capturados por Mailpit -- revisa http://localhost:8025

4. **Ejecutar en un Dispositivo Fisico**

   Tu telefono debe estar en la **misma red Wi-Fi** que tu maquina de desarrollo.

   a. Encuentra la IP local de tu maquina:
   ```bash
   # Windows
   ipconfig    # Busca "IPv4 Address" bajo tu adaptador Wi-Fi (ej. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # o: ip addr show
   ```

   b. Actualiza el flavor de build local para usar tu IP en lugar de `10.0.2.2`. En `app/build.gradle.kts`, encuentra el flavor `local` y cambia:
   ```kotlin
   // Reemplaza 10.0.2.2 con la IP local de tu maquina
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Conecta tu dispositivo por USB y habilita la depuracion USB, luego:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternativamente, usa **adb reverse** para evitar cambiar codigo (el dispositivo redirige localhost a tu maquina):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulador de Firestore
   adb reverse tcp:9099 tcp:9099   # Emulador de Auth
   adb reverse tcp:9000 tcp:9000   # Emulador de RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (almacenamiento de imagenes)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Con `adb reverse`, las direcciones predeterminadas `10.0.2.2` en el flavor local funcionaran en un dispositivo fisico tambien -- no se necesitan cambios en la configuracion de build.

5. **Detener servicios locales**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   O presiona `Ctrl+C` en la terminal del script de inicio. Los datos del emulador se guardan automaticamente y se restauran en el siguiente inicio.

### URLs Utiles para Desarrollo Local

| Servicio | URL | Proposito |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Explorar datos de Firestore, usuarios de Auth, RTDB |
| Express API | http://localhost:3000 | API del backend |
| Health check | http://localhost:3000/api/health | Verificar que la API esta ejecutandose |
| Mailpit | http://localhost:8025 | Ver correos capturados y codigos OTP |
| MinIO Console | http://localhost:9001 | Explorar imagenes y archivos subidos |

### Servicios Opcionales

**LibreTranslate (Traduccion de Mensajes)**

Imagen Docker opcional de 6GB+ para probar la funcion de traduccion localmente:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
No incluida en la configuracion predeterminada debido al gran tamano de la imagen. La traduccion funciona sin ella -- los mensajes simplemente permanecen sin traducir.

### Desarrollo en la Nube (Opcional)

Si necesitas probar contra servicios reales en la nube (ej. notificaciones push reales, inicio de sesion real con Google):

1. **Configuracion de Firebase**
   - Crea un proyecto Firebase en [console.firebase.google.com](https://console.firebase.google.com)
   - Habilita **Inicio de sesion con Google** e **Inicio de sesion con Apple** en Autenticacion
   - Habilita **Firestore**, **Realtime Database** y **Cloud Messaging**
   - Descarga `google-services.json` y colocalo en `app/src/dev/`

2. **Configuracion de Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edita con tus credenciales de la nube
   npm install
   npm start
   ```

3. **Desplegar reglas de Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Construir la app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variables de Entorno

| Variable | Descripcion | Donde |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON de cuenta de servicio Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID de cuenta de Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Clave de acceso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Clave secreta R2 | Express API |
| `R2_BUCKET_NAME` | Nombre del bucket R2 (predeterminado: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | Clave API de LiveKit (Asia/Singapur) | Express API |
| `LIVEKIT_SECRET_ASIA` | Secreto API de LiveKit (Asia/Singapur) | Express API |
| `LIVEKIT_URL_ASIA` | URL del servidor LiveKit (Asia) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | Clave API de LiveKit (UE/Londres) | Express API |
| `LIVEKIT_SECRET_EU` | Secreto API de LiveKit (UE/Londres) | Express API |
| `LIVEKIT_URL_EU` | URL del servidor LiveKit (UE) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | Clave API de LiveKit (reserva cuando no se establecen claves regionales) | Express API |
| `LIVEKIT_API_SECRET` | Secreto API de LiveKit (reserva cuando no se establecen claves regionales) | Express API |
| `LIVEKIT_URL` | URL del servidor LiveKit (incorporada en la app Android en tiempo de compilacion) | App Android (BuildConfig) |
| `WORKER_URL` | URL base de Express API | App Android (BuildConfig) |

## Tests

### Ejecutar Tests Localmente

```bash
# Menu interactivo de tests (elige que ejecutar):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# O ejecuta suites individuales:
bash local/test-unit.sh       # Tests unitarios de Kotlin + Express API
bash local/test-playwright.sh # Tests web de Playwright (necesita entorno local)
bash local/test-e2e.sh        # Tests E2E de Android (necesita entorno local + dispositivo)
bash local/test-lint.sh       # ktlint + ESLint

# Ver reporte de tests Allure:
npx allure serve allure-results
```

### Suites de Tests

| Suite | Comando | Cantidad |
|-------|---------|-------|
| Tests unitarios de Kotlin | `./gradlew test` | 100+ tests |
| Tests de Express API | `cd express-api && npm test` | 1,540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 archivos de features |
| Tests web de Playwright | `npx playwright test` | 28 especificaciones |

```bash
# Tests unitarios Kotlin/KMP
./gradlew test

# Tests de Express API
cd express-api && npm test

# Tests E2E (requiere dispositivo conectado o emulador)
./gradlew connectedDevDebugAndroidTest

# Tests de navegador Playwright (requiere panel de administracion ejecutandose)
npx playwright test
```

### Tests en CI

En CI, los tests de Playwright y Android E2E se ejecutan contra el mismo entorno local (emuladores + Docker) -- no se usan servicios en la nube. Esto asegura que los tests nunca interfieran con testers reales.

## Solucion de Problemas

- **Puerto ya en uso**: `lsof -i :<port>` (Linux/macOS) o `netstat -ano | findstr :<port>` (Windows) para encontrar que esta usando el puerto.
- **Docker no esta ejecutandose**: Asegurate de que Docker Desktop este iniciado. Ejecuta `docker ps` para verificar.
- **Los emuladores de Firebase no inician**: Requiere Java 21+. Verifica con `java -version`.
- **Falla la compilacion de Android**: Asegurate de que JDK 21+ y Android SDK esten instalados. Intenta `./gradlew clean`.
- **Dispositivo adb no detectado**: Habilita la depuracion USB. Ejecuta `adb devices` para verificar.
- **Las imagenes no cargan**: El bucket de MinIO puede no estar creado. Ejecuta `cd express-api && NODE_ENV=local node ../local/seed.js`. Para dispositivos fisicos, ejecuta `adb reverse tcp:9002 tcp:9002`.
- **OTP no llega**: Revisa la salida de consola buscando lineas `[OTP-LOCAL]`. Tambien revisa la UI de Mailpit en http://localhost:8025.
- **Restablecer datos del emulador**: Elimina el directorio `local/firebase-emulator-data/` y reinicia.
- **Restablecer datos de MinIO**: Ejecuta `docker compose -f local/docker-compose.yml down -v` para eliminar volumenes.

## Despliegue

Los despliegues se gestionan a traves de workflows de GitHub Actions (`.github/workflows/`):

| Workflow | Disparador | Que hace |
|----------|---------|-------------|
| **PR Checks** | Automatico en PRs a `main` | Ejecuta lint, tests de Kotlin, tests de Express API, tests de Playwright (basado en archivos modificados) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Despliega Express API + web a dev, distribuye APK a testers, opcionalmente ejecuta tests de Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Despliega una release etiquetada a prod -- Express API, web, Play Store y App Store |

Workflows adicionales: **E2E Tests** (matriz de emuladores Android), **SonarCloud** (analisis estatico), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Desplegada en VMs de Oracle Cloud via SSH + PM2 (dev: Londres, prod: Singapur)
- **Android:** Empaquetada y subida a Google Play via CI
- **iOS:** Compilada y subida a App Store Connect / TestFlight via CI
- **Panel de administracion / web:** Desplegado en Cloudflare Pages

## Contribuir

Las contribuciones son bienvenidas! Por favor consulta [CONTRIBUTING.md](CONTRIBUTING.md) para las directrices.

## Licencia

Este proyecto esta licenciado bajo la Licencia Apache 2.0. Ver [LICENSE](LICENSE) para detalles.

## Agradecimientos

- [Firebase](https://firebase.google.com) -- Autenticacion, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Comunicacion de voz en tiempo real
- [Cloudflare](https://www.cloudflare.com) -- Almacenamiento R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM de nivel gratuito para Express API
- [Express.js](https://expressjs.com) -- Framework de servidor API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI declarativa moderna
- [Koin](https://insert-koin.io) -- Inyeccion de dependencias ligera
- [Coil](https://coil-kt.github.io/coil/) -- Carga de imagenes para Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Efectos animados de regalos y UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Fecha/hora multiplataforma
