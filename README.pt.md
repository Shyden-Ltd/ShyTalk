# ShyTalk

**Salas de chat por voz, reinventadas.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | **Português** | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Sobre

ShyTalk e um aplicativo social de chat por voz onde os usuarios podem criar e participar de salas de chat por voz em tempo real. Construido com Kotlin Multiplatform (KMP), suporta tanto Android quanto iOS com uma base de codigo compartilhada. Seja para hospedar uma conversa, ouvir ou conectar-se com pessoas ao redor do mundo, o ShyTalk torna isso facil.

iOS e uma plataforma suportada, mas este guia foca no desenvolvimento Android, que e o alvo principal de desenvolvimento.

## Recursos

### Salas de Chat por Voz
- Crie ou participe de salas com voz em tempo real alimentada pelo LiveKit
- Sistema de assentos estruturado com papeis de proprietario, anfitriao e participante
- Solicitacoes e convites de assento -- solicite um assento ou convide ouvintes para falar
- Chathead flutuante -- continue o chat por voz enquanto navega por outras partes do app
- Expiracao de sala -- salas fecham automaticamente quando o proprietario esta ausente, com timers de contagem regressiva

### Mensagens
- Chat de texto ao vivo junto com voz em cada sala
- Mensagens privadas com conversas 1-a-1
- Chats em grupo com gerenciamento de membros e permissoes
- Indicadores de digitacao em tempo real
- Suporte a stickers

### Social
- Perfis de usuario personalizaveis com fotos, imagens de capa, bandeiras de nacionalidade e biografias
- Sistema de seguir -- siga outros usuarios e veja quando estao ativos
- Mural de presentes -- exiba presentes recebidos de outros usuarios
- Sistema de bloqueio -- bloqueie usuarios em salas e perfis

### Economia Virtual
- Economia baseada em moedas com carteira e historico de transacoes
- Recompensas diarias de login com bonus de sequencia
- Sistema Lucky Spin (gacha) com premios escalonados
- Presentes virtuais -- envie e receba presentes animados durante chats por voz
- Inventario de mochila para armazenar presentes
- Pacotes de moedas para comprar moedas
- Banners de transmissao com efeitos de presentes animados

### Conta e Identidade
- Autenticacao multi-provedor -- entre com Google, Apple ou Email (OTP)
- Vincule multiplos metodos de login a uma unica conta
- Identidade de usuario estavel (uniqueId) que persiste entre projetos Firebase
- Gerenciamento de contas vinculadas nas Configuracoes com suporte vincular/desvincular
- Vinculacao de dispositivo -- cada dispositivo e permanentemente vinculado a uma conta

### Moderacao e Seguranca
- Ferramentas de moderacao -- silenciar, expulsar, mover assentos e gerenciar anfitrioes como proprietario da sala
- Sistema de denuncia de usuarios com fluxo de revisao
- Sistema de advertencias e suspensoes por violacoes de politicas
- Telas de padroes da comunidade, politica de privacidade e termos de servico
- Fluxo de aceitacao legal para novos usuarios
- Atualizacao forcada para versoes desatualizadas do app

### Telas Iniciais
- Telas de lancamento configuraveis exibidas ao iniciar o app
- Conteudo gerenciado pelo administrador com opcoes de agendamento e segmentacao

### Seguranca
- Protecao por codigo PIN para acesso ao app
- Autenticacao biometrica -- impressao digital e reconhecimento facial
- Verificacao OTP (senha de uso unico) para acoes sensiveis

### Painel Administrativo
- Dashboard de moderacao baseado em web no site estatico do projeto
- Gerenciamento de usuarios, moderacao de conteudo e configuracao
- Gerenciamento de templates e presentes com preview ao vivo
- Streaming de logs e alertas em tempo real

### Compressao de Imagens
- Compressao automatica de imagens no upload via Express API
- Reduz custos de armazenamento e largura de banda mantendo a qualidade

### Internacionalizacao
- 19 idiomas suportados nativamente
- Localizacao completa de todas as strings visiveis ao usuario

### Logs e Monitoramento
- Logging estruturado em Express API, apps moveis e painel administrativo
- Streaming de logs em tempo real no dashboard administrativo
- Banimento de dispositivos e redes com aplicacao automatica
- Sistema de alertas para erros criticos e anomalias
- Propagacao de Trace ID para rastreamento de requisicoes ponta-a-ponta

## Stack Tecnologico

| Camada | Tecnologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arquitetura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autenticacao** | Firebase Authentication (Google, Apple, Email+OTP) com sistema de identidade multi-provedor |
| **Banco de dados** | Cloud Firestore |
| **Tempo real** | Firebase Realtime Database |
| **Armazenamento** | Cloudflare R2 (via proxy Express API) |
| **Servidor API** | Express.js no Oracle Cloud Free Tier |
| **Voz** | LiveKit |
| **Notificacoes push** | Firebase Cloud Messaging |
| **Carregamento de imagens** | Coil 3 (KMP) |
| **Animacoes** | Lottie Compose |
| **Data/Hora** | kotlinx-datetime |
| **Navegacao** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arquitetura

ShyTalk segue o padrao **MVVM** com um **Repository Pattern** limpo:

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

- **Modulo shared** (`commonMain`) -- Modelos, interfaces de repositorio, ViewModels e UI compartilhados entre plataformas
- **Modulo app** -- Telas especificas do Android, implementacoes de repositorio e ponto de entrada
- **Modulo iosApp** -- Ponto de entrada especifico do iOS
- **express-api** -- Backend Express.js rodando no Oracle Cloud Free Tier

## Estrutura do Projeto

```
ShyTalk/
+-- app/                              # Modulo do app Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Ponto de entrada da aplicacao
|       |   +-- MainActivity.kt       # Atividade principal
|       |   +-- core/
|       |   |   +-- di/               # Modulo Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Voz LiveKit, presenca, notificacoes
|       |   |   +-- repository/       # Implementacoes de repositorio
|       |   +-- feature/
|       |   |   +-- auth/             # Tela de login Google
|       |   |   +-- profile/          # Tela de perfil
|       |   |   +-- room/             # Tela de sala
|       |   |   +-- settings/         # Configuracoes do app
|       |   +-- navigation/           # NavGraph & rotas de tela
|       +-- test/                     # Testes unitarios
|       +-- androidTest/              # Testes E2E (Compose UI Test)
+-- shared/                           # Modulo compartilhado KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Modulos Koin compartilhados
|       |   +-- model/                # Modelos de dados (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Componentes compartilhados
|       |   +-- util/                 # Utilitarios & constantes
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Interfaces de repositorio
|       +-- feature/                  # Modulos de funcionalidades compartilhados
+-- iosApp/                           # Modulo do app iOS
+-- express-api/                      # Servidor Express.js API
|   +-- src/
|       +-- routes/                   # Handlers de rotas API
|       +-- middleware/               # Middleware de auth e logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tarefas agendadas
+-- public/                           # Site estatico & painel administrativo
+-- local/                            # Ambiente de desenvolvimento local (emuladores, dados seed)
+-- tests/web/                        # Testes de navegador Playwright
+-- scripts/                          # Scripts utilitarios
+-- .github/workflows/                # CI/CD (Checks de PR, Deploy para Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regras de seguranca do Firestore
+-- database.rules.json               # Regras de seguranca do RTDB
+-- firestore.indexes.json            # Indices compostos do Firestore
+-- firebase.json                     # Configuracao do Firebase
```

## Primeiros Passos

### Pre-requisitos

- **Android Studio** Ladybug ou posterior
- **JDK 17+**
- **Node.js 24+**
- **Docker** (para servidor de voz LiveKit, armazenamento MinIO, email Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Nenhuma conta na nuvem e necessaria para comecar -- o ambiente local roda completamente offline.

### Desenvolvimento Local (Recomendado)

A maneira mais rapida de comecar. Um comando inicia tudo -- emuladores Firebase, containers Docker, Express API e compila o app Android. Sem contas na nuvem, sem custos, sem limites de cota.

1. **Clonar e instalar**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Iniciar tudo**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Este unico comando:
   - Inicia containers Docker (servidor de voz LiveKit, armazenamento MinIO, email Mailpit)
   - Inicia emuladores Firebase (Firestore, Auth, RTDB)
   - Semeia dados de teste e cria o bucket de armazenamento MinIO
   - Inicia a Express API
   - Compila e instala o app Android (se um dispositivo estiver conectado)

   Quando pronto, voce vera:
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

3. **Entrar**
   - Use o fluxo de login por email com a conta de teste: `claude-test@shytalk.dev` / `localdev123`
   - Ou crie uma nova conta -- usara os emuladores locais
   - Login Google/Apple nao funciona localmente (sem OAuth real) -- use OTP por email
   - Codigos OTP sao capturados pelo Mailpit -- verifique http://localhost:8025

4. **Executar em um Dispositivo Fisico**

   Seu telefone deve estar na **mesma rede Wi-Fi** que sua maquina de desenvolvimento.

   a. Encontre o IP local da sua maquina:
   ```bash
   # Windows
   ipconfig    # Procure "IPv4 Address" no seu adaptador Wi-Fi (ex. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # ou: ip addr show
   ```

   b. Atualize o flavor de build local para usar seu IP em vez de `10.0.2.2`. Em `app/build.gradle.kts`, encontre o flavor `local` e altere:
   ```kotlin
   // Substitua 10.0.2.2 pelo IP local da sua maquina
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Conecte seu dispositivo via USB e habilite a depuracao USB, entao:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternativamente, use **adb reverse** para evitar alterar codigo (dispositivo roteia localhost para sua maquina):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulador Firestore
   adb reverse tcp:9099 tcp:9099   # Emulador Auth
   adb reverse tcp:9000 tcp:9000   # Emulador RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (armazenamento de imagens)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Com `adb reverse`, os enderecos padrao `10.0.2.2` no flavor local funcionarao em um dispositivo fisico tambem -- sem necessidade de alterar a configuracao de build.

5. **Parar servicos locais**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Ou pressione `Ctrl+C` no terminal do script de inicio. Dados do emulador sao salvos automaticamente e restaurados no proximo inicio.

### URLs Uteis de Desenvolvimento Local

| Servico | URL | Proposito |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Navegar dados Firestore, usuarios Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Health check | http://localhost:3000/api/health | Verificar se a API esta rodando |
| Mailpit | http://localhost:8025 | Ver emails capturados e codigos OTP |
| MinIO Console | http://localhost:9001 | Navegar imagens e arquivos enviados |

### Servicos Opcionais

**LibreTranslate (Traducao de Mensagens)**

Imagem Docker opcional de 6GB+ para testar a funcao de traducao localmente:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Nao incluida na configuracao padrao devido ao grande tamanho da imagem. A traducao funciona sem ela -- as mensagens simplesmente permanecem sem traducao.

### Desenvolvimento em Nuvem (Opcional)

Se voce precisa testar com servicos reais na nuvem (ex. notificacoes push reais, login Google real):

1. **Configuracao Firebase**
   - Crie um projeto Firebase em [console.firebase.google.com](https://console.firebase.google.com)
   - Habilite **Login Google** e **Login Apple** na Autenticacao
   - Habilite **Firestore**, **Realtime Database** e **Cloud Messaging**
   - Baixe `google-services.json` e coloque em `app/src/dev/`

2. **Configuracao Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edite com suas credenciais na nuvem
   npm install
   npm start
   ```

3. **Implantar regras do Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Compilar o app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variaveis de Ambiente

| Variavel | Descricao | Onde |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de servico Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID da conta Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Chave de acesso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Chave secreta R2 | Express API |
| `R2_BUCKET_NAME` | Nome do bucket R2 (padrao: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Chave da API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Segredo da API LiveKit | Express API |
| `LIVEKIT_URL` | URL do servidor LiveKit | App Android (BuildConfig) |
| `WORKER_URL` | URL base da Express API | App Android (BuildConfig) |

## Testes

### Executar Testes Localmente

```bash
# Menu interativo de testes (escolha o que executar):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Ou execute suites individuais:
bash local/test-unit.sh       # Testes unitarios Kotlin + Express API
bash local/test-playwright.sh # Testes web Playwright (precisa do ambiente local)
bash local/test-e2e.sh        # Testes E2E Android (precisa do ambiente local + dispositivo)
bash local/test-lint.sh       # ktlint + ESLint

# Ver relatorio de testes Allure:
npx allure serve allure-results
```

### Suites de Testes

| Suite | Comando | Quantidade |
|-------|---------|-------|
| Testes unitarios Kotlin | `./gradlew test` | 100+ testes |
| Testes Express API | `cd express-api && npm test` | 1.540+ testes |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 arquivos de features |
| Testes web Playwright | `npx playwright test` | 28 specs |

```bash
# Testes unitarios Kotlin/KMP
./gradlew test

# Testes Express API
cd express-api && npm test

# Testes E2E (requer dispositivo conectado ou emulador)
./gradlew connectedDevDebugAndroidTest

# Testes de navegador Playwright (requer painel admin rodando)
npx playwright test
```

### Testes em CI

No CI, os testes Playwright e Android E2E rodam no mesmo ambiente local (emuladores + Docker) -- nenhum servico em nuvem e usado. Isso garante que os testes nunca interfiram com testadores reais.

## Resolucao de Problemas

- **Porta ja em uso**: `lsof -i :<port>` (Linux/macOS) ou `netstat -ano | findstr :<port>` (Windows) para encontrar o que esta usando a porta.
- **Docker nao esta rodando**: Certifique-se de que o Docker Desktop esta iniciado. Execute `docker ps` para verificar.
- **Emuladores Firebase nao iniciam**: Requer Java 11+. Verifique com `java -version`.
- **Build Android falha**: Certifique-se de que JDK 17+ e Android SDK estao instalados. Tente `./gradlew clean`.
- **Dispositivo adb nao detectado**: Habilite a depuracao USB. Execute `adb devices` para verificar.
- **Imagens nao carregam**: O bucket MinIO pode nao ter sido criado. Execute `cd express-api && NODE_ENV=local node ../local/seed.js`. Para dispositivos fisicos, execute `adb reverse tcp:9002 tcp:9002`.
- **OTP nao chega**: Verifique a saida do console por linhas `[OTP-LOCAL]`. Tambem verifique a UI do Mailpit em http://localhost:8025.
- **Resetar dados do emulador**: Delete o diretorio `local/firebase-emulator-data/` e reinicie.
- **Resetar dados do MinIO**: Execute `docker compose -f local/docker-compose.yml down -v` para remover volumes.

## Implantacao

As implantacoes sao gerenciadas atraves de workflows do GitHub Actions (`.github/workflows/`):

| Workflow | Gatilho | O que faz |
|----------|---------|-------------|
| **PR Checks** | Automatico em PRs para `main` | Executa lint, testes Kotlin, testes Express API, testes Playwright (baseado em arquivos alterados) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Implanta Express API + web no dev, distribui APK para testadores, opcionalmente executa testes Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Implanta uma release tagueada no prod -- Express API, web, Play Store e App Store |

Workflows adicionais: **E2E Tests** (matriz de emuladores Android), **SonarCloud** (analise estatica), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Implantada em VMs Oracle Cloud via SSH + PM2 (dev: Londres, prod: Singapura)
- **Android:** Empacotado e enviado ao Google Play via CI
- **iOS:** Compilado e enviado ao App Store Connect / TestFlight via CI
- **Painel admin / web:** Implantado no Cloudflare Pages

## Contribuir

Contribuicoes sao bem-vindas! Por favor consulte [CONTRIBUTING.md](CONTRIBUTING.md) para diretrizes.

## Licenca

Este projeto esta licenciado sob a Licenca Apache 2.0. Veja [LICENSE](LICENSE) para detalhes.

## Agradecimentos

- [Firebase](https://firebase.google.com) -- Autenticacao, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Comunicacao por voz em tempo real
- [Cloudflare](https://www.cloudflare.com) -- Armazenamento R2, hospedagem Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM de nivel gratuito para Express API
- [Express.js](https://expressjs.com) -- Framework de servidor API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI declarativa moderna
- [Koin](https://insert-koin.io) -- Injecao de dependencia leve
- [Coil](https://coil-kt.github.io/coil/) -- Carregamento de imagens para Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Efeitos animados de presentes e UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Data/hora multiplataforma
