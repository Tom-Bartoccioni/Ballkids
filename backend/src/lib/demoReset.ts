import { execSync } from 'child_process';
import path from 'path';

// Racine du backend (ce fichier est dans backend/src/lib)
const BACKEND_ROOT = path.join(__dirname, '../..');

// Garde-fou : on n'autorise le `--force-reset` (destructif) QUE si la base cible
// est explicitement une base de démo. Sinon un DEMO_MODE=true qui fuiterait en
// production wiperait la vraie base. Le marqueur "demo" doit apparaître dans
// DATABASE_URL (ex: file:/app/data/demo.db) ; un override explicite est possible
// via DEMO_RESET_CONFIRM=true pour les cas de nommage non standard.
function isResetTargetSafe(): boolean {
  const url = process.env.DATABASE_URL || '';
  return /demo/i.test(url) || process.env.DEMO_RESET_CONFIRM === 'true';
}

// Réinitialise puis re-seed la base de démonstration.
function resetDemoDatabase(): void {
  if (!isResetTargetSafe()) {
    console.error(
      `⛔ Réinitialisation démo ANNULÉE : DATABASE_URL ("${process.env.DATABASE_URL}") ` +
        `ne ressemble pas à une base de démo. Refus de wiper la base. ` +
        `Nommez la base avec "demo" ou définissez DEMO_RESET_CONFIRM=true si c'est voulu.`
    );
    return;
  }
  try {
    execSync('npx prisma db push --force-reset --skip-generate', {
      cwd: BACKEND_ROOT,
      stdio: 'pipe',
    });
    execSync('npm run db:seed:demo', {
      cwd: BACKEND_ROOT,
      stdio: 'pipe',
    });
    console.log('♻️ Base de démonstration réinitialisée');
  } catch (error) {
    console.error('❌ Échec de la réinitialisation de la base de démonstration :', error);
  }
}

export function startDemoReset(): void {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }
  if (!isResetTargetSafe()) {
    console.error(
      `⛔ DEMO_MODE=true mais DATABASE_URL ("${process.env.DATABASE_URL}") n'est pas une base de démo. ` +
        `Réinitialisation périodique DÉSACTIVÉE par sécurité.`
    );
    return;
  }
  const intervalHours = Number(process.env.DEMO_RESET_INTERVAL_HOURS) || 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`🎭 Mode démo actif : réinitialisation automatique toutes les ${intervalHours} h`);
  setInterval(resetDemoDatabase, intervalMs);
}
