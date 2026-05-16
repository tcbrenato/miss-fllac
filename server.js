const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. INITIALISATION DE L'APPLICATION (Toujours en premier !)
const app = express();
const PORT = process.env.PORT || 3000;

// 2. CONFIGURATION DES MIDDLEWARES & CORS
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configuration de stockage des captures d'écran
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// SIMULATION DE BASE DE DONNÉES EN MÉMOIRE
let candidates = [
    { id: "1", name: "LAWSON Thalia", dept: "Anglais", votes: 0 },
    { id: "2", name: "DOSSOU Gabriella", dept: "DSLC", votes: 0 },
    { id: "3", name: "GBOYOU Oriane", dept: "Anglais", votes: 0 },
    { id: "4", name: "ALIASSIM Fridos", dept: "Anglais", votes: 0 },
    { id: "5", name: "AHOUANDJINOU Gislaine", dept: "Lettres Mod.", votes: 0 },
    { id: "6", name: "ADJAÏ Bénédicte", dept: "Lettres Mod.", votes: 0 },
    { id: "7", name: "FANDONOUGBO Sabine", dept: "Lettres Mod.", votes: 0 },
    { id: "8", name: "HOUNTONDJI Lislaine", dept: "Anglais", votes: 0 },
    { id: "9", name: "YACOUBOU NADIATH", dept: "Espagnol", votes: 0 },
    { id: "10", name: "SOTON Odette", dept: "Lettres Mod.", votes: 0 },
    { id: "11", name: "AGBEGNINOU Marie Josée", dept: "Lettres Mod.", votes: 0 }
];

let voteRequests = [];
let usedTransactionIds = new Set();
let logsHistory = [];

// 1. API : Récupérer le classement pour la page d'accueil
app.get('/api/ranking', (req, res) => {
    const ranking = {};
    candidates.forEach(c => { ranking[c.name] = c.votes; });
    res.json(ranking);
});

// 2. API : Soumission d'un vote par un utilisateur (AVEC ANTI-FRAUDE)
app.post('/api/voter', upload.single('capture'), (req, res) => {
    const { candidate, voteCount, senderName, senderPhone, txRef } = req.body;

    // 📢 LOGS EN DIRECT DANS LE TERMINAL VS CODE
    console.log("\n================ 🔥 NOUVEAU VOTE REÇU ==================");
    console.log(`👤 Payeur    : ${senderName || 'Inconnu'} (${senderPhone || 'Pas de numéro'})`);
    console.log(`👑 Candidate : ${candidate ? candidate.toUpperCase() : 'Non spécifiée'}`);
    console.log(`🗳️ Nombre    : ${voteCount || 1} vote(s)`);
    console.log(`🆔 ID Saisi  : ${txRef || 'Aucun'}`);
    console.log("========================================================");

    if (!txRef) {
        return res.status(400).json({ error: "L'ID de transaction est obligatoire." });
    }

    const cleanTxRef = txRef.toUpperCase().trim();

    // SÉCURITÉ : BLOCAGE INSTANTANÉ SI L'ID A DÉJÀ ÉTÉ UTILISÉ
    if (usedTransactionIds.has(cleanTxRef)) {
        console.log(`🚨 Tentative de fraude bloquée ! ID doublon détecté : ${cleanTxRef}`);
        return res.status(400).json({ error: "Cet ID de transaction a déjà été soumis pour un vote." });
    }

    usedTransactionIds.add(cleanTxRef);

    const newRequest = {
        id: Date.now(),
        candidate,
        voteCount: parseInt(voteCount),
        senderName,
        senderPhone,
        txRef: cleanTxRef,
        captureUrl: req.file ? `/uploads/${req.file.filename}` : '',
        status: 'pending'
    };

    voteRequests.push(newRequest);
    res.sendStatus(200);
});

// 3. API : Liste complète pour le dashboard Admin
app.get('/api/admin-list', (req, res) => { res.json(voteRequests); });
app.get('/api/candidates-list', (req, res) => { res.json(candidates); });
app.get('/api/admin-logs', (req, res) => { res.json(logsHistory); });

// 4. API : Action du Gestionnaire (Validation / Rejet + Traçabilité)
app.post('/api/admin-action', (req, res) => {
    const { id, action, controlRef, role } = req.body;
    const voteIdx = voteRequests.findIndex(v => v.id == id);

    if (voteIdx === -1) return res.status(404).send("Vote introuvable.");
    
    const vote = voteRequests[voteIdx];
    const timestamp = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const nameGestionnaire = role === 'super-admin' ? 'Super-Admin (Vous)' : 'Gestionnaire Mobile';

    if (action === 'validate') {
        vote.status = 'validated';
        vote.controlRef = controlRef.toUpperCase().trim();

        const cand = candidates.find(c => c.name === vote.candidate);
        if (cand) cand.votes += vote.voteCount;

        logsHistory.unshift({
            time: timestamp,
            text: `✅ ${nameGestionnaire} a VALIDÉ ${vote.voteCount} vote(s) pour "${vote.candidate}". (ID Réf: ${vote.txRef})`
        });

    } else if (action === 'reject') {
        vote.status = 'rejected';
        usedTransactionIds.delete(vote.txRef);

        logsHistory.unshift({
            time: timestamp,
            text: `❌ ${nameGestionnaire} a REJETÉ la demande de ${vote.voteCount} vote(s) pour "${vote.candidate}".`
        });
    }

    res.sendStatus(200);
});

// 5. API : Fonctions de gestion de la liste des candidates (CRUD Super-Admin)
app.post('/api/candidate-save', upload.single('photo'), (req, res) => {
    const { id, name, dept, votes } = req.body;
    
    if (id) {
        const cand = candidates.find(c => c.id == id);
        if (cand) {
            cand.name = name;
            cand.dept = dept;
            cand.votes = parseInt(votes);
            if (req.file) cand.photoUrl = `/uploads/${req.file.filename}`;
        }
    } else {
        const newId = (candidates.length + 1).toString();
        candidates.push({
            id: newId,
            name,
            dept,
            votes: parseInt(votes),
            photoUrl: req.file ? `/uploads/${req.file.filename}` : ''
        });
    }
    res.sendStatus(200);
});

app.delete('/api/candidate-delete', (req, res) => {
    const { id } = req.query;
    candidates = candidates.filter(c => c.id != id);
    res.sendStatus(200);
});

app.post('/api/admin-reset', (req, res) => {
    voteRequests = [];
    usedTransactionIds.clear();
    logsHistory = [];
    candidates.forEach(c => c.votes = 0);
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Serveur sécurisé actif sur le port ${PORT}`));