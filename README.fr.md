# ShyTalk

**Les salons vocaux, reinventes.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | **Français** | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## A propos

ShyTalk est une application sociale de chat vocal ou les utilisateurs peuvent creer et rejoindre des salons de chat vocal en temps reel. Construite avec Kotlin Multiplatform (KMP), elle cible a la fois Android et iOS avec une base de code partagee. Que vous souhaitiez animer une conversation, ecouter ou vous connecter avec des personnes du monde entier, ShyTalk rend tout cela facile.

iOS est une plateforme supportee mais ce guide se concentre sur le developpement Android, qui est la cible de developpement principale.

## Fonctionnalites

### Salons de Chat Vocal
- Creez ou rejoignez des salons avec voix en temps reel propulsee par LiveKit
- Systeme de sieges structure avec roles de proprietaire, hote et participant
- Demandes de sieges et invitations -- demandez a rejoindre un siege ou invitez des auditeurs a parler
- Bulle flottante -- continuez le chat vocal tout en parcourant d'autres parties de l'app
- Expiration de salon -- les salons se ferment automatiquement quand le proprietaire est absent, avec des compteurs a rebours

### Messagerie
- Chat textuel en direct a cote de la voix dans chaque salon
- Messagerie privee avec conversations 1 a 1
- Discussions de groupe avec gestion des membres et permissions
- Indicateurs de saisie en temps reel
- Support des stickers

### Social
- Profils utilisateurs personnalisables avec photos, images de couverture, drapeaux de nationalite et biographies
- Systeme de suivi -- suivez d'autres utilisateurs et voyez quand ils sont actifs
- Mur de cadeaux -- presentez les cadeaux recus d'autres utilisateurs
- Systeme de blocage -- bloquez des utilisateurs dans les salons et profils

### Economie Virtuelle
- Economie basee sur les pieces avec portefeuille et historique des transactions
- Recompenses de connexion quotidiennes avec bonus de serie
- Systeme Lucky Spin (gacha) avec prix echelonnes
- Cadeaux virtuels -- envoyez et recevez des cadeaux animes pendant les chats vocaux
- Inventaire de sac a dos pour stocker les cadeaux
- Packs de pieces pour acheter des pieces
- Bannieres de diffusion avec effets de cadeaux animes

### Compte et Identite
- Authentification multi-fournisseur -- connectez-vous avec Google, Apple ou Email (OTP)
- Liez plusieurs methodes de connexion a un seul compte
- Identite utilisateur stable (uniqueId) qui persiste entre les projets Firebase
- Gestion des comptes lies dans les Parametres avec support de liaison/deliaison
- Liaison d'appareil -- chaque appareil est lie en permanence a un compte

### Moderation et Securite
- Outils de moderation -- couper le son, expulser, deplacer les sieges et gerer les hotes en tant que proprietaire de salon
- Systeme de signalement des utilisateurs avec flux de revision
- Systeme d'avertissement et de suspension pour violations de politiques
- Ecrans des standards communautaires, politique de confidentialite et conditions d'utilisation
- Flux d'acceptation legale pour les nouveaux utilisateurs
- Mise a jour forcee pour les versions obsoletes de l'app

### Ecrans de Demarrage
- Ecrans de lancement configurables affiches au demarrage de l'app
- Contenu gere par l'administrateur avec options de planification et de ciblage

### Securite
- Protection par code PIN pour l'acces a l'app
- Authentification biometrique -- empreinte digitale et reconnaissance faciale
- Verification OTP (mot de passe a usage unique) pour les actions sensibles

### Panneau d'Administration
- Tableau de bord de moderation web sur le site statique du projet
- Gestion des utilisateurs, moderation de contenu et configuration
- Gestion des modeles et cadeaux avec apercu en direct
- Streaming de logs et alertes en temps reel

### Compression d'Images
- Compression automatique des images lors du telechargement via Express API
- Reduit les couts de stockage et de bande passante tout en preservant la qualite

### Internationalisation
- 19 langues supportees nativement
- Localisation complete de toutes les chaines visibles par l'utilisateur

### Logs et Surveillance
- Logging structure sur Express API, apps mobiles et panneau d'administration
- Streaming de logs en temps reel dans le tableau de bord d'administration
- Bannissement d'appareils et de reseaux avec application automatique
- Systeme d'alertes pour erreurs critiques et anomalies
- Propagation de Trace ID pour le suivi des requetes de bout en bout

## Stack Technique

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

ShyTalk suit le pattern **MVVM** avec un **Repository Pattern** propre :

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

- **Module shared** (`commonMain`) -- Modeles, interfaces de repository, ViewModels et UI partages entre plateformes
- **Module app** -- Ecrans specifiques Android, implementations de repository et point d'entree
- **Module iosApp** -- Point d'entree specifique iOS
- **express-api** -- Backend Express.js fonctionnant sur Oracle Cloud Free Tier

## Structure du Projet

```
ShyTalk/
+-- app/                              # Module app Android
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
+-- iosApp/                           # Module app iOS
+-- express-api/                      # Serveur Express.js API
|   +-- src/
|       +-- routes/                   # Gestionnaires de routes API
|       +-- middleware/               # Middleware auth et logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Taches planifiees
+-- public/                           # Site statique & panneau d'administration
+-- local/                            # Environnement de developpement local (emulateurs, donnees de test)
+-- tests/web/                        # Tests navigateur Playwright
+-- scripts/                          # Scripts utilitaires
+-- .github/workflows/                # CI/CD (Checks PR, Deploy vers Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regles de securite Firestore
+-- database.rules.json               # Regles de securite RTDB
+-- firestore.indexes.json            # Index composites Firestore
+-- firebase.json                     # Configuration Firebase
```

## Demarrage

### Prerequis

- **Android Studio** Ladybug ou ulterieur
- **JDK 17+**
- **Node.js 24+**
- **Docker** (pour le serveur vocal LiveKit, le stockage MinIO, l'email Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Aucun compte cloud n'est necessaire pour commencer -- l'environnement local fonctionne entierement hors ligne.

### Developpement Local (Recommande)

Le moyen le plus rapide de commencer. Une seule commande demarre tout -- emulateurs Firebase, conteneurs Docker, Express API et compile l'app Android. Pas de comptes cloud, pas de couts, pas de limites de quota.

1. **Cloner et installer**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Tout demarrer**

   **Linux / macOS / Git Bash :**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell :**
   ```powershell
   .\local\start.ps1
   ```

   Cette unique commande :
   - Demarre les conteneurs Docker (serveur vocal LiveKit, stockage MinIO, email Mailpit)
   - Demarre les emulateurs Firebase (Firestore, Auth, RTDB)
   - Seme les donnees de test et cree le bucket de stockage MinIO
   - Demarre l'Express API
   - Compile et installe l'app Android (si un appareil est connecte)

   Quand c'est pret, vous verrez :
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

3. **Se connecter**
   - Utilisez le flux de connexion par email avec le compte de test : `claude-test@shytalk.dev` / `localdev123`
   - Ou creez un nouveau compte -- il utilisera les emulateurs locaux
   - La connexion Google/Apple ne fonctionne pas localement (pas de vrai OAuth) -- utilisez l'OTP par email a la place
   - Les codes OTP sont captures par Mailpit -- verifiez http://localhost:8025

4. **Executer sur un Appareil Physique**

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
   adb reverse tcp:9002 tcp:9002   # MinIO (stockage d'images)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Avec `adb reverse`, les adresses par defaut `10.0.2.2` dans le flavor local fonctionneront aussi sur un appareil physique -- pas de changement de configuration de build necessaire.

5. **Arreter les services locaux**

   **Linux / macOS / Git Bash :**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell :**
   ```powershell
   .\local\stop.ps1
   ```

   Ou appuyez sur `Ctrl+C` dans le terminal du script de demarrage. Les donnees de l'emulateur sont sauvegardees automatiquement et restaurees au prochain demarrage.

### URLs Utiles pour le Developpement Local

| Service | URL | Objectif |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Parcourir les donnees Firestore, utilisateurs Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Health check | http://localhost:3000/api/health | Verifier que l'API fonctionne |
| Mailpit | http://localhost:8025 | Voir les emails captures et codes OTP |
| MinIO Console | http://localhost:9001 | Parcourir les images et fichiers telecharges |

### Services Optionnels

**LibreTranslate (Traduction de Messages)**

Image Docker optionnelle de 6 Go+ pour tester la fonctionnalite de traduction localement :
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Non incluse dans la configuration par defaut en raison de la taille importante de l'image. La traduction fonctionne sans -- les messages restent simplement non traduits.

### Developpement Cloud (Optionnel)

Si vous devez tester avec de vrais services cloud (ex. vraies notifications push, vraie connexion Google) :

1. **Configuration Firebase**
   - Creez un projet Firebase sur [console.firebase.google.com](https://console.firebase.google.com)
   - Activez **la connexion Google** et **la connexion Apple** dans l'Authentification
   - Activez **Firestore**, **Realtime Database** et **Cloud Messaging**
   - Telechargez `google-services.json` et placez-le dans `app/src/dev/`

2. **Configuration Express API**
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

4. **Compiler l'app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variables d'Environnement

| Variable | Description | Ou |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON du compte de service Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID de compte Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Cle d'acces R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Cle secrete R2 | Express API |
| `R2_BUCKET_NAME` | Nom du bucket R2 (defaut : `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Cle API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Secret API LiveKit | Express API |
| `LIVEKIT_URL` | URL du serveur LiveKit | App Android (BuildConfig) |
| `WORKER_URL` | URL de base Express API | App Android (BuildConfig) |

## Tests

### Executer les Tests Localement

```bash
# Menu de test interactif (choisissez quoi executer) :
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Ou executez des suites individuelles :
bash local/test-unit.sh       # Tests unitaires Kotlin + Express API
bash local/test-playwright.sh # Tests web Playwright (necessite l'env local)
bash local/test-e2e.sh        # Tests E2E Android (necessite l'env local + appareil)
bash local/test-lint.sh       # ktlint + ESLint

# Voir le rapport de tests Allure :
npx allure serve allure-results
```

### Suites de Tests

| Suite | Commande | Nombre |
|-------|---------|-------|
| Tests unitaires Kotlin | `./gradlew test` | 100+ tests |
| Tests Express API | `cd express-api && npm test` | 1 540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 fichiers de fonctionnalites |
| Tests web Playwright | `npx playwright test` | 28 specs |

```bash
# Tests unitaires Kotlin/KMP
./gradlew test

# Tests Express API
cd express-api && npm test

# Tests E2E (necessite un appareil connecte ou emulateur)
./gradlew connectedDevDebugAndroidTest

# Tests navigateur Playwright (necessite le panneau d'admin en fonctionnement)
npx playwright test
```

### Tests en CI

En CI, les tests Playwright et Android E2E s'executent contre le meme environnement local (emulateurs + Docker) -- aucun service cloud n'est utilise. Cela garantit que les tests n'interferent jamais avec les vrais testeurs.

## Depannage

- **Port deja utilise** : `lsof -i :<port>` (Linux/macOS) ou `netstat -ano | findstr :<port>` (Windows) pour trouver ce qui utilise le port.
- **Docker ne fonctionne pas** : Assurez-vous que Docker Desktop est demarre. Executez `docker ps` pour verifier.
- **Les emulateurs Firebase ne demarrent pas** : Necessite Java 11+. Verifiez avec `java -version`.
- **La compilation Android echoue** : Assurez-vous que JDK 17+ et Android SDK sont installes. Essayez `./gradlew clean`.
- **Appareil adb non detecte** : Activez le debogage USB. Executez `adb devices` pour verifier.
- **Les images ne chargent pas** : Le bucket MinIO n'a peut-etre pas ete cree. Executez `cd express-api && NODE_ENV=local node ../local/seed.js`. Pour les appareils physiques, executez `adb reverse tcp:9002 tcp:9002`.
- **OTP ne arrive pas** : Verifiez la sortie console pour les lignes `[OTP-LOCAL]`. Verifiez aussi l'UI Mailpit sur http://localhost:8025.
- **Reinitialiser les donnees de l'emulateur** : Supprimez le repertoire `local/firebase-emulator-data/` et redemarrez.
- **Reinitialiser les donnees MinIO** : Executez `docker compose -f local/docker-compose.yml down -v` pour supprimer les volumes.

## Deploiement

Les deploiements sont geres via les workflows GitHub Actions (`.github/workflows/`) :

| Workflow | Declencheur | Ce qu'il fait |
|----------|---------|-------------|
| **PR Checks** | Automatique sur PRs vers `main` | Execute lint, tests Kotlin, tests Express API, tests Playwright (selon les fichiers modifies) |
| **Deploy to Dev** | Manuel (`workflow_dispatch`) | Deploie Express API + web vers dev, distribue l'APK aux testeurs, execute optionnellement les tests Playwright |
| **Deploy to Prod** | Manuel (`workflow_dispatch`) | Deploie une release taguee vers prod -- Express API, web, Play Store et App Store |

Workflows supplementaires : **E2E Tests** (matrice d'emulateurs Android), **SonarCloud** (analyse statique), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API :** Deployee sur VMs Oracle Cloud via SSH + PM2 (dev : Londres, prod : Singapour)
- **Android :** Empaquetee et uploadee sur Google Play via CI
- **iOS :** Compilee et uploadee sur App Store Connect / TestFlight via CI
- **Panneau d'admin / web :** Deploye sur Cloudflare Pages

## Contribuer

Les contributions sont les bienvenues ! Veuillez consulter [CONTRIBUTING.md](CONTRIBUTING.md) pour les directives.

## Licence

Ce projet est sous licence Apache 2.0. Voir [LICENSE](LICENSE) pour les details.

## Remerciements

- [Firebase](https://firebase.google.com) -- Authentification, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Communication vocale en temps reel
- [Cloudflare](https://www.cloudflare.com) -- Stockage R2, hebergement Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM gratuite pour Express API
- [Express.js](https://expressjs.com) -- Framework serveur API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI declarative moderne
- [Koin](https://insert-koin.io) -- Injection de dependances legere
- [Coil](https://coil-kt.github.io/coil/) -- Chargement d'images pour Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Effets animes de cadeaux et UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Date/heure multiplateforme
