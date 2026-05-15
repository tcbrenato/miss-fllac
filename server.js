const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION SÉCURITÉ ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MISS2026FLLAC";

// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = 'https://hfznofaxuokofbhxdfik.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhmem5vZmF4dW9rb2ZiaHhkZmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzM3MjgsImV4cCI6MjA5NDQwOTcyOH0.hO8KuYknUVk4Q-UurQWd-mMN1wcNpLw_LqTSl6miNK8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));
app.use(express.json());

// Middleware de vérification Admin
const checkAdminAuth = (req, res, next) => {
    const providedPass = req.headers['x-admin-password'];
    if (providedPass === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: "Accès non autorisé" });
    }
};

// --- ROUTES PUBLIQUES ---

// Envoyer un vote
app.post('/api/voter', upload.single('capture'), async (req, res) => {
    try {
        const { candidate, voteCount } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "Capture manquante" });

        const fileName = `vote-${Date.now()}.jpg`;
        const { data: storageData, error: storageError } = await supabase.storage
            .from('captures')
            .upload(fileName, file.buffer, { contentType: 'image/jpeg' });

        if (storageError) throw storageError;

        const { data: urlData } = supabase.storage.from('captures').getPublicUrl(fileName);
        
        const { error: dbError } = await supabase
            .from('votes')
            .insert([{
                candidate: candidate,
                count: parseInt(voteCount),
                screenshot_url: urlData.publicUrl,
                status: 'EN_ATTENTE'
            }]);

        if (dbError) throw dbError;
        res.json({ message: "Vote enregistré avec succès !" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Récupérer le classement (Votes validés uniquement)
app.get('/api/ranking', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('votes')
            .select('candidate, count')
            .eq('status', 'VALIDE');

        if (error) throw error;
        const ranking = {};
        data.forEach(v => {
            ranking[v.candidate] = (ranking[v.candidate] || 0) + v.count;
        });
        res.json(ranking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTES ADMIN (SÉCURISÉES) ---

// Voir tous les votes
app.get('/api/admin/votes', checkAdminAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('votes')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Valider un vote
app.post('/api/admin/valider', checkAdminAuth, async (req, res) => {
    try {
        const { id } = req.body;
        const { error } = await supabase
            .from('votes')
            .update({ status: 'VALIDE' })
            .eq('id', id);

        if (error) throw error;
        res.json({ message: "Vote validé !" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`🚀 SERVEUR MISS FLLAC : http://localhost:${port}`);
    });
}

module.exports = app;