# Exécuteur de tests de parcours sur appareil de ShyTalk

_Ceci est une traduction de JOURNEY-RUNNER.md._

`device-journey-runner.js` pilote la **véritable application ShyTalk sur un téléphone connecté**
à travers des parcours utilisateur de bout en bout et écrit un **rapport détaillé de réussite/échec**
que vous pouvez lire — vous exécutez donc une seule commande et lisez un seul rapport au lieu de
toucher chaque étape à la main.

C'est un exécuteur **hybride**. Chaque parcours peut vérifier trois couches à la fois :

1. **UI** — touche/inspecte l'application en direct via `adb` + `uiautomator` (les
   `testTag` de Compose apparaissent comme des `resource-id` dans le dump ; les boîtes de dialogue sont
   reconnues par leur texte visible).
2. **Firestore** — lit l'émulateur local directement (via `firebase-admin`) pour
   confirmer l'état de la base de données derrière chaque action.
3. **Serveur / API** — se connecte en tant que chaque persona (véritable jeton d'ID Firebase de
   l'émulateur Auth) et appelle l'`express-api`, de sorte qu'il vérifie les **règles que le
   serveur applique** (la barrière de cohort de l'OSA, la dérogation administrateur, la modération) — qui
   ne sont _pas_ visibles dans l'UI seule.

> Les traductions de ce guide se trouvent dans `journey-runner-locales/` (20 langues).

---

## 1. Prérequis

| Vous avez besoin                        | Comment                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Docker Desktop** en cours d'exécution | pour les émulateurs Firebase + LiveKit/MinIO                                                                                                                             |
| **La pile locale démarrée**             | `bash local/start.sh` (depuis la racine du dépôt) — démarre les émulateurs Firebase + l'express-api. Laissez-la tourner.                                                 |
| **Personas amorcées**                   | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent ; amorce la distribution de test P‑02…P‑19 avec le mot de passe `localdev123`) |
| **Un téléphone connecté**               | `adb devices` doit en lister un (câble USB **ou** `adb` sans fil). Un émulateur Android fonctionne aussi.                                                                |
| **Java 21+ et le SDK Android**          | nécessaires uniquement la première fois, pour que l'exécuteur puisse compiler l'application si l'APK est absent                                                          |

L'exécuteur compile lui-même l'APK de débogage `local` s'il n'est pas déjà compilé.

---

## 2. Exécutez-le

Depuis la racine du dépôt :

```sh
# Exécuter toute la suite contre la pile locale
node express-api/scripts/device-journey-runner.js

# Voir la liste des parcours sans rien exécuter
node express-api/scripts/device-journey-runner.js --list

# Exécuter uniquement des parcours spécifiques
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Forcer d'abord une compilation neuve de l'APK
node express-api/scripts/device-journey-runner.js --rebuild

# Liste complète des options
node express-api/scripts/device-journey-runner.js --help
```

Options : `--target local|dev` (par défaut `local`) · `--serial <adb-serial>`
(par défaut : sélection automatique) · `--journeys <ids>` · `--rebuild` · `--no-reset` (ignore
la réinstallation propre dans le parcours de smoke) · `--out <dir>` · `--list` · `--help`.

L'exécuteur épingle **un seul** serial adb pour chaque commande, de sorte qu'il fonctionne même lorsqu'un
téléphone apparaît deux fois (USB + sans fil). Pour la cible `local`, il met en place
des tunnels `adb reverse` afin que l'application sur l'appareil atteigne la pile sur votre machine.

---

## 3. Consultez les résultats

Quand il termine, il affiche un résumé et écrit, sous `journey-results/` :

| Fichier                         | Quoi                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Lisez ceci** — par parcours, par étape ✅/❌ avec la raison, les testTags à l'écran et un lien de capture pour chaque étape |
| `latest-report.json`            | les mêmes données, lisibles par machine                                                                                       |
| `runs/<runId>/*.png`            | une capture de chaque étape (réussite _et_ échec)                                                                             |
| `runs/<runId>/report.{md,json}` | le rapport archivé pour cette exécution spécifique                                                                            |

Le code de sortie est `0` lorsque tous les parcours ont réussi, et `1` lorsque l'un d'eux a échoué. En cas d'échec,
l'étape enregistre exactement ce qui était à l'écran, de sorte que vous pouvez voir _pourquoi_ sans
repiloter le téléphone.

---

## 4. Ce que couvrent les parcours

Exécutez `--list` pour l'ensemble actuel. En un coup d'œil, la suite couvre :

- **Smoke** — installation propre → acceptation des conditions légales → connexion, backend joignable.
- **Connexion par cohort** — les personas adulte / mineur / administrateur se connectent via le
  sélecteur de personas de dev intégré à l'application ; l'identité est confirmée par rapport à la superposition de débogage et au
  champ `cohort` de Firestore.
- **Barrière de cohort de l'OSA** — un mineur ne peut ni suivre ni voir un adulte (le serveur renvoie
  `404`, et l'écriture Firestore n'a jamais lieu), tandis que les actions au sein de la même cohort
  réussissent — ce qui prouve que la barrière est spécifique à la cohort, et non un blocage général.
- **Admin** — la dérogation de cohort est réservée au personnel (un membre ordinaire est rejeté avec
  `422` ; un compte du personnel réussit et écrit une ligne d'audit réglementaire).
- **Modération** — signalement → suspension par l'administrateur (+ audit) → recours → levée de la suspension, entièrement
  appliquée par le serveur, avec un nettoyage idempotent.

L'authentification dans les parcours utilise toujours le **sélecteur de personas de dev intégré à l'application** — jamais
la véritable connexion Google/Apple.

> **Note sur les spécifications des parcours.** Les plans en Gherkin dans
> `journey-tests/j01-j19` sont en partie _aspirationnels_ : ils font référence à
> une UI que l'application livrée ne possède pas (p. ex. un écran d'inscription par e-mail/mot de passe, des onglets cachés
> pour les mineurs, un écran de découverte). L'exécuteur fait donc correspondre l'intention réelle de chaque parcours
> à l'application **réelle** + Firestore + API, et consigne de telles
> divergences comme des findings plutôt que d'échouer sur de la fiction.

---

## 5. Dépannage

| Symptôme                                                    | Solution                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                       | Branchez / appairez le téléphone ; vérifiez `adb devices`.                                                                            |
| Bloqué en atteignant SignIn / "backend NOT reachable"       | La pile locale n'est pas démarrée ou les tunnels `adb reverse` ne se sont pas établis — redémarrez `bash local/start.sh` et relancez. |
| `persona "<email>" not found in picker`                     | Les personas ne sont pas amorcées — exécutez la commande d'amorçage au §1.                                                            |
| `Firestore assertions: ON` manquant / étapes de BD ignorées | Les vérifications de BD ne s'exécutent que pour `--target local`.                                                                     |
| La compilation de l'APK échoue                              | Ouvrez le `gradle-build.log` affiché ; assurez-vous que Java 21+ et le SDK Android sont installés.                                    |
| Une étape échoue sur un écran que vous n'attendiez pas      | Ouvrez la capture nommée dans `latest-report.md` pour cette étape.                                                                    |

---

## 6. Ajouter un parcours

Les parcours sont de simples objets dotés d'une méthode `run(device, reporter, ctx)`, composés
à partir des helpers partagés :

- `signInAs(device, reporter, ctx, email, nameToken)` — connecte une persona via
  le sélecteur et traverse les interstitiels de premier lancement jusqu'à Home.
- UI : `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, ainsi que `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore : `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Serveur : `getIdToken(email)` → le jeton d'ID d'une persona, puis
  `apiCall(method, path, { token, body })`.

Enveloppez chaque vérification dans `reporter.step(device, 'name', async () => { … })` — cela
chronomètre l'étape, en prend une capture, consigne la réussite/l'échec et, en cas d'échec, capture les
testTags à l'écran. Ajoutez le nouvel objet au tableau `all` dans `buildJourneys`.

La logique pure (analyse, sélecteurs, gestion des arguments) est testée unitairement dans
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`) ;
les couches appareil/Firestore/API sont testées en intégration en exécutant la suite sur
un appareil réel.
