# Sélection : la grille de l'admin dans l'app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin score the selection in-app with the exact grid of his Excel (`Selection_anon.xlsx`: 11 leaf criteria with coefficients ×1/×2/×3, plus ANCIEN and JOUR bonuses), import raw totals from that Excel meanwhile, and pick the 78 selected + N substitutes he wants.

**Architecture:** The scoring formula already matches the sheet (`totalScore = Σ value × weight`, commit `e228974`). What blocks the admin is around it: generic default criteria, a hardcoded 0–20 ceiling in four places (criteria editor, score PUT, score-simple, import normalisation), and a hardcoded "80 / 0 reserve" auto-select. No schema change.

**Tech Stack:** as Plan 1. Backend tests in `src/__tests__/selection.test.ts` (existing helpers `newTournament`, `newSession`, `newBallkid`, `seedScore`), frontend `SelectionPage.tsx` / `SelectionScorePage.tsx`.

**Context an engineer needs:**
- Excel column W = `V+Q+O+J+G+F` where J=`H×1+I×3`, O=`L×2+K×1+M×3+N×2`, Q=`P×3`, V=`R×2+S×1+T×2+U×3`; F (ANCIEN) ∈ {5,10,20,30,40}; G (JOUR) = 9. Max observed W = 210. Leaf maxima are not recoverable from the anonymised file (values blanked) — defaults below use 20 and are editable.
- `DEFAULT_CRITERIA` in `src/lib/tournamentInit.ts` is shared by selection **and** the 4 training sessions. Training's formula normalises by `maxScore` (`training.routes.ts:258`), so training keeps the generic four; only selection gets the admin grid.
- `POST /select` today: `selectedCount = count − reserveCount`. The admin thinks "78 selected **plus** a few substitutes", so the API semantics change to `count` = selected, `reserveCount` = additional. One existing test asserts the old arithmetic (`selection.test.ts:246`).

---

### Task 1: Selection defaults = the admin's grid (backend + seed + frontend fallback)

**Files:** `backend/src/lib/tournamentInit.ts`, `backend/prisma/seed.ts:131-136`, `frontend/src/pages/SelectionPage.tsx:205-210`, test `backend/src/__tests__/tournamentClone.test.ts` (has an init test) — add an assertion.

- [ ] In `tournamentInit.ts` rename `DEFAULT_CRITERIA` → `DEFAULT_TRAINING_CRITERIA` (used in the training loop only) and add, exported:

```ts
/**
 * Grille de sélection de l'admin (reprise de son classeur Excel) : 11 critères
 * notés avec leur coefficient, + 2 bonus. Le total = Σ note × coef, comme la
 * colonne TOTAL du classeur. Les maxima par critère ne figurent pas dans le
 * classeur : 20 par défaut, modifiables dans l'éditeur de critères.
 */
export const DEFAULT_SELECTION_CRITERIA = [
  { name: 'Poubelle avec rebond',  abbreviation: 'POUB AVEC R',  order: 1,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Poubelle sans rebond',  abbreviation: 'POUB SANS R',  order: 2,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Roulé 1/2',             abbreviation: 'ROULE 1/2',    order: 3,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Roulé',                 abbreviation: 'ROULE',        order: 4,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Vitesse (roulé)',       abbreviation: 'VIT ROULE',    order: 5,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Rebond',                abbreviation: 'REBOND',       order: 6,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Vitesse',               abbreviation: 'VITESSE',      order: 7,  maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Parcours poubelle',     abbreviation: 'PARC POUB',    order: 8,  maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Parcours boîtes 1',     abbreviation: 'PARC BOITES 1',order: 9,  maxScore: 20, weight: 1, isCalculated: false },
  { name: 'Parcours boîtes 2',     abbreviation: 'PARC BOITES 2',order: 10, maxScore: 20, weight: 2, isCalculated: false },
  { name: 'Parcours vitesse',      abbreviation: 'PARC VITESSE', order: 11, maxScore: 20, weight: 3, isCalculated: false },
  { name: 'Ancien (bonus)',        abbreviation: 'ANCIEN',       order: 12, maxScore: 40, weight: 1, isCalculated: false },
  { name: 'Jour (bonus)',          abbreviation: 'JOUR',         order: 13, maxScore: 9,  weight: 1, isCalculated: false },
] as const;
```
  and use it in the selection loop. Mirror the same 13 rows in `seed.ts` (selection only; training keeps `defaultCriteria`) and in `SelectionPage.tsx` `handleOpenCriteria` fallback (as `{ name, maxScore, weight }`).
- [ ] Test (in `tournamentClone.test.ts`, existing "init" describe): after creating a tournament via `POST /api/tournaments`, `selectionCriteria.count` = 13, the one named `Poubelle sans rebond` has `weight 3`, and `trainingCriteria` for session 1 still has 4 rows. Run: `npx vitest run src/__tests__/tournamentClone.test.ts` → red, then green.
- [ ] Commit: `feat(selection): criteres par defaut = grille de l'admin (coefficients x1/x2/x3, bonus ancien/jour)`.

### Task 2: Remove the 0–20 ceiling everywhere; import raw totals

**Files:** `backend/src/routes/selection.routes.ts` (`score-simple` :146, `PUT /score/:scoreId` :511, import :331-341 & :372-375), `frontend/src/pages/SelectionPage.tsx:838` (`max="20"` on maxScore input), tests `selection.test.ts:287-345,456-476`.

- [ ] Rewrite tests: `PUT ... rejette hors 0-20` → accepts `score: 185`, rejects `-1`; `score-simple rejette hors 0-20` → rejects only negative, accepts 210; `normalise automatiquement…` → `importe les totaux bruts sans normalisation` (file `Email;Total\nmarc@norm.test;185\n` → `totalScore 185`). Run → red.
- [ ] Backend: replace the three `> 20` guards by `score < 0` only (`'La note doit être positive'`); delete the `maxScoreInFile` pre-scan and the `needsNormalization` block. Frontend: remove `max="20"` on the criteria maxScore input.
- [ ] Run `npx vitest run src/__tests__/selection.test.ts` → green. Commit: `fix(selection): plus de plafond 0-20 — totaux bruts comme le classeur de l'admin`.

### Task 3: Criteria editor speaks "coefficient" and shows the maximum total

**Files:** `frontend/src/pages/SelectionPage.tsx:816-822` (header labels) and the modal footer (:880-890).

- [ ] Header labels: `Max` → `Note max`, `Poids` → `Coef.`. Under the rows, add a line: `Total maximum : {criteriaDraft.reduce((s, c) => s + c.maxScore * c.weight, 0)}` and, per row, a muted `{Math.round(c.maxScore*c.weight / totalMax * 100)} %` so the admin sees each criterion's share ("avec pourcentage").
- [ ] `npx tsc --noEmit` → OK. Commit: `feat(selection): editeur de criteres en coefficients avec part en pourcentage`.

### Task 4: Auto-select = N selected + M substitutes, editable

**Files:** `backend/src/routes/selection.routes.ts:551-568`, `frontend/src/pages/SelectionPage.tsx:231-245,356-368,427-440`, test `selection.test.ts:246-286`.

- [ ] Test: change the existing select test to `{ count: 2, reserveCount: 1 }` and keep the same expectations (high/mid SELECTED, low RESERVE) — this encodes the new semantics. Add: `{ count: 78 }` with 3 kids → 3 SELECTED, 0 RESERVE, no error. Run → red.
- [ ] Backend: `const { count = 78, reserveCount = 0 } = req.body; const selectedCount = Math.max(0, count);` (drop the subtraction). Frontend: replace `const selectionTotal = 80` by two `useState` inputs (`selectCount` default 78, `reserveCount` default 4) rendered next to the button; the button label `Sélectionner {selectCount} + {reserveCount} remplaçants`; mutation sends both; the "80 minimum" alert uses `selectCount`.
- [ ] Green + `tsc`. Commit: `feat(selection): nombre de selectionnes et de remplacants configurables (78 + N)`.
