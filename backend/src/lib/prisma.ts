import { PrismaClient } from '@prisma/client';
import path from 'path';

// Resolution explicite de l'URL du datasource.
//
// Probleme : `new PrismaClient()` par defaut resout un chemin SQLite relatif
// (`file:./prisma/dev.db` du .env) par rapport au CWD, alors qu'un override via
// `datasources` le resout par rapport au dossier du schema -> deux bases
// differentes (dont une base "fantome" backend/prisma/prisma/dev.db).
//
// Solution : on convertit tout chemin `file:` relatif en chemin ABSOLU (base =
// CWD, comme le comportement d'origine du serveur) puis on le passe explicitement.
// Ainsi la meme base est utilisee quel que soit le mode :
//   - serveur dev  : file:./prisma/dev.db      -> file:/<cwd>/prisma/dev.db
//   - tests        : file:/<abs>/test.db       -> inchange
//   - Docker/prod  : file:/app/data/prod.db    -> inchange
// L'URL explicite l'emporte aussi sur un .env recharge par Prisma (sans quoi les
// tests ecrivaient dans dev.db au lieu de test.db).
function resolveDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('file:')) {
    const filePath = raw.slice('file:'.length);
    if (!path.isAbsolute(filePath)) {
      return 'file:' + path.resolve(process.cwd(), filePath);
    }
  }
  return raw;
}

const dbUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient(
  dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined
);

export default prisma;
