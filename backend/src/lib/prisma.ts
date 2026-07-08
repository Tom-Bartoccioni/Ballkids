import { PrismaClient } from '@prisma/client';

// On passe explicitement l'URL du datasource : ainsi le DATABASE_URL défini au
// niveau du process (tests -> test.db, Docker -> prod.db) l'emporte sur un
// éventuel .env chargé par Prisma. Sans cela, les tests écrivaient dans dev.db.
const prisma = new PrismaClient(
  process.env.DATABASE_URL
    ? { datasources: { db: { url: process.env.DATABASE_URL } } }
    : undefined
);

export default prisma;
