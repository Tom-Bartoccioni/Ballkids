import { Prisma } from '@prisma/client';

/**
 * Ajoute `days` jours à une date sans muter l'original.
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Grille de sélection de l'admin (reprise de son classeur Excel) : 11 critères
 * notés avec leur coefficient, + 2 bonus (ancien, jour). Le total = Σ note × coef,
 * comme la colonne TOTAL du classeur. Les maxima par critère ne figurent pas dans
 * le classeur : 20 par défaut, modifiables dans l'éditeur de critères.
 */
export const DEFAULT_SELECTION_CRITERIA = [
  { name: 'Poubelle avec rebond',  abbreviation: 'POUB AVEC R',   order: 1,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Poubelle sans rebond',  abbreviation: 'POUB SANS R',   order: 2,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Roulé 1/2',             abbreviation: 'ROULE 1/2',     order: 3,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Roulé',                 abbreviation: 'ROULE',         order: 4,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Vitesse (roulé)',       abbreviation: 'VIT ROULE',     order: 5,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Rebond',                abbreviation: 'REBOND',        order: 6,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Vitesse',               abbreviation: 'VITESSE',       order: 7,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Parcours poubelle',     abbreviation: 'PARC POUB',     order: 8,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Parcours boîtes 1',     abbreviation: 'PARC BOITES 1', order: 9,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Parcours boîtes 2',     abbreviation: 'PARC BOITES 2', order: 10, maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Parcours vitesse',      abbreviation: 'PARC VITESSE',  order: 11, maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Ancien (bonus)',        abbreviation: 'ANCIEN',        order: 12, maxScore: 40, weight: 1, isCalculated: false },
  { name: 'Jour (bonus)',          abbreviation: 'JOUR',          order: 13, maxScore: 9,  weight: 1, isCalculated: false },
] as const;

/**
 * Critères par défaut des séances de formation (total = somme brute des points,
 * différente de la sélection). Valeurs reprises telles quelles depuis `prisma/seed.ts`.
 */
const DEFAULT_TRAINING_CRITERIA = [
  { name: 'Vitesse', abbreviation: 'VITESSE', order: 1, maxScore: 5, isCalculated: false },
  { name: 'Précision', abbreviation: 'PRECISION', order: 2, maxScore: 5, isCalculated: false },
  { name: 'Réflexes', abbreviation: 'REFLEXES', order: 3, maxScore: 5, isCalculated: false },
  { name: 'Concentration', abbreviation: 'CONCENTRATION', order: 4, maxScore: 5, isCalculated: false },
] as const;

/**
 * Nombre de séances de formation créées par défaut.
 */
const DEFAULT_TRAINING_SESSION_COUNT = 4;

/**
 * Nombre d'équipes créées par défaut.
 */
const DEFAULT_TEAM_COUNT = 13;

/**
 * Configuration des 9 jours du tournoi : effectif de ramasseurs attendu par jour.
 * Valeurs reprises telles quelles depuis `prisma/seed.ts`.
 */
const DEFAULT_DAY_CONFIGS = [
  { dayNumber: 1, ballkidCount: 78 }, // Samedi
  { dayNumber: 2, ballkidCount: 78 }, // Dimanche
  { dayNumber: 3, ballkidCount: 78 }, // Lundi
  { dayNumber: 4, ballkidCount: 78 }, // Mardi
  { dayNumber: 5, ballkidCount: 78 }, // Mercredi
  { dayNumber: 6, ballkidCount: 78 }, // Jeudi
  { dayNumber: 7, ballkidCount: 36 }, // Vendredi
  { dayNumber: 8, ballkidCount: 20 }, // Samedi final
  { dayNumber: 9, ballkidCount: 20 }, // Dimanche final
] as const;

/**
 * Crée la structure par défaut d'un tournoi neuf : session de sélection + critères par défaut,
 * séances de formation + critères, équipes par défaut, et les jours de tournoi (dates calculées depuis startDate).
 * `tx` est un client de transaction Prisma (ou le singleton prisma).
 */
export async function initializeTournamentDefaults(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  startDate: Date
): Promise<void> {
  // --- Session de sélection + critères par défaut ---
  // SelectionSession.tournamentId est @unique : une seule session par tournoi.
  const selectionSession = await tx.selectionSession.create({
    data: {
      tournamentId,
      date: startDate,
    },
  });

  for (const criteria of DEFAULT_SELECTION_CRITERIA) {
    await tx.selectionCriteria.create({
      data: {
        ...criteria,
        selectionSessionId: selectionSession.id,
      },
    });
  }

  // --- Séances de formation + critères par défaut ---
  // Contrainte @@unique([tournamentId, sessionNumber]).
  for (let sessionNumber = 1; sessionNumber <= DEFAULT_TRAINING_SESSION_COUNT; sessionNumber++) {
    const trainingSession = await tx.trainingSession.create({
      data: {
        tournamentId,
        sessionNumber,
        date: startDate,
      },
    });

    for (const criteria of DEFAULT_TRAINING_CRITERIA) {
      await tx.trainingCriteria.create({
        data: {
          ...criteria,
          trainingSessionId: trainingSession.id,
        },
      });
    }
  }

  // --- Équipes par défaut ---
  // Contrainte @@unique([tournamentId, name]).
  for (let i = 1; i <= DEFAULT_TEAM_COUNT; i++) {
    await tx.team.create({
      data: {
        tournamentId,
        name: `Équipe ${i}`,
        order: i,
      },
    });
  }

  // --- Jours du tournoi ---
  // Contrainte @@unique([tournamentId, dayNumber]).
  // La date est calculée à partir de startDate + (dayNumber - 1) jours,
  // comme dans la mise à jour des jours de tournament.routes.ts.
  for (const config of DEFAULT_DAY_CONFIGS) {
    await tx.tournamentDay.create({
      data: {
        tournamentId,
        dayNumber: config.dayNumber,
        date: addDays(startDate, config.dayNumber - 1),
        ballkidCount: config.ballkidCount,
      },
    });
  }
}
