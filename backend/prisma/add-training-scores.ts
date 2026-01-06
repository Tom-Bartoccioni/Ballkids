/**
 * Script pour ajouter des notes de formation aléatoires pour les 4 séances
 * pour tous les ballkids sélectionnés et remplaçants
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addTrainingScores() {
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

    // Récupérer l'admin pour scorer
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!admin) {
      console.log('❌ Aucun admin trouvé');
      return;
    }

    // Récupérer tous les ballkids sélectionnés et remplaçants
    const ballkids = await prisma.ballkid.findMany({
      where: {
        tournamentId: tournament.id,
        status: { in: ['SELECTED', 'RESERVE'] },
      },
    });

    console.log(`\n👥 ${ballkids.length} ballkids à noter`);

    // Créer ou récupérer les 4 sessions de formation
    const sessions = [];
    for (let i = 1; i <= 4; i++) {
      let session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: {
            tournamentId: tournament.id,
            sessionNumber: i,
          },
        },
      });

      if (!session) {
        session = await prisma.trainingSession.create({
          data: {
            tournamentId: tournament.id,
            sessionNumber: i,
            date: new Date(2025, 0, 10 + i), // 11, 12, 13, 14 janvier
          },
        });
        console.log(`✅ Session ${i} créée`);
      } else {
        console.log(`📌 Session ${i} existe déjà`);
      }
      sessions.push(session);
    }

    // Pour chaque ballkid, générer des notes pour les 4 séances
    let totalScores = 0;
    for (const ballkid of ballkids) {
      // Générer un niveau de base pour ce ballkid (entre 10 et 18)
      const baseLevel = 10 + Math.random() * 8;
      
      for (const session of sessions) {
        // Vérifier si une note existe déjà
        const existing = await prisma.trainingScore.findFirst({
          where: {
            trainingSessionId: session.id,
            ballkidId: ballkid.id,
          },
        });

        if (!existing) {
          // Variation autour du niveau de base (+/- 2 points)
          const score = Math.min(20, Math.max(0, baseLevel + (Math.random() - 0.5) * 4));
          
          await prisma.trainingScore.create({
            data: {
              trainingSessionId: session.id,
              ballkidId: ballkid.id,
              scorerId: admin.id,
              totalScore: Math.round(score * 10) / 10, // Arrondi à 1 décimale
              isPresent: true,
            },
          });
          totalScores++;
        }
      }
    }

    console.log(`\n✅ ${totalScores} notes de formation ajoutées`);

    // Marquer les sessions comme terminées
    await prisma.trainingSession.updateMany({
      where: { tournamentId: tournament.id },
      data: { isCompleted: true },
    });
    console.log('✅ Sessions marquées comme terminées');

    // Afficher un aperçu
    const summary = await prisma.$queryRaw`
      SELECT 
        ts.sessionNumber,
        COUNT(tsc.id) as scoreCount,
        ROUND(AVG(tsc.totalScore), 2) as avgScore
      FROM training_sessions ts
      LEFT JOIN training_scores tsc ON ts.id = tsc.trainingSessionId
      WHERE ts.tournamentId = ${tournament.id}
      GROUP BY ts.sessionNumber
      ORDER BY ts.sessionNumber
    `;
    
    console.log('\n📊 Résumé par séance:');
    console.log(summary);

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addTrainingScores();
