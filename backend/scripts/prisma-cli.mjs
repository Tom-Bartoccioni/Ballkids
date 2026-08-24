#!/usr/bin/env node
/**
 * Wrapper autour du CLI Prisma.
 *
 * Probleme : le CLI resout un chemin SQLite relatif (`file:./prisma/dev.db`) par
 * rapport au dossier du SCHEMA (backend/prisma/), alors que le client Prisma le
 * resout par rapport au CWD (backend/) — cf. resolveDatabaseUrl() dans
 * src/lib/prisma.ts. Resultat : `prisma db push` creait une base fantome
 * backend/prisma/prisma/dev.db que le serveur ne lisait jamais.
 *
 * Solution : on applique la MEME resolution que le client (relatif -> absolu
 * depuis le CWD) avant de lancer le CLI. Une URL deja absolue (tests, Docker)
 * est laissee telle quelle.
 *
 * Usage : node scripts/prisma-cli.mjs db push [...]
 */
import { spawnSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function resolveDatabaseUrl(raw) {
  if (!raw || !raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  if (path.isAbsolute(filePath)) return raw;
  return 'file:' + path.resolve(process.cwd(), filePath);
}

const url = resolveDatabaseUrl(process.env.DATABASE_URL);
const args = process.argv.slice(2);

const result = spawnSync('npx', ['prisma', ...args], {
  stdio: 'inherit',
  env: url ? { ...process.env, DATABASE_URL: url } : process.env,
});

process.exit(result.status ?? 1);
