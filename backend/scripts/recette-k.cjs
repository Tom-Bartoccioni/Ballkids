/*
 * Recette automatisee de la section K du cahier de recette (+ B, C, I partiels),
 * contre l'API locale (http://localhost:3001) avec les fichiers *_anon.xlsx a la
 * racine du depot. Cree un tournoi « Recette K … », l'active le temps du test,
 * puis reactive le tournoi precedent. Le tournoi de recette est conserve (inactif)
 * pour consultation dans l'interface.
 *
 *   cd backend && node scripts/recette-k.cjs
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const API = 'http://localhost:3001/api';
const ROOT = path.resolve(__dirname, '..', '..');
const results = [];
const ok = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); console.log(`${id.padEnd(8)} ${cond ? 'PASS' : 'FAIL'}  ${detail}`); };

let admin, coach, prevActive;
const h = (t, extra = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };
const get = (p, t = admin) => fetch(API + p, { headers: h(t) }).then(j);
const send = (m, p, body, t = admin) => fetch(API + p, { method: m, headers: h(t, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
const sendJ = async (m, p, body, t) => j(await send(m, p, body, t));
const upload = async (p, buf, name, fields = {}, t = admin) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return j(await fetch(API + p, { method: 'POST', headers: h(t), body: fd }));
};

async function login(email, password) {
  const r = await sendJ('POST', '/auth/login', { email, password });
  return r.data?.token;
}

async function xlsxWithHeaders(src, renames, extra = null) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const ws = wb.worksheets[0];
  const row = ws.getRow(1);
  for (const [col, name] of Object.entries(renames)) row.getCell(col).value = name;
  row.commit();
  if (extra) extra(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function xlsxFrom(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function readXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const rows = [];
  wb.worksheets[0].eachRow((r) => rows.push(r.values.slice(1).map((v) => (v == null ? '' : String(v)))));
  return rows;
}

async function findKid(tid, lastName, firstName) {
  const r = await get(`/ballkids?tournamentId=${tid}&search=${encodeURIComponent(lastName)}&limit=200`);
  return (r.data?.ballkids || []).find((b) => b.lastName === lastName && (!firstName || b.firstName === firstName));
}

(async () => {
  admin = await login('admin@ballkids.com', 'admin123');
  coach = await login('coach@ballkids.com', 'coach123');
  if (!admin || !coach) throw new Error('login impossible');
  prevActive = (await get('/tournaments/active')).data?.tournament?.id || (await get('/tournaments/active')).data?.id;

  // ---------- tournoi de recette ----------
  const created = await sendJ('POST', '/tournaments', { name: `Recette K ${Date.now()}`, year: 2031, startDate: '2031-04-12', endDate: '2031-04-20' });
  const tid = created.data?.tournament?.id;
  if (!tid) throw new Error('creation tournoi: ' + JSON.stringify(created));
  await sendJ('PUT', `/tournaments/${tid}/activate`, {});

  // ---------- K-01 / K-02 ----------
  const liste = fs.readFileSync(path.join(ROOT, 'Liste_anon.xlsx'));
  const k1 = (await upload('/ballkids/import', liste, 'Liste_anon.xlsx', { tournamentId: tid })).data;
  ok('K-01', k1 && k1.errors === 0 && k1.imported + k1.updated === 220 && ['N°', '2022', '2025'].every((c) => k1.unmappedColumns.includes(c)),
    `imported=${k1?.imported} updated=${k1?.updated} errors=${k1?.errors} unmapped=${JSON.stringify(k1?.unmappedColumns)}`);
  const nom01 = await findKid(tid, 'NOM01');
  ok('K-02', nom01?.birthDate?.startsWith('2009-01-19'), `NOM01 birthDate=${nom01?.birthDate}`);

  // ---------- K-03 : TEL / TEL 1 / TEL 2 ----------
  const listeTel = await xlsxWithHeaders(path.join(ROOT, 'Liste_anon.xlsx'), { I: 'TEL', J: 'TEL 1', K: 'TEL 2' });
  const k3 = (await upload('/ballkids/import', listeTel, 'liste_tel.xlsx', { tournamentId: tid })).data;
  const n3 = await findKid(tid, 'NOM01');
  ok('K-03', k3?.errors === 0 && n3?.phone === '0639980001' && n3?.phoneFather === '0739980001' && n3?.phoneMother === '0839980001' && !k3.unmappedColumns.some((c) => /^TEL/.test(c)),
    `phone=${n3?.phone} legal1=${n3?.phoneFather} legal2=${n3?.phoneMother} unmapped=${JSON.stringify(k3?.unmappedColumns)}`);

  // ---------- K-04 : ANCIEN ----------
  const listeAncien = await xlsxWithHeaders(path.join(ROOT, 'Liste_anon.xlsx'), { I: 'TEL', J: 'TEL 1', K: 'TEL 2', F: 'ANCIEN' });
  const k4 = (await upload('/ballkids/import', listeAncien, 'liste_ancien.xlsx', { tournamentId: tid })).data;
  const all = (await get(`/ballkids?tournamentId=${tid}&limit=500`)).data.ballkids;
  const vets = all.filter((b) => b.isVeteran).length;
  const n4 = all.find((b) => b.lastName === 'NOM01');
  ok('K-04', k4?.errors === 0 && n4?.isVeteran === true && vets > 0 && vets < all.length, `NOM01 ancien=${n4?.isVeteran} ; anciens=${vets}/${all.length}`);

  // ---------- K-05 : Tenus ----------
  const tenus = fs.readFileSync(path.join(ROOT, 'Tenus_anon.xlsx'));
  const k5 = (await upload('/ballkids/import', tenus, 'Tenus_anon.xlsx', { tournamentId: tid })).data;
  const n5 = await findKid(tid, 'NOM01');
  ok('K-05', k5?.imported === 0 && k5?.updated >= 100 && k5?.errors === 3 && n5?.tshirtSize === 'S' && n5?.shoeSize === '42' && k5.unmappedColumns.join() === 'NB',
    `updated=${k5?.updated} imported=${k5?.imported} errors=${k5?.errors} NOM01=${n5?.tshirtSize}/${n5?.shortSize}/${n5?.tracksuitSize}/${n5?.shoeSize} unmapped=${JSON.stringify(k5?.unmappedColumns)}`);

  // ---------- K-06 : email familial partage ----------
  const sk = (await get(`/ballkids?tournamentId=${tid}&search=skaudic&limit=50`)).data.ballkids;
  ok('K-06', sk.length === 2 && new Set(sk.map((b) => b.firstName)).size === 2, `fiches avec skaudic@… : ${sk.length} (${sk.map((b) => b.lastName + ' ' + b.firstName).join(', ')})`);

  // ---------- K-07 : homonymes ----------
  const homo = await xlsxFrom(['NOM', 'PRENOM', 'MAIL', 'AGE'], [['DUPONT', 'Louise', 'l1@h.test', '2011-01-01'], ['DUPONT', 'Louise', 'l2@h.test', '2012-06-06']]);
  const k7a = (await upload('/ballkids/import', homo, 'homo.xlsx', { tournamentId: tid })).data;
  const homo2 = await xlsxFrom(['NOM', 'PRENOM', 'VILLE'], [['DUPONT', 'Louise', 'Menton']]);
  const k7b = (await upload('/ballkids/import', homo2, 'homo2.xlsx', { tournamentId: tid })).data;
  ok('K-07', k7a?.imported === 2 && k7b?.errors === 1 && /ambigu/i.test(k7b.errorDetails[0].error), `1er import: ${k7a?.imported} crees ; 2e: ${k7b?.errorDetails?.[0]?.error}`);

  // Les imports creent des fiches « en attente » : on les accepte (page En attente / action groupee)
  const pend = (await get(`/ballkids/pending?tournamentId=${tid}`)).data.ballkids;
  const acc = await sendJ('POST', '/ballkids/bulk/status', { ids: pend.map((b) => b.id), status: 'REGISTERED' });
  ok('D-08*', pend.length >= 200 && acc.success, `${pend.length} en attente acceptes en masse -> ${acc.success ? 'OK' : JSON.stringify(acc).slice(0, 120)}`);

  // ---------- K-10 : grille par defaut sur tournoi neuf ----------
  const sess = (await get(`/selection/${tid}`)).data.session;
  const crit = sess?.criteria || [];
  const byName = Object.fromEntries(crit.map((c) => [c.name, c]));
  ok('K-10', crit.length === 13 && byName['Poubelle sans rebond']?.weight === 3 && byName['Ancien (bonus)']?.maxScore === 40, `${crit.length} criteres ; POUB SANS R x${byName['Poubelle sans rebond']?.weight} ; ANCIEN max ${byName['Ancien (bonus)']?.maxScore}`);

  // ---------- K-09 : PUT criteria (grille) accepte sans plafond 20 ----------
  const k9 = await sendJ('PUT', `/selection/${tid}/criteria`, { criteria: crit.map((c) => ({ name: c.name, maxScore: c.maxScore, weight: c.weight })) });
  ok('K-09', k9.success && k9.data.criteria.length === 13 && k9.data.criteria.find((c) => /^Ancien/.test(c.name))?.maxScore === 40, `PUT criteria -> ${k9.data?.criteria?.length} criteres, Ancien max ${k9.data?.criteria?.find((c) => /^Ancien/.test(c.name))?.maxScore}`);
  const crit2 = k9.data.criteria;

  // ---------- K-11 : 20 partout + 40 + 9 = 489 ----------
  const scores = {};
  for (const c of crit2) scores[c.id] = /^Ancien/.test(c.name) ? 40 : /^Jour/.test(c.name) ? 9 : 20;
  const k11 = await sendJ('POST', `/selection/${tid}/score`, { ballkidId: nom01.id, scores });
  // 11 criteres notes 20 x somme des coefficients (23) + ANCIEN 40 + JOUR 9 = 509
  ok('K-11', k11.data?.selectionScore?.totalScore === 509, `total=${k11.data?.selectionScore?.totalScore} (attendu 509)`);

  // ---------- K-12 : coef 5 sur POUB SANS R -> 529 ----------
  const k12c = await sendJ('PUT', `/selection/${tid}/criteria`, { criteria: crit2.map((c) => ({ name: c.name, maxScore: c.maxScore, weight: c.name === 'Poubelle sans rebond' ? 5 : c.weight })) });
  const crit3 = k12c.data.criteria;
  const scores3 = {};
  for (const c of crit3) scores3[c.id] = /^Ancien/.test(c.name) ? 40 : /^Jour/.test(c.name) ? 9 : 20;
  const k12 = await sendJ('POST', `/selection/${tid}/score`, { ballkidId: nom01.id, scores: scores3 });
  ok('K-12', k12.data?.selectionScore?.totalScore === 549, `total=${k12.data?.selectionScore?.totalScore} (attendu 549)`);

  // ---------- K-13 : import Selection_anon (totaux bruts) ----------
  const selx = fs.readFileSync(path.join(ROOT, 'Selection_anon.xlsx'));
  const k13 = (await upload(`/selection/${tid}/import-csv`, selx, 'Selection_anon.xlsx')).data;
  const rank = (await get(`/selection/${tid}/ranking`)).data;
  const rlist = rank.ranking || [];
  const avgs = rlist.map((r) => r.averageScore).filter((x) => typeof x === 'number');
  const reasons = {}; for (const e of (k13?.errorDetails || [])) reasons[e.error] = (reasons[e.error] || 0) + 1;
  const mx = Math.max(...avgs), mn = Math.min(...avgs);
  ok('K-13', k13?.imported >= 78 && mx > 20 && avgs.filter((a) => a >= 85 && a <= 210).length >= 70,
    `imported=${k13?.imported} errors=${k13?.errors} ${JSON.stringify(reasons)} ; classement min=${mn} max=${mx} ; ${avgs.filter((a) => a >= 85 && a <= 210).length} totaux entre 85 et 210`);

  // ---------- K-14 : PUT 185 / -1 ----------
  const sc = (await get(`/selection/${tid}/score/${nom01.id}`)).data;
  const scoreId = sc?.scores?.[0]?.id || sc?.selectionScore?.id || sc?.score?.id;
  const p185 = await send('PUT', `/selection/score/${scoreId}`, { score: 185 });
  const pm1 = await send('PUT', `/selection/score/${scoreId}`, { score: -1 });
  ok('K-14', p185.status === 200 && pm1.status === 400, `185 -> ${p185.status} ; -1 -> ${pm1.status} (scoreId=${scoreId ? 'ok' : 'introuvable'})`);

  // ---------- K-15 : 78 + 4 ----------
  const k15 = await sendJ('POST', `/selection/${tid}/select`, { count: 78, reserveCount: 4 });
  const after = (await get(`/ballkids?tournamentId=${tid}&limit=500`)).data.ballkids;
  const nSel = after.filter((b) => b.status === 'SELECTED').length, nRes = after.filter((b) => b.status === 'RESERVE').length;
  ok('K-15', k15.data?.selected === 78 && k15.data?.reserves === 4 && nSel === 78 && nRes === 4, `reponse ${k15.data?.selected}+${k15.data?.reserves} ; en base SELECTED=${nSel} RESERVE=${nRes}`);

  // ---------- K-17/18/19 : export formation ----------
  const selKid = after.find((b) => b.status === 'SELECTED') || after[0];
  await sendJ('POST', `/training/${tid}/1/score-simple`, { ballkidId: selKid.id, score: 14 });
  await sendJ('POST', `/training/${tid}/2/absence`, { ballkidId: selKid.id });
  const rx = await fetch(`${API}/export/training/xlsx?tournamentId=${tid}`, { headers: h(admin) });
  const rows = await readXlsx(Buffer.from(await rx.arrayBuffer()));
  const line = rows.find((r) => r[0] === selKid.lastName && r[1] === selKid.firstName);
  ok('K-17', rx.status === 200 && rows[0][0] === 'Nom' && rows[0][7] === 'Séances' && line && line[2] === '14' && line[3] === 'ABS' && line[6] === '14' && line[7] === '1',
    `HTTP ${rx.status} ; ligne=${JSON.stringify(line)}`);
  const rc = await fetch(`${API}/export/training/csv?tournamentId=${tid}`, { headers: h(admin) });
  const csv = await rc.text();
  ok('K-18', rc.status === 200 && csv.replace(/^﻿/, '').split(/\r?\n/)[0] === '"Nom";"Prénom";"Séance 1";"Séance 2";"Séance 3";"Séance 4";"Moyenne";"Séances"' && csv.includes('"ABS"'), `HTTP ${rc.status} ; 1re ligne=${csv.split(/\r?\n/)[0].slice(0, 60)}…`);
  const rcoach = await fetch(`${API}/export/training/xlsx?tournamentId=${tid}`, { headers: h(coach) });
  ok('K-19', rcoach.status === 200, `coach -> HTTP ${rcoach.status}`);

  // ---------- K-20/21/22 : reset mot de passe ----------
  const email = `recette.${Date.now()}@coach.test`;
  const reg = await sendJ('POST', '/auth/register', { email, password: 'ancien123', firstName: 'Recette', lastName: 'Coach', role: 'COACH', tournamentId: tid });
  const uid = reg.data?.user?.id;
  const rs = await send('PUT', `/auth/users/${uid}/password`, { newPassword: 'nouveau456' });
  const oldLogin = await send('POST', '/auth/login', { email, password: 'ancien123' });
  const newLogin = await send('POST', '/auth/login', { email, password: 'nouveau456' });
  ok('K-20', rs.status === 200 && oldLogin.status === 401 && newLogin.status === 200, `reset ${rs.status} ; ancien mdp ${oldLogin.status} ; nouveau ${newLogin.status}`);
  const rshort = await send('PUT', `/auth/users/${uid}/password`, { newPassword: 'abc' });
  ok('K-21', rshort.status === 400, `mdp 3 caracteres -> ${rshort.status}`);
  const newCoachToken = (await j(newLogin)).data.token;
  const rforb = await send('PUT', `/auth/users/${uid}/password`, { newPassword: 'autre789' }, newCoachToken);
  ok('K-22', rforb.status === 403, `coach -> ${rforb.status}`);

  // ---------- K-23/24 : terrains sur la semaine ----------
  try {
  for (const [name, teamCount] of [['Central', 2], ['Court 1', 2], ['Court 2', 2]]) await sendJ('POST', `/schedule/${tid}/day/1/court`, { name, teamCount });
  const d2r = await sendJ('POST', `/schedule/${tid}/day/2/court`, { name: 'Provisoire', teamCount: 1 });
  const d2c = d2r.data?.court; if (!d2c) throw new Error('POST day/2/court -> ' + JSON.stringify(d2r).slice(0, 200));
  const cl = (await get(`/coaches/${tid}`)).data; const coaches = Array.isArray(cl) ? cl : (cl.coaches || []);
  const coachProfile = coaches.find((c) => c.user?.email === email) || coaches[0];
  if (!coachProfile) throw new Error('aucun coach sur le tournoi: ' + JSON.stringify(cl).slice(0, 150));
  await sendJ('PUT', `/schedule/court/${d2c.id}/coach`, { coachIds: [coachProfile.id] });
  const k23 = await sendJ('POST', `/schedule/${tid}/day/1/courts/apply-to-all`, {});
  const days = (await get(`/schedule/${tid}`)).data.days || (await get(`/schedule/${tid}`)).data.schedule?.days || [];
  const day2 = (await get(`/schedule/${tid}/day/2`)).data.day;
  const day9 = (await get(`/schedule/${tid}/day/9`)).data.day;
  const d2first = day2.courts.find((c) => c.order === 1);
  ok('K-23', k23.data?.created === 3 * 8 - 1 && k23.data?.updated === 1 && day9.courts.length === 3 && day9.courts.map((c) => c.name).join() === 'Central,Court 1,Court 2' && d2first?.id === d2c.id && d2first?.name === 'Central' && (d2first.coachAssignments || []).length === 1,
    `reponse ${JSON.stringify(k23.data)} ; jour 9: ${day9.courts.map((c) => c.name).join(', ')} ; jour 2 rang 1: ${d2first?.name} (meme id=${d2first?.id === d2c.id}, coachs=${(d2first?.coachAssignments || []).length})`);
  const k24 = await sendJ('POST', `/schedule/${tid}/day/1/courts/apply-to-all`, {});
  const day5 = (await get(`/schedule/${tid}/day/5`)).data.day;
  ok('K-24', k24.data?.created === 0 && k24.data?.updated === 0 && day5.courts.length === 3, `reponse ${JSON.stringify(k24.data)} ; jour 5 = ${day5.courts.length} terrains`);
  } catch (e) { ok('K-23/24', false, 'exception: ' + (e && e.message)); }

  // ---------- B / C / I (API) ----------
  const noTid = (await get('/ballkids?limit=500')).data.ballkids;
  const inTid = (await get(`/ballkids?tournamentId=${tid}&limit=500`)).data.ballkids.length;
  ok('B-01/04', noTid.length === inTid && noTid.every((b) => b.tournamentId === tid), `sans tournamentId: ${noTid.length} fiches, toutes du tournoi actif=${noTid.every((b) => b.tournamentId === tid)}`);
  const c6 = (await upload('/ballkids/import', liste, 'Liste_anon.xlsx', { tournamentId: tid })).data;
  ok('C-06', c6?.imported === 0 && c6?.updated === 220 && c6?.errors === 0, `re-import: imported=${c6?.imported} updated=${c6?.updated} errors=${c6?.errors}`);
  const ec = await fetch(`${API}/export/ballkids/csv?tournamentId=${tid}`, { headers: h(admin) });
  const ex = await fetch(`${API}/export/ballkids/xlsx?tournamentId=${tid}`, { headers: h(admin) });
  ok('C-08/09', ec.status === 200 && ex.status === 200 && (ex.headers.get('content-type') || '').includes('spreadsheetml'), `csv ${ec.status} ; xlsx ${ex.status}`);
  const i1 = await send('POST', '/auth/login', { email: 'admin@ballkids.com', password: 'faux' });
  const i4 = await fetch(`${API}/ballkids/pending`, { headers: h(coach) });
  ok('I-01/04', i1.status === 401 && i4.status === 403, `mauvais mdp ${i1.status} ; coach sur /ballkids/pending ${i4.status}`);

  // ---------- restaurer le tournoi actif ----------
  if (prevActive) await sendJ('PUT', `/tournaments/${prevActive}/activate`, {});
  const act = (await get('/tournaments/active')).data;
  const actId = act?.tournament?.id || act?.id;

  console.log('\nCAS      RESULTAT  DETAIL');
  for (const r of results) console.log(`${r.id.padEnd(8)} ${r.pass ? 'PASS' : 'FAIL'}      ${r.detail}`);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS — tournoi de recette ${tid} conserve (inactif), actif restaure = ${actId}`);
})().catch((e) => { console.error('ERREUR SCRIPT', e); if (prevActive) send('PUT', `/tournaments/${prevActive}/activate`, {}); });
