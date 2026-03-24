#!/bin/sh
set -e

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
    console.log('No users found, seeding admin account...');
    const hash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { email: 'admin@ballkids.com', password: hash, firstName: 'Admin', lastName: 'Principal', role: 'ADMIN' }
    });
    console.log('Admin created: admin@ballkids.com');
  } else {
    console.log('Database already seeded, skipping.');
  }
  await prisma.\$disconnect();
})();
"

exec "$@"
