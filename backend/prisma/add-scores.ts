import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function addScores() {
  const tournament = await prisma.tournament.findFirst({ where: { isActive: true } });
  if (!tournament) { console.log('Pas de tournoi'); return; }

  // Trouver ou créer la session de sélection
  let session = await prisma.selectionSession.findUnique({ where: { tournamentId: tournament.id } });
  if (!session) {
    session = await prisma.selectionSession.create({
      data: { tournamentId: tournament.id, date: new Date() }
    });
  }
  console.log('Session:', session.id);

  // Trouver l'admin
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) { console.log('Pas d admin'); return; }

  // Récupérer tous les ballkids sélectionnés
  const ballkids = await prisma.ballkid.findMany({
    where: { tournamentId: tournament.id, status: { in: ['SELECTED', 'RESERVE'] } }
  });
  console.log('Ballkids:', ballkids.length);

  // Supprimer les anciennes notes
  await prisma.selectionScore.deleteMany({ where: { selectionSessionId: session.id } });

  // Créer des notes aléatoires
  for (const b of ballkids) {
    const score = Math.round((10 + Math.random() * 10) * 10) / 10; // Entre 10 et 20
    await prisma.selectionScore.create({
      data: {
        selectionSessionId: session.id,
        ballkidId: b.id,
        scorerId: admin.id,
        totalScore: score,
      }
    });
  }
  console.log('Notes créées pour', ballkids.length, 'ballkids');
  await prisma.$disconnect();
}

addScores();
