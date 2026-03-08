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

// Conectar a MongoDB - SIN OPCIONES OBSOLETAS
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => console.error('❌ Error MongoDB:', err));

// ========== MODELOS ==========
const KeySchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    program: { 
        type: String, 
        enum: ['temp', 'perm'],
        required: true 
    },
    category: { 
        type: String,
        required: true
    },
    subcategory: { 
        type: String,
        default: null
    },
    status: { 
        type: String, 
        enum: ['active', 'banned', 'expired', 'unused', 'used'], 
        default: 'unused' 
    },
    hwid: { type: String, default: null },
    ip_addresses: [String],
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: null },
    last_login: { type: Date, default: null },
    usage_count: { type: Number, default: 0 },
    max_uses: { type: Number, default: null },
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
        console.error('Error en auth discord:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error en autenticación', details: error.message });
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

// ========== GENERAR KEYS ==========
app.post('/api/keys/generate', verifyToken, checkRole(['owner', 'admin']), async (req, res) => {
    try {
        const { program, category, count = 1, notes = '' } = req.body;
        
        if (!program || !['temp', 'perm'].includes(program)) {
            return res.status(400).json({ error: 'Programa no válido' });
        }
        
        // Validar categorías
        if (program === 'temp') {
            const validTemp = ['1d', '7d', '30d', '90d', '365d', 'lifetime'];
            if (!validTemp.includes(category)) {
                return res.status(400).json({ error: 'Categoría temporal no válida' });
            }
        }
        
        if (program === 'perm') {
            const validPerm = ['single', 'lifetime'];
            if (!validPerm.includes(category)) {
                return res.status(400).json({ error: 'Categoría permanente no válida' });
            }
        }
        
        if (count > 50) return res.status(400).json({ error: 'Máximo 50 keys' });
        
        const keys = [];
        const now = new Date();
        
        for (let i = 0; i < count; i++) {
            // Generar key: XXXXX-XXXXX-XXXXX
            const key = Array(3).fill(0).map(() => 
                crypto.randomBytes(3).toString('hex').toUpperCase()
            ).join('-');
            
            let expires_at = null;
            let max_uses = null;
            
            // Configurar expiración para temporales
            if (program === 'temp' && category !== 'lifetime') {
                const expires = new Date(now);
                switch(category) {
                    case '1d': expires.setDate(expires.getDate() + 1); break;
                    case '7d': expires.setDate(expires.getDate() + 7); break;
                    case '30d': expires.setDate(expires.getDate() + 30); break;
                    case '90d': expires.setDate(expires.getDate() + 90); break;
                    case '365d': expires.setFullYear(expires.getFullYear() + 1); break;
                }
                expires_at = expires;
            }
            
            // Configurar usos para single-use
            if (program === 'perm' && category === 'single') {
                max_uses = 1;
            }
            
            await Key.create({
                key: key,
                program: program,
                category: category,
                expires_at: expires_at,
                max_uses: max_uses,
                created_by: req.user.username,
                notes: notes
            });
            
            keys.push(key);
        }
        
        await Log.create({
            action: 'KEYS_GENERATED',
            user: req.user.username,
            details: { program, category, count, keys }
        });
        
        res.json({ success: true, keys });
        
    } catch (error) {
        console.error('Error generando keys:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ========== LISTAR KEYS ==========
app.get('/api/keys', verifyToken, checkRole(['owner', 'admin', 'moderator']), async (req, res) => {
    try {
        const { program, category, status, search, page = 1, limit = 20 } = req.query;
        
        let query = {};
        if (program) query.program = program;
        if (category) query.category = category;
        if (status) query.status = status;
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
        console.error('Error listando keys:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ========== ACTUALIZAR KEY ==========
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
        console.error('Error actualizando key:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ========== RESET HWID ==========
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
        console.error('Error reseteando HWID:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ========== ESTADÍSTICAS ==========
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
            used: await Key.countDocuments({ status: 'used' }),
            
            by_program: {
                temp: await Key.countDocuments({ program: 'temp' }),
                perm: await Key.countDocuments({ program: 'perm' })
            },
            
            by_category: {
                temp: {
                    '1d': await Key.countDocuments({ program: 'temp', category: '1d' }),
                    '7d': await Key.countDocuments({ program: 'temp', category: '7d' }),
                    '30d': await Key.countDocuments({ program: 'temp', category: '30d' }),
                    '90d': await Key.countDocuments({ program: 'temp', category: '90d' }),
                    '365d': await Key.countDocuments({ program: 'temp', category: '365d' }),
                    'lifetime': await Key.countDocuments({ program: 'temp', category: 'lifetime' })
                },
                perm: {
                    'single': await Key.countDocuments({ program: 'perm', category: 'single' }),
                    'lifetime': await Key.countDocuments({ program: 'perm', category: 'lifetime' })
                }
            },
            
            activations_today: await Log.countDocuments({ 
                action: 'LOGIN_SUCCESS',
                timestamp: { $gte: today }
            })
        };
        
        res.json(stats);
        
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ========== VERIFICAR LICENCIA (ENDPOINT PRINCIPAL) ==========
app.post('/api/verify', async (req, res) => {
    try {
        const { key, hwid, ip, program } = req.body;
        
        // Validar programa
        if (!program || !['temp', 'perm'].includes(program)) {
            return res.json({ success: false, error: 'Programa no especificado' });
        }
        
        // Buscar key
        const license = await Key.findOne({ key: key.toUpperCase() });
        
        if (!license) {
            return res.json({ success: false, error: 'Key inválida' });
        }
        
        // Verificar programa correcto
        if (license.program !== program) {
            const programName = license.program === 'temp' ? 'Temporal' : 'Permanente';
            return res.json({ 
                success: false, 
                error: `Esta key es para el programa ${programName}` 
            });
        }
        
        // Verificar estado
        if (license.status === 'banned') {
            return res.json({ success: false, error: 'Key baneada' });
        }
        
        // Verificar expiración (para temporales no-lifetime)
        if (license.program === 'temp' && license.category !== 'lifetime') {
            if (license.expires_at && new Date() > license.expires_at) {
                license.status = 'expired';
                await license.save();
                return res.json({ success: false, error: 'Key expirada' });
            }
        }
        
        // Verificar usos (para perm single-use)
        if (license.program === 'perm' && license.category === 'single') {
            if (license.usage_count >= license.max_uses) {
                license.status = 'used';
                await license.save();
                return res.json({ success: false, error: 'Key ya utilizada' });
            }
        }
        
        // Primera activación
        if (!license.hwid) {
            license.hwid = hwid;
            license.status = 'active';
            license.usage_count = 1;
            license.last_login = new Date();
            if (ip) license.ip_addresses.push(ip);
            await license.save();
            
            await Log.create({ 
                key, 
                program: license.program, 
                action: 'FIRST_ACTIVATION', 
                ip, 
                hwid,
                details: { category: license.category }
            });
            
            return res.json({ 
                success: true, 
                program: license.program,
                category: license.category,
                expires_at: license.expires_at,
                first_activation: true
            });
        }
        
        // Verificar HWID
        if (license.hwid !== hwid) {
            await Log.create({ 
                key, 
                program: license.program, 
                action: 'HWID_MISMATCH', 
                ip, 
                hwid,
                details: { expected: license.hwid, received: hwid }
            });
            return res.json({ success: false, error: 'HWID no coincide' });
        }
        
        // Incrementar uso para single-use
        if (license.program === 'perm' && license.category === 'single') {
            license.usage_count += 1;
            if (license.usage_count >= license.max_uses) {
                license.status = 'used';
            }
        }
        
        // Actualizar último login
        license.last_login = new Date();
        if (ip && !license.ip_addresses.includes(ip)) {
            license.ip_addresses.push(ip);
        }
        await license.save();
        
        await Log.create({ 
            key, 
            program: license.program, 
            action: 'LOGIN_SUCCESS', 
            ip, 
            hwid,
            details: { usage_count: license.usage_count }
        });
        
        res.json({ 
            success: true, 
            program: license.program,
            category: license.category,
            expires_at: license.expires_at
        });
        
    } catch (error) {
        console.error('Error en verify:', error);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ========== RUTA DE PRUEBA ==========
app.get('/', (req, res) => {
    res.json({ 
        name: 'PinkAuth API',
        version: '2.0.0',
        status: 'online',
        programs: ['temp', 'perm'],
        temp_categories: ['1d', '7d', '30d', '90d', '365d', 'lifetime'],
        perm_categories: ['single', 'lifetime'],
        timestamp: new Date().toISOString()
    });
});

// ========== PING (para uptimerobot) ==========
app.get('/ping', (req, res) => {
    res.send('pong');
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ PinkAuth API v2.0 corriendo en puerto ${PORT}`);
    console.log(`🌐 URL: https://kazzs-production.up.railway.app`);
});