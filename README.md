# Ballkids Manager – Cahier des charges

Application web destinée à la **gestion complète des ramasseurs de balles** pour un tournoi :
collecte des données, sélection, formations, constitution des équipes, planning du tournoi,
gestion des coachs et exports.

---

## 📌 Objectifs

- Centraliser les informations des ramasseurs
- Gérer les phases de sélection et de formation
- Constituer et ajuster les équipes
- Organiser le planning du tournoi sur 9 jours
- Respecter les contraintes des coachs
- Fournir des exports clairs pour l’organisation

---

## 🧒 1. Gestion des ramasseurs

### 1.1 Collecte et import
- Import automatique depuis **Google Form** ou **CSV**
- Création automatique des fiches ramasseurs

### 1.2 Données enregistrées

**Informations personnelles**
- Nom
- Prénom
- Âge
- Sexe
- Club
- Email
- Téléphone
- Adresse
- Code postal
- Ville
- Numéro de licence

**Équipement**
- Taille T-shirt
- Taille short
- Taille survêtement
- Pointure

### 1.3 Affichage et gestion
- Tableau complet avec recherche et filtres
- Fiche détaillée par ramasseur
- Gestion des absences pour les plannings :
  - sélection
  - formations
  - tournoi (9 jours)

---

## 🏁 2. Sélection initiale

### 2.1 Notation par les coachs
Formulaire de notation comprenant les critères suivants (abréviations à préciser) :

- ANCIEN  
- JOUR  
- POUB AVEC R  
- POUB SANS R  
- TOTAL POUB  
- ROULE 1/2  
- ROULE  
- VITESSE  
- REBOND  
- TOTAL ROULE  
- VITESSE  
- TOTAL VITESSE  
- POUB  
- BOITES  
- BOITES  
- VITESSE  
- TOTAL PARCOURS  
- TOTAL  

### 2.2 Calcul automatique
- Calcul des moyennes (ou équivalent selon règles définies)
- Classement global

### 2.3 Résultat final
- Sélection de **80 ramasseurs** parmi environ **200 inscrits**

---

## 🏋️ 3. Séances de formation (4 séances)

### 3.1 Présences
- Chaque ramasseur peut être présent ou absent
- Saisie des présences par l’**admin**
- Accès en lecture seule pour les coachs

### 3.2 Notation
- Formulaire coach pour noter les 80 ramasseurs sélectionnés
- Critères similaires à la sélection (à préciser)
- Calcul automatique :
  - note par séance
  - moyenne globale sur les 4 séances

### 3.3 Synthèse des résultats
- Tableau global :
  - Séance 1
  - Séance 2
  - Séance 3
  - Séance 4
  - Moyenne
- Base de travail pour la constitution des équipes

---

## 👥 4. Création des équipes

### 4.1 Constitution initiale
- **13 équipes de 6 ramasseurs** (78)
- **2 remplaçants**
- Répartition semi-automatique basée sur les notes

### 4.2 Préremplissage et flexibilité
- Les équipes sont **préremplies automatiquement** d’un jour à l’autre
- L’admin peut :
  - interchanger librement les ramasseurs
  - gérer les remplaçants
  - ajuster en cas d’absence

---

## 🗓️ 5. Planning du tournoi (9 jours)

### 5.1 Configuration quotidienne
Pour chaque jour :
- nombre de terrains
- nom de chaque terrain
- nombre d’équipes de ramasseurs par terrain
- coach(s) associé(s)

### 5.2 Affectation des équipes
- Samedi → jeudi : **78 ramasseurs**
- Vendredi : **36 ramasseurs**
- Samedi + dimanche final : **20 ramasseurs**
- Modification manuelle possible à tout moment

### 5.3 Gestion des absences
- Remplacement des ramasseurs absents
- Mise à jour automatique des équipes du jour

---

## 🧑‍🏫 6. Gestion des coachs

### 6.1 Contraintes
- Un coach ne peut pas travailler plus de **6 jours consécutifs**

### 6.2 Planning coach
- Affectation coach ↔ terrain ↔ journée
- Alerte en cas de dépassement
- Tableau clair jours travaillés / repos

---

## 🔐 7. Rôles et permissions

### 7.1 Admin (Responsable)
Accès total :
- ramasseurs
- sélections
- formations
- équipes
- plannings
- notes
- remplacements
- exports
- configurations

### 7.2 Coach
Peut :
- noter les ramasseurs
- consulter plannings
- consulter équipes
- consulter fiches ramasseurs

Ne peut pas :
- modifier équipes
- modifier présences
- modifier l’organisation

### 7.3 Ramasseurs
- Aucun accès à la plateforme

---

## 📤 8. Exports

### CSV
- ramasseurs
- équipes
- planning du jour
- planning coachs

### PDF
- planning journalier
- composition des équipes
- planning coachs

---

## 🖥️ 9. Interface

- Application **web desktop**
- Navigation par modules :
  - Ramasseurs
  - Sélection
  - Formations
  - Équipes
  - Tournoi
  - Coachs
  - Réglages

---

## 🛠️ 10. Stack Technique

### Backend
- **Node.js** + **Express** + **TypeScript**
- **Prisma ORM** avec PostgreSQL
- **JWT** pour l'authentification

### Frontend
- **React 18** + **TypeScript** + **Vite**
- **TanStack Query** pour le data fetching
- **Tailwind CSS** + composants shadcn/ui

### Base de données
- **PostgreSQL** (Docker)

---

## 🚀 11. Installation

### Prérequis
- Node.js 18+
- Docker et Docker Compose

### Démarrage rapide

```bash
# 1. Cloner et accéder au projet
git clone <repo-url>
cd ramasseurs

# 2. Configuration complète (première fois)
./start.sh setup

# 3. Lancer l'application
./start.sh dev
```

### Commandes disponibles

| Commande | Description |
|----------|-------------|
| `./start.sh setup` | Configuration initiale complète |
| `./start.sh dev` | Démarrer en mode développement |
| `./start.sh db` | Démarrer uniquement PostgreSQL |
| `./start.sh stop` | Arrêter tous les services |
| `./start.sh reset` | Réinitialiser la base de données |

### URLs

- **Frontend** : http://localhost:5173
- **Backend API** : http://localhost:3001
- **Prisma Studio** : `cd backend && npx prisma studio`

### Comptes par défaut

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Admin | admin@ballkids.com | admin123 |
| Coach | coach@ballkids.com | coach123 |

---

## 📁 12. Structure du Projet

```
ramasseurs/
├── docker-compose.yml          # Configuration PostgreSQL
├── README.md                   # Ce fichier
├── start.sh                    # Script de démarrage
│
├── backend/
│   ├── package.json
│   ├── .env                    # Variables d'environnement
│   ├── prisma/
│   │   ├── schema.prisma       # Schéma de la BDD
│   │   └── seed.ts             # Données initiales
│   └── src/
│       ├── index.ts            # Point d'entrée Express
│       ├── middleware/         # Auth, error handling
│       └── routes/             # Endpoints API
│
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── contexts/           # AuthContext
        ├── components/         # Layout, UI
        └── pages/              # Toutes les pages
```

---

## 🔌 13. API Endpoints

### Authentification
- `POST /api/auth/login` - Connexion
- `GET /api/auth/me` - Utilisateur courant
- `PUT /api/auth/password` - Changer mot de passe

### Ramasseurs
- `GET /api/ballkids` - Liste avec filtres
- `POST /api/ballkids/import` - Import CSV
- `PUT /api/ballkids/:id/approve` - Approuver

### Sélection
- `GET /api/selection/criteria` - Critères
- `POST /api/selection/scores` - Enregistrer scores
- `GET /api/selection/ranking` - Classement
- `POST /api/selection/auto-select` - Sélection auto

### Formation
- `GET /api/training/sessions` - Sessions
- `POST /api/training/scores` - Enregistrer scores
- `GET /api/training/summary` - Récapitulatif

### Équipes
- `GET /api/teams` - Liste
- `POST /api/teams/generate` - Générer équipes

### Planning
- `GET /api/schedule/days` - Jours du tournoi
- `POST /api/schedule/assign` - Assigner équipe

### Coachs
- `GET /api/coaches/planning` - Planning
- `GET /api/coaches/alerts` - Alertes 6 jours

### Export
- `GET /api/export/ballkids/csv` - Export CSV
- `GET /api/export/teams/pdf` - Export PDF

---
