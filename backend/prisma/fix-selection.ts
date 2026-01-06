/**
 * Script pour corriger la sélection : 78 SELECTED + 2 RESERVE
 * Les 2 derniers SELECTED (par score) passent en RESERVE
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSelection() {
  try {
    // Récupérer le tournoi actif
    const tournament = await prisma.tournament.findFirst({
      where: { isActive: true },
    });

    if (!tournament) {
      console.log('❌ Aucun tournoi actif trouvé');
      return;
    }

    console.log(`📋 Tournoi: ${tournament.name}`);

    // Récupérer tous les ballkids SELECTED avec leurs scores
    const selectedBallkids = await prisma.ballkid.findMany({
      where: {
        tournamentId: tournament.id,
        status: 'SELECTED',
      },
      include: {
        selectionScores: true,
      },
    });

    console.log(`\n📊 ${selectedBallkids.length} ballkids SELECTED actuellement`);

    if (selectedBallkids.length <= 78) {
      console.log('✅ Pas de correction nécessaire (déjà 78 ou moins)');
      return;
    }

    // Calculer la moyenne de chaque ballkid
    const ranking = selectedBallkids.map((b) => {
      const avgScore = b.selectionScores.length > 0
        ? b.selectionScores.reduce((sum, s) => sum + (s.totalScore || 0), 0) / b.selectionScores.length
        : 0;
      return { id: b.id, firstName: b.firstName, lastName: b.lastName, avgScore };
    });

    // Trier par score décroissant
    ranking.sort((a, b) => b.avgScore - a.avgScore);

    // Les 2 derniers passent en RESERVE
    const toReserve = ranking.slice(78, 80);

    console.log('\n🔄 Passage en RESERVE:');
    for (const b of toReserve) {
      console.log(`   - ${b.lastName} ${b.firstName} (moyenne: ${b.avgScore.toFixed(2)})`);
    }

    // Mise à jour
    const reserveIds = toReserve.map((b) => b.id);
    await prisma.ballkid.updateMany({
      where: { id: { in: reserveIds } },
      data: { status: 'RESERVE' },
    });

    // Vérification
    const finalCounts = await prisma.ballkid.groupBy({
      by: ['status'],
      where: { tournamentId: tournament.id },
      _count: true,
    });

    console.log('\n📊 Résultat final:');
    for (const count of finalCounts) {
      console.log(`   ${count.status}: ${count._count}`);
    }

    console.log('\n✅ Correction terminée!');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixSelection();
