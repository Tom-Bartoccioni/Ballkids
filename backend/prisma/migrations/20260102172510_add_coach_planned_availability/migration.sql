-- CreateTable
CREATE TABLE "coach_planned_availabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coach_planned_availabilities_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coaches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coach_planned_availabilities_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_planned_availabilities_coachId_tournamentId_dayNumber_key" ON "coach_planned_availabilities"("coachId", "tournamentId", "dayNumber");
