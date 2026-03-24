# ShyTalk

**Salas de chat por voz, reinventadas.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [العربية](README.ar.md) | [Deutsch](README.de.md) | [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | **Português** | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Sobre

ShyTalk é um aplicativo social de chat por voz onde os utilizadores podem criar e entrar em salas de voz em tempo real. Construído com Kotlin Multiplatform (KMP), suporta Android e iOS com um codebase partilhado. Seja para hospedar conversas, ouvir ou conectar-se com pessoas de todo o mundo, o ShyTalk torna tudo fácil.

## Funcionalidades

### Salas de Chat por Voz
- Crie ou entre em salas com voz em tempo real via LiveKit
- Sistema de assentos estruturado com papéis de proprietário, anfitrião e participante
- Pedidos e convites de assento -- peça para falar ou convide ouvintes
- Chathead flutuante -- continue o chat por voz enquanto navega noutras partes do app
- Expiração de sala -- salas fecham automaticamente quando o proprietário está ausente

### Mensagens
- Chat de texto ao vivo junto com voz em cada sala
- Mensagens privadas com conversas 1-a-1
- Chats de grupo com gestão de membros e permissões
- Indicadores de digitação em tempo real
- Suporte a stickers

### Social
- Perfis personalizáveis com fotos, imagens de capa, bandeiras de nacionalidade e bios
- Sistema de seguir -- siga outros utilizadores e veja quando estão ativos
- Mural de presentes -- exiba presentes recebidos de outros utilizadores
- Sistema de bloqueio -- bloqueie utilizadores em salas e perfis

### Economia Virtual
- Economia baseada em moedas com carteira e histórico de transações
- Recompensas diárias de login com bónus de sequência
- Sistema Lucky Spin (gacha) com prémios por níveis
- Presentes virtuais -- envie e receba presentes animados durante chats por voz
- Inventário de mochila para guardar presentes
- Pacotes de moedas para compra
- Banners de transmissão com efeitos animados de presentes

### Conta e Identidade
- Autenticação multi-provedor -- inicie sessão com Google, Apple ou Email (OTP)
- Vincule múltiplos métodos de login a uma única conta
- Identidade de utilizador estável (uniqueId) que persiste entre projetos Firebase
- Gestão de Contas Vinculadas nas Definições com suporte para vincular/desvincular
- Vinculação de dispositivo -- cada dispositivo é permanentemente ligado a uma conta

### Moderação e Segurança
- Ferramentas de moderação -- silenciar, expulsar, mover assentos e gerir anfitriões
- Sistema de denúncia de utilizadores com fluxo de revisão
- Sistema de avisos e suspensões para violações de políticas
- Ecrãs de padrões comunitários, política de privacidade e termos de serviço
- Fluxo de aceitação legal para novos utilizadores
- Atualização forçada para versões desatualizadas do app

### Ecrãs Iniciais
- Ecrãs de lançamento configuráveis exibidos ao iniciar o app
- Conteúdo gerido pelo admin com opções de agendamento e segmentação

### Segurança
- Proteção por código PIN para acesso ao app
- Autenticação biométrica -- impressão digital e reconhecimento facial
- Verificação OTP (senha única) para ações sensíveis

### Painel de Administração
- Dashboard de moderação baseado na web no site estático do projeto
- Gestão de utilizadores, moderação de conteúdo e configuração
- Gestão de templates e presentes com pré-visualização ao vivo
- Streaming e alertas de logs em tempo real

### Compressão de Imagens
- Compressão automática de imagens no upload via Express API
- Reduz custos de armazenamento e largura de banda mantendo a qualidade

### Internacionalização
- 19 idiomas suportados de raiz
- Localização completa para todas as strings visíveis ao utilizador

### Logs e Monitorização
- Logs estruturados em Express API, apps móveis e painel de admin
- Streaming de logs em tempo real no dashboard de admin
- Banimento de dispositivos e redes com aplicação automática
- Sistema de alertas para erros críticos e anomalias
- Propagação de Trace ID para rastreamento de pedidos ponta-a-ponta

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arquitetura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Google, Apple, Email+OTP) com sistema de identidade multi-provedor |
| **Base de Dados** | Cloud Firestore |
| **Tempo Real** | Firebase Realtime Database |
| **Armazenamento** | Cloudflare R2 (via Express API proxy) |
| **Servidor API** | Express.js on Oracle Cloud Free Tier |
| **Voz** | LiveKit |
| **Notificações Push** | Firebase Cloud Messaging |
| **Carregamento de Imagens** | Coil 3 (KMP) |
| **Animações** | Lottie Compose |
| **Data/Hora** | kotlinx-datetime |
| **Navegação** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arquitetura

ShyTalk segue **MVVM** com um **Repository Pattern** limpo:

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

- **shared module** (`commonMain`) -- Modelos, interfaces de repositório, ViewModels e UI partilhados entre plataformas
- **app module** -- Ecrãs específicos do Android, implementações de repositório e ponto de entrada
- **iosApp module** -- Ponto de entrada específico do iOS
- **express-api** -- Backend Express.js no Oracle Cloud Free Tier

## Estrutura do Projeto

```
ShyTalk/
+-- app/                              # Android app module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Ponto de entrada da aplicação
|       |   +-- MainActivity.kt       # Activity principal
|       |   +-- core/
|       |   |   +-- di/               # Módulo Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # Implementações de repositório
|       |   +-- feature/
|       |   |   +-- auth/             # Ecrã de Google Sign-In
|       |   |   +-- profile/          # Ecrã de perfil
|       |   |   +-- room/             # Ecrã de sala
|       |   |   +-- settings/         # Definições do app
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # Testes unitários
|       +-- androidTest/              # Testes E2E (Compose UI Test)
+-- shared/                           # Módulo partilhado KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Módulos Koin partilhados
|       |   +-- model/                # Modelos de dados (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Componentes partilhados
|       |   +-- util/                 # Utilitários e constantes
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Interfaces de repositório
|       +-- feature/                  # Módulos de funcionalidades partilhados
+-- iosApp/                           # iOS app module
+-- express-api/                      # Servidor Express.js API
|   +-- src/
|       +-- routes/                   # Route handlers da API
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tarefas agendadas
+-- public/                           # Site estático e painel de admin
+-- local/                            # Ambiente de desenvolvimento local (emuladores, dados de teste)
+-- tests/web/                        # Testes Playwright para browser
+-- scripts/                          # Scripts utilitários
+-- .github/workflows/                # CI/CD (PR Checks, Deploy to Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regras de segurança Firestore
+-- database.rules.json               # Regras de segurança RTDB
+-- firestore.indexes.json            # Índices compostos Firestore
+-- firebase.json                     # Configuração Firebase
```

## Começar

### Pré-requisitos

- **Android Studio** Ladybug ou mais recente
- **JDK 17+**
- **Node.js 24+**
- **Docker** (para servidor LiveKit local)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Desenvolvimento Local (Recomendado)

A forma mais rápida de começar. Usa Firebase Emulators e um contentor Docker LiveKit local -- sem contas cloud, sem custos, sem limites de quota.

1. **Clonar e instalar**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Iniciar serviços locais**
   ```bash
   bash local/start.sh
   ```
   Isto inicia Firebase Emulators (Firestore, Auth, RTDB) e um contentor Docker LiveKit. Na primeira execução, semeia automaticamente dados de teste (utilizador admin, presentes de exemplo, configuração).

   Verá:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Iniciar a Express API** (num novo terminal)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edite valores R2/SMTP se necessário
   npm run local
   ```
   A API inicia em `http://localhost:3000`. Teste: `curl http://localhost:3000/api/health`

4. **Executar no Emulador Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   O build flavor `local` conecta-se a `10.0.2.2` (loopback do emulador Android para a sua máquina). Funciona de imediato -- sem configuração extra.

5. **Executar num Dispositivo Físico**

   O seu telemóvel deve estar na **mesma rede Wi-Fi** que a sua máquina de desenvolvimento.

   a. Encontre o IP local da sua máquina:
   ```bash
   # Windows
   ipconfig    # Procure "IPv4 Address" no adaptador Wi-Fi (ex: 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # ou: ip addr show
   ```

   b. Atualize o build flavor local para usar o seu IP em vez de `10.0.2.2`. Em `app/build.gradle.kts`, encontre o flavor `local` e altere:
   ```kotlin
   // Substitua 10.0.2.2 pelo IP local da sua máquina
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Conecte o dispositivo via USB e ative a depuração USB, depois:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Em alternativa, use **adb reverse** para evitar alterar código (o dispositivo redireciona localhost para a sua máquina):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Com `adb reverse`, os endereços padrão `10.0.2.2` no flavor local funcionarão num dispositivo físico também -- sem alterações de build config.

6. **Iniciar sessão**
   - Use o fluxo de login por email com a conta de teste: `claude-test@shytalk.dev` / `localdev123`
   - Ou crie uma nova conta -- usará os emuladores locais
   - Google/Apple sign-in não funciona localmente (sem OAuth real) -- use email OTP

7. **Parar serviços locais**
   ```bash
   bash local/stop.sh
   ```
   Ou pressione `Ctrl+C` no terminal do `start.sh`. Os dados do emulador são guardados automaticamente e restaurados na próxima execução.

### URLs Úteis para Desenvolvimento Local

| Serviço | URL | Finalidade |
|---------|-----|-----------|
| Firebase Emulator UI | http://localhost:4000 | Explorar dados Firestore, utilizadores Auth, RTDB |
| Express API | http://localhost:3000 | API Backend |
| Health check | http://localhost:3000/api/health | Verificar se a API está a funcionar |

### Desenvolvimento Cloud (Opcional)

Se precisar de testar contra serviços cloud reais (ex: notificações push reais, Google Sign-In real):

1. **Configuração Firebase**
   - Crie um projeto Firebase em [console.firebase.google.com](https://console.firebase.google.com)
   - Ative **Google Sign-In** e **Apple Sign-In** em Authentication
   - Ative **Firestore**, **Realtime Database** e **Cloud Messaging**
   - Descarregue `google-services.json` e coloque em `app/src/dev/`

2. **Configuração Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edite com as suas credenciais cloud
   npm install
   npm start
   ```

3. **Implementar regras Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Compilar o app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variáveis de Ambiente

| Variável | Descrição | Onde |
|----------|-----------|------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de serviço Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID da conta Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Chave de acesso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Chave secreta R2 | Express API |
| `R2_BUCKET_NAME` | Nome do bucket R2 (padrão: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Chave API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Segredo API LiveKit | Express API |
| `LIVEKIT_URL` | URL do servidor LiveKit | Android app (BuildConfig) |
| `WORKER_URL` | URL base da Express API | Android app (BuildConfig) |

## Testes

| Suite | Comando | Quantidade |
|-------|---------|-----------|
| Testes unitários Kotlin | `./gradlew test` | 100+ testes |
| Testes Express API | `cd express-api && npm test` | 1,540+ testes |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature files |
| Testes web Playwright | `npx playwright test` | 28 specs |

```bash
# Testes unitários Kotlin/KMP
./gradlew test

# Testes Express API
cd express-api && npm test

# Testes E2E (requer dispositivo conectado ou emulador)
./gradlew connectedDevDebugAndroidTest

# Testes Playwright para browser (requer painel de admin em execução)
npx playwright test
```

## Implementação

As implementações são geridas através de workflows do GitHub Actions (`.github/workflows/`):

| Workflow | Gatilho | O que faz |
|----------|---------|-----------|
| **PR Checks** | Automático em PRs para `main` | Executa lint, testes Kotlin, testes Express API, testes Playwright (baseado em ficheiros alterados) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Implementa Express API + web para dev, distribui APK para testers, opcionalmente executa testes Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Implementa uma release tagged para prod -- Express API, web, Play Store e App Store |

Workflows adicionais: **E2E Tests** (matriz de emuladores Android), **SonarCloud** (análise estática), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Implementada em VMs Oracle Cloud via SSH + PM2 (dev: Londres, prod: Singapura)
- **Android:** Empacotado e carregado para Google Play via CI
- **iOS:** Compilado e carregado para App Store Connect / TestFlight via CI
- **Painel de admin / web:** Implementado no Cloudflare Pages

## Contribuir

Contribuições são bem-vindas! Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para orientações.

## Licença

Este projeto está licenciado sob a Licença Apache 2.0. Consulte [LICENSE](LICENSE) para detalhes.

## Agradecimentos

- [Firebase](https://firebase.google.com) -- Autenticação, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Comunicação por voz em tempo real
- [Cloudflare](https://www.cloudflare.com) -- Armazenamento R2, hospedagem Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM Free Tier para Express API
- [Express.js](https://expressjs.com) -- Framework de servidor API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI declarativa moderna
- [Koin](https://insert-koin.io) -- Injeção de dependências leve
- [Coil](https://coil-kt.github.io/coil/) -- Carregamento de imagens para Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Efeitos animados de presentes e UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Data/hora multiplataforma
