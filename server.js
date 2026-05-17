const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ════════════════════════════════ INIT
const app = express();
const PORT = process.env.PORT || 3000;

// ════════════════════════════════ SUPABASE
const supabase = createClient(
    'https://hfznofaxuokofbhxdfik.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhmem5vZmF4dW9rb2ZiaHhkZmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzM3MjgsImV4cCI6MjA5NDQwOTcyOH0.hO8KuYknUVk4Q-UurQWd-mMN1wcNpLw_LqTSl6miNK8'
);

// ════════════════════════════════ MIDDLEWARES
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ════════════════════════════════ MULTER
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// ════════════════════════════════ HELPER LOG
async function addLog(event_type, actor, candidate, vote_count, tx_ref, details) {
    await supabase.from('logs').insert({
        event_type,
        actor,
        candidate,
        vote_count,
        tx_ref,
        details,
        happened_at: new Date().toISOString()
    });
}

// ════════════════════════════════ 1. CLASSEMENT PUBLIC
app.get('/api/ranking', async (req, res) => {
    const { data, error } = await supabase
        .from('candidates')
        .select('name, votes')
        .order('votes', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const ranking = {};
    data.forEach(c => { ranking[c.name] = c.votes; });
    res.json(ranking);
});

// ════════════════════════════════ 2. SOUMISSION D'UN VOTE
app.post('/api/voter', upload.single('capture'), async (req, res) => {
    const { candidate, voteCount, senderName, senderPhone, txRef } = req.body;

    console.log("\n================ 🔥 NOUVEAU VOTE REÇU ==================");
    console.log(`👤 Payeur    : ${senderName || 'Inconnu'} (${senderPhone || 'Pas de numéro'})`);
    console.log(`👑 Candidate : ${candidate ? candidate.toUpperCase() : 'Non spécifiée'}`);
    console.log(`🗳️  Nombre    : ${voteCount || 1} vote(s)`);
    console.log(`🆔 ID Saisi  : ${txRef || 'Aucun'}`);
    console.log("========================================================");

    if (!txRef) return res.status(400).json({ error: "L'ID de transaction est obligatoire." });

    const cleanTxRef = txRef.toUpperCase().trim();

    // Vérifier doublon dans Supabase
    const { data: existing } = await supabase
        .from('votes')
        .select('id')
        .eq('tx_ref', cleanTxRef)
        .single();

    if (existing) {
        console.log(`🚨 Tentative de fraude bloquée ! ID doublon : ${cleanTxRef}`);
        await addLog('FRAUDE_BLOQUEE', senderName || 'Inconnu', candidate, parseInt(voteCount), cleanTxRef,
            `Doublon détecté — ${senderName} (${senderPhone})`);
        return res.status(400).json({ error: "Cet ID de transaction a déjà été soumis." });
    }

    const captureUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const { error } = await supabase.from('votes').insert({
        id: Date.now(),
        candidate,
        vote_count: parseInt(voteCount),
        sender_name: senderName,
        sender_phone: senderPhone,
        tx_ref: cleanTxRef,
        capture_url: captureUrl,
        status: 'pending',
        submitted_at: new Date().toISOString()
    });

    if (error) return res.status(500).json({ error: error.message });

    // Log de soumission
    await addLog('VOTE_SOUMIS', senderName || 'Inconnu', candidate, parseInt(voteCount), cleanTxRef,
        `${senderName} (${senderPhone}) a soumis ${voteCount} vote(s) pour ${candidate}`);

    res.sendStatus(200);
});

// ════════════════════════════════ 3. LISTE ADMIN
app.get('/api/admin-list', async (req, res) => {
    const { data, error } = await supabase
        .from('votes')
        .select('*')
        .order('submitted_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Adapter les noms de colonnes pour le frontend
    const adapted = data.map(v => ({
        id: v.id,
        candidate: v.candidate,
        voteCount: v.vote_count,
        senderName: v.sender_name,
        senderPhone: v.sender_phone,
        txRef: v.tx_ref,
        captureUrl: v.capture_url,
        status: v.status,
        controlRef: v.control_ref,
        submittedAt: v.submitted_at,
        validatedAt: v.validated_at,
        rejectedAt: v.rejected_at,
        actionBy: v.action_by
    }));

    res.json(adapted);
});

app.get('/api/candidates-list', async (req, res) => {
    const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .order('votes', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.get('/api/admin-logs', async (req, res) => {
    const { data, error } = await supabase
        .from('logs')
        .select('*')
        .order('happened_at', { ascending: false })
        .limit(100);

    if (error) return res.status(500).json({ error: error.message });

    // Adapter pour le frontend
    const adapted = data.map(l => ({
        time: new Date(l.happened_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        text: l.details,
        event_type: l.event_type,
        happened_at: l.happened_at
    }));

    res.json(adapted);
});

// ════════════════════════════════ 4. ACTION ADMIN
app.post('/api/admin-action', async (req, res) => {
    const { id, action, controlRef, role } = req.body;

    const { data: vote, error: fetchError } = await supabase
        .from('votes')
        .select('*')
        .eq('id', id)
        .single();

    if (fetchError || !vote) return res.status(404).send("Vote introuvable.");

    const nameGestionnaire = role === 'super-admin' ? 'Super-Admin' : 'Gestionnaire';
    const now = new Date().toISOString();

    if (action === 'validate') {
        // Mettre à jour le statut du vote
        await supabase.from('votes').update({
            status: 'validated',
            control_ref: controlRef.toUpperCase().trim(),
            validated_at: now,
            action_by: nameGestionnaire
        }).eq('id', id);

        // Incrémenter les votes de la candidate
        const { data: cand } = await supabase
            .from('candidates')
            .select('votes')
            .eq('name', vote.candidate)
            .single();

        if (cand) {
            await supabase.from('candidates')
                .update({
                    votes: cand.votes + vote.vote_count,
                    updated_at: now
                })
                .eq('name', vote.candidate);
        }

        await addLog('VOTE_VALIDE', nameGestionnaire, vote.candidate, vote.vote_count, vote.tx_ref,
            `✅ ${nameGestionnaire} a VALIDÉ ${vote.vote_count} vote(s) pour "${vote.candidate}" — Payeur: ${vote.sender_name} (${vote.sender_phone}) — ID: ${vote.tx_ref}`);

    } else if (action === 'reject') {
        await supabase.from('votes').update({
            status: 'rejected',
            rejected_at: now,
            action_by: nameGestionnaire
        }).eq('id', id);

        await addLog('VOTE_REJETE', nameGestionnaire, vote.candidate, vote.vote_count, vote.tx_ref,
            `❌ ${nameGestionnaire} a REJETÉ ${vote.vote_count} vote(s) pour "${vote.candidate}" — Payeur: ${vote.sender_name} (${vote.sender_phone}) — ID: ${vote.tx_ref}`);
    }

    res.sendStatus(200);
});

// ════════════════════════════════ 5. CRUD CANDIDATES
app.post('/api/candidate-save', upload.single('photo'), async (req, res) => {
    const { id, name, dept, votes } = req.body;

    if (id) {
        const updateData = { name, dept, votes: parseInt(votes), updated_at: new Date().toISOString() };
        if (req.file) updateData.photo_url = `/uploads/${req.file.filename}`;
        await supabase.from('candidates').update(updateData).eq('id', id);
    } else {
        const { data: all } = await supabase.from('candidates').select('id');
        const newId = (all.length + 1).toString();
        await supabase.from('candidates').insert({
            id: newId, name, dept,
            votes: parseInt(votes),
            photo_url: req.file ? `/uploads/${req.file.filename}` : ''
        });
    }
    res.sendStatus(200);
});

app.delete('/api/candidate-delete', async (req, res) => {
    const { id } = req.query;
    await supabase.from('candidates').delete().eq('id', id);
    res.sendStatus(200);
});

// ════════════════════════════════ 6. RESET
app.post('/api/admin-reset', async (req, res) => {
    await supabase.from('votes').delete().neq('id', 0);
    await supabase.from('logs').delete().neq('id', 0);
    await supabase.from('candidates').update({ votes: 0 }).neq('id', '');
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Serveur Supabase actif sur le port ${PORT}`));