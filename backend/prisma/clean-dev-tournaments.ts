/**
 * Script ponctuel : supprime de la base de dev les tournois parasites laisses
 * par les suites de tests, en ne gardant que "Monaco Master 2026".
 * Usage : npx tsx prisma/clean-dev-tournaments.ts
 */
import prisma from '../src/lib/prisma.js';

const GARDER = 'Monaco Master 2026';

async function main() {
  const tournois = await prisma.tournament.findMany({
    select: { id: true, name: true, _count: { select: { ballkids: true } } },
  });

  const aSupprimer = tournois.filter((t) => t.name !== GARDER);
  console.log(`Tournois trouves : ${tournois.length}, a supprimer : ${aSupprimer.length}`);

  for (const t of aSupprimer) {
    await prisma.tournament.delete({ where: { id: t.id } });
    console.log(`  supprime : ${t.name} (${t._count.ballkids} ramasseurs)`);
  }

  const restants = await prisma.tournament.findMany({
    select: { name: true, isActive: true, _count: { select: { ballkids: true } } },
  });
  console.log('Restants :', restants);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
