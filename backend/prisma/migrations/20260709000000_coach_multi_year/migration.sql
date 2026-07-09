-- Coach multi-annees : un utilisateur peut etre coach sur plusieurs tournois.
-- On remplace l'unicite globale sur userId par une unicite composite (userId, tournamentId).

-- DropIndex
DROP INDEX "coaches_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "coaches_userId_tournamentId_key" ON "coaches"("userId", "tournamentId");
