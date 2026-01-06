-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COACH',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ballkids" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tournamentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" DATETIME NOT NULL,
    "gender" TEXT NOT NULL,
    "club" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "phoneFather" TEXT,
    "phoneMother" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "licenseNumber" TEXT,
    "photoUrl" TEXT,
    "isVeteran" BOOLEAN NOT NULL DEFAULT false,
    "tshirtSize" TEXT,
    "shortSize" TEXT,
    "tracksuitSize" TEXT,
    "shoeSize" TEXT,
    CONSTRAINT "ballkids_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ballkidId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trainingSessionId" TEXT,
    "tournamentDayId" TEXT,
    CONSTRAINT "absences_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "absences_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "training_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "absences_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "selection_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "selection_sessions_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "selection_criteria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectionSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "maxScore" REAL NOT NULL DEFAULT 10,
    "weight" REAL NOT NULL DEFAULT 1,
    "isCalculated" BOOLEAN NOT NULL DEFAULT false,
    "formula" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "selection_criteria_selectionSessionId_fkey" FOREIGN KEY ("selectionSessionId") REFERENCES "selection_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "selection_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectionSessionId" TEXT NOT NULL,
    "ballkidId" TEXT NOT NULL,
    "scorer_id" TEXT NOT NULL,
    "totalScore" REAL,
    "rank" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "selection_scores_selectionSessionId_fkey" FOREIGN KEY ("selectionSessionId") REFERENCES "selection_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "selection_scores_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "selection_scores_scorer_id_fkey" FOREIGN KEY ("scorer_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "selection_score_details" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectionScoreId" TEXT NOT NULL,
    "selectionCriteriaId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    CONSTRAINT "selection_score_details_selectionScoreId_fkey" FOREIGN KEY ("selectionScoreId") REFERENCES "selection_scores" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "selection_score_details_selectionCriteriaId_fkey" FOREIGN KEY ("selectionCriteriaId") REFERENCES "selection_criteria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "training_sessions_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "training_criteria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "maxScore" REAL NOT NULL DEFAULT 10,
    "weight" REAL NOT NULL DEFAULT 1,
    "isCalculated" BOOLEAN NOT NULL DEFAULT false,
    "formula" TEXT,
    "order" INTEGER NOT NULL,
    CONSTRAINT "training_criteria_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "training_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "training_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingSessionId" TEXT NOT NULL,
    "ballkidId" TEXT NOT NULL,
    "scorerId" TEXT NOT NULL,
    "totalScore" REAL,
    "isPresent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "training_scores_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "training_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "training_scores_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "training_scores_scorerId_fkey" FOREIGN KEY ("scorerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "training_score_details" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingScoreId" TEXT NOT NULL,
    "trainingCriteriaId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    CONSTRAINT "training_score_details_trainingScoreId_fkey" FOREIGN KEY ("trainingScoreId") REFERENCES "training_scores" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "training_score_details_trainingCriteriaId_fkey" FOREIGN KEY ("trainingCriteriaId") REFERENCES "training_criteria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tournament_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentDayId" TEXT NOT NULL,
    "ballkidId" TEXT NOT NULL,
    "scorerId" TEXT NOT NULL,
    "totalScore" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tournament_scores_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tournament_scores_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tournament_scores_scorerId_fkey" FOREIGN KEY ("scorerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "teams_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "ballkidId" TEXT NOT NULL,
    "tournamentDayId" TEXT,
    "isReserve" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "team_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_assignments_ballkidId_fkey" FOREIGN KEY ("ballkidId") REFERENCES "ballkids" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_assignments_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coaches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "coaches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coaches_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coach_availabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "tournamentDayId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coach_availabilities_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coaches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coach_availabilities_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coach_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coachId" TEXT NOT NULL,
    "tournamentDayId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coach_assignments_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coaches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coach_assignments_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coach_assignments_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "courts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tournament_days" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "ballkidCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tournament_days_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "courts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentDayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamCount" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "courts_tournamentDayId_fkey" FOREIGN KEY ("tournamentDayId") REFERENCES "tournament_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "court_teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courtId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "court_teams_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "courts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "court_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "selection_sessions_tournamentId_key" ON "selection_sessions"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "selection_scores_selectionSessionId_ballkidId_scorer_id_key" ON "selection_scores"("selectionSessionId", "ballkidId", "scorer_id");

-- CreateIndex
CREATE UNIQUE INDEX "selection_score_details_selectionScoreId_selectionCriteriaId_key" ON "selection_score_details"("selectionScoreId", "selectionCriteriaId");

-- CreateIndex
CREATE UNIQUE INDEX "training_sessions_tournamentId_sessionNumber_key" ON "training_sessions"("tournamentId", "sessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "training_scores_trainingSessionId_ballkidId_scorerId_key" ON "training_scores"("trainingSessionId", "ballkidId", "scorerId");

-- CreateIndex
CREATE UNIQUE INDEX "training_score_details_trainingScoreId_trainingCriteriaId_key" ON "training_score_details"("trainingScoreId", "trainingCriteriaId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_scores_tournamentDayId_ballkidId_scorerId_key" ON "tournament_scores"("tournamentDayId", "ballkidId", "scorerId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tournamentId_name_key" ON "teams"("tournamentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_userId_key" ON "coaches"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_availabilities_coachId_tournamentDayId_key" ON "coach_availabilities"("coachId", "tournamentDayId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_assignments_coachId_courtId_key" ON "coach_assignments"("coachId", "courtId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_days_tournamentId_dayNumber_key" ON "tournament_days"("tournamentId", "dayNumber");
