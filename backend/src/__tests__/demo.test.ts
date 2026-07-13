import { describe, it, expect, afterAll } from 'vitest';
import { blockInDemo } from '../middleware/demoGuard.js';
import { AppError } from '../middleware/errorHandler.js';

// Test UNITAIRE du middleware demoGuard en isolation (pas de HTTP, pas de DB).
// blockInDemo est un middleware Express standard (req, res, next).

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

afterAll(() => {
  // Restaurer l'etat initial de la variable d'environnement
  if (ORIGINAL_DEMO_MODE === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  }
});

describe('demoGuard.blockInDemo', () => {
  it('passe une AppError 403 (message FR exact) a next() quand DEMO_MODE=true', () => {
    process.env.DEMO_MODE = 'true';

    let received: unknown;
    const next = (err?: unknown) => {
      received = err;
    };

    blockInDemo({} as any, {} as any, next as any);

    expect(received).toBeInstanceOf(AppError);
    expect((received as AppError).statusCode).toBe(403);
    expect((received as AppError).message).toBe('Action désactivée en mode démonstration.');
  });

  it('appelle next() sans erreur quand DEMO_MODE n\'est pas actif', () => {
    delete process.env.DEMO_MODE;

    let called = false;
    let arg: unknown = 'sentinel';
    const next = (err?: unknown) => {
      called = true;
      arg = err;
    };

    blockInDemo({} as any, {} as any, next as any);

    expect(called).toBe(true);
    expect(arg).toBeUndefined();
  });
});
