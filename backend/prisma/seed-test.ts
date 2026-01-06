import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
  // Récupérer le tournoi actif
  const tournament = await prisma.tournament.findFirst({ where: { isActive: true } });
  if (!tournament) {
    console.log('Pas de tournoi actif');
    return;
  }
  console.log('Tournoi:', tournament.name);

  // Supprimer les anciens ballkids
  await prisma.selectionScore.deleteMany({});
  await prisma.trainingScore.deleteMany({});
  await prisma.teamAssignment.deleteMany({});
  await prisma.ballkid.deleteMany({ where: { tournamentId: tournament.id } });
  console.log('Anciens ballkids supprimés');

  // Créer 80 ballkids avec statut SELECTED
  const prenoms = ['Lucas', 'Emma', 'Hugo', 'Léa', 'Louis', 'Chloé', 'Gabriel', 'Manon', 'Raphaël', 'Inès', 'Arthur', 'Jade', 'Jules', 'Louise', 'Adam', 'Alice', 'Léo', 'Lina', 'Paul', 'Rose', 'Nathan', 'Camille', 'Ethan', 'Zoé', 'Tom', 'Juliette', 'Noah', 'Eva', 'Théo', 'Anna', 'Maxime', 'Léonie', 'Mathis', 'Clara', 'Enzo', 'Sarah', 'Timéo', 'Mia', 'Sacha', 'Lou'];
  const noms = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Lefèvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez'];
  const clubs = ['TC Paris', 'TC Lyon', 'TC Marseille', 'TC Nice', 'TC Bordeaux', 'TC Toulouse', 'TC Nantes', 'TC Lille', null];
  const sizes = ['XS', 'S', 'M', 'L', 'XL'];

  const ballkids: any[] = [];
  for (let i = 0; i < 80; i++) {
    const prenom = prenoms[i % prenoms.length];
    const nom = noms[i % noms.length];
    const gender = i % 2 === 0 ? 'MALE' : 'FEMALE';
    const birthYear = 2010 + (i % 5);
    
    ballkids.push({
      firstName: prenom,
      lastName: nom + (i >= 30 ? '-' + (i - 29) : ''),
      email: `${prenom.toLowerCase()}.${nom.toLowerCase()}${i}@email.com`,
      birthDate: new Date(birthYear, (i % 12), (i % 28) + 1),
      gender,
      phone: '06' + String(i).padStart(8, '0'),
      club: clubs[i % clubs.length],
      tshirtSize: sizes[i % sizes.length],
      shortSize: sizes[i % sizes.length],
      shoeSize: String(36 + (i % 8)),
      status: 'SELECTED',
      tournamentId: tournament.id,
      isVeteran: i < 10,
    });
  }

  // Ajouter 2 remplaçants
  for (let i = 80; i < 82; i++) {
    const prenom = prenoms[i % prenoms.length];
    const nom = noms[i % noms.length];
    ballkids.push({
      firstName: prenom,
      lastName: nom + '-R' + (i - 79),
      email: `${prenom.toLowerCase()}.reserve${i}@email.com`,
      birthDate: new Date(2011, i % 12, (i % 28) + 1),
      gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
      phone: '06' + String(i).padStart(8, '0'),
      club: clubs[i % clubs.length],
      status: 'RESERVE',
      tournamentId: tournament.id,
    });
  }

  await prisma.ballkid.createMany({ data: ballkids });
  console.log('82 ballkids créés (80 sélectionnés + 2 remplaçants)');

  // Créer les 13 équipes
  await prisma.team.deleteMany({ where: { tournamentId: tournament.id } });
  
  const colors = ['Rouge', 'Bleu', 'Vert', 'Jaune', 'Orange', 'Violet', 'Rose', 'Cyan', 'Blanc', 'Noir', 'Gris', 'Marron', 'Turquoise'];
  const teams: any[] = [];
  for (let i = 0; i < 13; i++) {
    teams.push({
      name: 'Équipe ' + colors[i],
      order: i + 1,
      tournamentId: tournament.id,
    });
  }
  await prisma.team.createMany({ data: teams });
  console.log('13 équipes créées');

  // Assigner les ballkids aux équipes via TeamAssignment (6 par équipe, 2 restent sans équipe)
  const createdBallkids = await prisma.ballkid.findMany({ 
    where: { tournamentId: tournament.id, status: 'SELECTED' },
    orderBy: { lastName: 'asc' }
  });
  const createdTeams = await prisma.team.findMany({ 
    where: { tournamentId: tournament.id },
    orderBy: { order: 'asc' }
  });

  // Supprimer les anciennes assignations
  await prisma.teamAssignment.deleteMany({});
  
  const assignments: any[] = [];
  for (let i = 0; i < createdBallkids.length; i++) {
    const teamIndex = Math.floor(i / 6);
    if (teamIndex < createdTeams.length) {
      assignments.push({
        ballkidId: createdBallkids[i].id,
        teamId: createdTeams[teamIndex].id,
      });
    }
  }
  await prisma.teamAssignment.createMany({ data: assignments });
  console.log('Ballkids assignés aux équipes (6 par équipe)');

  await prisma.$disconnect();
  console.log('Done!');
}

seed().catch(console.error);
