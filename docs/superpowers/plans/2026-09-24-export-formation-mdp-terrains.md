# Export formation, reset mot de passe, terrains sur toute la semaine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent admin asks from the September feedback: export the training synthesis, let the admin reset a coach's password, and apply one day's courts to the whole week.

**Architecture:** Each task adds one route following an existing pattern (`export.routes.ts` xlsx/csv, `auth.routes.ts` password, `schedule.routes.ts` courts) and one button on the matching page. No schema change.

**Tech Stack:** as Plan 1. New backend test files, one per task, using the `excel.test.ts` / `auth.test.ts` / `schedule.test.ts` setups.

---

### Task 1: Export de la synthèse formation

**Files:** `backend/src/routes/export.routes.ts` (new `GET /training/xlsx` and `/training/csv` — csv helper is whatever `/ballkids/csv` uses), `backend/src/routes/training.routes.ts` (extract the summary computation of `GET /:tournamentId/summary/all` into an exported `computeTrainingSummary(tournamentId)`), `frontend/src/pages/TrainingPage.tsx` (Download button in the "Synthèse des 4 séances" card header, :415), test `backend/src/__tests__/trainingExport.test.ts`.

- [ ] Test: create tournament + 2 SELECTED ballkids + training sessions 1..4; one `TrainingScore` (session 1, 14) for kid A, one `Absence` (TRAINING, session 2) for kid A. `GET /api/export/training/xlsx?tournamentId=…` → 200, content-type xlsx; read back with ExcelJS: headers `['Nom','Prénom','Séance 1','Séance 2','Séance 3','Séance 4','Moyenne','Séances']`, kid A row = `['A-last','A-first','14','ABS','','','14','1']`. Coach token → 200 as well (export is read-only). Run → red.
- [ ] Implement: `computeTrainingSummary` returns the `summary` array (unchanged shape). Export rows: session cell = `absentN ? 'ABS' : sessionN == null ? '' : String(sessionN)`, `Moyenne` = `average ?? ''`, `Séances` = `sessionsAttended`. Filename `formation.xlsx`. Button: `handleExportTraining` copies the blob pattern of `BallkidsPage.tsx:210-230`.
- [ ] Green + `tsc`. Commit: `feat(formation): export xlsx/csv de la synthese des seances`.

### Task 2: Réinitialisation du mot de passe d'un coach par l'admin

**Files:** `backend/src/routes/auth.routes.ts` (new `PUT /users/:userId/password`, `authenticate` + admin check + `blockInDemo`, body `newPassword` ≥ 6), `frontend/src/pages/CoachesPage.tsx:176-195` (a `KeyRound` button per coach → `prompt()` for the new password → mutation), test in `backend/src/__tests__/auth.test.ts`.

- [ ] Tests: admin resets coach password → 200, then login with the new password → 200 and old → 401; coach token → 403; unknown user → 404; 3-char password → 400. Run → red.
- [ ] Implement route (hash with bcrypt 10, `prisma.user.update`), never return the password. Frontend: on success toast "Mot de passe réinitialisé".
- [ ] Green + `tsc`. Commit: `feat(coachs): reinitialisation du mot de passe par l'admin`.

### Task 3: Appliquer les terrains d'un jour à toute la semaine

**Files:** `backend/src/routes/schedule.routes.ts` (new `POST /:tournamentId/day/:dayNumber/courts/apply-to-all`), `frontend/src/pages/SchedulePage.tsx:1413-1424` (button "Appliquer à tous les jours" next to "Ajouter un terrain", admin only, with `confirm`), test `backend/src/__tests__/scheduleCourts.test.ts`.

- [ ] Test: tournament with days 1..3; day 1 has courts `[Central(2), Court 1(2)]`; day 2 has one court `X(1)` with a coach assignment; day 3 empty. Call apply-to-all from day 1 → day 3 gets the 2 courts (same names/teamCount/order); day 2: its `order 1` court is renamed `Central` with teamCount 2 **and keeps its coach assignment**, `order 2` court `Court 1` is created; nothing is ever deleted; day 1 untouched; response `{ updated: 1, created: 3 }`. Coach → 403. Run → red.
- [ ] Implement: for each other day, index its courts by `order`; for each source court: update by order if present (name, teamCount) else create. Never delete — deleting would cascade coach and team assignments.
- [ ] Green + `tsc`. Commit: `feat(planning): appliquer les terrains d'un jour a toute la semaine`.
