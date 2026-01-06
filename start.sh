#!/bin/bash

# Ballkids Manager - Script de démarrage
# Usage: ./start.sh [dev|setup|reset]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════╗"
    echo "║     🎾 Ballkids Manager               ║"
    echo "╚═══════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}▶ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✖ $1${NC}"
}

# Charger nvm si disponible
load_nvm() {
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}

# Installation et configuration initiale
setup() {
    print_header
    print_step "Configuration initiale du projet (SQLite)..."
    
    load_nvm
    
    # Backend setup
    print_step "Installation des dépendances backend..."
    cd backend
    npm install
    
    print_step "Génération du client Prisma..."
    npx prisma generate
    
    print_step "Création de la base de données SQLite..."
    npx prisma db push
    
    print_step "Peuplement de la base de données..."
    npx prisma db seed
    
    # Créer le dossier uploads
    mkdir -p uploads/photos
    
    cd ..
    
    # Frontend setup
    print_step "Installation des dépendances frontend..."
    cd frontend
    npm install
    cd ..
    
    echo ""
    print_step "✅ Configuration terminée!"
    echo ""
    echo -e "Comptes par défaut:"
    echo -e "  Admin: ${GREEN}admin@ballkids.com${NC} / ${GREEN}admin123${NC}"
    echo -e "  Coach: ${GREEN}coach@ballkids.com${NC} / ${GREEN}coach123${NC}"
    echo ""
    echo -e "Pour démarrer l'application: ${YELLOW}./start.sh dev${NC}"
}

# Démarrage en mode développement
start_dev() {
    print_header
    load_nvm
    
    # Vérifier si les node_modules existent
    if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
        print_warning "Les dépendances ne sont pas installées. Lancement de la configuration..."
        setup
    fi
    
    # Vérifier si la BDD existe
    if [ ! -f "backend/prisma/dev.db" ]; then
        print_warning "Base de données non trouvée. Création..."
        cd backend
        npx prisma db push
        npx prisma db seed
        cd ..
    fi
    
    print_step "Démarrage du backend et du frontend..."
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "  Frontend: ${GREEN}http://localhost:5173${NC}"
    echo -e "  Backend:  ${GREEN}http://localhost:3001${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}Appuyez sur Ctrl+C pour arrêter${NC}"
    echo ""
    
    # Démarrer backend et frontend en parallèle
    trap 'kill 0' SIGINT
    
    (cd backend && npm run dev) &
    (cd frontend && npx vite --host) &
    
    wait
}

# Arrêter tous les services
stop_all() {
    print_step "Arrêt de tous les services..."
    pkill -f "tsx watch" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    print_step "Tous les services sont arrêtés."
}

# Reset de la base de données
reset_db() {
    print_warning "Cette action va supprimer toutes les données!"
    read -p "Êtes-vous sûr? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_step "Reset de la base de données..."
        load_nvm
        cd backend
        rm -f prisma/dev.db prisma/dev.db-journal
        npx prisma db push
        npx prisma db seed
        cd ..
        print_step "Base de données réinitialisée!"
    fi
}

# Afficher l'aide
show_help() {
    print_header
    echo "Usage: ./start.sh [commande]"
    echo ""
    echo "Commandes disponibles:"
    echo "  dev      Démarrer en mode développement (défaut)"
    echo "  setup    Configuration initiale du projet"
    echo "  stop     Arrêter tous les services"
    echo "  reset    Réinitialiser la base de données"
    echo "  help     Afficher cette aide"
    echo ""
    echo "Note: Ce projet utilise SQLite, pas besoin de Docker!"
    echo ""
}

# Main
case "${1:-dev}" in
    dev)
        start_dev
        ;;
    setup)
        setup
        ;;
    stop)
        stop_all
        ;;
    reset)
        reset_db
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Commande inconnue: $1"
        show_help
        exit 1
        ;;
esac
