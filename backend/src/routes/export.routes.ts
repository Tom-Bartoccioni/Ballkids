import { Router } from 'express';
import PDFDocument from 'pdfkit';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/export/ballkids/csv - Export CSV des ramasseurs
router.get('/ballkids/csv', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId, status } = req.query;

    const where: any = {};
    if (tournamentId) where.tournamentId = tournamentId;
    if (status) where.status = status;

    const ballkids = await prisma.ballkid.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const headers = [
      'Nom', 'Prénom', 'Date naissance', 'Sexe', 'Email', 'Téléphone',
      'Adresse', 'Code postal', 'Ville', 'Club', 'Licence',
      'Taille T-shirt', 'Taille Short', 'Taille Survêtement', 'Pointure', 'Statut'
    ];

    const rows = ballkids.map((b) => [
      b.lastName,
      b.firstName,
      b.birthDate.toISOString().split('T')[0],
      b.gender,
      b.email,
      b.phone || '',
      b.address || '',
      b.postalCode || '',
      b.city || '',
      b.club || '',
      b.licenseNumber || '',
      b.tshirtSize || '',
      b.shortSize || '',
      b.tracksuitSize || '',
      b.shoeSize || '',
      b.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(';'))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=ramasseurs.csv');
    res.send('\uFEFF' + csv); // BOM pour Excel
  } catch (error) {
    next(error);
  }
});

// GET /api/export/teams/csv - Export CSV des équipes
router.get('/teams/csv', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId } = req.query;

    if (!tournamentId) {
      throw new AppError('tournamentId requis', 400);
    }

    const teams = await prisma.team.findMany({
      where: { tournamentId: tournamentId as string },
      orderBy: { order: 'asc' },
      include: {
        assignments: {
          where: { tournamentDayId: null },
          include: { ballkid: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    const headers = ['Équipe', 'Position', 'Nom', 'Prénom', 'Remplaçant'];
    const rows: string[][] = [];

    teams.forEach((team) => {
      team.assignments.forEach((a) => {
        rows.push([
          team.name,
          a.position?.toString() || '',
          a.ballkid.lastName,
          a.ballkid.firstName,
          a.isReserve ? 'Oui' : 'Non',
        ]);
      });
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(';'))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=equipes.csv');
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/export/schedule/csv - Export CSV planning d'un jour
router.get('/schedule/csv', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId, dayNumber } = req.query;

    if (!tournamentId || !dayNumber) {
      throw new AppError('tournamentId et dayNumber requis', 400);
    }

    const day = await prisma.tournamentDay.findUnique({
      where: {
        tournamentId_dayNumber: {
          tournamentId: tournamentId as string,
          dayNumber: parseInt(dayNumber as string),
        },
      },
      include: {
        courts: {
          orderBy: { order: 'asc' },
          include: {
            coachAssignments: {
              include: { coach: { include: { user: true } } },
            },
            courtTeams: {
              include: { team: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!day) {
      throw new AppError('Jour non trouvé', 404);
    }

    const headers: string[] = [];
    const rows: string[][] = [];

    const buildSlots = () => {
      const slots: { start: string; end: string }[] = [];
      const startMinutes = 11 * 60;
      const endMinutes = 20 * 60;
      for (let t = startMinutes; t < endMinutes; t += 30) {
        const startH = String(Math.floor(t / 60)).padStart(2, '0');
        const startM = String(t % 60).padStart(2, '0');
        const end = t + 30;
        const endH = String(Math.floor(end / 60)).padStart(2, '0');
        const endM = String(end % 60).padStart(2, '0');
        slots.push({ start: `${startH}:${startM}`, end: `${endH}:${endM}` });
      }
      return slots;
    };

    const slots = buildSlots();

    const formatTeamNumber = (name: string, fallbackId: string) => {
      const match = name.match(/\d+/);
      return match ? match[0] : fallbackId;
    };

    day.courts.forEach((court) => {
      const coaches = court.coachAssignments.map((ca) => {
        const user = ca.coach.user;
        return user ? `${user.firstName} ${user.lastName}` : '';
      }).filter(Boolean);
      const coachNames = coaches.length > 0 ? coaches.join(', ') : 'Non assigné';
      
      const teams = court.courtTeams.map((ct) => ({
        id: ct.teamId,
        name: ct.team?.name || `Équipe ${ct.teamId}`,
      }));

      rows.push([`Terrain`, court.name]);
      rows.push([`Coach`, coachNames]);
      rows.push([]);

      rows.push(['Heure', 'Terrain', 'Attente', 'Repos', 'Coach']);

      // Split time slots between coaches
      const coachCount = coaches.length || 1;
      const slotsPerCoach = Math.ceil(slots.length / coachCount);

      slots.forEach((slot, index) => {
        const row = [slot.start];
        if (teams.length === 0) {
          row.push('', '', '');
        } else {
          const activeTeamIndex = index % teams.length;
          const waitingTeamIndex = teams.length > 1 ? (index + 1) % teams.length : -1;
          const activeTeam = teams[activeTeamIndex];
          const waitingTeam = waitingTeamIndex >= 0 ? teams[waitingTeamIndex] : null;
          
          // Build resting teams in order of when they finished (most recent first in queue)
          // The team that just finished terrain goes to the end of the rest queue
          const restingTeams: typeof teams = [];
          if (teams.length > 2) {
            // Start from the team after waiting (index + 2) and go around
            // This gives us teams in the order they finished their turn
            for (let i = 2; i < teams.length; i++) {
              const restIndex = (index + i) % teams.length;
              restingTeams.push(teams[restIndex]);
            }
          }

          row.push(formatTeamNumber(activeTeam.name, activeTeam.id));
          row.push(waitingTeam ? formatTeamNumber(waitingTeam.name, waitingTeam.id) : '');
          row.push(
            restingTeams
              .map((team) => formatTeamNumber(team.name, team.id))
              .join(', ')
          );
        }
        
        // Determine which coach is assigned to this time slot
        const coachIndex = Math.floor(index / slotsPerCoach);
        const currentCoach = coaches[Math.min(coachIndex, coaches.length - 1)] || '';
        row.push(currentCoach);
        
        rows.push(row);
      });

      rows.push([]);
    });

    headers.push(...(rows.shift() || []));

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(';'))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=planning-jour-${dayNumber}.csv`);
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/export/coaches/csv - Export CSV planning coachs
router.get('/coaches/csv', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId } = req.query;

    if (!tournamentId) {
      throw new AppError('tournamentId requis', 400);
    }

    const days = await prisma.tournamentDay.findMany({
      where: { tournamentId: tournamentId as string },
      orderBy: { dayNumber: 'asc' },
    });

    const coaches = await prisma.coach.findMany({
      where: { tournamentId: tournamentId as string },
      include: {
        user: true,
        assignments: {
          include: { tournamentDay: true, court: true },
        },
      },
    });

    const headers = ['Coach', ...days.map((d) => `Jour ${d.dayNumber}`)];
    const rows = coaches.map((coach) => {
      const row = [`${coach.user.firstName} ${coach.user.lastName}`];
      days.forEach((day) => {
        const assignment = coach.assignments.find(
          (a) => a.tournamentDay.dayNumber === day.dayNumber
        );
        row.push(assignment ? assignment.court.name : 'Repos');
      });
      return row;
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(';'))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=planning-coachs.csv');
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/export/teams/pdf - Export PDF des équipes
router.get('/teams/pdf', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId } = req.query;

    if (!tournamentId) {
      throw new AppError('tournamentId requis', 400);
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId as string },
    });

    const teams = await prisma.team.findMany({
      where: { tournamentId: tournamentId as string },
      orderBy: { order: 'asc' },
      include: {
        assignments: {
          where: { tournamentDayId: null, isReserve: false },
          include: { ballkid: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=equipes.pdf');
    doc.pipe(res);

    // Titre
    doc.fontSize(20).text(`Équipes - ${tournament?.name || 'Tournoi'}`, { align: 'center' });
    doc.moveDown();

    // Équipes
    teams.forEach((team, index) => {
      if (index > 0 && index % 4 === 0) {
        doc.addPage();
      }

      doc.fontSize(14).fillColor('#2563eb').text(team.name);
      doc.fontSize(10).fillColor('#000');

      team.assignments.forEach((a, i) => {
        doc.text(`  ${i + 1}. ${a.ballkid.lastName} ${a.ballkid.firstName}`);
      });

      doc.moveDown(0.5);
    });

    doc.end();
  } catch (error) {
    next(error);
  }
});

// GET /api/export/schedule/pdf - Export PDF planning journalier
router.get('/schedule/pdf', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId, dayNumber } = req.query;

    if (!tournamentId || !dayNumber) {
      throw new AppError('tournamentId et dayNumber requis', 400);
    }

    const day = await prisma.tournamentDay.findUnique({
      where: {
        tournamentId_dayNumber: {
          tournamentId: tournamentId as string,
          dayNumber: parseInt(dayNumber as string),
        },
      },
      include: {
        tournament: true,
        courts: {
          orderBy: { order: 'asc' },
          include: {
            coachAssignments: {
              include: { coach: { include: { user: true } } },
            },
            courtTeams: {
              include: { team: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!day) {
      throw new AppError('Jour non trouvé', 404);
    }

    const doc = new PDFDocument({ margin: 20, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=planning-jour-${dayNumber}.pdf`);
    doc.pipe(res);

    const drawHeader = (courtName: string) => {
      const headerY = doc.page.margins.top;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const dateLabel = day.date.toLocaleDateString('fr-FR');
      const spacer = '             ';
      const headerLine = `Planning Jour ${dayNumber}${spacer}${dateLabel}${spacer}${courtName}`;

      doc.fillColor('#111');
      doc.fontSize(18);
      const headerHeight = doc.heightOfString(headerLine, { width: pageWidth });
      doc.text(headerLine, doc.page.margins.left, headerY, { width: pageWidth, align: 'center' });
      doc.y = headerY + headerHeight + 6;
    };

    const formatTeamNumber = (name: string, fallbackId: string) => {
      const match = name.match(/\d+/);
      return match ? match[0] : fallbackId;
    };

    // Terrains
    day.courts.forEach((court, courtIndex) => {
      if (courtIndex > 0) {
        doc.addPage();
      }
      
      // Get coaches for this court
      const coaches = court.coachAssignments.map((ca) => {
        const user = ca.coach.user;
        return `${user.firstName} ${user.lastName}`;
      });
      
      drawHeader(court.name);
      const teams = court.courtTeams.map((ct) => ({
        id: ct.teamId,
        name: ct.team?.name || `Équipe ${ct.teamId}`,
      }));

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const timeColWidth = Math.max(50, Math.floor(pageWidth * 0.08));
      const coachColWidth = Math.max(80, Math.floor(pageWidth * 0.18));
      const statusColWidth = Math.floor((pageWidth - timeColWidth - coachColWidth) / 3);

      const slots: { start: string; end: string }[] = [];
      for (let t = 11 * 60; t < 20 * 60; t += 30) {
        const startH = String(Math.floor(t / 60)).padStart(2, '0');
        const startM = String(t % 60).padStart(2, '0');
        const end = t + 30;
        const endH = String(Math.floor(end / 60)).padStart(2, '0');
        const endM = String(end % 60).padStart(2, '0');
        slots.push({ start: `${startH}:${startM}`, end: `${endH}:${endM}` });
      }

      // Split time slots between coaches
      const coachCount = coaches.length || 1;
      const slotsPerCoach = Math.ceil(slots.length / coachCount);

      const availableHeight =
        doc.page.height - doc.page.margins.bottom - doc.y;
      const totalRows = slots.length + 1;
      const rowHeight = Math.max(14, Math.floor(availableHeight / totalRows));
      const headerFontSize = Math.max(11, Math.min(16, Math.floor(rowHeight * 0.7)));
      const cellFontSize = Math.max(10, Math.min(15, Math.floor(rowHeight * 0.6)));

      const drawRow = (y: number, cells: string[], header = false) => {
        let x = doc.page.margins.left;
        doc.fontSize(header ? headerFontSize : cellFontSize).fillColor(
          header ? '#111' : '#333'
        );
        doc.text(cells[0], x, y, { width: timeColWidth });
        x += timeColWidth;
        for (let i = 1; i <= 3; i++) {
          doc.text(cells[i] || '', x, y, { width: statusColWidth, align: 'center' });
          x += statusColWidth;
        }
        // Coach column
        doc.text(cells[4] || '', x, y, { width: coachColWidth, align: 'center' });
      };

      let currentY = doc.y;

      const headerCells = ['Heure', 'Terrain', 'Attente', 'Repos', 'Coach'];
      drawRow(currentY, headerCells, true);
      currentY += rowHeight;

      slots.forEach((slot, index) => {
        if (currentY > doc.page.height - doc.page.margins.bottom - rowHeight) {
          doc.addPage();
          drawHeader(court.name);
          currentY = doc.y;
          drawRow(currentY, headerCells, true);
          currentY += rowHeight;
        }

        const cells = [slot.start];
        if (teams.length === 0) {
          cells.push('', '', '', '');
          drawRow(currentY, cells);
          currentY += rowHeight;
          return;
        }
        const activeTeamIndex = index % teams.length;
        const waitingTeamIndex = teams.length > 1 ? (index + 1) % teams.length : -1;
        const activeTeam = teams[activeTeamIndex];
        const waitingTeam = waitingTeamIndex >= 0 ? teams[waitingTeamIndex] : null;
        
        // Build resting teams in order of when they finished
        const restingTeams: typeof teams = [];
        if (teams.length > 2) {
          for (let i = 2; i < teams.length; i++) {
            const restIndex = (index + i) % teams.length;
            restingTeams.push(teams[restIndex]);
          }
        }

        cells.push(formatTeamNumber(activeTeam.name, activeTeam.id));
        cells.push(waitingTeam ? formatTeamNumber(waitingTeam.name, waitingTeam.id) : '');
        cells.push(
          restingTeams
            .map((team) => formatTeamNumber(team.name, team.id))
            .join(', ')
        );
        
        // Determine which coach is assigned to this time slot
        const coachIndex = Math.floor(index / slotsPerCoach);
        const currentCoach = coaches[Math.min(coachIndex, coaches.length - 1)] || '';
        cells.push(currentCoach);
        
        drawRow(currentY, cells);
        currentY += rowHeight;
      });

      doc.moveDown(1);
    });

    doc.end();
  } catch (error) {
    next(error);
  }
});

export default router;
