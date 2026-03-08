// PinkAuth/Backend/bot/index.js
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API_URL = 'http://localhost:3000';
const ADMIN_KEY = 'tu_clave_super_secreta_cambiar'; // Misma que en .env

// Roles permitidos (IDs de Discord)
const ALLOWED_ROLES = [
    'ID_DEL_ROLE_ADMIN',
    'ID_DEL_ROLE_OWNER'
];

client.once('ready', () => {
    console.log(`PinkAuth Bot conectado como ${client.user.tag}`);
    registerCommands();
});

// Registrar comandos slash
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('gen')
            .setDescription('Generar keys')
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('Tipo de key')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Lifetime', value: 'lifetime' },
                        { name: '1 Día', value: '1d' },
                        { name: '7 Días', value: '7d' },
                        { name: '30 Días', value: '30d' },
                        { name: '90 Días', value: '90d' },
                        { name: 'Anual', value: 'yearly' }
                    ))
            .addIntegerOption(option =>
                option.setName('cantidad')
                    .setDescription('Cantidad a generar (1-10)')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(10)),
        
        new SlashCommandBuilder()
            .setName('info')
            .setDescription('Ver información de una key')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('La key a consultar')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Banear una key')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('Key a banear')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('razon')
                    .setDescription('Razón del ban')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Desbanear una key')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('Key a desbanear')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('list')
            .setDescription('Listar keys')
            .addStringOption(option =>
                option.setName('estado')
                    .setDescription('Estado de las keys')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Activas', value: 'active' },
                        { name: 'Sin usar', value: 'unused' },
                        { name: 'Baneadas', value: 'banned' },
                        { name: 'Expiradas', value: 'expired' }
                    )),
        
        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('Ver estadísticas del sistema'),
        
        new SlashCommandBuilder()
            .setName('reset-hwid')
            .setDescription('Resetear HWID de una key')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('Key a resetear')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('logs')
            .setDescription('Ver logs recientes')
            .addIntegerOption(option =>
                option.setName('cantidad')
                    .setDescription('Cantidad de logs (1-50)')
                    .setRequired(false))
    ];

    try {
        await client.application.commands.set(commands);
        console.log('Comandos registrados');
    } catch (error) {
        console.error('Error registrando comandos:', error);
    }
}

// Verificar permisos
function hasPermission(interaction) {
    return interaction.member.roles.cache.some(role => 
        ALLOWED_ROLES.includes(role.id)
    );
}

// Manejar comandos
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // Verificar permisos
    if (!hasPermission(interaction)) {
        return interaction.reply({ 
            content: '❌ No tienes permiso para usar este comando.', 
            ephemeral: true 
        });
    }

    const { commandName, options } = interaction;

    try {
        switch(commandName) {
            case 'gen':
                await generateKeys(interaction, options);
                break;
            case 'info':
                await keyInfo(interaction, options);
                break;
            case 'ban':
                await banKey(interaction, options);
                break;
            case 'unban':
                await unbanKey(interaction, options);
                break;
            case 'list':
                await listKeys(interaction, options);
                break;
            case 'stats':
                await showStats(interaction);
                break;
            case 'reset-hwid':
                await resetHwid(interaction, options);
                break;
            case 'logs':
                await showLogs(interaction, options);
                break;
        }
    } catch (error) {
        console.error(error);
        await interaction.reply({ 
            content: '❌ Error al procesar el comando', 
            ephemeral: true 
        });
    }
});

// Generar keys
async function generateKeys(interaction, options) {
    const type = options.getString('type');
    const cantidad = options.getInteger('cantidad') || 1;
    
    await interaction.deferReply();
    
    try {
        const response = await axios.post(`${API_URL}/admin/generate`, {
            admin_key: ADMIN_KEY,
            type: type,
            count: cantidad,
            created_by: interaction.user.tag
        });
        
        if (response.data.success) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Keys Generadas')
                .setDescription(`**Tipo:** ${type}\n**Cantidad:** ${cantidad}`)
                .addFields({
                    name: 'Keys',
                    value: response.data.keys.map(k => `\`${k}\``).join('\n'),
                    inline: false
                })
                .setFooter({ text: `Generadas por ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
    } catch (error) {
        await interaction.editReply('❌ Error al generar keys');
    }
}

// Información de key
async function keyInfo(interaction, options) {
    const key = options.getString('key').toUpperCase();
    
    await interaction.deferReply();
    
    try {
        const response = await axios.get(`${API_URL}/admin/keys`, {
            params: { admin_key: ADMIN_KEY }
        });
        
        const license = response.data.find(k => k.key === key);
        
        if (!license) {
            return interaction.editReply('❌ Key no encontrada');
        }
        
        const embed = new EmbedBuilder()
            .setColor(license.status === 'active' ? 0x00FF00 : 0xFF0000)
            .setTitle(`🔑 Información de Key`)
            .addFields(
                { name: 'Key', value: `\`${license.key}\``, inline: false },
                { name: 'Tipo', value: license.type, inline: true },
                { name: 'Estado', value: license.status, inline: true },
                { name: 'HWID', value: license.hwid || '❌ No asignado', inline: true },
                { name: 'Creada', value: new Date(license.created_at).toLocaleString(), inline: true },
                { name: 'Expira', value: license.expires_at ? new Date(license.expires_at).toLocaleString() : 'Nunca', inline: true },
                { name: 'Último login', value: license.last_login ? new Date(license.last_login).toLocaleString() : 'Nunca', inline: true },
                { name: 'Creada por', value: license.created_by || 'Desconocido', inline: true }
            )
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener información');
    }
}

// Banear key
async function banKey(interaction, options) {
    const key = options.getString('key').toUpperCase();
    const razon = options.getString('razon') || 'No especificada';
    
    await interaction.deferReply();
    
    try {
        await axios.post(`${API_URL}/admin/ban`, {
            admin_key: ADMIN_KEY,
            key: key,
            reason: razon
        });
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🔨 Key Baneada')
            .setDescription(`**Key:** \`${key}\`\n**Razón:** ${razon}`)
            .setFooter({ text: `Baneada por ${interaction.user.tag}` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al banear key');
    }
}

// Desbanear key
async function unbanKey(interaction, options) {
    const key = options.getString('key').toUpperCase();
    
    await interaction.deferReply();
    
    try {
        await axios.post(`${API_URL}/admin/unban`, {
            admin_key: ADMIN_KEY,
            key: key
        });
        
        await interaction.editReply(`✅ Key \`${key}\` desbaneada correctamente`);
    } catch (error) {
        await interaction.editReply('❌ Error al desbanear key');
    }
}

// Listar keys
async function listKeys(interaction, options) {
    const estado = options.getString('estado') || 'active';
    
    await interaction.deferReply();
    
    try {
        const response = await axios.get(`${API_URL}/admin/keys`, {
            params: { 
                admin_key: ADMIN_KEY,
                status: estado
            }
        });
        
        const keys = response.data;
        
        if (keys.length === 0) {
            return interaction.editReply(`❌ No hay keys con estado ${estado}`);
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`📋 Keys ${estado} (Total: ${keys.length})`)
            .setDescription(keys.slice(0, 20).map(k => 
                `\`${k.key}\` - ${k.type} - ${k.hwid ? '✅' : '❌'} - ${k.last_login ? new Date(k.last_login).toLocaleDateString() : 'Nunca'}`
            ).join('\n'))
            .setFooter({ text: `Mostrando 20 de ${keys.length} keys` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al listar keys');
    }
}

// Estadísticas
async function showStats(interaction) {
    await interaction.deferReply();
    
    try {
        const response = await axios.get(`${API_URL}/admin/stats`, {
            params: { admin_key: ADMIN_KEY }
        });
        
        const stats = response.data;
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('📊 Estadísticas del Sistema')
            .addFields(
                { name: '📌 Totales', value: `Total: ${stats.total}\nActivas: ${stats.active}\nSin usar: ${stats.unused}`, inline: true },
                { name: '⚠️ Estado', value: `Baneadas: ${stats.banned}\nExpiradas: ${stats.expired}`, inline: true },
                { name: '📈 Tipos', value: 
                    `Lifetime: ${stats.by_type.lifetime}\n` +
                    `1d: ${stats.by_type['1d']}\n` +
                    `7d: ${stats.by_type['7d']}\n` +
                    `30d: ${stats.by_type['30d']}\n` +
                    `90d: ${stats.by_type['90d']}\n` +
                    `Yearly: ${stats.by_type.yearly}`, inline: false },
                { name: '📊 Actividad', value: `Activaciones hoy: ${stats.activations_today}`, inline: true }
            )
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener estadísticas');
    }
}

// Reset HWID
async function resetHwid(interaction, options) {
    const key = options.getString('key').toUpperCase();
    
    await interaction.deferReply();
    
    try {
        // Primero obtener info de la key para saber el HWID actual
        const keysResponse = await axios.get(`${API_URL}/admin/keys`, {
            params: { admin_key: ADMIN_KEY }
        });
        
        const license = keysResponse.data.find(k => k.key === key);
        
        if (!license) {
            return interaction.editReply('❌ Key no encontrada');
        }
        
        if (!license.hwid) {
            return interaction.editReply('❌ Esta key no tiene HWID asignado');
        }
        
        // Confirmación (podrías añadir botones)
        await interaction.editReply(`⚠️ ¿Estás seguro de resetear el HWID de \`${key}\`?\nHWID actual: \`${license.hwid}\`\nResponde con **confirmar** en 30 segundos.`);
        
        // Aquí podrías implementar un sistema de confirmación con botones
        // Por ahora, lo hacemos directo
        
        await axios.post(`${API_URL}/admin/reset-hwid`, {
            admin_key: ADMIN_KEY,
            key: key
        });
        
        await interaction.followUp(`✅ HWID reseteado para key \`${key}\``);
        
    } catch (error) {
        await interaction.editReply('❌ Error al resetear HWID');
    }
}

// Ver logs
async function showLogs(interaction, options) {
    const cantidad = options.getInteger('cantidad') || 20;
    
    await interaction.deferReply();
    
    try {
        const response = await axios.get(`${API_URL}/admin/logs`, {
            params: { 
                admin_key: ADMIN_KEY,
                limit: cantidad
            }
        });
        
        const logs = response.data;
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`📋 Últimos ${logs.length} Logs`)
            .setDescription(logs.map(log => 
                `\`${new Date(log.timestamp).toLocaleString()}\` **${log.action}** - ${log.key} - ${log.hwid || 'N/A'}`
            ).join('\n'))
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply('❌ Error al obtener logs');
    }
}

client.login('DISCORD_BOT_TOKEN');