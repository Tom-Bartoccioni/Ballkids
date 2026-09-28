import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveDatabaseUrl } from '../lib/prisma.js';

// Le serveur doit resoudre un chemin SQLite relatif EXACTEMENT comme le CLI
// Prisma (par rapport au dossier du schema), sinon deux bases differentes.
describe('resolveDatabaseUrl', () => {
  const schemaDir = path.resolve('/srv/app/backend/prisma');

  it('resout un chemin relatif par rapport au dossier du schema (comme le CLI)', () => {
    expect(resolveDatabaseUrl('file:./dev.db', schemaDir)).toBe('file:' + path.resolve(schemaDir, './dev.db'));
  });

  it('laisse un chemin absolu inchange (prod Docker, tests)', () => {
    expect(resolveDatabaseUrl('file:/app/data/prod.db', schemaDir)).toBe('file:/app/data/prod.db');
  });

  it('laisse une URL non-file inchangee et renvoie undefined si absente', () => {
    expect(resolveDatabaseUrl('postgresql://u:p@h/db', schemaDir)).toBe('postgresql://u:p@h/db');
    expect(resolveDatabaseUrl(undefined, schemaDir)).toBeUndefined();
  });
});
