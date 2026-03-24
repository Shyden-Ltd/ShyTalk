# ShyTalk

**Les salons vocaux, reinventes.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | **Français** | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## A propos

ShyTalk est une application sociale de chat vocal ou les utilisateurs peuvent creer et rejoindre des salons de chat vocal en temps reel. Construite avec Kotlin Multiplatform (KMP), elle cible a la fois Android et iOS avec une base de code partagee. Que vous souhaitiez animer une conversation, ecouter ou vous connecter avec des personnes du monde entier, ShyTalk rend cela facile.

## Fonctionnalites

### Salons de chat vocal
- Creez ou rejoignez des salons avec de la voix en temps reel propulsee par LiveKit
- Systeme de places structure avec des roles de proprietaire, animateur et participant
- Demandes et invitations de places -- demandez a rejoindre une place ou invitez des auditeurs a parler
- Bulle flottante -- continuez le chat vocal tout en naviguant dans d'autres parties de l'application
- Expiration de salon -- les salons se ferment automatiquement lorsque le proprietaire est absent, avec des minuteries de compte a rebours

### Messagerie
- Chat textuel en direct aux cotes de la voix dans chaque salon
- Messagerie privee avec des conversations individuelles
- Chats de groupe avec gestion des membres et des permissions
- Indicateurs de saisie en temps reel
- Support des stickers

### Social
- Profils utilisateurs personnalisables avec photos, images de couverture, drapeaux de nationalite et biographies
- Systeme de suivi -- suivez d'autres utilisateurs et voyez quand ils sont actifs
- Mur de cadeaux -- exposez les cadeaux recus d'autres utilisateurs
- Systeme de blocage -- bloquez des utilisateurs a travers les salons et les profils

### Economie virtuelle
- Economie basee sur des pieces avec portefeuille et historique des transactions
- Recompenses de connexion quotidienne avec bonus de serie
- Systeme de Roue de la Chance (gacha) avec des prix par paliers
- Cadeaux virtuels -- envoyez et recevez des cadeaux animes pendant les chats vocaux
- Inventaire de sac a dos pour stocker les cadeaux
- Packs de pieces pour acheter des pieces
- Bannieres de diffusion avec effets de cadeaux animes

### Compte et identite
- Authentification multi-fournisseur -- connectez-vous avec Google, Apple ou e-mail (OTP)
- Liez plusieurs methodes de connexion a un seul compte
- Identite utilisateur stable (uniqueId) qui persiste entre les projets Firebase
- Gestion des comptes lies dans les Parametres avec support de liaison/deliaison
- Liaison d'appareil -- chaque appareil est lie de facon permanente a un seul compte

### Moderation et securite
- Outils de moderation -- couper le son, expulser, deplacer les places et gerer les animateurs en tant que proprietaire de salon
- Systeme de signalement des utilisateurs avec workflow de revision
- Systeme d'avertissement et de suspension pour les violations de politique
- Ecrans des normes communautaires, de la politique de confidentialite et des conditions d'utilisation
- Flux d'acceptation legale pour les nouveaux utilisateurs
- Mise a jour forcee pour les versions obsoletes de l'application

### Ecrans de demarrage
- Ecrans de lancement configurables affiches au demarrage de l'application
- Contenu gere par l'administrateur avec des options de planification et de ciblage

### Securite
- Protection par code PIN pour l'acces a l'application
- Authentification biometrique -- empreinte digitale et reconnaissance faciale
- Verification OTP (mot de passe a usage unique) pour les actions sensibles

### Panneau d'administration
- Tableau de bord de moderation web sur le site statique du projet
- Gestion des utilisateurs, moderation du contenu et configuration
- Gestion des modeles et des cadeaux avec apercu en direct
- Streaming de logs en temps reel et alertes

### Compression d'images
- Compression automatique des images lors du telechargement via Express API
- Reduit les couts de stockage et de bande passante tout en preservant la qualite

### Internationalisation
- 19 langues supportees nativement
- Localisation complete pour toutes les chaines visibles par l'utilisateur

### Journalisation et surveillance
- Journalisation structuree a travers Express API, applications mobiles et panneau d'administration
- Streaming de logs en temps reel dans le tableau de bord d'administration
- Bannissement d'appareils et de reseaux avec application automatique
- Systeme d'alertes pour les erreurs critiques et les anomalies
- Propagation de Trace ID pour le suivi des requetes de bout en bout

## Stack technique

| Couche | Technologie |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Authentification** | Firebase Authentication (Google, Apple, Email+OTP) avec systeme d'identite multi-fournisseur |
| **Base de donnees** | Cloud Firestore |
| **Temps reel** | Firebase Realtime Database |
| **Stockage** | Cloudflare R2 (via proxy Express API) |
| **Serveur API** | Express.js sur Oracle Cloud Free Tier |
| **Voix** | LiveKit |
| **Notifications push** | Firebase Cloud Messaging |
| **Chargement d'images** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Heure** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architecture

ShyTalk suit le patron **MVVM** avec un **Repository Pattern** propre :

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

- **Module partage** (`commonMain`) -- Modeles, interfaces de repository, ViewModels et UI partages entre les plateformes
- **Module app** -- Ecrans specifiques a Android, implementations de repository et point d'entree
- **Module iosApp** -- Point d'entree specifique a iOS
- **express-api** -- Backend Express.js fonctionnant sur Oracle Cloud Free Tier

## Structure du projet

```
ShyTalk/
+-- app/                              # Module de l'app Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Point d'entree de l'application
|       |   +-- MainActivity.kt       # Activite principale
|       |   +-- core/
|       |   |   +-- di/               # Module Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Voix LiveKit, presence, notifications
|       |   |   +-- repository/       # Implementations de repository
|       |   +-- feature/
|       |   |   +-- auth/             # Ecran de connexion Google
|       |   |   +-- profile/          # Ecran de profil
|       |   |   +-- room/             # Ecran de salon
|       |   |   +-- settings/         # Parametres de l'app
|       |   +-- navigation/           # NavGraph & routes d'ecran
|       +-- test/                     # Tests unitaires
|       +-- androidTest/              # Tests E2E (Compose UI Test)
+-- shared/                           # Module partage KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Modules Koin partages
|       |   +-- model/                # Modeles de donnees (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Composants partages
|       |   +-- util/                 # Utilitaires & constantes
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Interfaces de repository
|       +-- feature/                  # Modules de fonctionnalites partages
+-- iosApp/                           # Module de l'app iOS
+-- express-api/                      # Serveur Express.js API
|   +-- src/
|       +-- routes/                   # Gestionnaires de routes API
|       +-- middleware/               # Auth, middleware de journalisation
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Taches planifiees
+-- public/                           # Site statique & panneau d'administration
+-- local/                            # Environnement de developpement local (emulateurs, donnees de test)
+-- tests/web/                        # Tests navigateur Playwright
+-- scripts/                          # Scripts utilitaires
+-- .github/workflows/                # CI/CD (Checks de PR, Deploy vers Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regles de securite Firestore
+-- database.rules.json               # Regles de securite RTDB
+-- firestore.indexes.json            # Index composes Firestore
+-- firebase.json                     # Configuration Firebase
```

## Pour commencer

### Prerequis

- **Android Studio** Ladybug ou plus recent
- **JDK 17+**
- **Node.js 24+**
- **Docker** (pour le serveur LiveKit local)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Developpement local (Recommande)

La facon la plus rapide de commencer. Utilise les emulateurs Firebase et un conteneur Docker LiveKit local -- pas besoin de comptes cloud, pas de couts, pas de limites de quota.

1. **Cloner et installer**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Demarrer les services locaux**
   ```bash
   bash local/start.sh
   ```
   Cela demarre les emulateurs Firebase (Firestore, Auth, RTDB) et un conteneur Docker LiveKit. Lors de la premiere execution, les donnees de test sont automatiquement inserees (utilisateur admin, cadeaux exemples, configuration).

   Vous verrez :
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Demarrer Express API** (dans un nouveau terminal)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Modifiez les valeurs R2/SMTP si necessaire
   npm run local
   ```
   L'API demarre sur `http://localhost:3000`. Test : `curl http://localhost:3000/api/health`

4. **Executer sur l'emulateur Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Le flavor de build `local` se connecte a `10.0.2.2` (loopback de l'emulateur Android vers votre machine). Ca fonctionne directement -- pas de configuration supplementaire necessaire.

5. **Executer sur un appareil physique**

   Votre telephone doit etre sur le **meme reseau Wi-Fi** que votre machine de developpement.

   a. Trouvez l'IP locale de votre machine :
   ```bash
   # Windows
   ipconfig    # Cherchez "IPv4 Address" sous votre adaptateur Wi-Fi (ex. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # ou : ip addr show
   ```

   b. Mettez a jour le flavor de build local pour utiliser votre IP au lieu de `10.0.2.2`. Dans `app/build.gradle.kts`, trouvez le flavor `local` et changez :
   ```kotlin
   // Remplacez 10.0.2.2 par l'IP locale de votre machine
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Connectez votre appareil par USB et activez le debogage USB, puis :
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternativement, utilisez **adb reverse** pour eviter de modifier le code (l'appareil redirige localhost vers votre machine) :
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulateur Firestore
   adb reverse tcp:9099 tcp:9099   # Emulateur Auth
   adb reverse tcp:9000 tcp:9000   # Emulateur RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Avec `adb reverse`, les adresses `10.0.2.2` par defaut du flavor local fonctionneront aussi sur un appareil physique -- pas besoin de modifier la configuration de build.

6. **Se connecter**
   - Utilisez le flux de connexion par e-mail avec le compte de test insere : `claude-test@shytalk.dev` / `localdev123`
   - Ou creez un nouveau compte -- il utilisera les emulateurs locaux
   - La connexion Google/Apple ne fonctionne pas localement (pas de vrai OAuth) -- utilisez l'OTP par e-mail a la place

7. **Arreter les services locaux**
   ```bash
   bash local/stop.sh
   ```
   Ou appuyez sur `Ctrl+C` dans le terminal `start.sh`. Les donnees de l'emulateur sont automatiquement sauvegardees et restaurees au prochain demarrage.

### URLs utiles pour le developpement local

| Service | URL | Objectif |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Parcourir les donnees Firestore, utilisateurs Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Verification de sante | http://localhost:3000/api/health | Verifier que l'API fonctionne |

### Developpement cloud (Optionnel)

Si vous devez tester contre de vrais services cloud (ex. vraies notifications push, vraie connexion Google) :

1. **Configurer Firebase**
   - Creez un projet Firebase sur [console.firebase.google.com](https://console.firebase.google.com)
   - Activez **Connexion Google** et **Connexion Apple** dans l'Authentification
   - Activez **Firestore**, **Realtime Database** et **Cloud Messaging**
   - Telechargez `google-services.json` et placez-le dans `app/src/dev/`

2. **Configurer Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Editez avec vos identifiants cloud
   npm install
   npm start
   ```

3. **Deployer les regles Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Compiler l'application Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variables d'environnement

| Variable | Description | Ou |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON du compte de service Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID de compte Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Cle d'acces R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Cle secrete R2 | Express API |
| `R2_BUCKET_NAME` | Nom du bucket R2 (par defaut : `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Cle API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Secret API LiveKit | Express API |
| `LIVEKIT_URL` | URL du serveur LiveKit | App Android (BuildConfig) |
| `WORKER_URL` | URL de base Express API | App Android (BuildConfig) |

## Tests

| Suite | Commande | Nombre |
|-------|---------|-------|
| Tests unitaires Kotlin | `./gradlew test` | 100+ tests |
| Tests Express API | `cd express-api && npm test` | 1 540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 fichiers de fonctionnalites |
| Tests web Playwright | `npx playwright test` | 28 specifications |

```bash
# Tests unitaires Kotlin/KMP
./gradlew test

# Tests Express API
cd express-api && npm test

# Tests E2E (necessite un appareil connecte ou un emulateur)
./gradlew connectedDevDebugAndroidTest

# Tests navigateur Playwright (necessite le panneau d'administration en cours d'execution)
npx playwright test
```

## Deploiement

Les deploiements sont geres via les workflows GitHub Actions (`.github/workflows/`) :

| Workflow | Declencheur | Ce qu'il fait |
|----------|---------|-------------|
| **PR Checks** | Automatique sur les PRs vers `main` | Execute le lint, les tests Kotlin, les tests Express API, les tests Playwright (selon les fichiers modifies) |
| **Deploy to Dev** | Manuel (`workflow_dispatch`) | Deploie Express API + web vers dev, distribue l'APK aux testeurs, execute optionnellement les tests Playwright |
| **Deploy to Prod** | Manuel (`workflow_dispatch`) | Deploie une version taguee en prod -- Express API, web, Play Store et App Store |

Workflows supplementaires : **E2E Tests** (matrice d'emulateurs Android), **SonarCloud** (analyse statique), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API :** Deploye sur des VMs Oracle Cloud via SSH + PM2 (dev : Londres, prod : Singapour)
- **Android :** Empaquete et televerse sur Google Play via CI
- **iOS :** Compile et televerse sur App Store Connect / TestFlight via CI
- **Panneau d'administration / Web :** Deploye sur Cloudflare Pages

## Contribuer

Les contributions sont les bienvenues ! Veuillez consulter [CONTRIBUTING.md](CONTRIBUTING.md) pour les directives.

## Licence

Ce projet est sous licence Apache 2.0. Voir [LICENSE](LICENSE) pour les details.

## Remerciements

- [Firebase](https://firebase.google.com) -- Authentification, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Communication vocale en temps reel
- [Cloudflare](https://www.cloudflare.com) -- Stockage R2, hebergement Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM gratuite pour Express API
- [Express.js](https://expressjs.com) -- Framework de serveur API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI declarative moderne
- [Koin](https://insert-koin.io) -- Injection de dependances legere
- [Coil](https://coil-kt.github.io/coil/) -- Chargement d'images pour Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Effets animes de cadeaux et d'interface
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Date/heure multiplateforme
