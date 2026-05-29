# ShyTalk cihaz üzerinde yolculuk testi çalıştırıcısı

_Bu, JOURNEY-RUNNER.md dosyasının bir çevirisidir._

`device-journey-runner.js`, **bağlı bir telefonda gerçek ShyTalk uygulamasını**
uçtan uca kullanıcı yolculukları boyunca çalıştırır ve okuyabileceğiniz
**ayrıntılı bir başarılı/başarısız raporu** yazar — böylece her adımı elle
dokunarak geçmek yerine tek bir komut çalıştırıp tek bir rapor okursunuz.

Bu **karma** bir çalıştırıcıdır. Her yolculuk aynı anda üç katmanda doğrulama yapabilir:

1. **UI** — canlı uygulamaya `adb` + `uiautomator` aracılığıyla dokunur/inceler (Compose
   `testTag`'leri dökümde `resource-id` olarak görünür; iletişim kutuları
   görünür metinleriyle eşleştirilir).
2. **Firestore** — yerel emülatörü doğrudan (`firebase-admin` aracılığıyla) okuyarak
   her eylemin arkasındaki veritabanı durumunu doğrular.
3. **Sunucu / API** — her persona olarak oturum açar (Auth emülatöründen gerçek bir
   Firebase ID belirteci) ve `express-api`'yi çağırır, böylece **sunucunun
   uyguladığı kuralları** doğrular (OSA cohort kapısı, yönetici geçersiz kılma,
   moderasyon) — ki bunlar tek başına UI'da _görünmez_.

> Bu kılavuzun çevirileri `journey-runner-locales/` içinde bulunur (20 dil).

---

## 1. Ön koşullar

| İhtiyacınız olan                | Nasıl                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** çalışıyor    | Firebase emülatörleri + LiveKit/MinIO için                                                                                                              |
| **Yerel yığın çalışır durumda** | `bash local/start.sh` (depo kökünden) — Firebase emülatörlerini + express-api'yi başlatır. Çalışır durumda bırakın.                                     |
| **Persona'lar tohumlandı**      | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; P‑02…P‑19 test kadrosunu `localdev123` parolasıyla tohumlar) |
| **Bağlı bir telefon**           | `adb devices` bir tane listelemeli (USB kablosu **veya** kablosuz `adb`). Bir Android emülatörü de çalışır.                                             |
| **Java 21+ & Android SDK**      | yalnızca ilk seferinde gereklidir, böylece APK eksikse çalıştırıcı uygulamayı derleyebilir                                                              |

Çalıştırıcı, henüz derlenmemişse `local` hata ayıklama APK'sını kendisi derler.

---

## 2. Çalıştırın

Depo kökünden:

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

Seçenekler: `--target local|dev` (varsayılan `local`) · `--serial <adb-serial>`
(varsayılan: otomatik seçim) · `--journeys <ids>` · `--rebuild` · `--no-reset` (smoke
yolculuğundaki temiz yeniden kurulumu atlar) · `--out <dir>` · `--list` · `--help`.

Çalıştırıcı her komut için **tek bir** adb serisini sabitler, böylece bir telefon iki
kez göründüğünde bile (USB + kablosuz) çalışır. `local` hedefi için, cihazdaki
uygulamanın makinenizdeki yığına ulaşması amacıyla `adb reverse` tünelleri kurar.

---

## 3. Sonuçları görün

Bittiğinde bir özet yazdırır ve `journey-results/` altına şunları yazar:

| Dosya                           | Ne                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Bunu okuyun** — yolculuk başına, adım başına ✅/❌, nedeniyle birlikte, ekrandaki testTag'ler ve her adım için bir ekran görüntüsü bağlantısı |
| `latest-report.json`            | aynı veri, makine tarafından okunabilir                                                                                                         |
| `runs/<runId>/*.png`            | her adımın bir ekran görüntüsü (hem başarılı _hem de_ başarısız)                                                                                |
| `runs/<runId>/report.{md,json}` | o belirli çalıştırma için arşivlenmiş rapor                                                                                                     |

Her yolculuk başarılı olduğunda çıkış kodu `0`, herhangi biri başarısız olduğunda `1`
olur. Bir başarısızlıkta adım, ekranda tam olarak ne olduğunu kaydeder, böylece
telefonu yeniden çalıştırmadan _nedenini_ görebilirsiniz.

---

## 4. Yolculuklar neyi kapsıyor

Canlı küme için `--list` çalıştırın. Genel olarak paket şunları kapsar:

- **Smoke** — temiz kurulum → yasal kabul → oturum açma, arka uca ulaşılabilir.
- **Cohort oturum açma** — yetişkin / reşit olmayan / yönetici persona'ları uygulama içi
  geliştirici persona seçici aracılığıyla oturum açar; kimlik, hata ayıklama
  yer paylaşımına ve Firestore `cohort` alanına karşı doğrulanır.
- **OSA cohort kapısı** — reşit olmayan biri bir yetişkini takip edemez veya
  göremez (sunucu `404` döndürür ve Firestore yazımı asla gerçekleşmez), aynı
  cohort'taki eylemler ise başarılı olur — bu da kapının cohort'a özgü olduğunu,
  toptan bir engelleme olmadığını kanıtlar.
- **Yönetici** — cohort geçersiz kılma yalnızca personele özeldir (sıradan bir üye
  `422` ile reddedilir; bir personel hesabı başarılı olur ve düzenleyici bir
  denetim satırı yazar).
- **Moderasyon** — bildir → yönetici askıya alır (+ denetim) → itiraz → askıyı
  kaldır, tamamen sunucu tarafından uygulanan, idempotent temizlikle.

Yolculuklarda kimlik doğrulama her zaman **uygulama içi geliştirici persona
seçicisini** kullanır — asla gerçek Google/Apple oturum açma değil.

> **Yolculuk spesifikasyonlarına dair not.** `journey-tests/j01-j19`
> içindeki Gherkin planları kısmen _özlemseldir_: gönderilen uygulamanın sahip
> olmadığı bir UI'ya atıfta bulunurlar (örneğin bir e-posta/parola kayıt ekranı,
> gizli reşit olmayan sekmeleri, bir keşif ekranı). Bu nedenle çalıştırıcı, her
> yolculuğun gerçek niyetini **gerçek** uygulamaya + Firestore'a + API'ye karşı
> eşler ve bu tür sapmaları kurgu üzerinde başarısız olmak yerine bulgular olarak
> kaydeder.

---

## 5. Sorun giderme

| Belirti                                                 | Çözüm                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                   | Telefonu takın / eşleştirin; `adb devices` denetleyin.                                                                        |
| SignIn'e ulaşmada takılma / "backend NOT reachable"     | Yerel yığın çalışmıyor veya `adb reverse` tünelleri kurulmadı — `bash local/start.sh` yeniden başlatın ve yeniden çalıştırın. |
| `persona "<email>" not found in picker`                 | Persona'lar tohumlanmamış — §1'deki tohumlama komutunu çalıştırın.                                                            |
| `Firestore assertions: ON` eksik / DB adımları atlanmış | DB doğrulamaları yalnızca `--target local` için çalışır.                                                                      |
| APK derlemesi başarısız                                 | Yazdırılan `gradle-build.log` dosyasını açın; Java 21+ ve Android SDK'nın kurulu olduğundan emin olun.                        |
| Bir adım, beklemediğiniz bir ekranda başarısız oluyor   | O adım için `latest-report.md` içinde adı geçen ekran görüntüsünü açın.                                                       |

---

## 6. Bir yolculuk ekleme

Yolculuklar, paylaşılan yardımcılardan oluşturulan, bir `run(device, reporter, ctx)`
metodu olan düz nesnelerdir:

- `signInAs(device, reporter, ctx, email, nameToken)` — seçici aracılığıyla bir
  persona ile oturum açar ve ilk başlatma ara ekranlarından Home'a kadar ilerler.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText` ve `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Sunucu: `getIdToken(email)` → bir persona'nın ID belirteci, ardından
  `apiCall(method, path, { token, body })`.

Her doğrulamayı `reporter.step(device, 'name', async () => { … })` içine sarın — bu,
adımı zamanlar, ekran görüntüsünü alır, başarılı/başarısız durumunu kaydeder ve
başarısızlık durumunda ekrandaki testTag'leri yakalar. Yeni nesneyi `buildJourneys`
içindeki `all` dizisine ekleyin.

Saf mantık (ayrıştırma, seçiciler, argüman işleme),
`tests/scripts/device-journey-runner.test.js` içinde birim testiyle test edilir
(`cd express-api && npm test`); cihaz/Firestore/API katmanları, paketi gerçek bir
cihazda çalıştırarak entegrasyon testinden geçirilir.
