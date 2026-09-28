import { PrismaClient } from '@prisma/client';
import path from 'path';

// Resolution explicite de l'URL du datasource.
//
// Le CLI Prisma (`db push`, `migrate`, `db seed`) resout un chemin SQLite RELATIF
// par rapport au dossier du schema (backend/prisma/), alors que le client par
// defaut le resout par rapport au CWD. Avec un .env partage par les deux, cela
// donnait DEUX bases : l'une remplie par le CLI, l'autre lue (vide) par le
// serveur (cas J-02 du cahier de recette, dossier fantome prisma/prisma/).
//
// On aligne le serveur sur le CLI : tout chemin `file:` relatif est resolu par
// rapport au dossier du schema, puis passe explicitement au client.
//   - dev  : file:./dev.db            -> file:<backend>/prisma/dev.db (comme le CLI)
//   - tests: file:/<abs>/test.db      -> inchange
//   - prod : file:/app/data/prod.db   -> inchange
// L'URL explicite l'emporte aussi sur un .env recharge par Prisma (sans quoi les
// tests ecrivaient dans dev.db au lieu de test.db).
const SCHEMA_DIR = path.resolve(__dirname, '..', '..', 'prisma');

export function resolveDatabaseUrl(raw: string | undefined, schemaDir: string = SCHEMA_DIR): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('file:')) {
    const filePath = raw.slice('file:'.length);
    if (!path.isAbsolute(filePath)) {
      return 'file:' + path.resolve(schemaDir, filePath);
    }
  }
  return raw;
}

const dbUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient(
  dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined
);

export default prisma;
