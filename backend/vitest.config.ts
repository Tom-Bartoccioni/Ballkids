import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les suites partagent une seule base SQLite (prisma/test.db) et chacune fait
    // `prisma db push --force-reset` dans son beforeAll. Exécuter les fichiers en
    // parallèle les ferait se réinitialiser mutuellement en pleine exécution :
    // on force donc une exécution séquentielle des fichiers de test.
    fileParallelism: false,
  },
});
