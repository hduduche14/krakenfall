const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let joueurs = {};
let etatJeu = 'LOBBY'; 

let ordreInit = []; 
let ordrePlacement = [];
let ordreJeu = [];
let tourIndex = 0;
let joueurActuel = null;

let boucanier = { position: -1, possesseur: null, prix: 0 };
let stocksGlobaux = {};

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
    
    // Le serveur gère la boutique mondiale !
    stocksGlobaux = { "Tissu": 5, "Cacao": 5, "Rhum": 5, "Canon": 10, "Voile": 10, "Repa": 10, "Tornade": 5, "Eruption": 5 };

    io.emit('initCarte', { layout: layoutCarte, typesIles: typesIles, positionVolcan: positionVolcan, stocks: stocksGlobaux });
}
genererNouvelleCarte();

io.on('connection', (socket) => {
    console.log('Un navire approche... (ID: ' + socket.id + ')');

    socket.emit('initCarte', { layout: layoutCarte, typesIles: typesIles, positionVolcan: positionVolcan, stocks: stocksGlobaux });
    socket.emit('majLobby', { joueurs, etatJeu });
    if (etatJeu !== 'LOBBY') {
        socket.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
    }

    socket.on('nouveauJoueur', (pseudo) => {
        if (etatJeu !== 'LOBBY') { return socket.emit('erreur', "Une partie est déjà en cours !"); }
        
        joueurs[socket.id] = { 
            id: socket.id, pseudo: pseudo, position: -1, estPret: false, de: 0, 
            pv: 5, or: 5, 
            inventaire: { "Tissu": 0, "Cacao": 0, "Rhum": 0, "Canon": 0, "Voile": 0, "Repa": 0, "Tornade": 0, "Eruption": 0, "Perle": 0 }
        };
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

            setTimeout(() => {
                etatJeu = 'CHOIX_PREMIER';
                io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
            }, 4000);
        }
    });

    socket.on('choixOrdre', (choix) => {
        if (etatJeu === 'CHOIX_PREMIER' && socket.id === joueurActuel) {
            if (choix === 'CHOIX_A') {
                ordrePlacement = [...ordreInit]; 
                ordreJeu = [...ordreInit].reverse(); 
            } else {
                ordrePlacement = [...ordreInit].reverse(); 
                ordreJeu = [...ordreInit]; 
            }
            
            etatJeu = 'PLACEMENT';
            tourIndex = 0;
            joueurActuel = ordrePlacement[tourIndex]; 
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('placerBateau', (pos) => {
        if(etatJeu === 'PLACEMENT' && socket.id === joueurActuel) {
            joueurs[socket.id].position = pos;
            joueurs[socket.id].estPret = true;
            
            tourIndex++; 
            if (tourIndex < ordrePlacement.length) {
                joueurActuel = ordrePlacement[tourIndex];
            } else {
                etatJeu = 'JEU';
                tourIndex = 0;
                joueurActuel = ordreJeu[tourIndex]; 
            }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('deplacement', (nouvellePos) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            joueurs[socket.id].position = nouvellePos;
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    // --- ATTAQUES ET SORTS ---
    socket.on('attaque', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            let cible = joueurs[data.cible];
            
            if(cible) {
                cible.pv -= data.degats; 
                let arme = data.type === 'canon' ? 'au canon' : 'avec le Boucanier';
                io.emit('logGlobal', `💥 Le Capitaine ${joueurs[socket.id].pseudo} a tiré sur ${cible.pseudo} ${arme} ! (-${data.degats} PV)`);
                
                // Si le joueur meurt
                if (cible.pv <= 0) {
                    io.emit('logGlobal', `☠️ Le navire de ${cible.pseudo} a coulé !`);
                    
                    // Si tué au canon, on vole le loot
                    if (data.type === 'canon') {
                        let tueur = joueurs[socket.id];
                        tueur.or += cible.or;
                        if(cible.inventaire) {
                            for(let key in cible.inventaire) {
                                tueur.inventaire[key] = (tueur.inventaire[key] || 0) + cible.inventaire[key];
                            }
                        }
                        // On notifie le tueur pour qu'il mette à jour son inventaire client
                        io.to(socket.id).emit('recoitLoot', { or: cible.or, inventaire: cible.inventaire });
                        io.emit('logGlobal', `💰 ${tueur.pseudo} a récupéré l'Or et la Cargaison de ${cible.pseudo} !`);
                    }
                    
                    // On supprime la victime
                    io.to(data.cible).emit('mort');
                    cible.position = -1; 
                } else {
                    // Sinon il prend juste les dégats
                    io.to(data.cible).emit('subirDegats', data.degats); 
                }
            }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('utiliserTornade', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            if(joueurs[data.cible]) {
                joueurs[data.cible].position = data.pos;
                io.emit('logGlobal', `🌪️ Le Capitaine ${joueurs[data.cible].pseudo} a été emporté par une Tornade !`);
            }
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    // --- BOUTIQUE ET BOUCANIER ---
    socket.on('syncStocks', (nouveauxStocks) => {
        stocksGlobaux = nouveauxStocks;
        io.emit('majStocks', stocksGlobaux);
    });

    socket.on('achatBoucanier', (data) => {
        if(etatJeu === 'JEU' && socket.id === joueurActuel) {
            boucanier.prix += data.mise;
            boucanier.possesseur = socket.id;
            if(boucanier.position === -1) boucanier.position = data.pos;
            io.emit('logGlobal', `🪝 Le Capitaine ${joueurs[socket.id].pseudo} a pris le contrôle du Boucanier !`);
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
            joueurs[socket.id].pv = stats.pv;
            joueurs[socket.id].or = stats.or;
            joueurs[socket.id].inventaire = stats.inventaire; // Stocké pour le pillage futur
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('finDeTour', () => {
        if (etatJeu === 'JEU' && socket.id === joueurActuel) {
            tourIndex++;
            if (tourIndex >= ordreJeu.length) tourIndex = 0;
            joueurActuel = ordreJeu[tourIndex]; 
            io.emit('majJeu', { joueurs, etatJeu, joueurActuel, boucanier });
        }
    });

    socket.on('disconnect', () => {
        let etaitActuel = (socket.id === joueurActuel);
        if(boucanier.possesseur === socket.id) boucanier.possesseur = null; 

        delete joueurs[socket.id];
        
        if(Object.keys(joueurs).length === 0) {
            etatJeu = 'LOBBY'; 
            genererNouvelleCarte(); 
        } else {
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

// Pour la mise en ligne Render
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`⚓ Serveur Kraken Fall prêt sur le port ${PORT}`);
});