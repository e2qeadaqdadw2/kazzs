const API_URL = 'http://localhost:3000';
let currentUser = null;

// Verificar sesión al cargar
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    
    if (!token && !window.location.pathname.includes('callback.html')) {
        window.location.href = '/';
        return;
    }
    
    if (token) {
        loadUserData();
        setupNavigation();
        loadDashboard();
    }
});

// Cargar datos del usuario
async function loadUserData() {
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const user = await response.json();
        currentUser = user;
        
        document.getElementById('userName').textContent = user.username;
        document.getElementById('userAvatar').src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
        
        const roleBadge = document.getElementById('userRole');
        roleBadge.textContent = user.role;
        
        // Mostrar elementos solo para admin/owner
        if (user.role === 'owner' || user.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.classList.add('visible');
            });
        }
        
    } catch (error) {
        console.error('Error cargando usuario:', error);
        logout();
    }
}

// Configurar navegación
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-links li');
    
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const page = link.dataset.page;
            
            // Actualizar clases activas
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Mostrar página correspondiente
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`${page}-page`).classList.add('active');
            
            // Cargar datos según la página
            switch(page) {
                case 'dashboard':
                    loadDashboard();
                    break;
                case 'keys':
                    loadKeys();
                    break;
            }
        });
    });
}

// Cargar dashboard
async function loadDashboard() {
    try {
        const response = await fetch(`${API_URL}/api/stats`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const stats = await response.json();
        
        document.getElementById('totalKeys').textContent = stats.total;
        document.getElementById('activeKeys').textContent = stats.active;
        document.getElementById('activationsToday').textContent = stats.activations_today;
        document.getElementById('keysToday').textContent = stats.keys_generated_today;
        
        renderCharts(stats);
        
    } catch (error) {
        console.error('Error cargando stats:', error);
    }
}

// Renderizar gráficos
function renderCharts(stats) {
    // Gráfico de tipos
    const typeChart = document.getElementById('typeChart');
    typeChart.innerHTML = '';
    
    const types = [
        { label: 'Lifetime', value: stats.by_type.lifetime, color: '#667eea' },
        { label: '1 Día', value: stats.by_type['1d'], color: '#764ba2' },
        { label: '7 Días', value: stats.by_type['7d'], color: '#ff4757' },
        { label: '30 Días', value: stats.by_type['30d'], color: '#00d25b' },
        { label: '90 Días', value: stats.by_type['90d'], color: '#ffa502' },
        { label: 'Anual', value: stats.by_type.yearly, color: '#ff6b81' }
    ];
    
    const maxValue = Math.max(...types.map(t => t.value));
    
    types.forEach(type => {
        const bar = document.createElement('div');
        bar.style.cssText = `
            width: 40px;
            height: ${(type.value / maxValue) * 200}px;
            background: ${type.color};
            border-radius: 5px 5px 0 0;
            position: relative;
        `;
        
        const label = document.createElement('span');
        label.style.cssText = `
            position: absolute;
            bottom: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 12px;
            white-space: nowrap;
        `;
        label.textContent = type.label;
        
        const value = document.createElement('span');
        value.style.cssText = `
            position: absolute;
            top: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 12px;
            font-weight: bold;
        `;
        value.textContent = type.value;
        
        bar.appendChild(label);
        bar.appendChild(value);
        typeChart.appendChild(bar);
    });
    
    // Gráfico de actividad
    const activityChart = document.getElementById('activityChart');
    activityChart.innerHTML = '';
    
    stats.activity.forEach(day => {
        const bar = document.createElement('div');
        bar.style.cssText = `
            width: 30px;
            height: ${(day.count / 50) * 200}px;
            background: #667eea;
            border-radius: 5px 5px 0 0;
            position: relative;
        `;
        
        const label = document.createElement('span');
        label.style.cssText = `
            position: absolute;
            bottom: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 11px;
        `;
        label.textContent = day.date.split('-')[2];
        
        const value = document.createElement('span');
        value.style.cssText = `
            position: absolute;
            top: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 11px;
        `;
        value.textContent = day.count;
        
        bar.appendChild(label);
        bar.appendChild(value);
        activityChart.appendChild(bar);
    });
}

// Cargar keys
async function loadKeys(page = 1) {
    const search = document.getElementById('keySearch')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    const type = document.getElementById('typeFilter')?.value || '';
    
    try {
        const url = new URL(`${API_URL}/api/keys`);
        url.searchParams.append('page', page);
        url.searchParams.append('limit', 20);
        if (search) url.searchParams.append('search', search);
        if (status) url.searchParams.append('status', status);
        if (type) url.searchParams.append('type', type);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        renderKeysTable(data.keys);
        renderPagination(data.pagination);
        
    } catch (error) {
        console.error('Error cargando keys:', error);
    }
}

// Renderizar tabla de keys
function renderKeysTable(keys) {
    const tbody = document.getElementById('keysTableBody');
    
    if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No hay keys</td></tr>';
        return;
    }
    
    tbody.innerHTML = keys.map(key => `
        <tr>
            <td><code>${key.key}</code></td>
            <td>${key.type}</td>
            <td><span class="status-badge status-${key.status}">${key.status}</span></td>
            <td><code>${key.hwid || '-'}</code></td>
            <td>${new Date(key.created_at).toLocaleDateString()}</td>
            <td>${key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'Nunca'}</td>
            <td>${key.last_login ? new Date(key.last_login).toLocaleDateString() : '-'}</td>
            <td>
                <button class="action-btn view" onclick="viewKey('${key.key}')">👁️</button>
                ${key.status !== 'banned' ? 
                    `<button class="action-btn ban" onclick="banKey('${key.key}')">🔨</button>` :
                    `<button class="action-btn unban" onclick="unbanKey('${key.key}')">✅</button>`
                }
                ${key.hwid ? 
                    `<button class="action-btn reset" onclick="resetHwid('${key.key}')">🔄</button>` :
                    ''
                }
            </td>
        </tr>
    `).join('');
}

// Renderizar paginación
function renderPagination(pagination) {
    const container = document.getElementById('keysPagination');
    let html = '';
    
    for (let i = 1; i <= pagination.pages; i++) {
        html += `<button class="${i === pagination.page ? 'active' : ''}" onclick="loadKeys(${i})">${i}</button>`;
    }
    
    container.innerHTML = html;
}

// Generar keys
async function generateKeys() {
    const type = document.getElementById('generateType').value;
    const count = document.getElementById('generateCount').value;
    const notes = document.getElementById('generateNotes').value;
    
    try {
        const response = await fetch(`${API_URL}/api/keys/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ type, count, notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('keysOutput').value = data.keys.join('\n');
            document.getElementById('generatedKeys').style.display = 'block';
        }
        
    } catch (error) {
        alert('Error generando keys');
    }
}

// Copiar keys
function copyKeys() {
    const output = document.getElementById('keysOutput');
    output.select();
    document.execCommand('copy');
    alert('Keys copiadas al portapapeles');
}

// Banear key
async function banKey(key) {
    if (!confirm(`¿Banear key ${key}?`)) return;
    
    try {
        await fetch(`${API_URL}/api/keys/${key}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status: 'banned' })
        });
        
        loadKeys();
        
    } catch (error) {
        alert('Error baneando key');
    }
}

// Desbanear key
async function unbanKey(key) {
    if (!confirm(`¿Desbanear key ${key}?`)) return;
    
    try {
        await fetch(`${API_URL}/api/keys/${key}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status: 'unused' })
        });
        
        loadKeys();
        
    } catch (error) {
        alert('Error desbaneando key');
    }
}

// Reset HWID
async function resetHwid(key) {
    if (!confirm(`¿Resetear HWID de key ${key}?`)) return;
    
    try {
        await fetch(`${API_URL}/api/keys/${key}/reset-hwid`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        loadKeys();
        
    } catch (error) {
        alert('Error reseteando HWID');
    }
}

// Ver key
function viewKey(key) {
    window.open(`/key.html?key=${key}`, '_blank');
}

// Cerrar sesión
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}