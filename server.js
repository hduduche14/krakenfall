const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let joueurs = {};
let etatJeu = 'LOBBY'; 
let ordreInit = []; let ordrePlacement = []; let ordreJeu = [];
let tourIndex = 0; let joueurActuel = null;
let boucanier = { position: -1, possesseur: null, prix: 0 };

const layoutCarte = [1,0,1,0,1, 0,1,0,1,0, 1,0,1,0,1, 0,1,0,1,0, 1,0,1,0,1];
let typesIles = {};
let positionVolcan = -1;

function genererNouvelleCarte() {
    let listeIles = ["Tissu", "Cacao", "Rhum", "Vente", "Vente", "Bateau", "Bateau", "Magie", "Boucanier", "Pirate", "Kraken", "Kraken Fall", "Vie"];
    listeIles.sort(() => Math.random() - 0.5);
    let indexIle = 0;
    layoutCarte.forEach((type, i) => { if(type === 1) { typesIles[i] = listeIles[indexIle]; indexIle++; } });
    let casesEau = [];
    layoutCarte.forEach((type, index) => { if(type === 0) casesEau.push(index); });
    positionVolcan = casesEau[Math.floor(Math.random() * casesEau.length)];
    boucanier = { position: -1, possesseur: null, prix: 0 };
    io.emit('initCarte', { layout: layoutCarte, typesIles: typesIles, positionVolcan: positionVolcan });
}
genererNouvelleCarte();

io.on('connection', (socket) => {
    socket.emit('initCarte', { layout: layoutCarte, typesIles: typesIles, positionVolcan: positionVolcan });
    socket.emit('majLobby', { joueurs, etatJeu });
    if (etatJeu !== 'LOBBY') socket.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });

    socket.on('nouveauJoueur', (pseudo) => {
        if (etatJeu !== 'LOBBY') return socket.emit('erreur', "Partie en cours !");
        joueurs[socket.id] = { id: socket.id, pseudo: pseudo, position: -1, estPret: false, de: 0, pv: 5, or: 5, cargaison: 0 };
        io.emit('majLobby', { joueurs, etatJeu });
    });

    socket.on('demarrerPartie', () => {
        if(etatJeu === 'LOBBY' && Object.keys(joueurs).length > 0) {
            etatJeu = 'LANCEMENT_DES';
            for(let id in joueurs) {
                joueurs[id].de = Math.floor(Math.random() * 6) + 1;
                joueurs[id].deExact = joueurs[id].de + Math.random(); 
            }
            let classement = Object.values(joueurs).sort((a, b) => b.deExact - a.deExact);
            ordreInit = classement.map(j => j.id);
            joueurActuel = ordreInit[0]; 
            io.emit('resultatsDes', classement);
            setTimeout(() => { etatJeu = 'CHOIX_PREMIER'; io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier }); }, 4000);
        }
    });

    socket.on('choixOrdre', (choix) => {
        if (etatJeu === 'CHOIX_PREMIER' && socket.id === joueurActuel) {
            if (choix === 'CHOIX_A') { ordrePlacement = [...ordreInit]; ordreJeu = [...ordreInit].reverse(); } 
            else { ordrePlacement = [...ordreInit].reverse(); ordreJeu = [...ordreInit]; }
            etatJeu = 'PLACEMENT'; tourIndex = 0; joueurActuel = ordrePlacement[tourIndex]; 
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('placerBateau', (pos) => {
        if(etatJeu === 'PLACEMENT' && socket.id === joueurActuel) {
            joueurs[socket.id].position = pos; joueurs[socket.id].estPret = true;
            tourIndex++; 
            if (tourIndex < ordrePlacement.length) joueurActuel = ordrePlacement[tourIndex];
            else { etatJeu = 'JEU'; tourIndex = 0; joueurActuel = ordreJeu[tourIndex]; }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('deplacement', (nouvellePos) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            joueurs[socket.id].position = nouvellePos;
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('attaque', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            if(joueurs[data.cible]) {
                io.to(data.cible).emit('subirDegats', data.degats); 
                let arme = data.type === 'canon' ? 'au canon' : 'avec le Boucanier';
                io.emit('logGlobal', `💥 ${joueurs[socket.id].pseudo} a tiré sur ${joueurs[data.cible].pseudo} ${arme} ! (-${data.degats} PV)`);
            }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('utiliserTornade', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            if(joueurs[data.cible]) {
                joueurs[data.cible].position = data.pos;
                io.emit('logGlobal', `🌪️ ${joueurs[socket.id].pseudo} a déplacé ${joueurs[data.cible].pseudo} avec une Tornade !`);
            }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('achatBoucanier', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            boucanier.prix += data.mise; boucanier.possesseur = socket.id;
            if(boucanier.position === -1) boucanier.position = data.pos;
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('deplacementBoucanier', (nouvellePos) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel && boucanier.possesseur === socket.id) {
            boucanier.position = nouvellePos;
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('majStats', (stats) => {
        if(joueurs[socket.id]) {
            joueurs[socket.id].pv = stats.pv; joueurs[socket.id].or = stats.or; joueurs[socket.id].cargaison = stats.cargaison;
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('finDeTour', () => {
        if (etatJeu === 'JEU' && socket.id === joueurActuel) {
            tourIndex++; if (tourIndex >= ordreJeu.length) tourIndex = 0;
            joueurActuel = ordreJeu[tourIndex]; 
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('disconnect', () => {
        let etaitActuel = (socket.id === joueurActuel);
        if(boucanier.possesseur === socket.id) boucanier.possesseur = null;
        delete joueurs[socket.id];
        if(Object.keys(joueurs).length === 0) { etatJeu = 'LOBBY'; genererNouvelleCarte(); } 
        else {
            if (etaitActuel && etatJeu === 'JEU') {
                ordreJeu = ordreJeu.filter(id => id !== socket.id);
                if (tourIndex >= ordreJeu.length) tourIndex = 0;
                if(ordreJeu.length > 0) joueurActuel = ordreJeu[tourIndex];
            }
            io.emit('majLobby', { joueurs, etatJeu });
            if (etatJeu !== 'LOBBY') io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });
});

http.listen(3000, () => { console.log('⚓ Serveur en ligne sur http://localhost:3000'); });