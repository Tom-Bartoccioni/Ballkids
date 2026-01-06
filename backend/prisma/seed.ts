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

async function main() {
  console.log('🌱 Seeding database...');

  // Créer un admin par défaut
  const hashedPassword = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@ballkids.com' },
    update: {},
    create: {
      email: 'admin@ballkids.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'Principal',
      role: UserRole.ADMIN,
    },
  });

  console.log('✅ Admin créé:', admin.email);

  // Créer un tournoi par défaut
  const tournament = await prisma.tournament.upsert({
    where: { id: 'tournament-2025' },
    update: {},
    create: {
      id: 'tournament-2025',
      name: 'Tournoi 2025',
      year: 2025,
      startDate: new Date('2026-04-12'),
      endDate: new Date('2026-04-20'),
      isActive: true,
    },
  });

  console.log('✅ Tournoi créé:', tournament.name);

  // Créer un coach de démo
  const coachPassword = await bcrypt.hash('coach123', 10);
  const coachUser = await prisma.user.upsert({
    where: { email: 'coach@ballkids.com' },
    update: {},
    create: {
      email: 'coach@ballkids.com',
      password: coachPassword,
      firstName: 'Jean',
      lastName: 'Coach',
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

  console.log('✅ Coach créé:', coachUser.email);

  // Créer quelques ramasseurs de démo
  const ballkidsData = [
    { firstName: 'Lucas', lastName: 'Martin', gender: Gender.MALE, status: BallkidStatus.REGISTERED },
    { firstName: 'Emma', lastName: 'Bernard', gender: Gender.FEMALE, status: BallkidStatus.REGISTERED },
    { firstName: 'Hugo', lastName: 'Petit', gender: Gender.MALE, status: BallkidStatus.PENDING },
    { firstName: 'Léa', lastName: 'Dubois', gender: Gender.FEMALE, status: BallkidStatus.PENDING },
    { firstName: 'Nathan', lastName: 'Moreau', gender: Gender.MALE, status: BallkidStatus.SELECTED },
  ];

  for (const data of ballkidsData) {
    const email = `${data.firstName.toLowerCase()}.${data.lastName.toLowerCase()}@example.com`;
    const existing = await prisma.ballkid.findFirst({ where: { email, tournamentId: tournament.id } });
    if (!existing) {
      await prisma.ballkid.create({
        data: {
          ...data,
          tournamentId: tournament.id,
          birthDate: new Date('2012-05-15'),
          email,
          club: 'Tennis Club Local',
          tshirtSize: 'M',
          shortSize: 'M',
          shoeSize: '38',
        },
      });
    }
  }

  console.log('✅ Ramasseurs de démo créés');

  // Créer les critères de sélection par défaut
  const selectionSession = await prisma.selectionSession.upsert({
    where: { tournamentId: tournament.id },
    update: {
      date: new Date('2026-03-01'),
    },
    create: {
      tournamentId: tournament.id,
      date: new Date('2026-03-01'),
    },
  });

  const defaultCriteria = [
    { name: 'Vitesse', abbreviation: 'VITESSE', order: 1, maxScore: 5, isCalculated: false },
    { name: 'Précision', abbreviation: 'PRECISION', order: 2, maxScore: 5, isCalculated: false },
    { name: 'Réflexes', abbreviation: 'REFLEXES', order: 3, maxScore: 5, isCalculated: false },
    { name: 'Concentration', abbreviation: 'CONCENTRATION', order: 4, maxScore: 5, isCalculated: false },
  ];

  const existingSelectionCriteria = await prisma.selectionCriteria.count({
    where: { selectionSessionId: selectionSession.id },
  });

  if (existingSelectionCriteria === 0) {
    for (const criteria of defaultCriteria) {
      await prisma.selectionCriteria.create({
        data: {
          ...criteria,
          selectionSessionId: selectionSession.id,
        },
      });
    }
    console.log('✅ Critères de sélection créés');
  } else {
    console.log('ℹ️ Critères de sélection déjà présents');
  }

  // Créer les 4 séances de formation
  for (let i = 1; i <= 4; i++) {
    await prisma.trainingSession.upsert({
      where: {
        tournamentId_sessionNumber: {
          tournamentId: tournament.id,
          sessionNumber: i,
        },
      },
      update: {
        date: new Date(`2026-03-${10 + i}`),
      },
      create: {
        tournamentId: tournament.id,
        sessionNumber: i,
        date: new Date(`2026-03-${10 + i}`),
      },
    });
  }

  console.log('✅ Séances de formation créées/actualisées');

  // Créer les critères de formation par défaut
  const trainingSessions = await prisma.trainingSession.findMany({
    where: { tournamentId: tournament.id },
  });

  for (const session of trainingSessions) {
    const existingTrainingCriteria = await prisma.trainingCriteria.count({
      where: { trainingSessionId: session.id },
    });
    if (existingTrainingCriteria === 0) {
      for (const criteria of defaultCriteria) {
        await prisma.trainingCriteria.create({
          data: {
            ...criteria,
            trainingSessionId: session.id,
          },
        });
      }
    }
  }

  console.log('✅ Critères de formation créés');

  // Créer les 9 jours de tournoi
  const dayConfigs = [
    { dayNumber: 1, ballkidCount: 78 }, // Samedi
    { dayNumber: 2, ballkidCount: 78 }, // Dimanche
    { dayNumber: 3, ballkidCount: 78 }, // Lundi
    { dayNumber: 4, ballkidCount: 78 }, // Mardi
    { dayNumber: 5, ballkidCount: 78 }, // Mercredi
    { dayNumber: 6, ballkidCount: 78 }, // Jeudi
    { dayNumber: 7, ballkidCount: 36 }, // Vendredi
    { dayNumber: 8, ballkidCount: 20 }, // Samedi final
    { dayNumber: 9, ballkidCount: 20 }, // Dimanche final
  ];

  for (const config of dayConfigs) {
    await prisma.tournamentDay.upsert({
      where: {
        tournamentId_dayNumber: {
          tournamentId: tournament.id,
          dayNumber: config.dayNumber,
        },
      },
      update: {
        date: new Date(`2026-04-${11 + config.dayNumber}`),
        ballkidCount: config.ballkidCount,
      },
      create: {
        tournamentId: tournament.id,
        dayNumber: config.dayNumber,
        date: new Date(`2026-04-${11 + config.dayNumber}`),
        ballkidCount: config.ballkidCount,
      },
    });
  }

  console.log('✅ Jours de tournoi créés/actualisés');

  // Créer les 13 équipes
  for (let i = 1; i <= 13; i++) {
    await prisma.team.upsert({
      where: {
        tournamentId_name: {
          tournamentId: tournament.id,
          name: `Équipe ${i}`,
        },
      },
      update: { order: i },
      create: {
        tournamentId: tournament.id,
        name: `Équipe ${i}`,
        order: i,
      },
    });
  }

  console.log('✅ Équipes créées/actualisées');

  console.log('');
  console.log('🎉 Seeding terminé !');
  console.log('');
  console.log('📧 Comptes de test:');
  console.log('   Admin: admin@ballkids.com / admin123');
  console.log('   Coach: coach@ballkids.com / coach123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
