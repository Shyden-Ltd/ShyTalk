# ShyTalk

**Salas de chat de voz, reimaginadas.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | **Español** | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Acerca del proyecto

ShyTalk es una aplicacion social de chat de voz donde los usuarios pueden crear y unirse a salas de chat de voz en tiempo real. Construida con Kotlin Multiplatform (KMP), esta dirigida tanto a Android como a iOS con una base de codigo compartida. Ya sea que quieras organizar una conversacion, escuchar o conectarte con personas de todo el mundo, ShyTalk lo hace facil.

## Caracteristicas

### Salas de chat de voz
- Crea o unete a salas con voz en tiempo real impulsada por LiveKit
- Sistema de asientos estructurado con roles de propietario, anfitrion y asistente
- Solicitudes e invitaciones de asientos -- solicita unirte a un asiento o invita a oyentes a hablar
- Burbuja flotante -- continua el chat de voz mientras navegas por otras partes de la aplicacion
- Expiracion de sala -- las salas se cierran automaticamente cuando el propietario esta ausente, con temporizadores de cuenta regresiva

### Mensajeria
- Chat de texto en vivo junto con voz en cada sala
- Mensajeria privada con conversaciones 1 a 1
- Chats grupales con gestion de miembros y permisos
- Indicadores de escritura en tiempo real
- Soporte de stickers

### Social
- Perfiles de usuario personalizables con fotos, imagenes de portada, banderas de nacionalidad y biografias
- Sistema de seguimiento -- sigue a otros usuarios y ve cuando estan activos
- Muro de regalos -- muestra los regalos recibidos de otros usuarios
- Sistema de bloqueo -- bloquea usuarios en salas y perfiles

### Economia virtual
- Economia basada en monedas con billetera e historial de transacciones
- Recompensas de inicio de sesion diario con bonificaciones por racha
- Sistema de Giro de la Suerte (gacha) con premios escalonados
- Regalos virtuales -- envia y recibe regalos animados durante los chats de voz
- Inventario de mochila para almacenar regalos
- Paquetes de monedas para comprar monedas
- Banners de transmision con efectos de regalo animados

### Cuenta e identidad
- Autenticacion multi-proveedor -- inicia sesion con Google, Apple o correo electronico (OTP)
- Vincula multiples metodos de inicio de sesion a una sola cuenta
- Identidad de usuario estable (uniqueId) que persiste entre proyectos de Firebase
- Gestion de cuentas vinculadas en Configuracion con soporte para vincular/desvincular
- Vinculacion de dispositivo -- cada dispositivo esta permanentemente vinculado a una cuenta

### Moderacion y seguridad
- Herramientas de moderacion -- silenciar, expulsar, mover asientos y gestionar anfitriones como propietario de sala
- Sistema de reportes de usuarios con flujo de revision
- Sistema de advertencias y suspensiones por violaciones de politicas
- Pantallas de estandares comunitarios, politica de privacidad y terminos de servicio
- Flujo de aceptacion legal para nuevos usuarios
- Actualizacion forzada para versiones de la aplicacion desactualizadas

### Pantallas de inicio
- Pantallas de lanzamiento configurables que se muestran al iniciar la aplicacion
- Contenido administrado por el administrador con opciones de programacion y segmentacion

### Seguridad
- Proteccion con codigo PIN para el acceso a la aplicacion
- Autenticacion biometrica -- huella dactilar y reconocimiento facial
- Verificacion OTP (contrasena de un solo uso) para acciones sensibles

### Panel de administracion
- Panel de moderacion basado en web en el sitio estatico del proyecto
- Gestion de usuarios, moderacion de contenido y configuracion
- Gestion de plantillas y regalos con vista previa en vivo
- Transmision de registros en tiempo real y alertas

### Compresion de imagenes
- Compresion automatica de imagenes al subir a traves de Express API
- Reduce costos de almacenamiento y ancho de banda manteniendo la calidad

### Internacionalizacion
- 19 idiomas soportados de serie
- Localizacion completa para todas las cadenas visibles al usuario

### Registro y monitoreo
- Registro estructurado a traves de Express API, aplicaciones moviles y panel de administracion
- Transmision de registros en tiempo real en el panel de administracion
- Prohibicion de dispositivos y redes con aplicacion automatica
- Sistema de alertas para errores criticos y anomalias
- Propagacion de Trace ID para seguimiento de solicitudes de extremo a extremo

## Stack tecnologico

| Capa | Tecnologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arquitectura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autenticacion** | Firebase Authentication (Google, Apple, Email+OTP) con sistema de identidad multi-proveedor |
| **Base de datos** | Cloud Firestore |
| **Tiempo real** | Firebase Realtime Database |
| **Almacenamiento** | Cloudflare R2 (via proxy Express API) |
| **Servidor API** | Express.js en Oracle Cloud Free Tier |
| **Voz** | LiveKit |
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

- **Modulo compartido** (`commonMain`) -- Modelos, interfaces de repositorio, ViewModels y UI compartidos entre plataformas
- **Modulo app** -- Pantallas especificas de Android, implementaciones de repositorio y punto de entrada
- **Modulo iosApp** -- Punto de entrada especifico de iOS
- **express-api** -- Backend Express.js ejecutandose en Oracle Cloud Free Tier

## Estructura del proyecto

```
ShyTalk/
+-- app/                              # Modulo de la app Android
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
|       |   |   +-- auth/             # Pantalla de inicio de sesion con Google
|       |   |   +-- profile/          # Pantalla de perfil
|       |   |   +-- room/             # Pantalla de sala
|       |   |   +-- settings/         # Configuracion de la app
|       |   +-- navigation/           # NavGraph y rutas de pantalla
|       +-- test/                     # Tests unitarios
|       +-- androidTest/              # Tests E2E (Compose UI Test)
+-- shared/                           # Modulo compartido KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Modulos Koin compartidos
|       |   +-- model/                # Modelos de datos (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Componentes compartidos
|       |   +-- util/                 # Utilidades y constantes
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Interfaces de repositorio
|       +-- feature/                  # Modulos de funciones compartidos
+-- iosApp/                           # Modulo de la app iOS
+-- express-api/                      # Servidor Express.js API
|   +-- src/
|       +-- routes/                   # Manejadores de rutas API
|       +-- middleware/               # Auth, middleware de registro
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tareas programadas
+-- public/                           # Sitio estatico y panel de administracion
+-- local/                            # Entorno de desarrollo local (emuladores, datos semilla)
+-- tests/web/                        # Tests de navegador Playwright
+-- scripts/                          # Scripts de utilidad
+-- .github/workflows/                # CI/CD (Checks de PR, Deploy a Dev/Prod, E2E, lint)
+-- firestore.rules                   # Reglas de seguridad de Firestore
+-- database.rules.json               # Reglas de seguridad de RTDB
+-- firestore.indexes.json            # Indices compuestos de Firestore
+-- firebase.json                     # Configuracion de Firebase
```

## Primeros pasos

### Requisitos previos

- **Android Studio** Ladybug o mas reciente
- **JDK 17+**
- **Node.js 24+**
- **Docker** (para servidor LiveKit local)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Desarrollo local (Recomendado)

La forma mas rapida de empezar. Usa emuladores de Firebase y un contenedor Docker de LiveKit local -- no se necesitan cuentas en la nube, sin costos, sin limites de cuota.

1. **Clonar e instalar**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Iniciar servicios locales**
   ```bash
   bash local/start.sh
   ```
   Esto inicia los emuladores de Firebase (Firestore, Auth, RTDB) y un contenedor Docker de LiveKit. En la primera ejecucion, siembra automaticamente datos de prueba (usuario administrador, regalos de ejemplo, configuracion).

   Veras:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Iniciar Express API** (en una nueva terminal)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edita valores R2/SMTP si es necesario
   npm run local
   ```
   La API se inicia en `http://localhost:3000`. Prueba: `curl http://localhost:3000/api/health`

4. **Ejecutar en emulador Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   El flavor de build `local` se conecta a `10.0.2.2` (loopback del emulador Android a tu maquina). Simplemente funciona -- no se necesita configuracion adicional.

5. **Ejecutar en un dispositivo fisico**

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
   adb reverse tcp:8080 tcp:8080   # Emulador Firestore
   adb reverse tcp:9099 tcp:9099   # Emulador Auth
   adb reverse tcp:9000 tcp:9000   # Emulador RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Con `adb reverse`, las direcciones predeterminadas `10.0.2.2` en el flavor local funcionaran tambien en un dispositivo fisico -- no se necesitan cambios en la configuracion de build.

6. **Iniciar sesion**
   - Usa el flujo de inicio de sesion por correo electronico con la cuenta de prueba sembrada: `claude-test@shytalk.dev` / `localdev123`
   - O crea una cuenta nueva -- usara los emuladores locales
   - El inicio de sesion con Google/Apple no funciona localmente (sin OAuth real) -- usa OTP por correo electronico en su lugar

7. **Detener servicios locales**
   ```bash
   bash local/stop.sh
   ```
   O presiona `Ctrl+C` en la terminal de `start.sh`. Los datos del emulador se guardan automaticamente y se restauran en el proximo inicio.

### URLs utiles para desarrollo local

| Servicio | URL | Proposito |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Explorar datos de Firestore, usuarios Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Verificacion de salud | http://localhost:3000/api/health | Verificar que la API esta ejecutandose |

### Desarrollo en la nube (Opcional)

Si necesitas probar contra servicios en la nube reales (ej. notificaciones push reales, inicio de sesion real con Google):

1. **Configurar Firebase**
   - Crea un proyecto Firebase en [console.firebase.google.com](https://console.firebase.google.com)
   - Habilita **Inicio de sesion con Google** e **Inicio de sesion con Apple** en Autenticacion
   - Habilita **Firestore**, **Realtime Database** y **Cloud Messaging**
   - Descarga `google-services.json` y colocalo en `app/src/dev/`

2. **Configurar Express API**
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

4. **Compilar la app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variables de entorno

| Variable | Descripcion | Donde |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON de cuenta de servicio Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID de cuenta Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Clave de acceso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Clave secreta R2 | Express API |
| `R2_BUCKET_NAME` | Nombre del bucket R2 (predeterminado: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Clave API de LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Secreto API de LiveKit | Express API |
| `LIVEKIT_URL` | URL del servidor LiveKit | App Android (BuildConfig) |
| `WORKER_URL` | URL base de Express API | App Android (BuildConfig) |

## Pruebas

| Suite | Comando | Cantidad |
|-------|---------|-------|
| Tests unitarios Kotlin | `./gradlew test` | 100+ tests |
| Tests Express API | `cd express-api && npm test` | 1,540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 archivos de funciones |
| Tests web Playwright | `npx playwright test` | 28 especificaciones |

```bash
# Tests unitarios Kotlin/KMP
./gradlew test

# Tests Express API
cd express-api && npm test

# Tests E2E (requiere dispositivo conectado o emulador)
./gradlew connectedDevDebugAndroidTest

# Tests de navegador Playwright (requiere panel de administracion ejecutandose)
npx playwright test
```

## Despliegue

Los despliegues se gestionan a traves de workflows de GitHub Actions (`.github/workflows/`):

| Workflow | Disparador | Que hace |
|----------|---------|-------------|
| **PR Checks** | Automatico en PRs a `main` | Ejecuta lint, tests Kotlin, tests Express API, tests Playwright (basado en archivos modificados) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Despliega Express API + web a dev, distribuye APK a testers, opcionalmente ejecuta tests Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Despliega un release etiquetado a prod -- Express API, web, Play Store y App Store |

Workflows adicionales: **E2E Tests** (matriz de emulador Android), **SonarCloud** (analisis estatico), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Desplegado en VMs de Oracle Cloud via SSH + PM2 (dev: Londres, prod: Singapur)
- **Android:** Empaquetado y subido a Google Play via CI
- **iOS:** Compilado y subido a App Store Connect / TestFlight via CI
- **Panel de administracion / Web:** Desplegado en Cloudflare Pages

## Contribuir

Las contribuciones son bienvenidas! Por favor consulta [CONTRIBUTING.md](CONTRIBUTING.md) para las directrices.

## Licencia

Este proyecto esta licenciado bajo la Licencia Apache 2.0. Consulta [LICENSE](LICENSE) para mas detalles.

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
