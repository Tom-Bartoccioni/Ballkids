-- CreateTable
CREATE TABLE "team_captains" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "tournamentDayId" TEXT NOT NULL,
    "ballkidId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "team_captains_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_captains_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_captains_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "team_captains_teamId_tournamentDayId_key" ON "team_captains"("teamId", "tournamentDayId");
