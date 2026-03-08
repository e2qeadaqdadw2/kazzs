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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Web corriendo en puerto ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});