const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => console.error('❌ Error MongoDB:', err));

// Modelos
const KeySchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    program: { 
        type: String, 
        enum: ['temp', 'perm'], // 🔥 temp = programa temporal, 💎 perm = programa permanente
        required: true 
    },
    type: { 
        type: String, 
        enum: ['lifetime', '1d', '7d', '30d', '90d', 'yearly'],
        required: true 
    },
    status: { 
        type: String, 
        enum: ['active', 'banned', 'expired', 'unused'], 
        default: 'unused' 
    },
    hwid: { type: String, default: null },
    ip_addresses: [String],
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: null },
    last_login: { type: Date, default: Date.now },
    created_by: { type: String, default: 'web' },
    notes: { type: String, default: '' }
});

const UserSchema = new mongoose.Schema({
    discord_id: { type: String, unique: true },
    discord_username: String,
    discord_avatar: String,
    role: { 
        type: String, 
        enum: ['owner', 'admin', 'moderator', 'user'], 
        default: 'user' 
    },
    created_at: { type: Date, default: Date.now },
    last_login: { type: Date, default: Date.now }
});

const LogSchema = new mongoose.Schema({
    key: String,
    program: String,
    action: String,
    ip: String,
    hwid: String,
    user: String,
    timestamp: { type: Date, default: Date.now },
    details: Object
});

const Key = mongoose.model('Key', KeySchema);
const User = mongoose.model('User', UserSchema);
const Log = mongoose.model('Log', LogSchema);

// Middleware JWT
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ error: 'Token inválido' });
    }
};

// Verificar rol
const checkRole = (roles) => {
    return async (req, res, next) => {
        const user = await User.findOne({ discord_id: req.user.discord_id });
        if (!user) return res.status(403).json({ error: 'Usuario no encontrado' });
        if (roles.includes(user.role)) {
            req.userData = user;
            next();
        } else {
            res.status(403).json({ error: 'Permisos insuficientes' });
        }
    };
};

// ========== ENDPOINTS ==========

// Auth Discord
app.post('/api/auth/discord', async (req, res) => {
    try {
        const { code } = req.body;
        
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.DISCORD_REDIRECT_URI,
                scope: 'identify'
            }), { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' } 
            }
        );
        
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });
        
        const discordUser = userRes.data;
        
        let user = await User.findOne({ discord_id: discordUser.id });
        
        if (!user) {
            let role = discordUser.id === process.env.OWNER_DISCORD_ID ? 'owner' : 'user';
            user = await User.create({
                discord_id: discordUser.id,
                discord_username: discordUser.username,
                discord_avatar: discordUser.avatar,
                role: role
            });
        } else {
            user.last_login = new Date();
            user.discord_username = discordUser.username;
            user.discord_avatar = discordUser.avatar;
            await user.save();
        }
        
        const token = jwt.sign(
            { discord_id: user.discord_id, username: user.discord_username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token: token,
            user: {
                id: user.discord_id,
                username: user.discord_username,
                avatar: user.discord_avatar,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error en autenticación' });
    }
});

// Verificar sesión
app.get('/api/auth/me', verifyToken, async (req, res) => {
    const user = await User.findOne({ discord_id: req.user.discord_id });
    res.json({
        id: user.discord_id,
        username: user.discord_username,
        avatar: user.discord_avatar,
        role: user.role
    });
});

// Generar keys (solo owner y admin)
app.post('/api/keys/generate', verifyToken, checkRole(['owner', 'admin']), async (req, res) => {
    try {
        const { program, type, count = 1, notes = '' } = req.body;
        
        if (!program || !['temp', 'perm'].includes(program)) {
            return res.status(400).json({ error: 'Programa no válido (temp/perm)' });
        }
        
        if (count > 50) return res.status(400).json({ error: 'Máximo 50 keys' });
        
        const keys = [];
        const now = new Date();
        
        for (let i = 0; i < count; i++) {
            const key = Array(3).fill(0).map(() => 
                crypto.randomBytes(3).toString('hex').toUpperCase()
            ).join('-');
            
            let expires_at = null;
            if (program === 'temp') {
                const expires = new Date(now);
                switch(type) {
                    case '1d': expires.setDate(expires.getDate() + 1); expires_at = expires; break;
                    case '7d': expires.setDate(expires.getDate() + 7); expires_at = expires; break;
                    case '30d': expires.setDate(expires.getDate() + 30); expires_at = expires; break;
                    case '90d': expires.setDate(expires.getDate() + 90); expires_at = expires; break;
                    case 'yearly': expires.setFullYear(expires.getFullYear() + 1); expires_at = expires; break;
                }
            }
            
            await Key.create({
                key: key,
                program: program,
                type: program === 'temp' ? type : 'lifetime',
                expires_at: expires_at,
                created_by: req.user.username,
                notes: notes
            });
            
            keys.push(key);
        }
        
        await Log.create({
            action: 'KEYS_GENERATED',
            user: req.user.username,
            details: { program, type, count, keys }
        });
        
        res.json({ success: true, keys });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// Listar keys
app.get('/api/keys', verifyToken, checkRole(['owner', 'admin', 'moderator']), async (req, res) => {
    try {
        const { program, status, type, search, page = 1, limit = 20 } = req.query;
        
        let query = {};
        if (program) query.program = program;
        if (status) query.status = status;
        if (type) query.type = type;
        if (search) {
            query.$or = [
                { key: { $regex: search, $options: 'i' } },
                { hwid: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const keys = await Key.find(query)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(parseInt(limit));
            
        const total = await Key.countDocuments(query);
        
        res.json({
            keys,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Actualizar key
app.put('/api/keys/:key', verifyToken, checkRole(['owner', 'admin']), async (req, res) => {
    try {
        const { status, notes } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        
        await Key.findOneAndUpdate({ key: req.params.key.toUpperCase() }, updateData);
        
        await Log.create({
            key: req.params.key,
            action: 'KEY_UPDATED',
            user: req.user.username,
            details: updateData
        });
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Reset HWID
app.post('/api/keys/:key/reset-hwid', verifyToken, checkRole(['owner', 'admin']), async (req, res) => {
    try {
        await Key.findOneAndUpdate(
            { key: req.params.key.toUpperCase() }, 
            { hwid: null }
        );
        
        await Log.create({
            key: req.params.key,
            action: 'HWID_RESET',
            user: req.user.username
        });
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Estadísticas
app.get('/api/stats', verifyToken, checkRole(['owner', 'admin', 'moderator']), async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const stats = {
            total: await Key.countDocuments(),
            active: await Key.countDocuments({ status: 'active' }),
            unused: await Key.countDocuments({ status: 'unused' }),
            banned: await Key.countDocuments({ status: 'banned' }),
            expired: await Key.countDocuments({ status: 'expired' }),
            by_program: {
                temp: await Key.countDocuments({ program: 'temp' }),
                perm: await Key.countDocuments({ program: 'perm' })
            },
            by_type: {
                lifetime: await Key.countDocuments({ type: 'lifetime' }),
                '1d': await Key.countDocuments({ type: '1d' }),
                '7d': await Key.countDocuments({ type: '7d' }),
                '30d': await Key.countDocuments({ type: '30d' }),
                '90d': await Key.countDocuments({ type: '90d' }),
                yearly: await Key.countDocuments({ type: 'yearly' })
            },
            activations_today: await Log.countDocuments({ 
                action: 'LOGIN_SUCCESS',
                timestamp: { $gte: today }
            })
        };
        
        res.json(stats);
        
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Verificar licencia (para el cliente)
app.post('/api/verify', async (req, res) => {
    try {
        const { key, hwid, ip, program } = req.body;
        
        if (!program || !['temp', 'perm'].includes(program)) {
            return res.json({ success: false, error: 'Programa no especificado' });
        }
        
        const license = await Key.findOne({ key: key.toUpperCase() });
        
        if (!license) {
            return res.json({ success: false, error: 'Key inválida' });
        }
        
        // Verificar que la key es para el programa correcto
        if (license.program !== program) {
            const programName = license.program === 'temp' ? 'Temporal' : 'Permanente';
            return res.json({ 
                success: false, 
                error: `Esta key es para el programa ${programName}. No puedes usarla aquí.` 
            });
        }
        
        // Verificar si está baneada
        if (license.status === 'banned') {
            return res.json({ success: false, error: 'Key baneada' });
        }
        
        // Verificar expiración (solo para programa temp)
        if (license.program === 'temp' && license.expires_at && new Date() > license.expires_at) {
            license.status = 'expired';
            await license.save();
            return res.json({ success: false, error: 'Key expirada' });
        }
        
        // Primera activación
        if (!license.hwid) {
            license.hwid = hwid;
            license.status = 'active';
            license.last_login = new Date();
            if (ip) license.ip_addresses.push(ip);
            await license.save();
            
            await Log.create({ key, program: license.program, action: 'FIRST_ACTIVATION', ip, hwid });
            
            return res.json({ 
                success: true, 
                program: license.program,
                type: license.type,
                expires_at: license.expires_at,
                first_activation: true
            });
        }
        
        // Verificar HWID
        if (license.hwid !== hwid) {
            await Log.create({ key, program: license.program, action: 'HWID_MISMATCH', ip, hwid });
            return res.json({ success: false, error: 'HWID no coincide' });
        }
        
        // Todo correcto
        license.last_login = new Date();
        if (ip && !license.ip_addresses.includes(ip)) {
            license.ip_addresses.push(ip);
        }
        await license.save();
        
        await Log.create({ key, program: license.program, action: 'LOGIN_SUCCESS', ip, hwid });
        
        res.json({ 
            success: true, 
            program: license.program,
            type: license.type,
            expires_at: license.expires_at
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// Ruta de prueba
app.get('/', (req, res) => {
    res.json({ 
        name: 'PinkAuth API',
        version: '1.0.0',
        status: 'online'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ API corriendo en puerto ${PORT}`);
});