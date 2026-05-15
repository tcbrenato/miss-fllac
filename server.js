const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = 'https://hfznofaxuokofbhxdfik.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhmem5vZmF4dW9rb2ZiaHhkZmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzM3MjgsImV4cCI6MjA5NDQwOTcyOH0.hO8KuYknUVk4Q-UurQWd-mMN1wcNpLw_LqTSl6miNK8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Utilisation de la mémoire pour Multer (pour envoyer vers le Cloud)
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));
app.use(express.json());

// 1. ROUTE : ENVOYER UN VOTE DEPUIS LE SITE
app.post('/api/voter', upload.single('capture'), async (req, res) => {
    try {
        const { candidate, voteCount } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: "Capture manquante" });

        const fileName = `vote-${Date.now()}.jpg`;

        // A. Envoyer l'image vers le bucket "captures"
        const { data: storageData, error: storageError } = await supabase.storage
            .from('captures')
            .upload(fileName, file.buffer, { contentType: 'image/jpeg' });

        if (storageError) throw storageError;

        // B. Récupérer l'URL publique
        const { data: urlData } = supabase.storage.from('captures').getPublicUrl(fileName);
        const imageUrl = urlData.publicUrl;

        // C. Insérer les infos du vote dans la table SQL
        const { error: dbError } = await supabase
            .from('votes')
            .insert([{
                candidate: candidate,
                count: parseInt(voteCount),
                screenshot_url: imageUrl,
                status: 'EN_ATTENTE'
            }]);

        if (dbError) throw dbError;

        res.json({ message: "Vote enregistré avec succès !" });
    } catch (err) {
        console.error("Erreur serveur :", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. ROUTE : RÉCUPÉRER LE CLASSEMENT
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

// 3. ROUTE : ADMIN - LISTE DES VOTES À VALIDER
app.get('/api/admin/votes', async (req, res) => {
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

// 4. ROUTE : ADMIN - VALIDER UN VOTE
app.post('/api/admin/valider', async (req, res) => {
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

// --- MODIFICATION POUR VERCEL ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`🚀 SERVEUR MISS FLLAC LANCÉ SUR http://localhost:${port}`);
    });
}

module.exports = app; // CRUCIAL POUR VERCEL