// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const saltRounds = 10;

const connectionString = process.env.DATABASE_URL || 'postgres://SEU_USUARIO:SUA_SENHA@SEU_HOST:SUA_PORTA/SEU_BANCO';
const pool = new Pool({
    connectionString: connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Variável para armazenar a URL da playlist carregada do banco
let currentPlaylistUrl = "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"; // Valor padrão inicial

// Função para carregar configurações do banco
async function loadAppConfig() {
    try {
        const result = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'currentPlaylistUrl'");
        if (result.rows.length > 0) {
            currentPlaylistUrl = result.rows[0].config_value;
            console.log('SERVER: currentPlaylistUrl carregada do banco:', currentPlaylistUrl);
        } else {
            // Se não existir no banco, insere o valor padrão
            await pool.query(
                "INSERT INTO app_config (config_key, config_value) VALUES ($1, $2) ON CONFLICT (config_key) DO NOTHING",
                ['currentPlaylistUrl', currentPlaylistUrl]
            );
            console.log('SERVER: currentPlaylistUrl não encontrada no banco, valor padrão usado e talvez inserido:', currentPlaylistUrl);
        }
    } catch (err) {
        console.error('SERVER: Erro ao carregar currentPlaylistUrl do banco:', err);
        // Mantém o valor padrão se houver erro
    }
}

// Função para salvar configurações no banco
async function saveAppConfig(key, value) {
    try {
        await pool.query(
            "INSERT INTO app_config (config_key, config_value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (config_key) DO UPDATE SET config_value = $2, updated_at = NOW()",
            [key, value]
        );
        console.log(`SERVER: Configuração '${key}' salva no banco com valor:`, value);
        return true;
    } catch (err) {
        console.error(`SERVER: Erro ao salvar configuração '${key}' no banco:`, err);
        return false;
    }
}


pool.connect(async (err) => { // Adicionado async aqui
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL', err.stack);
    } else {
        console.log('Conectado ao PostgreSQL com sucesso!');
        await loadAppConfig(); // Carrega a config da playlist após conectar ao banco
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/login', async (req, res) => {
    // ... (código do login como antes)
    console.log("LOG SERVER: Rota /login acessada!");
    const { username, password } = req.body;
    console.log("LOG SERVER: Credenciais recebidas para login:", { username });
    try {
        const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const userFromDb = result.rows[0];
            const match = await bcrypt.compare(password, userFromDb.password_hash);
            if (match) {
                console.log("LOG SERVER: Login BEM SUCEDIDO para:", username);
                res.json({ success: true, username: userFromDb.username });
            } else {
                console.log("LOG SERVER: Login FALHOU (senha incorreta) para:", username);
                res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
            }
        } else {
            console.log("LOG SERVER: Login FALHOU (usuário não encontrado) para:", username);
            res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error('SERVER: Erro na rota /login:', err);
        res.status(500).json({ success: false, message: 'Erro no servidor ao tentar fazer login.' });
    }
});

async function getQueueState() {
    // ... (função getQueueState como antes)
    let waitingListFromDb = [];
    let calledPatientInfoFromDb = null;
    console.log('SERVER (getQueueState): Buscando estado da fila do banco...');
    try {
        const waitingResult = await pool.query(
            "SELECT id, name, priority, added_by_username, status, created_at FROM patients WHERE status = 'waiting' OR status = 'called' ORDER BY priority DESC, created_at ASC"
        );
        waitingListFromDb = waitingResult.rows.map(p => ({ 
            id: String(p.id), name: p.name, priority: p.priority,
            addedBy: p.added_by_username, status: p.status
        }));
        const calledResult = await pool.query(
            "SELECT id, name, added_by_username, status FROM patients WHERE status = 'called' ORDER BY called_at DESC LIMIT 1"
        );
        if (calledResult.rows.length > 0) {
            const calledDbRow = calledResult.rows[0];
            calledPatientInfoFromDb = { 
                name: calledDbRow.name, calledBy: calledDbRow.added_by_username,
                patientId: String(calledDbRow.id) 
            };
        }
    } catch (err) { console.error("SERVER (getQueueState): Erro ao buscar estado da fila:", err); }
    return { waitingList: waitingListFromDb, calledPatientInfo: calledPatientInfoFromDb };
}

io.on('connection', async (socket) => {
    console.log('SERVER: Novo usuário conectado:', socket.id);
    const queueState = await getQueueState();
    // Agora 'currentPlaylistUrl' é a variável global atualizada por loadAppConfig()
    socket.emit('initialData', { 
        waitingList: queueState.waitingList, 
        calledPatientInfo: queueState.calledPatientInfo, 
        currentPlaylistUrl // Usa a variável global que foi carregada do BD
    });

    socket.on('addPatient', async (patientData) => {
        // ... (código do addPatient como antes, usando o banco)
        console.log('SERVER (addPatient): Recebeu addPatient com dados:', patientData);
        const patientId = Date.now(); 
        try {
            await pool.query(
                "INSERT INTO patients (id, name, priority, added_by_username, status, created_at) VALUES ($1, $2, $3, $4, 'waiting', NOW())",
                [patientId, patientData.name, patientData.priority || false, patientData.addedBy]
            );
            console.log('SERVER (addPatient): Paciente adicionado ao BANCO DE DADOS:', patientData.name);
            const updatedQueueState = await getQueueState();
            io.emit('updateWaitingList', updatedQueueState.waitingList); 
        } catch (err) {
            console.error("SERVER (addPatient): Erro ao adicionar paciente ao banco:", err);
            socket.emit('addPatientError', { message: 'Erro ao adicionar paciente.'});
        }
    });

    socket.on('callPatient', async (data) => {
        // ... (código do callPatient como antes, usando o banco)
        console.log(`SERVER (callPatient): Recebeu 'callPatient'. Dados:`, data);
        try {
            let patientToCallResult = await pool.query(
                "SELECT id, name, added_by_username FROM patients WHERE id = $1 AND added_by_username = $2 AND status = 'waiting'",
                [BigInt(data.patientId), data.calledBy]
            );
            if (patientToCallResult && patientToCallResult.rows.length > 0) {
                const patientToCall = patientToCallResult.rows[0];
                const updateResult = await pool.query(
                    "UPDATE patients SET status = 'called', called_at = NOW() WHERE id = $1 RETURNING id, name, added_by_username",
                    [patientToCall.id]
                );
                if (updateResult.rowCount > 0) {
                    const calledPatientDb = updateResult.rows[0];
                    const currentCalledPatientPayload = {
                        name: calledPatientDb.name, calledBy: calledPatientDb.added_by_username,
                        patientId: String(calledPatientDb.id)
                    };
                    const updatedQueueState = await getQueueState();
                    io.emit('patientCalled', currentCalledPatientPayload);
                    io.emit('updateWaitingList', updatedQueueState.waitingList);
                } else { socket.emit('callError', { message: 'Erro ao tentar chamar (update falhou).' }); }
            } else { socket.emit('callError', { message: 'Paciente não encontrado ou já chamado/atendido.' }); }
        } catch (err) {
            console.error("SERVER (callPatient): Erro no evento callPatient:", err);
            socket.emit('callError', { message: 'Erro no servidor ao chamar paciente.'});
        }
    });

    socket.on('confirmPatientEntry', async (data) => {
        // ... (código do confirmPatientEntry como antes, usando o banco)
        console.log('SERVER (confirmPatientEntry): Recebeu confirmPatientEntry:', data);
        try {
            const result = await pool.query(
                "UPDATE patients SET status = 'attended', attended_at = NOW() WHERE id = $1 AND added_by_username = $2 AND status = 'called' RETURNING id",
                [BigInt(data.patientId), data.confirmedBy]
            );
            if (result.rowCount > 0) {
                const updatedQueueState = await getQueueState();
                io.emit('callResolved'); 
                io.emit('updateWaitingList', updatedQueueState.waitingList);
            }
        } catch (err) {
            console.error("SERVER (confirmPatientEntry): Erro ao confirmar entrada:", err);
            socket.emit('confirmationError', { message: 'Erro ao confirmar entrada.'});
        }
    });

    socket.on('cancelCall', async (data) => {
        // ... (código do cancelCall como antes, usando o banco)
        console.log('SERVER (cancelCall): Recebeu cancelCall:', data);
        try {
             const result = await pool.query(
                "UPDATE patients SET status = 'waiting', called_at = NULL WHERE id = $1 AND added_by_username = $2 AND status = 'called' RETURNING id",
                [BigInt(data.patientId), data.cancelledBy]
            );
            if (result.rowCount > 0) {
                const updatedQueueState = await getQueueState();
                io.emit('callResolved');
                io.emit('updateWaitingList', updatedQueueState.waitingList);
            }
        } catch (err) {
            console.error("SERVER (cancelCall): Erro ao cancelar chamada:", err);
            socket.emit('cancelError', { message: 'Erro ao cancelar chamada.'});
        }
    });
    
    socket.on('adminAddUser', async (data) => {
        // ... (código do adminAddUser como antes, usando o banco e bcrypt)
        console.log('SERVER (adminAddUser): Recebeu evento com dados:', data.adminUsername, data.usernameToAdd);
        try {
            const adminUserResult = await pool.query('SELECT password_hash FROM users WHERE username = $1', [data.adminUsername]);
            let isAdminAuthorized = false;
            if (adminUserResult.rows.length > 0) {
                if (adminUserResult.rows[0].password_hash.startsWith('$2a$') || adminUserResult.rows[0].password_hash.startsWith('$2b$')) { 
                    isAdminAuthorized = await bcrypt.compare('admin', adminUserResult.rows[0].password_hash); 
                } else if (adminUserResult.rows[0].password_hash === 'admin' && data.adminUsername === 'Admin') { 
                    isAdminAuthorized = true;
                }
            }
            if (data.adminUsername === 'Admin' && isAdminAuthorized) {
                // ... (lógica interna do adminAddUser)
                if (!data.usernameToAdd || !data.passwordForNewUser) {
                    socket.emit('adminAddUserResponse', { success: false, message: 'Nome ou senha do novo usuário faltando.' }); return;
                }
                const trimmedUsernameToAdd = data.usernameToAdd.trim();
                const existingUserResult = await pool.query('SELECT * FROM users WHERE username = $1', [trimmedUsernameToAdd]);
                if (existingUserResult.rows.length > 0) {
                    socket.emit('adminAddUserResponse', { success: false, message: `Usuário '${trimmedUsernameToAdd}' já existe.` });
                } else {
                    const hashedPassword = await bcrypt.hash(data.passwordForNewUser.trim(), saltRounds);
                    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [trimmedUsernameToAdd, hashedPassword]);
                    socket.emit('adminAddUserResponse', { success: true, message: `Usuário '${trimmedUsernameToAdd}' adicionado!` });
                }
            } else {
                socket.emit('adminAddUserResponse', { success: false, message: 'Ação não autorizada.' });
            }
        } catch (err) {
            console.error('SERVER (adminAddUser): Erro no evento:', err);
            socket.emit('adminAddUserResponse', { success: false, message: 'Erro no servidor ao adicionar usuário.' });
        }
    });
    
    // Modificado para salvar no banco de dados
    socket.on('updatePlaylist', async (playlistUrlFromClient) => { // Adicionado async
        console.log('SERVER (updatePlaylist): Recebeu URL:', playlistUrlFromClient);
        // Validação simples da URL (pode ser melhorada)
        if (playlistUrlFromClient && (playlistUrlFromClient.includes("youtube.com/embed/") || playlistUrlFromClient.includes("https://www.youtube.com/embed/videoseries?list=SUALISTADEVIDEOS"))) {
            const success = await saveAppConfig('currentPlaylistUrl', playlistUrlFromClient);
            if (success) {
                currentPlaylistUrl = playlistUrlFromClient; // Atualiza a variável global no servidor
                io.emit('playlistUpdated', currentPlaylistUrl); // Notifica todos os clientes
                console.log('SERVER (updatePlaylist): Playlist atualizada no BD e emitida:', currentPlaylistUrl);
                socket.emit('playlistUpdateSuccess', { message: 'Playlist atualizada com sucesso!', url: currentPlaylistUrl });
            } else {
                socket.emit('playlistError', { message: 'Erro ao salvar URL da playlist no banco de dados.' });
            }
        } else {
            console.log('SERVER (updatePlaylist): URL da playlist inválida recebida:', playlistUrlFromClient);
            socket.emit('playlistError', { message: 'URL da playlist fornecida é inválida.' });
        }
    });

    socket.on('disconnect', () => {
        console.log('SERVER: Usuário desconectado:', socket.id);
    });
});

// Garante que a configuração inicial seja carregada antes do servidor começar a ouvir por conexões de fato
// No entanto, pool.connect é chamado uma vez. loadAppConfig é chamado dentro do callback de sucesso.
// server.listen pode ser chamado diretamente.
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    // loadAppConfig será chamado quando a pool se conectar com sucesso.
    // Se a pool já conectou, loadAppConfig já foi chamado.
    // Se a conexão com a pool falhar e depois reconectar, loadAppConfig não é chamado de novo automaticamente por este listen.
    // A chamada inicial de loadAppConfig no pool.connect é o ponto principal.
    console.log(`Acesse a tela de login em: http://localhost:${PORT}`);
});
