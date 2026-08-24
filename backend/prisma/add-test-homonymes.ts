/**
 * Script ponctuel : ajoute des cas de collision de noms dans la base de dev pour
 * pouvoir tester manuellement la categorie "homonymes" de l'import photos.
 *  - un second DUPONT LOUISE  -> homonyme strict
 *  - un SWAN MARTIN           -> collision par inversion prenom/nom avec MARTIN SWAN
 * Usage : npx tsx prisma/add-test-homonymes.ts
 */
import prisma from '../src/lib/prisma.js';

const CAS = [
  {
    firstName: 'LOUISE',
    lastName: 'DUPONT',
    email: 'louise.dupont.homonyme@example.com',
    gender: 'FEMALE',
    birthDate: new Date('2010-03-15'),
    status: 'REGISTERED',
  },
  {
    firstName: 'MARTIN',
    lastName: 'SWAN',
    email: 'swan.martin.inversion@example.com',
    gender: 'MALE',
    birthDate: new Date('2010-07-02'),
    status: 'REGISTERED',
  },
];

async function main() {
  const tournament = await prisma.tournament.findFirst({ where: { isActive: true } });
  if (!tournament) throw new Error('Aucun tournoi actif');

  for (const cas of CAS) {
    const existant = await prisma.ballkid.findFirst({
      where: { email: cas.email, tournamentId: tournament.id },
    });
    if (existant) {
      console.log(`  deja present : ${cas.lastName} ${cas.firstName}`);
      continue;
    }
    await prisma.ballkid.create({ data: { ...cas, tournamentId: tournament.id } });
    console.log(`  cree : ${cas.lastName} ${cas.firstName}`);
  }

  const total = await prisma.ballkid.count({ where: { tournamentId: tournament.id } });
  console.log(`Total ramasseurs sur "${tournament.name}" : ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
