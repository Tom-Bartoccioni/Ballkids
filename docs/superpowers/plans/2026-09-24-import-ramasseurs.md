# Import ramasseurs fidèle aux fichiers de l'admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /api/ballkids/import` ingest the admin's real Excel files (`Liste_anon.xlsx`, `Tenus_anon.xlsx`) without losing data: exact birth dates, parent phones, equipment from a separate file, the veteran flag, and an honest report of any column that was ignored.

**Architecture:** All changes stay in the existing import pipeline — `src/lib/spreadsheet.ts` (cell → string) and the `/import` route in `src/routes/ballkid.routes.ts` (string → Ballkid). No schema change: `phoneFather`, `phoneMother`, `isVeteran`, `tracksuitSize` already exist in Prisma and are already displayed/editable in the frontend. The route gains a header normaliser that ignores spaces/punctuation, a small set of new aliases, a reordered validation so a "complement" file (names + sizes, no contact) updates existing rows, and an `unmappedColumns` list in the response.

**Tech Stack:** Node 24, Express 4, Prisma 5 (SQLite), SheetJS (`xlsx`) for reading, ExcelJS for test fixtures, Vitest 3 + supertest. Tests run from `backend/` with `npx vitest run <file>`; suites are sequential and use `prisma/test.db`.

**Context an engineer needs:**
- Field lookup in the route works by normalising both the file's header and a list of alias names, then comparing. Today `normalizeKey` only lowercases, strips accents and trims — so `TAILLE TSHIRT` (with space) never equals the alias `tailletshirt`. That is the "équipement impossible à importer" bug.
- The equipment file (`Tenus_anon.xlsx`, headers `NB | NOM | PRENOM | TAILLE TSHIRT | TAILLE SHORT | TAILLE SURVET | POINTURE`) has **no email and no phone**. Today the route rejects every such row with `Email ou telephone obligatoire` *before* looking up whether the person already exists. That is the second half of the same bug.
- The list file has three phone columns. The admin will relabel them; the agreed target headers are of the form *téléphone (enfant) / responsable légal 1 / responsable légal 2* (exact wording TBD — the aliases below cover père/mère/parent/légal/responsable variants). Mapping: kid → `phone`, légal/parent 1 → `phoneFather`, légal/parent 2 → `phoneMother`.
- Birth dates come out one day early for any user east of UTC: `spreadsheet.ts` builds a **local** `Date` and then formats it with `toISOString()` (UTC). Observed: Excel `2009-01-19` → app `2009-01-18`. This is test-map case **C-05**.
- The 254-row list file yields 220 records: 34 rows are genuinely empty in the sheet. Not a bug; do not "fix" the row filter.

---

## File map

| File | Responsibility | Change |
|---|---|---|
| `backend/src/lib/spreadsheet.ts` | Excel/CSV → `Record<string,string>[]` | Fix date formatting (serial + Date cell) without timezone shift |
| `backend/src/__tests__/spreadsheet.test.ts` | Unit tests of the parser | Rewrite the two date tests to assert exact days |
| `backend/src/routes/ballkid.routes.ts` | `/import` route | `normalizeHeader`, new aliases, parent phones, `isVeteran`, validation reorder, `unmappedColumns` |
| `backend/src/__tests__/ballkidImportFields.test.ts` | **New.** HTTP tests of the import mapping | One `describe` per task 2–5 |
| `frontend/src/pages/BallkidsPage.tsx` | Import UI | Toast for `unmappedColumns`, helper text listing recognised headers |

---

### Task 1: Birth dates must not shift by one day

**Files:**
- Modify: `backend/src/lib/spreadsheet.ts:36-40` and `:61-63`
- Test: `backend/src/__tests__/spreadsheet.test.ts:19-61`

- [ ] **Step 1: Replace the two date tests so they assert exact days**

In `backend/src/__tests__/spreadsheet.test.ts`, delete the local `excelDateToISO` helper (lines 19-26) and replace the whole `describe('parseSpreadsheet - conversion des dates Excel', …)` block (lines 28-61) with:

```ts
describe('parseSpreadsheet - conversion des dates Excel', () => {
  // Serial Excel 39832 = 19/01/2009 (epoch 1899-12-30). Le jour exact est
  // verifie : un decalage de fuseau horaire ferait sortir 2009-01-18.
  it('convertit un serial en date ISO exacte quand l\'en-tete est une colonne date, mais pas dans une colonne "Pointure"', async () => {
    const buf = await makeXlsx([
      ['Nom', 'Date naissance', 'Pointure'],
      ['Dupont', 39832, 42],
    ]);

    const rows = await parseSpreadsheet(buf, 'ramasseurs.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0]['Date naissance']).toBe('2009-01-19');
    // Colonne "Pointure" : nombre NON converti, juste stringifie
    expect(rows[0]['Pointure']).toBe('42');
    expect(rows[0]['Nom']).toBe('Dupont');
  });

  it('rend une cellule de type date au jour exact, quel que soit le fuseau', async () => {
    const buf = await makeXlsx([
      ['Nom', 'Date'],
      ['Martin', new Date(Date.UTC(2011, 7, 22))],
    ]);

    const rows = await parseSpreadsheet(buf, 'ramasseurs.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0]['Date']).toBe('2011-08-22');
  });

  it('ne perd pas le jour pour un serial avec heure (fraction)', async () => {
    const buf = await makeXlsx([
      ['Nom', 'Date naissance'],
      ['Durand', 39832.75],
    ]);

    const rows = await parseSpreadsheet(buf, 'ramasseurs.xlsx');

    expect(rows[0]['Date naissance']).toBe('2009-01-19');
  });
});
```

- [ ] **Step 2: Run the tests in a timezone east of UTC and confirm they fail**

Run (from `backend/`): `TZ=Europe/Paris npx vitest run src/__tests__/spreadsheet.test.ts`
Expected: the first and third tests FAIL with `expected '2009-01-18' to be '2009-01-19'`. (The second may pass or fail depending on how SheetJS re-reads the cell; either is fine at this step.)

- [ ] **Step 3: Rewrite the date helpers in `spreadsheet.ts`**

Replace `excelDateToISO` (lines 36-40) with two helpers:

```ts
// Un serial Excel est un nombre de JOURS depuis le 30/12/1899 : on reste en
// arithmetique UTC de bout en bout pour ne jamais subir le fuseau du serveur.
function excelSerialToISO(serial: number): string {
  const days = Math.floor(serial);
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Une cellule deja typee Date par SheetJS est construite en heure LOCALE :
// on lit donc ses composantes locales (toISOString la ferait basculer en UTC,
// soit la veille pour tout fuseau a l'est de Greenwich).
function localDateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

Then in `parseExcel`, change the two call sites:

```ts
        if (value instanceof Date) {
          record[key] = localDateToISO(value);
```

and

```ts
          if (isDateColumn && value > 1 && value < 73000) {
            record[key] = excelSerialToISO(value);
```

- [ ] **Step 4: Run the parser tests in three timezones**

Run:
```bash
TZ=Europe/Paris npx vitest run src/__tests__/spreadsheet.test.ts
TZ=Pacific/Auckland npx vitest run src/__tests__/spreadsheet.test.ts
TZ=America/Los_Angeles npx vitest run src/__tests__/spreadsheet.test.ts
```
Expected: `Tests  N passed` in all three, zero failures.

- [ ] **Step 5: Run the Excel HTTP suite to check nothing else depended on the old behaviour**

Run: `npx vitest run src/__tests__/excel.test.ts`
Expected: `4 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/spreadsheet.ts backend/src/__tests__/spreadsheet.test.ts
git commit -m "fix(import): dates de naissance exactes quel que soit le fuseau horaire

Les serials Excel etaient convertis via une epoch locale puis formates en UTC,
et les cellules Date via toISOString : un jour de moins pour tout serveur a
l'est de Greenwich (cas C-05 du cahier de recette). Serial -> arithmetique UTC,
cellule Date -> composantes locales.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Header matching ignores spaces/punctuation; equipment aliases

**Files:**
- Modify: `backend/src/routes/ballkid.routes.ts` (module scope near line 39, and the `/import` route lines 512-577)
- Create: `backend/src/__tests__/ballkidImportFields.test.ts`

- [ ] **Step 1: Create the test file with shared setup and the equipment test**

Create `backend/src/__tests__/ballkidImportFields.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';

// Tests HTTP du MAPPING des colonnes de l'import ramasseurs : on verifie que
// les fichiers reels de l'admin (Liste / Tenus) sont lus sans perte.

let app: Express;
let adminToken: string;
let tournamentId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@importfields.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@importfields.test', password: 'admin123' });
  adminToken = res.body.data.token;

  const tournament = await prisma.tournament.create({
    data: { name: 'Import Fields Test', year: 2026, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-07'), isActive: true },
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  await teardownTestDB();
});

async function makeXlsx(headers: string[], rows: any[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importFile(buf: Buffer, name = 'import.xlsx') {
  const res = await request(app)
    .post('/api/ballkids/import')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', buf, name)
    .field('tournamentId', tournamentId);
  expect(res.status).toBe(200);
  return res.body.data as {
    imported: number; updated: number; skipped: number; errors: number;
    errorDetails: { record: any; error: string }[];
    unmappedColumns?: string[];
  };
}

describe('Import ramasseurs - equipement (en-tetes avec espaces, fichier Tenus)', () => {
  it('lit TAILLE TSHIRT / TAILLE SHORT / TAILLE SURVET / POINTURE et garde les tailles numeriques', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TAILLE TSHIRT', 'TAILLE SHORT', 'TAILLE SURVET', 'POINTURE'],
      [
        ['Tenue', 'Alpha', 'alpha@tenue.test', 'S', 'XS', 'M', 42],
        ['Tenue', 'Beta', 'beta@tenue.test', 14, 12, 14, 38],
      ]
    );

    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    expect(data.imported).toBe(2);

    const alpha = await prisma.ballkid.findFirst({ where: { email: 'alpha@tenue.test' } });
    expect(alpha).toMatchObject({ tshirtSize: 'S', shortSize: 'XS', tracksuitSize: 'M', shoeSize: '42' });

    const beta = await prisma.ballkid.findFirst({ where: { email: 'beta@tenue.test' } });
    expect(beta).toMatchObject({ tshirtSize: '14', shortSize: '12', tracksuitSize: '14', shoeSize: '38' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails on the sizes**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts`
Expected: FAIL — `tshirtSize` is `null` (headers with spaces are not recognised).

- [ ] **Step 3: Check that `normalizeKey` has no other callers you would disturb**

Run: `grep -n "normalizeKey" src/routes/ballkid.routes.ts`
Expected output — exactly these three lines (definition + two uses inside `/import`):
```
39:const normalizeKey = (value: string) =>
513:            normalizedRecord[normalizeKey(key)] = value as string;
518:              const normalizedKey = normalizeKey(key);
```
If there are more, stop and read them before continuing: this task adds a *new* helper rather than editing `normalizeKey`, precisely so that other callers stay untouched.

- [ ] **Step 4: Add `normalizeHeader` at module scope**

In `backend/src/routes/ballkid.routes.ts`, directly after the `normalizeKey` definition (after line 45), add:

```ts
// Cle d'EN-TETE pour l'import : comme normalizeKey, puis suppression de tout ce
// qui n'est pas lettre/chiffre. Ainsi « TAILLE T-SHIRT », « Taille Tshirt » et
// « tailletshirt » designent la meme colonne. Appliquee a l'identique aux
// en-tetes du fichier ET aux alias, pour garantir la symetrie.
const normalizeHeader = (value: string) => normalizeKey(value).replace(/[^a-z0-9]+/g, '');
```

- [ ] **Step 5: Use `normalizeHeader` in the import and extend the equipment aliases**

Inside the `/import` route, replace the record-normalisation and the two lookup helpers (current lines 512-537, from `const normalizedRecord` down to the end of `getFieldPartial`) with:

```ts
          const normalizedRecord: Record<string, string> = {};
          for (const [key, value] of Object.entries(record)) {
            const nk = normalizeHeader(key);
            if (!nk) continue; // en-tete vide ou purement decoratif : colonne inaccessible
            normalizedRecord[nk] = value as string;
          }

          // Recherche exacte : renvoie la 1re valeur non vide parmi des alias d'en-tete.
          const getField = (keys: string[]) => {
            for (const key of keys) {
              const nk = normalizeHeader(key);
              if (nk in normalizedRecord && normalizedRecord[nk] !== '') {
                return (normalizedRecord[nk] || '').toString();
              }
            }
            return '';
          };

          // Presence d'un en-tete (meme avec valeur vide) : sert a distinguer
          // « colonne absente » de « case vide » pour les booleens.
          const hasField = (keys: string[]) => keys.some((key) => normalizeHeader(key) in normalizedRecord);

          // Recherche « partielle » : 1re valeur non vide dont l'en-tete CONTIENT un des radicaux,
          // en excluant les en-tetes qui matchent `exclude`. Utile pour le telephone dont les
          // en-tetes varient (Mobile, GSM, Telephone portable, TELEPHONE 1/2/3...).
          const getFieldPartial = (substrings: string[], exclude?: RegExp) => {
            for (const [k, v] of Object.entries(normalizedRecord)) {
              if (exclude && exclude.test(k)) continue;
              if (substrings.some((s) => k.includes(s))) {
                const val = (v || '').toString().trim();
                if (val) return val;
              }
            }
            return '';
          };
```

Then replace the four equipment lines (current 574-577) with:

```ts
          const tshirtSize = getField(['Taille T-shirt', 'Taille Tshirt', 'tshirtSize', 'T-shirt', 'Tshirt']).trim();
          const shortSize = getField(['Taille Short', 'shortSize', 'Short']).trim();
          const tracksuitSize = getField(['Taille Survêtement', 'Taille Survet', 'tracksuitSize', 'Survêtement', 'Survet']).trim();
          const shoeSize = getField(['Pointure', 'shoeSize', 'Taille chaussures', 'Chaussures']).trim();
```

Note: because `normalizeHeader` is applied to aliases too, `'Taille T-shirt'` becomes `tailletshirt` and matches the file's `TAILLE TSHIRT`. Every *other* existing `getField([...])` call in the route keeps working unchanged — its aliases are normalised the same way.

- [ ] **Step 6: Run the new test and the existing import suites**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts src/__tests__/excel.test.ts src/__tests__/ballkid.test.ts`
Expected: all PASS (`1 passed` in the new file).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ballkid.routes.ts backend/src/__tests__/ballkidImportFields.test.ts
git commit -m "fix(import): reconnaitre les en-tetes avec espaces (TAILLE TSHIRT, TAILLE SURVET, POINTURE)

La correspondance d'en-tete ignorait la casse et les accents mais pas les
espaces/ponctuation : les colonnes equipement du fichier Tenus n'etaient
jamais lues. Nouveau normalizeHeader applique symetriquement au fichier et
aux alias.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Parent phones and veteran flag

**Files:**
- Modify: `backend/src/routes/ballkid.routes.ts` (`/import` route: phone block ~lines 543-551, update `data`, create `data`)
- Test: `backend/src/__tests__/ballkidImportFields.test.ts`

- [ ] **Step 1: Add the tests**

Append to `ballkidImportFields.test.ts`:

```ts
describe('Import ramasseurs - telephones enfant / responsables legaux', () => {
  it('mappe telephone -> phone, pere/legal 1 -> phoneFather, mere/legal 2 -> phoneMother', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TELEPHONE', 'TELEPHONE PERE', 'TELEPHONE MERE'],
      [['Tel', 'Un', 'un@tel.test', '0611111111', '0622222222', '0633333333']]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'un@tel.test' } });
    expect(bk).toMatchObject({ phone: '0611111111', phoneFather: '0622222222', phoneMother: '0633333333' });
  });

  it('accepte les libelles "responsable legal 1/2" et restaure le 0 initial perdu par Excel', async () => {
    const buf = await makeXlsx(
      ['Nom', 'Prénom', 'Email', 'Tél enfant', 'Tél responsable légal 1', 'Tél responsable légal 2'],
      [['Tel', 'Deux', 'deux@tel.test', 611111112, 622222222, 633333332]]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'deux@tel.test' } });
    expect(bk).toMatchObject({ phone: '0611111112', phoneFather: '0622222222', phoneMother: '0633333332' });
  });

  it('ne prend PAS le numero d\'un parent comme telephone de l\'enfant quand la colonne enfant est absente', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TELEPHONE PERE'],
      [['Tel', 'Trois', 'trois@tel.test', '0644444444']]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'trois@tel.test' } });
    expect(bk?.phone).toBeNull();
    expect(bk?.phoneFather).toBe('0644444444');
  });
});

describe('Import ramasseurs - ancien', () => {
  it('ANCIEN = A / oui / x / 1 -> isVeteran true ; vide -> false ; colonne absente -> inchange', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'ANCIEN'],
      [
        ['Anc', 'A', 'a@anc.test', 'A'],
        ['Anc', 'B', 'b@anc.test', 'oui'],
        ['Anc', 'C', 'c@anc.test', ''],
      ]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    expect((await prisma.ballkid.findFirst({ where: { email: 'a@anc.test' } }))?.isVeteran).toBe(true);
    expect((await prisma.ballkid.findFirst({ where: { email: 'b@anc.test' } }))?.isVeteran).toBe(true);
    expect((await prisma.ballkid.findFirst({ where: { email: 'c@anc.test' } }))?.isVeteran).toBe(false);

    // Re-import SANS colonne ANCIEN : le flag ne doit pas etre ecrase
    const buf2 = await makeXlsx(['NOM', 'PRENOM', 'MAIL', 'VILLE'], [['Anc', 'A', 'a@anc.test', 'Nice']]);
    const data2 = await importFile(buf2);
    expect(data2.updated).toBe(1);
    expect((await prisma.ballkid.findFirst({ where: { email: 'a@anc.test' } }))?.isVeteran).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts`
Expected: the 4 new tests FAIL (`phoneFather` null; `isVeteran` false).

- [ ] **Step 3: Add a `normalizePhone` helper at module scope**

Directly after `normalizeHeader` (added in Task 2), add:

```ts
// Nettoyage minimal d'un numero issu d'un tableur : retire les « ; » parasites,
// et remet le 0 initial perdu quand Excel a stocke le numero comme un nombre
// (ex: 651904945 -> 0651904945). Les espaces internes sont conserves.
const normalizePhone = (raw: string) => {
  const p = (raw || '').toString().replace(/;/g, '').trim();
  return /^\d{9}$/.test(p) ? '0' + p : p;
};

// En-tetes de telephone designant un PARENT / responsable legal, a exclure de
// la recherche partielle du telephone de l'enfant.
const PARENT_HEADER = /(pere|mere|parent|legal|responsable|tuteur)/;
```

- [ ] **Step 4: Replace the phone block in the route**

Replace the current phone resolution (from `// Telephone : d'abord les en-tetes connus…` through the `if (/^\d{9}$/.test(phone)) { phone = '0' + phone; }` block, ~lines 543-551) with:

```ts
          // Telephones. Responsables d'abord (alias exacts), puis l'enfant : alias exacts,
          // sinon match partiel en EXCLUANT les en-tetes de parents pour ne jamais
          // attribuer le numero d'un parent a l'enfant.
          const phoneFather = normalizePhone(getField([
            'Téléphone père', 'Tel père', 'Portable père', 'Père',
            'Téléphone parent 1', 'Tel parent 1', 'Parent 1',
            'Téléphone responsable légal 1', 'Tel responsable légal 1', 'Responsable légal 1',
            'Téléphone légal 1', 'Tel légal 1', 'Légal 1', 'Responsable 1', 'Tel responsable 1',
            'phoneFather',
          ]));
          const phoneMother = normalizePhone(getField([
            'Téléphone mère', 'Tel mère', 'Portable mère', 'Mère',
            'Téléphone parent 2', 'Tel parent 2', 'Parent 2',
            'Téléphone responsable légal 2', 'Tel responsable légal 2', 'Responsable légal 2',
            'Téléphone légal 2', 'Tel légal 2', 'Légal 2', 'Responsable 2', 'Tel responsable 2',
            'phoneMother',
          ]));
          let phone = normalizePhone(getField([
            'Téléphone', 'Téléphone enfant', 'Tel enfant', 'Portable enfant', 'Téléphone ramasseur',
            'phone', 'Téléphone 1', 'Tel', 'Portable', 'Mobile',
          ]));
          if (!phone) {
            phone = normalizePhone(getFieldPartial(['tel', 'phone', 'mobile', 'gsm', 'portable'], PARENT_HEADER));
          }

          // Ancien (a deja participe). On ne touche au flag que si la colonne existe.
          const ancienPresent = hasField(['Ancien', 'Ancienne', 'Vétéran', 'Veteran', 'Déjà participé']);
          const ancienRaw = getField(['Ancien', 'Ancienne', 'Vétéran', 'Veteran', 'Déjà participé']).trim().toLowerCase();
          const isVeteran = ['a', 'oui', 'o', 'x', '1', 'true', 'vrai', 'yes', 'ancien'].includes(ancienRaw);
```

Note that `'Téléphone 3'` is **deliberately no longer** an alias for the kid's phone: in the admin's current file it is one of three unlabeled numbers and nothing guarantees it is the child's. Once the admin relabels the columns, the aliases above pick the right one; until then the number lands in `phone` only if it is the sole phone column (via the partial match).

- [ ] **Step 5: Write the new fields in both the update and the create branches**

In the `prisma.ballkid.update({ … data: { … } })` block add, after `phone: phone || undefined,`:

```ts
                phoneFather: phoneFather || undefined,
                phoneMother: phoneMother || undefined,
                isVeteran: ancienPresent ? isVeteran : undefined,
```

In the `prisma.ballkid.create({ … data: { … } })` block add, after `phone: phone || null,`:

```ts
              phoneFather: phoneFather || null,
              phoneMother: phoneMother || null,
              isVeteran,
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts src/__tests__/excel.test.ts src/__tests__/ballkid.test.ts`
Expected: all PASS (`5 passed` in the new file).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ballkid.routes.ts backend/src/__tests__/ballkidImportFields.test.ts
git commit -m "feat(import): telephones des responsables legaux et statut ancien

phoneFather / phoneMother / isVeteran existaient en base et dans les
formulaires mais l'import ne les lisait jamais. Le telephone de l'enfant ne
peut plus etre confondu avec celui d'un parent (exclusion des en-tetes
pere/mere/parent/legal/responsable dans la recherche partielle).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: A complement file (names + sizes, no contact) updates existing rows

**Files:**
- Modify: `backend/src/routes/ballkid.routes.ts` (`/import` route: existing-maps construction ~lines 486-491, validation + lookup order ~lines 553-583)
- Test: `backend/src/__tests__/ballkidImportFields.test.ts`

- [ ] **Step 1: Add the test**

Append to `ballkidImportFields.test.ts`:

```ts
describe('Import ramasseurs - fichier complement (Tenus) sans email ni telephone', () => {
  it('met a jour les ramasseurs existants par nom/prenom (accents et casse ignores) et refuse les inconnus', async () => {
    await prisma.ballkid.create({
      data: { firstName: 'Guilhem', lastName: 'Bérard', email: '', gender: 'MALE', status: 'REGISTERED',
        birthDate: new Date('2011-03-02'), tournamentId },
    });
    await prisma.ballkid.create({
      data: { firstName: 'Monica', lastName: "D'Ancona", email: '', gender: 'FEMALE', status: 'REGISTERED',
        birthDate: new Date('2011-03-02'), tournamentId },
    });

    const buf = await makeXlsx(
      ['NB', 'NOM', 'PRENOM', 'TAILLE TSHIRT', 'TAILLE SHORT', 'TAILLE SURVET', 'POINTURE'],
      [
        [1, 'BERARD', 'GUILHEM', 'M', 'M', 'L', 43],
        [2, 'D ANCONA', 'MONICA', 12, 12, 14, 37],
        [3, 'INCONNU', 'PERSONNE', 'S', 'S', 'S', 40],
      ]
    );
    const data = await importFile(buf, 'tenus.xlsx');

    expect(data.updated).toBe(2);
    expect(data.imported).toBe(0);
    expect(data.errors).toBe(1);
    expect(data.errorDetails[0].error).toMatch(/Email ou telephone obligatoire/);

    const g = await prisma.ballkid.findFirst({ where: { firstName: 'Guilhem' } });
    expect(g).toMatchObject({ tshirtSize: 'M', shortSize: 'M', tracksuitSize: 'L', shoeSize: '43' });
    const m = await prisma.ballkid.findFirst({ where: { firstName: 'Monica' } });
    expect(m).toMatchObject({ tshirtSize: '12', shoeSize: '37' });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts`
Expected: FAIL — `updated` is `0` and `errors` is `3` (every row rejected for missing contact).

- [ ] **Step 3: Build the name index with `normalizeName` (accent/case/punctuation-insensitive)**

`normalizeName` already exists at module scope (line 51) and is used by the photo import. Replace the map construction (the `for (const b of existingBallkids)` loop, ~lines 488-491) with:

```ts
      for (const b of existingBallkids) {
        if (b.email) emailToId.set(b.email.toLowerCase(), b.id);
        nameToId.set(`${normalizeName(b.firstName)}|${normalizeName(b.lastName)}`, b.id);
      }
```

- [ ] **Step 4: Look up the existing row BEFORE requiring a contact**

Replace the block from `// Validation: nom et prenom obligatoires` down to and including the line `const nameKey = …` (~lines 553-564) with:

```ts
          // Validation: nom et prenom obligatoires
          if (!firstName || !lastName) {
            errors.push({ record, error: 'Nom et prenom obligatoires' });
            continue;
          }

          const nameKey = `${normalizeName(firstName)}|${normalizeName(lastName)}`;
          const existingId = (email && emailToId.get(email.toLowerCase())) || nameToId.get(nameKey);

          // Un contact (email ou telephone) n'est exige que pour CREER une fiche.
          // Un fichier complement (ex: tailles de tenue) ne porte que nom + prenom :
          // il doit pouvoir mettre a jour une fiche existante.
          if (!existingId && !email && !phone) {
            errors.push({ record, error: 'Email ou telephone obligatoire' });
            continue;
          }
```

Then delete the now-duplicate line further down:

```ts
          const existingId = (email && emailToId.get(email.toLowerCase())) || nameToId.get(nameKey);
```

(it sat just above `if (existingId) {`). Also add `email: email || undefined,` as the first entry of the update `data` so a complement file that *does* carry an email fills it in.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts src/__tests__/excel.test.ts src/__tests__/ballkid.test.ts src/__tests__/ballkidImport.test.ts`
Expected: all PASS (`6 passed` in the new file).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/ballkid.routes.ts backend/src/__tests__/ballkidImportFields.test.ts
git commit -m "feat(import): un fichier complement (nom + tailles) met a jour les fiches existantes

Le contact (email/telephone) n'etait exige qu'a la creation dans l'intention,
mais la validation precedait la recherche de la fiche : le fichier Tenus de
l'admin (sans email ni telephone) etait rejete ligne par ligne. La cle
nom|prenom passe par normalizeName (accents, casse, ponctuation).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Report ignored columns

**Files:**
- Modify: `backend/src/routes/ballkid.routes.ts` (`/import` route: lookups + response)
- Modify: `frontend/src/pages/BallkidsPage.tsx` (import `onSuccess`, and the import control's helper text)
- Test: `backend/src/__tests__/ballkidImportFields.test.ts`

- [ ] **Step 1: Add the test**

Append to `ballkidImportFields.test.ts`:

```ts
describe('Import ramasseurs - colonnes non reconnues', () => {
  it('liste les en-tetes que personne n\'a consommes, sans les colonnes mappees ni les en-tetes vides', async () => {
    const buf = await makeXlsx(
      ['N°', 'NOM', 'PRENOM', 'MAIL', '2024', 'COULEUR PREFEREE', ' ', 'POINTURE'],
      [[7, 'Colonne', 'Test', 'col@test.test', 190, 'bleu', 'x', 41]]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    expect(data.unmappedColumns).toEqual(expect.arrayContaining(['N°', '2024', 'COULEUR PREFEREE']));
    expect(data.unmappedColumns).not.toEqual(expect.arrayContaining(['NOM', 'PRENOM', 'MAIL', 'POINTURE']));
    expect(data.unmappedColumns).not.toContain(' ');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts`
Expected: FAIL — `unmappedColumns` is `undefined`.

- [ ] **Step 3: Track consumed headers in the route**

Just before `const created: any[] = [];` (~line 493) add:

```ts
      // En-tetes (normalises) effectivement lus par un getField/getFieldPartial :
      // ce qui reste a la fin est signale a l'utilisateur comme ignore.
      const usedHeaders = new Set<string>();
```

In `getField` (Task 2 version), record the hit: change the inner `if` body to

```ts
              if (nk in normalizedRecord && normalizedRecord[nk] !== '') {
                usedHeaders.add(nk);
                return (normalizedRecord[nk] || '').toString();
              }
```

and also mark *present-but-empty* aliases as consumed so an empty cell doesn't flag its column as unknown — add before the `for` loop in `getField`:

```ts
            for (const key of keys) { const nk = normalizeHeader(key); if (nk in normalizedRecord) usedHeaders.add(nk); }
```

In `getFieldPartial`, add `usedHeaders.add(k);` immediately before `return val;`.

Then, after the `for (const record of records)` loop and before `res.json(`, add:

```ts
      const unmappedColumns = Object.keys(records[0] ?? {})
        .filter((h) => normalizeHeader(h) && !usedHeaders.has(normalizeHeader(h)));
```

and add `unmappedColumns,` to the response `data` object.

- [ ] **Step 4: Run the backend tests**

Run: `npx vitest run src/__tests__/ballkidImportFields.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Surface it in the frontend**

In `frontend/src/pages/BallkidsPage.tsx`, inside the import mutation's `onSuccess` (the block starting `const parts = [\`${data.imported} importe(s)\`]`), add after the existing `if (data.skipped > 0 && …)` toast:

```tsx
      if (data.unmappedColumns?.length > 0) {
        toast({
          title: `${data.unmappedColumns.length} colonne(s) non reconnue(s), ignoree(s)`,
          description: data.unmappedColumns.join(', '),
        })
      }
```

Then find the ramasseurs import file input: run `grep -n "importMutation.mutate" frontend/src/pages/BallkidsPage.tsx` — the `<input type="file" …>` whose `onChange` calls it is the target. Immediately after that `<input …/>` add:

```tsx
                <p className="text-xs text-gray-400">
                  Colonnes reconnues : Nom, Prenom, Email, Date de naissance, Sexe, Club, Telephone,
                  Telephone responsable legal 1 / 2 (ou pere / mere), Adresse, CP, Ville, Licence, Ancien,
                  Taille T-shirt, Taille Short, Taille Survetement, Pointure. Casse, accents et espaces ignores.
                  Un fichier ne contenant que Nom + Prenom + tailles met a jour les fiches existantes.
                </p>
```

- [ ] **Step 6: Type-check the frontend**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ballkid.routes.ts backend/src/__tests__/ballkidImportFields.test.ts frontend/src/pages/BallkidsPage.tsx
git commit -m "feat(import): signaler les colonnes ignorees et documenter les en-tetes reconnus

Les colonnes inconnues etaient silencieusement perdues, ce qui rendait les
problemes de mapping invisibles pour l'admin.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end check against the admin's real files

**Files:** none modified. Uses `Liste_anon.xlsx` and `Tenus_anon.xlsx` at the repo root (untracked, do **not** commit them).

- [ ] **Step 1: Full backend suite in a non-UTC timezone**

Run (from `backend/`): `TZ=Europe/Paris npx vitest run`
Expected: `Test Files  15 passed`, `Tests  186 passed` (179 existing + 7 new), 0 failed.

- [ ] **Step 2: Import the list file through the running API into the inactive test tournament**

Start the stack (`./start.sh dev`, or `npm run dev` in both `backend/` and `frontend/`). Then:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@ballkids.com","password":"admin123"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.token")
curl -s -X POST http://localhost:3001/api/ballkids/import -H "Authorization: Bearer $TOKEN" \
  -F "file=@Liste_anon.xlsx" -F "tournamentId=tournament-2026-btest" \
  | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')).data,null,1)"
```

Expected: `imported: 220`, `errors: 0`, and `unmappedColumns` containing `"N°"`, `"2022"`, `"2023"`, `"2024"`, `"2025"`, `"    00"`, `"TELEPHONE 3"` (the two unlabeled phone columns and the historic-score years — exactly the columns the admin must relabel or that a later plan will consume). Birth date check:

```bash
curl -s "http://localhost:3001/api/ballkids?tournamentId=tournament-2026-btest&search=NOM01" -H "Authorization: Bearer $TOKEN" \
  | node -pe "const b=JSON.parse(require('fs').readFileSync(0,'utf8')).data.ballkids[0]; b.lastName+' '+b.birthDate"
```

Expected: `NOM01 2009-01-19T00:00:00.000Z` (the sheet says 19/01/2009; before this plan the app stored the 18th).

- [ ] **Step 3: Import the equipment file on top**

```bash
curl -s -X POST http://localhost:3001/api/ballkids/import -H "Authorization: Bearer $TOKEN" \
  -F "file=@Tenus_anon.xlsx" -F "tournamentId=tournament-2026-btest" \
  | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).data; 'updated='+d.updated+' imported='+d.imported+' errors='+d.errors+' unmapped='+JSON.stringify(d.unmappedColumns)"
```

Expected: `updated` ≥ 100 (every anonymised `NOMxx` row matches a list row), `imported=0`, `errors` = number of rows whose names exist only in the Tenus file (the non-anonymised block: AUDIC, DUPONT, …) — each with `Email ou telephone obligatoire`, `unmapped=["NB"]`. Spot-check: `NOM01` now has `tshirtSize 'S'`, `shoeSize '42'`.

- [ ] **Step 4: Clean the test tournament so the dev DB stays usable for the recette**

```bash
cd backend && npx tsx prisma/clean-dev-tournaments.ts
```

Expected: the script reports the `tournament-2026-btest` ballkids removed (or delete them with Prisma Studio if the script keeps that tournament). Nothing to commit.

---

## Self-review

**Spec coverage**
- Dates exact (C-05) → Task 1 ✔
- Équipement importable from `Tenus` (headers with spaces) → Task 2 ✔ ; (no contact in file) → Task 4 ✔
- Téléphones père/mère → Task 3 ✔ (aliases cover père/mère, parent 1/2, responsable légal 1/2 — the final wording from the admin can be appended to the alias arrays without other change)
- Ancien flag from column F → Task 3 ✔
- Admin can see what was dropped → Task 5 ✔
- Not in scope, deliberately: selection site (column R, Cannes/Monaco — user parked point 4), historic year scores (feed the ANCIEN bonus — belongs to the selection plan), positional mapping of the two unlabeled phone columns (admin will relabel).

**Placeholder scan** — every code step contains the code; every run step has an expected outcome. The only "find the line" instruction (Task 5 step 5) is backed by a grep with a stated expected form.

**Type consistency** — `normalizeHeader`, `normalizePhone`, `PARENT_HEADER`, `hasField`, `usedHeaders`, `unmappedColumns` are each defined before first use and spelled identically across tasks. `getFieldPartial(substrings, exclude?)` signature introduced in Task 2 is the one called in Task 3.
