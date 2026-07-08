import { Prisma } from '@prisma/client';

/**
 * Options de copie : chaque drapeau active la reprise d'une catégorie de données
 * du tournoi source vers le tournoi cible.
 */
export interface CloneOptions {
  ballkids: boolean;          // reprendre la liste des ramasseurs
  selectionCriteria: boolean; // reprendre la session + critères de sélection
  trainingSetup: boolean;     // reprendre les séances de formation + critères
  teams: boolean;             // reprendre les équipes
  days: boolean;              // reprendre les jours de tournoi
  coaches: boolean;           // reprendre les coachs
}

/**
 * Compteurs réels des entités effectivement créées dans le tournoi cible.
 */
export interface CloneSummary {
  ballkids: number;
  selectionCriteria: number;
  trainingSessions: number;
  teams: number;
  days: number;
  coaches: number;
}

/**
 * Copie les données choisies du tournoi source vers le tournoi cible (déjà créé).
 * Ne réutilise JAMAIS les ids source. Ne copie PAS les scores/absences/affectations.
 *
 * @param tx                  Client de transaction Prisma (toutes les écritures passent par lui)
 * @param sourceTournamentId  Tournoi source (année précédente)
 * @param targetTournamentId  Tournoi cible (déjà créé)
 * @param options             Catégories de données à reprendre
 * @param targetStartDate     Date de début du tournoi cible (sert à recalculer les jours)
 */
export async function cloneTournamentData(
  tx: Prisma.TransactionClient,
  sourceTournamentId: string,
  targetTournamentId: string,
  options: CloneOptions,
  targetStartDate: Date
): Promise<CloneSummary> {
  const summary: CloneSummary = {
    ballkids: 0,
    selectionCriteria: 0,
    trainingSessions: 0,
    teams: 0,
    days: 0,
    coaches: 0,
  };

  // ------------------------------------------------------------------
  // RAMASSEURS
  // On reprend l'identité/contact/tailles. On réinitialise le statut à
  // 'REGISTERED', on marque isVeteran = true, et on repart sans photo ni
  // enfants liés (scores, absences, affectations, capitanats).
  // ------------------------------------------------------------------
  if (options.ballkids) {
    const sourceBallkids = await tx.ballkid.findMany({
      where: { tournamentId: sourceTournamentId },
    });

    for (const bk of sourceBallkids) {
      await tx.ballkid.create({
        data: {
          tournamentId: targetTournamentId,
          status: 'REGISTERED',
          isVeteran: true,
          // Informations personnelles
          firstName: bk.firstName,
          lastName: bk.lastName,
          birthDate: bk.birthDate,
          gender: bk.gender,
          club: bk.club,
          email: bk.email,
          phone: bk.phone,
          phoneFather: bk.phoneFather,
          phoneMother: bk.phoneMother,
          address: bk.address,
          postalCode: bk.postalCode,
          city: bk.city,
          licenseNumber: bk.licenseNumber,
          // photoUrl volontairement omise : on repart propre
          // Équipement
          tshirtSize: bk.tshirtSize,
          shortSize: bk.shortSize,
          tracksuitSize: bk.tracksuitSize,
          shoeSize: bk.shoeSize,
        },
      });
      summary.ballkids += 1;
    }
  }

  // ------------------------------------------------------------------
  // SESSION + CRITÈRES DE SÉLECTION
  // Une seule session par tournoi (@@unique tournamentId). On recrée la
  // session pour la cible et on copie ses critères (sans les scores).
  // ------------------------------------------------------------------
  if (options.selectionCriteria) {
    const sourceSession = await tx.selectionSession.findUnique({
      where: { tournamentId: sourceTournamentId },
      include: { criteria: true },
    });

    if (sourceSession) {
      const newSession = await tx.selectionSession.create({
        data: {
          tournamentId: targetTournamentId,
          date: sourceSession.date,
          isCompleted: false,
        },
      });

      for (const crit of sourceSession.criteria) {
        await tx.selectionCriteria.create({
          data: {
            selectionSessionId: newSession.id,
            name: crit.name,
            abbreviation: crit.abbreviation,
            maxScore: crit.maxScore,
            weight: crit.weight,
            isCalculated: crit.isCalculated,
            formula: crit.formula,
            order: crit.order,
          },
        });
        summary.selectionCriteria += 1;
      }
    }
  }

  // ------------------------------------------------------------------
  // SÉANCES + CRITÈRES DE FORMATION
  // On copie chaque séance (unique par tournamentId+sessionNumber) et ses
  // critères, sans les scores ni les absences.
  // ------------------------------------------------------------------
  if (options.trainingSetup) {
    const sourceSessions = await tx.trainingSession.findMany({
      where: { tournamentId: sourceTournamentId },
      include: { criteria: true },
    });

    for (const sess of sourceSessions) {
      const newSession = await tx.trainingSession.create({
        data: {
          tournamentId: targetTournamentId,
          sessionNumber: sess.sessionNumber,
          date: sess.date,
          isCompleted: false,
        },
      });

      for (const crit of sess.criteria) {
        await tx.trainingCriteria.create({
          data: {
            trainingSessionId: newSession.id,
            name: crit.name,
            abbreviation: crit.abbreviation,
            maxScore: crit.maxScore,
            weight: crit.weight,
            isCalculated: crit.isCalculated,
            formula: crit.formula,
            order: crit.order,
          },
        });
      }
      summary.trainingSessions += 1;
    }
  }

  // ------------------------------------------------------------------
  // ÉQUIPES
  // On copie name/order (unique par tournamentId+name). Pas d'affectations
  // (TeamAssignment), pas de placement sur court, pas de capitaine.
  // ------------------------------------------------------------------
  if (options.teams) {
    const sourceTeams = await tx.team.findMany({
      where: { tournamentId: sourceTournamentId },
    });

    for (const team of sourceTeams) {
      await tx.team.create({
        data: {
          tournamentId: targetTournamentId,
          name: team.name,
          order: team.order,
        },
      });
      summary.teams += 1;
    }
  }

  // ------------------------------------------------------------------
  // JOURS DE TOURNOI
  // On copie dayNumber/ballkidCount (unique par tournamentId+dayNumber). La
  // date est RECALCULÉE depuis targetStartDate + (dayNumber - 1) jours. Pas
  // de courts ni de placements repris.
  // ------------------------------------------------------------------
  if (options.days) {
    const sourceDays = await tx.tournamentDay.findMany({
      where: { tournamentId: sourceTournamentId },
    });

    for (const day of sourceDays) {
      const date = new Date(targetStartDate);
      date.setDate(date.getDate() + (day.dayNumber - 1));

      await tx.tournamentDay.create({
        data: {
          tournamentId: targetTournamentId,
          dayNumber: day.dayNumber,
          date,
          ballkidCount: day.ballkidCount,
        },
      });
      summary.days += 1;
    }
  }

  // ------------------------------------------------------------------
  // COACHS
  // La contrainte est @@unique([userId, tournamentId]) : un utilisateur peut
  // etre coach sur plusieurs annees. On recree donc une ligne Coach pointant
  // vers le meme userId pour le tournoi cible (sans reprendre les
  // disponibilites ni les affectations liees a l'ancienne annee).
  // ------------------------------------------------------------------
  if (options.coaches) {
    const sourceCoaches = await tx.coach.findMany({
      where: { tournamentId: sourceTournamentId },
    });

    for (const coach of sourceCoaches) {
      await tx.coach.create({
        data: {
          userId: coach.userId,
          tournamentId: targetTournamentId,
        },
      });
      summary.coaches += 1;
    }
  }

  return summary;
}
