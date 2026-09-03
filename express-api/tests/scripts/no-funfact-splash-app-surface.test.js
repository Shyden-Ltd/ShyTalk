/**
 * SHY-0144 — the FunFact splash and the app-side fun-fact code are retired.
 *
 * This guard is deliberately APP-SIDE ONLY. The admin tab, the Express
 * `/fun-facts` routes and the collection itself are SHY-0145's scope and are
 * asserted separately there; a guard that spanned both would go green only
 * when two stories had landed and would tell neither of them apart.
 *
 * It scans rather than listing known files, so a splash reference reintroduced
 * in a file nobody thought of still fails.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');

/** Directories that are not source, or that belong to SHY-0145. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  'dist',
  '.gradle',
  'Pods',
  'test-results',
  'playwright-report',
  'allure-results',
  '.project',
]);

/**
 * SHY-0145's surface — was excluded here on purpose so the two stories could be
 * told apart (see the file header). **SHY-0145 has now landed**, so the list is
 * empty: the backend routes, the admin tab and the collection are gone, and
 * `no-funfacts-backend-admin-surface.test.js` asserts that half. Kept as an
 * empty list rather than deleted so the header's explanation still has the thing
 * it refers to, and so a future carve-out has an obvious home.
 */
const SHY_0145_PATHS = [];

const APP_EXTENSIONS = new Set(['.kt', '.kts', '.swift', '.xml', '.feature']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(REPO);
const rel = (f) => path.relative(REPO, f);
const isShy0145 = (f) => SHY_0145_PATHS.includes(rel(f));

describe('SHY-0144 — the FunFact splash is gone from the app', () => {
  test('the scan actually sees source — the guard is not vacuous', () => {
    const kotlin = ALL_FILES.filter((f) => f.endsWith('.kt'));
    expect(kotlin.length).toBeGreaterThan(100);
  });

  test('no Kotlin or Swift source references Screen.Splash', () => {
    const offenders = ALL_FILES.filter((f) => {
      const ext = path.extname(f);
      if (ext !== '.kt' && ext !== '.kts' && ext !== '.swift') return false;
      return /Screen\.Splash\b/.test(fs.readFileSync(f, 'utf8'));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  test('no "splash" route string survives in the navigation model', () => {
    const screenKt = path.join(
      REPO,
      'shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/Screen.kt',
    );
    expect(fs.existsSync(screenKt)).toBe(true);
    expect(fs.readFileSync(screenKt, 'utf8')).not.toMatch(/Splash/);
  });

  test('the splash and app-side fun-fact source files are deleted', () => {
    const gone = [
      'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/splash/FunFactSplashScreen.kt',
      'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/splash/FunFactSplashViewModel.kt',
      'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/splash/BannerImagePreloader.kt',
      'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/splash/WebContentPreloader.kt',
      'shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/FunFact.kt',
      'shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/FunFactRepository.kt',
      'app/src/main/java/com/shyden/shytalk/data/repository/FunFactRepositoryImpl.kt',
      'app/src/main/java/com/shyden/shytalk/feature/splash/CoilBannerImagePreloader.kt',
      'app/src/main/java/com/shyden/shytalk/feature/splash/OkHttpWebContentPreloader.kt',
      'app/src/androidTest/java/com/shyden/shytalk/fake/FakeFunFactRepository.kt',
      'app/src/androidTest/assets/features/splash.feature',
      'app/src/test/java/com/shyden/shytalk/feature/splash/FunFactSplashViewModelTest.kt',
      'app/src/test/java/com/shyden/shytalk/data/repository/FunFactRepositoryImplTest.kt',
      'app/src/test/java/com/shyden/shytalk/core/model/FunFactFromMapTest.kt',
      'shared/src/jvmTest/kotlin/com/shyden/shytalk/core/model/FunFactTest.kt',
    ];
    const surviving = gone.filter((p) => fs.existsSync(path.join(REPO, p)));
    expect(surviving).toEqual([]);
  });

  test('no app-side source binds or names a FunFact type', () => {
    const offenders = ALL_FILES.filter((f) => {
      const ext = path.extname(f);
      if (!APP_EXTENSIONS.has(ext)) return false;
      if (isShy0145(f)) return false;
      return /FunFact/.test(fs.readFileSync(f, 'utf8'));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  test('splash_tagline is removed from EVERY locale, and locales still exist', () => {
    const dir = path.join(REPO, 'shared/src/commonMain/composeResources');
    const localeDirs = fs.readdirSync(dir).filter((d) => d.startsWith('values'));
    // Not vacuous: deleting the locale tree must not make this pass.
    // Five since SHY-0289 (base + id, th, vi, zh). Hardcoded on purpose: this
    // is the anchor that stops the scan passing because it found no files.
    expect(localeDirs.length).toBeGreaterThanOrEqual(5);
    const offenders = localeDirs.filter((d) => {
      const f = path.join(dir, d, 'strings.xml');
      return fs.existsSync(f) && /splash_tagline/.test(fs.readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
