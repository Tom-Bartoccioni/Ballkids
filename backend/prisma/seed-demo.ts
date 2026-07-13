import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Constantes pour remplacer les enums (SQLite ne supporte pas les enums)
const UserRole = {
  ADMIN: 'ADMIN',
  COACH: 'COACH',
} as const;

const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
} as const;

const BallkidStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  SELECTED: 'SELECTED',
  RESERVE: 'RESERVE',
  REJECTED: 'REJECTED',
} as const;

// Données 100% fictives — ne JAMAIS utiliser de vraies informations personnelles.
const PRENOMS = [
  'Lucas', 'Emma', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Louis', 'Manon',
  'Jules', 'Camille', 'Gabriel', 'Sarah', 'Arthur', 'Inès', 'Adam', 'Jade',
  'Raphaël', 'Louise', 'Paul', 'Alice', 'Tom', 'Lina', 'Noah', 'Zoé',
  'Ethan', 'Mila', 'Sacha', 'Anna', 'Maël', 'Rose', 'Léo', 'Eva',
  'Timéo', 'Lola', 'Enzo', 'Nina',
];

const STATUTS = [
  BallkidStatus.SELECTED,
  BallkidStatus.SELECTED,
  BallkidStatus.REGISTERED,
  BallkidStatus.PENDING,
  BallkidStatus.RESERVE,
];

async function main() {
  console.log('🌱 Seed de DÉMONSTRATION (données fictives)...');

  // Compte admin de démonstration
  const adminPassword = await bcrypt.hash('demo1234', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'demo@demo.com' },
    update: {},
    create: {
      email: 'demo@demo.com',
      password: adminPassword,
      firstName: 'Démo',
      lastName: 'Admin',
      role: UserRole.ADMIN,
    },
  });
  console.log('✅ Admin démo créé:', admin.email);

  // Tournoi fictif
  const tournament = await prisma.tournament.upsert({
    where: { id: 'tournament-demo-2026' },
    update: {},
    create: {
      id: 'tournament-demo-2026',
      name: 'Open Démo 2026',
      year: 2026,
      startDate: new Date('2026-04-11'),
      endDate: new Date('2026-04-19'),
      isActive: true,
    },
  });
  console.log('✅ Tournoi démo créé:', tournament.name);

  // Coachs fictifs
  const coachPassword = await bcrypt.hash('demo1234', 10);
  for (let i = 1; i <= 3; i++) {
    const coachUser = await prisma.user.upsert({
      where: { email: `demo+coach${i}@example.com` },
      update: {},
      create: {
        email: `demo+coach${i}@example.com`,
        password: coachPassword,
        firstName: `Coach${i}`,
        lastName: 'Démo',
        role: UserRole.COACH,
      },
    });
    await prisma.coach.upsert({
      where: { userId: coachUser.id },
      update: {},
      create: {
        userId: coachUser.id,
        tournamentId: tournament.id,
      },
    });
  }
  console.log('✅ 3 coachs démo créés');

  // Ramasseurs fictifs (données évidemment fausses)
  const existingBallkids = await prisma.ballkid.count({ where: { tournamentId: tournament.id } });
  if (existingBallkids === 0) {
    for (let i = 0; i < PRENOMS.length; i++) {
      const num = i + 1;
      await prisma.ballkid.create({
        data: {
          firstName: PRENOMS[i],
          lastName: `Démo ${num}`,
          gender: i % 2 === 0 ? Gender.MALE : Gender.FEMALE,
          status: STATUTS[i % STATUTS.length],
          tournamentId: tournament.id,
          birthDate: new Date(`201${2 + (i % 3)}-0${(i % 9) + 1}-15`),
          email: `demo+${num}@example.com`,
          phone: `06000000${String(num).padStart(2, '0')}`,
          club: 'Club Fictif de Démonstration',
          city: 'Démoville',
          postalCode: '00000',
          tshirtSize: ['S', 'M', 'L'][i % 3],
          shortSize: ['S', 'M', 'L'][i % 3],
          shoeSize: String(36 + (i % 8)),
          isVeteran: i % 5 === 0,
        },
      });
    }
    console.log(`✅ ${PRENOMS.length} ramasseurs fictifs créés`);
  } else {
    console.log('ℹ️ Ramasseurs déjà présents');
  }

  // Critères (sélection + formation)
  const defaultCriteria = [
    { name: 'Vitesse', abbreviation: 'VITESSE', order: 1, maxScore: 5, isCalculated: false },
    { name: 'Précision', abbreviation: 'PRECISION', order: 2, maxScore: 5, isCalculated: false },
    { name: 'Réflexes', abbreviation: 'REFLEXES', order: 3, maxScore: 5, isCalculated: false },
    { name: 'Concentration', abbreviation: 'CONCENTRATION', order: 4, maxScore: 5, isCalculated: false },
  ];

  const selectionSession = await prisma.selectionSession.upsert({
    where: { tournamentId: tournament.id },
    update: { date: new Date('2026-03-01') },
    create: { tournamentId: tournament.id, date: new Date('2026-03-01') },
  });

  if ((await prisma.selectionCriteria.count({ where: { selectionSessionId: selectionSession.id } })) === 0) {
    for (const criteria of defaultCriteria) {
      await prisma.selectionCriteria.create({
        data: { ...criteria, selectionSessionId: selectionSession.id },
      });
    }
  }
  console.log('✅ Critères de sélection créés');

  for (let i = 1; i <= 4; i++) {
    await prisma.trainingSession.upsert({
      where: { tournamentId_sessionNumber: { tournamentId: tournament.id, sessionNumber: i } },
      update: { date: new Date(`2026-03-${10 + i}`) },
      create: { tournamentId: tournament.id, sessionNumber: i, date: new Date(`2026-03-${10 + i}`) },
    });
  }

  const trainingSessions = await prisma.trainingSession.findMany({ where: { tournamentId: tournament.id } });
  for (const session of trainingSessions) {
    if ((await prisma.trainingCriteria.count({ where: { trainingSessionId: session.id } })) === 0) {
      for (const criteria of defaultCriteria) {
        await prisma.trainingCriteria.create({
          data: { ...criteria, trainingSessionId: session.id },
        });
      }
    }
  }
  console.log('✅ Séances et critères de formation créés');

  // Jours de tournoi + terrains fictifs
  const dayConfigs = [
    { dayNumber: 1, ballkidCount: 78 },
    { dayNumber: 2, ballkidCount: 78 },
    { dayNumber: 3, ballkidCount: 78 },
    { dayNumber: 4, ballkidCount: 78 },
    { dayNumber: 5, ballkidCount: 78 },
    { dayNumber: 6, ballkidCount: 78 },
    { dayNumber: 7, ballkidCount: 36 },
    { dayNumber: 8, ballkidCount: 20 },
    { dayNumber: 9, ballkidCount: 20 },
  ];

  for (const config of dayConfigs) {
    const day = await prisma.tournamentDay.upsert({
      where: { tournamentId_dayNumber: { tournamentId: tournament.id, dayNumber: config.dayNumber } },
      update: { date: new Date(`2026-04-${11 + config.dayNumber}`), ballkidCount: config.ballkidCount },
      create: {
        tournamentId: tournament.id,
        dayNumber: config.dayNumber,
        date: new Date(`2026-04-${11 + config.dayNumber}`),
        ballkidCount: config.ballkidCount,
      },
    });

    if ((await prisma.court.count({ where: { tournamentDayId: day.id } })) === 0) {
      await prisma.court.createMany({
        data: [
          { tournamentDayId: day.id, name: 'Court Central', teamCount: 2, order: 1 },
          { tournamentDayId: day.id, name: 'Court Annexe 1', teamCount: 2, order: 2 },
        ],
      });
    }
  }
  console.log('✅ Jours de tournoi et terrains créés');

  // 13 équipes fictives
  for (let i = 1; i <= 13; i++) {
    await prisma.team.upsert({
      where: { tournamentId_name: { tournamentId: tournament.id, name: `Équipe ${i}` } },
      update: { order: i },
      create: { tournamentId: tournament.id, name: `Équipe ${i}`, order: i },
    });
  }
  console.log('✅ 13 équipes créées');

  console.log('');
  console.log('🎉 Seed de démonstration terminé !');
  console.log('🔑 Identifiants démo : demo@demo.com / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
