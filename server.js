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

// ════════════════════════════════ MULTER (mémoire uniquement)
const upload = multer({ storage: multer.memoryStorage() });

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

// ════════════════════════════════ HELPER : vérifier maintenance
async function isMaintenanceActive() {
    const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'maintenance')
        .single();
    return data?.value === 'true';
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

// ════════════════════════════════ 2. STATUT MAINTENANCE (pour le frontend)
app.get('/api/status', async (req, res) => {
    const maintenance = await isMaintenanceActive();
    res.json({ maintenance });
});

// ════════════════════════════════ 3. SOUMISSION D'UN VOTE
app.post('/api/voter', upload.single('capture'), async (req, res) => {
    // 🔒 BLOCAGE SI MAINTENANCE ACTIVE
    const maintenance = await isMaintenanceActive();
    if (maintenance) {
        return res.status(503).json({ error: "🔧 La plateforme de vote est temporairement suspendue. Réouverture prochaine !" });
    }

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
        .maybeSingle();

    if (existing) {
        console.log(`🚨 Tentative de fraude bloquée ! ID doublon : ${cleanTxRef}`);
        await addLog('FRAUDE_BLOQUEE', senderName || 'Inconnu', candidate, parseInt(voteCount), cleanTxRef,
            `🚨 Doublon détecté — ${senderName} (${senderPhone}) a tenté de soumettre l'ID : ${cleanTxRef}`);
        return res.status(400).json({ error: "Cet ID de transaction a déjà été soumis." });
    }

    // ✅ Upload capture vers Supabase Storage
    let captureUrl = '';
    if (req.file) {
        const fileName = `${Date.now()}_${req.file.originalname.replace(/\s/g, '_')}`;
        const { error: uploadError } = await supabase.storage
            .from('captures')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (!uploadError) {
            const { data: urlData } = supabase.storage
                .from('captures')
                .getPublicUrl(fileName);
            captureUrl = urlData.publicUrl;
        }
    }

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

    await addLog('VOTE_SOUMIS', senderName || 'Inconnu', candidate, parseInt(voteCount), cleanTxRef,
        `📥 ${senderName} (${senderPhone}) a soumis ${voteCount} vote(s) pour ${candidate} — ID: ${cleanTxRef}`);

    res.sendStatus(200);
});

// ════════════════════════════════ 4. LISTE ADMIN
app.get('/api/admin-list', async (req, res) => {
    const { data, error } = await supabase
        .from('votes')
        .select('*')
        .order('submitted_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

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

    const adapted = data.map(l => ({
        time: new Date(l.happened_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        text: l.details,
        event_type: l.event_type,
        happened_at: l.happened_at
    }));

    res.json(adapted);
});

// ════════════════════════════════ 5. ACTION ADMIN
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
        await supabase.from('votes').update({
            status: 'validated',
            control_ref: controlRef.toUpperCase().trim(),
            validated_at: now,
            action_by: nameGestionnaire
        }).eq('id', id);

        const { data: cand } = await supabase
            .from('candidates')
            .select('votes')
            .eq('name', vote.candidate)
            .single();

        if (cand) {
            await supabase.from('candidates')
                .update({ votes: cand.votes + vote.vote_count, updated_at: now })
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

// ════════════════════════════════ 6. TOGGLE MAINTENANCE (super-admin)
app.post('/api/maintenance', async (req, res) => {
    const { active } = req.body;
    await supabase
        .from('settings')
        .update({ value: active ? 'true' : 'false' })
        .eq('key', 'maintenance');
    res.json({ maintenance: active });
});

// ════════════════════════════════ 7. CRUD CANDIDATES
app.post('/api/candidate-save', upload.single('photo'), async (req, res) => {
    const { id, name, dept, votes } = req.body;

    let photoUrl = '';
    if (req.file) {
        const fileName = `photos/${Date.now()}_${req.file.originalname.replace(/\s/g, '_')}`;
        const { error: uploadError } = await supabase.storage
            .from('captures')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });
        if (!uploadError) {
            const { data: urlData } = supabase.storage.from('captures').getPublicUrl(fileName);
            photoUrl = urlData.publicUrl;
        }
    }

    if (id) {
        const updateData = { name, dept, votes: parseInt(votes), updated_at: new Date().toISOString() };
        if (photoUrl) updateData.photo_url = photoUrl;
        await supabase.from('candidates').update(updateData).eq('id', id);
    } else {
        const { data: all } = await supabase.from('candidates').select('id');
        const newId = (all.length + 1).toString();
        await supabase.from('candidates').insert({
            id: newId, name, dept,
            votes: parseInt(votes),
            photo_url: photoUrl
        });
    }
    res.sendStatus(200);
});

app.delete('/api/candidate-delete', async (req, res) => {
    const { id } = req.query;
    await supabase.from('candidates').delete().eq('id', id);
    res.sendStatus(200);
});

// ════════════════════════════════ 8. RESET
app.post('/api-reset', async (req, res) => {
    await supabase.from('votes').delete().neq('id', 0);
    await supabase.from('logs').delete().neq('id', 0);
    await supabase.from('candidates').update({ votes: 0 }).neq('id', '');
    res.sendStatus(200);
});

app.post('/api/admin-reset', async (req, res) => {
    await supabase.from('votes').delete().neq('id', 0);
    await supabase.from('logs').delete().neq('id', 0);
    await supabase.from('candidates').update({ votes: 0 }).neq('id', '');
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Serveur Supabase Storage actif sur le port ${PORT}`));