const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/callback', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'callback.html'));
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CAMBIA ESTO: de 5000 a 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`✅ Web corriendo en puerto ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});