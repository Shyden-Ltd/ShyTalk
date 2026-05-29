# Ejecutor de pruebas de journey en dispositivo de ShyTalk

_Esta es una traducción de JOURNEY-RUNNER.md._

`device-journey-runner.js` conduce la **app real de ShyTalk en un teléfono conectado**
a través de journeys de usuario de extremo a extremo y escribe un **informe detallado de aprobado/fallido**
que puedes leer — así ejecutas un comando y lees un informe en lugar de tocar
cada paso a mano.

Es un ejecutor **híbrido**. Cada journey puede verificar tres capas a la vez:

1. **UI** — toca/inspecciona la app en vivo mediante `adb` + `uiautomator` (los
   `testTag` de Compose aparecen como `resource-id` en el volcado; los diálogos se
   reconocen por su texto visible).
2. **Firestore** — lee el emulador local directamente (mediante `firebase-admin`) para
   confirmar el estado de la base de datos detrás de cada acción.
3. **Servidor / API** — inicia sesión como cada persona (token de ID real de Firebase del
   emulador de Auth) y llama a la `express-api`, de modo que verifica las **reglas que el
   servidor aplica** (la barrera de cohort de la OSA, la anulación de administrador, la moderación) — que
   _no_ son visibles solo en la UI.

> Las traducciones de esta guía están en `journey-runner-locales/` (20 idiomas).

---

## 1. Requisitos previos

| Necesitas                        | Cómo                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** en ejecución  | para los emuladores de Firebase + LiveKit/MinIO                                                                                                                     |
| **El stack local levantado**     | `bash local/start.sh` (desde la raíz del repo) — arranca los emuladores de Firebase + la express-api. Déjalo en ejecución.                                          |
| **Personas sembradas**           | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotente; siembra el reparto de prueba P‑02…P‑19 con la contraseña `localdev123`) |
| **Un teléfono conectado**        | `adb devices` debe listar uno (cable USB **o** `adb` inalámbrico). Un emulador de Android también funciona.                                                         |
| **Java 21+ y el SDK de Android** | solo se necesita la primera vez, para que el ejecutor pueda compilar la app si falta el APK                                                                         |

El ejecutor compila por sí mismo el APK de depuración `local` si aún no está compilado.

---

## 2. Ejecútalo

Desde la raíz del repo:

```sh
# Ejecutar toda la suite contra el stack local
node express-api/scripts/device-journey-runner.js

# Ver la lista de journeys sin ejecutar nada
node express-api/scripts/device-journey-runner.js --list

# Ejecutar solo journeys específicos
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Forzar primero una compilación nueva del APK
node express-api/scripts/device-journey-runner.js --rebuild

# Lista completa de opciones
node express-api/scripts/device-journey-runner.js --help
```

Opciones: `--target local|dev` (predeterminado `local`) · `--serial <adb-serial>`
(predeterminado: selección automática) · `--journeys <ids>` · `--rebuild` · `--no-reset` (omite
la reinstalación limpia en el journey de smoke) · `--out <dir>` · `--list` · `--help`.

El ejecutor fija **un** serial de adb para cada comando, de modo que funciona incluso cuando un
teléfono aparece dos veces (USB + inalámbrico). Para el objetivo `local` configura
túneles `adb reverse` para que la app en el dispositivo alcance el stack en tu máquina.

---

## 3. Mira los resultados

Cuando termina, imprime un resumen y escribe, bajo `journey-results/`:

| Archivo                         | Qué                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `latest-report.md`              | **Lee esto** — por journey, por paso ✅/❌ con el motivo, los testTags en pantalla y un enlace de captura para cada paso |
| `latest-report.json`            | los mismos datos, legibles por máquina                                                                                   |
| `runs/<runId>/*.png`            | una captura de cada paso (aprobado _y_ fallido)                                                                          |
| `runs/<runId>/report.{md,json}` | el informe archivado de esa ejecución concreta                                                                           |

El código de salida es `0` cuando todos los journeys pasaron, y `1` cuando alguno falló. Ante un fallo
el paso registra exactamente qué había en pantalla, de modo que puedes ver _por qué_ sin
volver a conducir el teléfono.

---

## 4. Qué cubren los journeys

Ejecuta `--list` para ver el conjunto actual. A grandes rasgos la suite cubre:

- **Smoke** — instalación limpia → aceptación legal → inicio de sesión, backend accesible.
- **Inicio de sesión por cohort** — las personas adulta / menor / administrador inician sesión mediante el
  selector de personas de dev dentro de la app; la identidad se confirma contra la superposición de depuración y el
  campo `cohort` de Firestore.
- **Barrera de cohort de la OSA** — un menor no puede seguir ni ver a un adulto (el servidor devuelve
  `404`, y la escritura en Firestore nunca ocurre), mientras que las acciones dentro de la misma cohort
  tienen éxito — lo que demuestra que la barrera es específica de la cohort, no un bloqueo general.
- **Admin** — la anulación de cohort es solo para personal (un miembro normal es rechazado con
  `422`; una cuenta de personal tiene éxito y escribe una fila de auditoría regulatoria).
- **Moderación** — denuncia → suspensión por administrador (+ auditoría) → apelación → cese de la suspensión, totalmente
  aplicada por el servidor, con limpieza idempotente.

La autenticación en los journeys siempre usa el **selector de personas de dev dentro de la app** — nunca
el inicio de sesión real de Google/Apple.

> **Nota sobre las especificaciones de los journeys.** Los planes en Gherkin de
> `journey-tests/j01-j19` son en parte _aspiracionales_: hacen referencia a
> UI que la app publicada no tiene (p. ej. una pantalla de registro con correo/contraseña, pestañas ocultas
> de menores, una pantalla de descubrimiento). Por ello, el ejecutor asigna la intención real de cada journey
> contra la app **real** + Firestore + API, y registra tales
> divergencias como findings en lugar de fallar por ficción.

---

## 5. Resolución de problemas

| Síntoma                                                        | Solución                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                          | Conecta / empareja el teléfono; comprueba `adb devices`.                                                                               |
| Se queda atascado al llegar a SignIn / "backend NOT reachable" | El stack local no está levantado o los túneles `adb reverse` no se establecieron — reinicia `bash local/start.sh` y vuelve a ejecutar. |
| `persona "<email>" not found in picker`                        | Las personas no están sembradas — ejecuta el comando de siembra en §1.                                                                 |
| Falta `Firestore assertions: ON` / pasos de BD omitidos        | Las verificaciones de BD se ejecutan solo para `--target local`.                                                                       |
| La compilación del APK falla                                   | Abre el `gradle-build.log` impreso; asegúrate de que Java 21+ y el SDK de Android están instalados.                                    |
| Un paso falla en una pantalla que no esperabas                 | Abre la captura nombrada en `latest-report.md` para ese paso.                                                                          |

---

## 6. Añadir un journey

Los journeys son objetos simples con un método `run(device, reporter, ctx)`, compuestos
a partir de los helpers compartidos:

- `signInAs(device, reporter, ctx, email, nameToken)` — inicia sesión con una persona mediante
  el selector y recorre los intersticiales del primer arranque hasta Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, y `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Servidor: `getIdToken(email)` → el token de ID de una persona, luego
  `apiCall(method, path, { token, body })`.

Envuelve cada verificación en `reporter.step(device, 'name', async () => { … })` — esto
cronometra el paso, le hace una captura, registra aprobado/fallido y, ante un fallo, captura los
testTags en pantalla. Añade el nuevo objeto al array `all` en `buildJourneys`.

La lógica pura (análisis, selectores, manejo de argumentos) se prueba con tests unitarios en
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
las capas de dispositivo/Firestore/API se prueban en integración ejecutando la suite en
un dispositivo real.
