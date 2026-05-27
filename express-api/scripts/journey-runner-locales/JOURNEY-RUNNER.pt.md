# Executor de testes de jornada no dispositivo do ShyTalk

_Esta é uma tradução de JOURNEY-RUNNER.md._

O `device-journey-runner.js` conduz o **app real do ShyTalk em um telefone conectado**
através de jornadas de usuário de ponta a ponta e escreve um **relatório detalhado de aprovação/reprovação** que você
pode ler — então você executa um comando e lê um relatório em vez de tocar
em cada etapa manualmente.

É um executor **híbrido**. Cada jornada pode verificar três camadas ao mesmo tempo:

1. **UI** — toca/inspeciona o app ao vivo via `adb` + `uiautomator` (os `testTag`s do Compose
   aparecem como `resource-id`s no dump; os diálogos são correspondidos pelo
   seu texto visível).
2. **Firestore** — lê o emulador local diretamente (via `firebase-admin`) para
   confirmar o estado do banco de dados por trás de cada ação.
3. **Servidor / API** — autentica-se como cada persona (token de ID real do Firebase do
   emulador Auth) e chama a `express-api`, então verifica as **regras que o
   servidor impõe** (a barreira de cohort da OSA, a substituição de admin, a moderação) — que
   _não_ são visíveis apenas na UI.

> As traduções deste guia ficam em `journey-runner-locales/` (20 idiomas).

---

## 1. Pré-requisitos

| Você precisa                   | Como                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** em execução | para os emuladores do Firebase + LiveKit/MinIO                                                                                                            |
| **A pilha local no ar**        | `bash local/start.sh` (a partir da raiz do repositório) — inicia os emuladores do Firebase + a express-api. Deixe-a em execução.                          |
| **Personas semeadas**          | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotente; semeia o elenco de teste P‑02…P‑19 com a senha `localdev123`) |
| **Um telefone conectado**      | `adb devices` deve listar um (cabo USB **ou** `adb` sem fio). Um emulador Android também funciona.                                                        |
| **Java 21+ e o Android SDK**   | necessário apenas na primeira vez, para que o executor possa compilar o app se o APK estiver ausente                                                      |

O executor compila o APK de debug `local` por conta própria se ele ainda não estiver compilado.

---

## 2. Execute-o

A partir da raiz do repositório:

```sh
# Run the whole suite against the local stack
node express-api/scripts/device-journey-runner.js

# See the list of journeys without running anything
node express-api/scripts/device-journey-runner.js --list

# Run only specific journeys
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Force a fresh APK build first
node express-api/scripts/device-journey-runner.js --rebuild

# Full option list
node express-api/scripts/device-journey-runner.js --help
```

Opções: `--target local|dev` (padrão `local`) · `--serial <adb-serial>`
(padrão: seleção automática) · `--journeys <ids>` · `--rebuild` · `--no-reset` (pula
a reinstalação limpa na jornada de smoke) · `--out <dir>` · `--list` · `--help`.

O executor fixa **um** serial do adb para cada comando, então ele funciona mesmo quando um
telefone aparece duas vezes (USB + sem fio). Para o alvo `local`, ele configura
túneis `adb reverse` para que o app no dispositivo alcance a pilha na sua máquina.

---

## 3. Veja os resultados

Quando termina, ele imprime um resumo e escreve, em `journey-results/`:

| Arquivo                         | O que                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Leia este** — por jornada, por etapa ✅/❌ com o motivo, os testTags na tela e um link de captura de tela para cada etapa |
| `latest-report.json`            | os mesmos dados, legíveis por máquina                                                                                       |
| `runs/<runId>/*.png`            | uma captura de tela de cada etapa (aprovação _e_ reprovação)                                                                |
| `runs/<runId>/report.{md,json}` | o relatório arquivado daquela execução específica                                                                           |

O código de saída é `0` quando todas as jornadas passaram, `1` quando alguma falhou. Em uma falha,
a etapa registra exatamente o que estava na tela, então você pode ver _por que_ sem
reconduzir o telefone.

---

## 4. O que as jornadas cobrem

Execute `--list` para o conjunto ao vivo. Em resumo, a suíte cobre:

- **Smoke** — instalação limpa → aceitação legal → autenticação, backend acessível.
- **Autenticação por cohort** — personas adulto / menor / admin autenticam-se via o
  seletor de personas dev no app; a identidade é confirmada contra a sobreposição de debug e o
  campo `cohort` do Firestore.
- **Barreira de cohort da OSA** — um menor não pode seguir nem visualizar um adulto (o servidor retorna
  `404`, e a escrita no Firestore nunca acontece), enquanto ações de mesma cohort
  têm sucesso — provando que a barreira é específica da cohort, não um bloqueio geral.
- **Admin** — a substituição de cohort é apenas para a equipe (um membro comum é rejeitado com
  `422`; uma conta da equipe tem sucesso e escreve uma linha de auditoria regulatória).
- **Moderação** — denúncia → suspensão por admin (+ auditoria) → recurso → suspensão revogada, totalmente
  imposta pelo servidor, com limpeza idempotente.

A autenticação nas jornadas sempre usa o **seletor de personas dev no app** — nunca
autenticação real do Google/Apple.

> **Nota sobre as especificações das jornadas.** Os planos em Gherkin em
> `.project/test-plans/manual/j01-j19` são parcialmente _aspiracionais_: eles referenciam
> UI que o app publicado não tem (por exemplo, uma tela de cadastro com e-mail/senha, abas de
> menor ocultas, uma tela de descoberta). O executor, portanto, mapeia a intenção real de cada jornada
> contra o app **real** + Firestore + API, e registra tais
> divergências como achados em vez de falhar por ficção.

---

## 5. Solução de problemas

| Sintoma                                                   | Correção                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                     | Conecte / pareie o telefone; verifique `adb devices`.                                                                              |
| Travado ao alcançar a SignIn / "backend NOT reachable"    | A pilha local não está no ar ou os túneis `adb reverse` não foram configurados — reinicie `bash local/start.sh` e execute de novo. |
| `persona "<email>" not found in picker`                   | As personas não estão semeadas — execute o comando de seed na §1.                                                                  |
| `Firestore assertions: ON` ausente / etapas de DB puladas | As verificações de DB executam apenas para `--target local`.                                                                       |
| A compilação do APK falha                                 | Abra o `gradle-build.log` impresso; garanta que Java 21+ e o Android SDK estejam instalados.                                       |
| Uma etapa falha em uma tela que você não esperava         | Abra a captura de tela nomeada no `latest-report.md` para aquela etapa.                                                            |

---

## 6. Adicionando uma jornada

Jornadas são objetos simples com um método `run(device, reporter, ctx)`, compostos
a partir dos auxiliares compartilhados:

- `signInAs(device, reporter, ctx, email, nameToken)` — autentica uma persona via
  o seletor e percorre os interstícios do primeiro lançamento até a Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, e `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Servidor: `getIdToken(email)` → o token de ID de uma persona, depois
  `apiCall(method, path, { token, body })`.

Envolva cada verificação em `reporter.step(device, 'name', async () => { … })` — isso
cronometra a etapa, captura a tela, registra aprovação/reprovação e, na falha, captura os
testTags na tela. Adicione o novo objeto ao array `all` em `buildJourneys`.

A lógica pura (parsing, seletores, tratamento de argumentos) é testada por unidade em
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
as camadas de dispositivo/Firestore/API são testadas por integração executando a suíte em
um dispositivo real.
