#!/bin/sh
set -e

# Migrate old DB from container to volume (one-time migration)
if [ -f /app/prisma/dev.db ] && [ ! -f /app/data/prod.db ]; then
  echo "Migrating existing database to persistent volume..."
  cp /app/prisma/dev.db /app/data/prod.db
  echo "Database migrated to /app/data/prod.db"
fi

# Run prisma migrations
npx prisma migrate deploy

# Seed database if no users exist (first run)
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const count = await prisma.user.count();
  if (count === 0) {
    console.log('No users found, seeding accounts...');
    const hash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { email: 'admin@ballkids.com', password: hash, firstName: 'Admin', lastName: 'Principal', role: 'ADMIN' }
    });
    console.log('Admin created: admin@ballkids.com / admin123');
    const coachHash = await bcrypt.hash('coach123', 10);
    const coachUser = await prisma.user.create({
      data: { email: 'coach@ballkids.com', password: coachHash, firstName: 'Coach', lastName: 'Principal', role: 'COACH' }
    });
    console.log('Coach created: coach@ballkids.com / coach123');
    const testAdminHash = await bcrypt.hash('testadmin123', 10);
    await prisma.user.create({
      data: { email: 'testadmin@ballkids.com', password: testAdminHash, firstName: 'TestAdmin', lastName: 'Test', role: 'ADMIN' }
    });
    console.log('Test Admin created: testadmin@ballkids.com / testadmin123');
    const testCoachHash = await bcrypt.hash('testcoach123', 10);
    await prisma.user.create({
      data: { email: 'testcoach@ballkids.com', password: testCoachHash, firstName: 'TestCoach', lastName: 'Test', role: 'COACH' }
    });
    console.log('Test Coach created: testcoach@ballkids.com / testcoach123');
    await prisma.tournament.create({
      data: {
        name: 'Monaco Master 2026',
        year: 2026,
        startDate: new Date('2026-05-24'),
        endDate: new Date('2026-06-07'),
        isActive: true,
      }
    });
    console.log('Tournament created: Roland Garros 2026');
  }
  // Ensure an active tournament always exists
  const tournament = await prisma.tournament.findFirst({ where: { isActive: true } });
  if (!tournament) {
    await prisma.tournament.create({
      data: {
        name: 'Monaco Master 2026',
        year: 2026,
        startDate: new Date('2026-05-24'),
        endDate: new Date('2026-06-07'),
        isActive: true,
      }
    });
    console.log('Tournament created: Roland Garros 2026');
  }
  await prisma.\$disconnect();
})();
"

exec "$@"
