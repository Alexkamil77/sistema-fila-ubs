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

let currentPlaylistUrl = "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"; 

async function loadAppConfig() {
    try {
        const result = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'currentPlaylistUrl'");
        if (result.rows.length > 0) {
            currentPlaylistUrl = result.rows[0].config_value;
            console.log('SERVER: currentPlaylistUrl carregada do banco:', currentPlaylistUrl);
        } else {
            await pool.query(
                "INSERT INTO app_config (config_key, config_value) VALUES ($1, $2) ON CONFLICT (config_key) DO NOTHING",
                ['currentPlaylistUrl', currentPlaylistUrl]
            );
            console.log('SERVER: currentPlaylistUrl não encontrada no banco, valor padrão usado e talvez inserido:', currentPlaylistUrl);
        }
    } catch (err) {
        console.error('SERVER: Erro ao carregar currentPlaylistUrl do banco:', err);
    }
}

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

pool.connect(async (err) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL', err.stack);
    } else {
        console.log('Conectado ao PostgreSQL com sucesso!');
        await loadAppConfig(); 
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/login', async (req, res) => {
    console.log("LOG SERVER: Rota /login acessada!");
    const { username, password } = req.body;
    console.log("LOG SERVER: Credenciais recebidas para login:", { username });
    try {
        const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const userFromDb = result.rows[0];
            const match = await bcrypt.compare(password, userFromDb.password_hash);
            if (match) {
                res.json({ success: true, username: userFromDb.username });
            } else {
                res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error('SERVER: Erro na rota /login:', err);
        res.status(500).json({ success: false, message: 'Erro no servidor.' });
    }
});

async function getQueueState() {
    let waitingListFromDb = []; let calledPatientInfoFromDb = null;
    console.log('SERVER (getQueueState): Buscando estado da fila...');
    try {
        const waitingResult = await pool.query(
            "SELECT id, name, priority, added_by_username, status, created_at FROM patients WHERE status = 'waiting' OR status = 'called' ORDER BY priority DESC, created_at ASC"
        );
        waitingListFromDb = waitingResult.rows.map(p => ({ 
            id: String(p.id), name: p.name, priority: p.priority,
            addedBy: p.added_by_username, status: p.status
        }));
        const calledResult = await pool.query(
            "SELECT id, name, added_by_username FROM patients WHERE status = 'called' ORDER BY called_at DESC LIMIT 1"
        );
        if (calledResult.rows.length > 0) {
            const cd = calledResult.rows[0];
            calledPatientInfoFromDb = { name: cd.name, calledBy: cd.added_by_username, patientId: String(cd.id) };
        }
    } catch (err) { console.error("SERVER (getQueueState): Erro ao buscar fila:", err); }
    console.log('SERVER (getQueueState): Estado retornado:', { itemCount: waitingListFromDb.length, called: !!calledPatientInfoFromDb });
    return { waitingList: waitingListFromDb, calledPatientInfo: calledPatientInfoFromDb };
}

io.on('connection', async (socket) => {
    console.log('SERVER: Novo usuário conectado:', socket.id);
    const queueState = await getQueueState();
    socket.emit('initialData', { 
        waitingList: queueState.waitingList, 
        calledPatientInfo: queueState.calledPatientInfo, 
        currentPlaylistUrl
    });

    socket.on('addPatient', async (patientData) => {
        console.log('SERVER (addPatient): Recebeu:', patientData);
        const patientId = Date.now(); 
        try {
            await pool.query(
                "INSERT INTO patients (id, name, priority, added_by_username, status, created_at) VALUES ($1, $2, $3, $4, 'waiting', NOW())",
                [patientId, patientData.name, patientData.priority || false, patientData.addedBy]
            );
            const updatedQueueState = await getQueueState();
            io.emit('updateWaitingList', updatedQueueState.waitingList); 
        } catch (err) { console.error("SERVER (addPatient): Erro BD:", err); socket.emit('addPatientError', { message: 'Erro BD.'});}
    });

    socket.on('callPatient', async (data) => {
        console.log(`SERVER (callPatient): Recebeu:`, data);
        try {
            let pRes = await pool.query(
                "SELECT id, name, added_by_username FROM patients WHERE id = $1 AND added_by_username = $2 AND status = 'waiting'",
                [BigInt(data.patientId), data.calledBy]
            );
            if (pRes && pRes.rows.length > 0) {
                const pToCall = pRes.rows[0];
                const uRes = await pool.query(
                    "UPDATE patients SET status = 'called', called_at = NOW() WHERE id = $1 RETURNING id, name, added_by_username",
                    [pToCall.id]
                );
                if (uRes.rowCount > 0) {
                    const cP = uRes.rows[0];
                    const cPPayload = { name: cP.name, calledBy: cP.added_by_username, patientId: String(cP.id) };
                    const uQS = await getQueueState();
                    io.emit('patientCalled', cPPayload);
                    io.emit('updateWaitingList', uQS.waitingList);
                } else { socket.emit('callError', { message: 'Update falhou.' }); }
            } else { socket.emit('callError', { message: 'Paciente não elegível.' }); }
        } catch (err) { console.error("SERVER (callPatient): Erro:", err); socket.emit('callError', { message: 'Erro servidor.'});}
    });

    socket.on('confirmPatientEntry', async (data) => {
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
        } catch (err) { console.error("SERVER (confirmPatientEntry): Erro:", err); socket.emit('confirmationError', { message: 'Erro BD.'});}
    });

    socket.on('cancelCall', async (data) => {
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
        } catch (err) { console.error("SERVER (cancelCall): Erro:", err); socket.emit('cancelError', { message: 'Erro BD.'});}
    });
    
    socket.on('adminAddUser', async (data) => {
        console.log('SERVER (adminAddUser): Recebeu:', data.adminUsername, data.usernameToAdd);
        try {
            const adminUserResult = await pool.query('SELECT password_hash FROM users WHERE username = $1', [data.adminUsername]);
            let isAdminAuthorized = false;
            if (adminUserResult.rows.length > 0 && data.adminUsername === 'Admin') { // Garante que é o usuário 'Admin'
                const adminPasswordInDb = adminUserResult.rows[0].password_hash;
                // Assume que a senha do admin no formulário para esta ação é 'admin'
                isAdminAuthorized = await bcrypt.compare('admin', adminPasswordInDb);
            }
            if (isAdminAuthorized) {
                if (!data.usernameToAdd || !data.passwordForNewUser) {
                    socket.emit('adminAddUserResponse', { success: false, message: 'Dados faltando.' }); return;
                }
                const trimmedUsernameToAdd = data.usernameToAdd.trim();
                const existingUserResult = await pool.query('SELECT id FROM users WHERE username = $1', [trimmedUsernameToAdd]);
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
        } catch (err) { console.error('SERVER (adminAddUser): Erro:', err); socket.emit('adminAddUserResponse', { success: false, message: 'Erro servidor.' });}
    });

    // NOVO HANDLER PARA ADMIN LISTAR USUÁRIOS
    socket.on('adminRequestUserList', async (data) => {
        console.log('SERVER (adminRequestUserList): Solicitado por:', data.adminUsername);
        try {
            const adminUserResult = await pool.query('SELECT password_hash FROM users WHERE username = $1', [data.adminUsername]);
            let isAdminAuthorized = false;
            if (data.adminUsername === 'Admin' && adminUserResult.rows.length > 0) {
                 // Assume que a senha do admin no formulário para esta ação é 'admin'
                isAdminAuthorized = await bcrypt.compare('admin', adminUserResult.rows[0].password_hash);
            }

            if (isAdminAuthorized) {
                const usersResult = await pool.query('SELECT id, username, created_at FROM users ORDER BY username ASC');
                socket.emit('adminUserListResponse', { success: true, users: usersResult.rows });
            } else {
                socket.emit('adminUserListResponse', { success: false, message: 'Ação não autorizada.' });
            }
        } catch (err) {
            console.error('SERVER: Erro no evento adminRequestUserList:', err);
            socket.emit('adminUserListResponse', { success: false, message: 'Erro no servidor ao listar usuários.' });
        }
    });
    
    socket.on('updatePlaylist', async (playlistUrlFromClient) => {
        console.log('SERVER (updatePlaylist): Recebeu URL:', playlistUrlFromClient);
        if (playlistUrlFromClient && (playlistUrlFromClient.includes("youtube.com/embed/") || playlistUrlFromClient.includes("https://www.youtube.com/embed/videoseries?list=SUALISTADEVIDEOS"))) {
            const success = await saveAppConfig('currentPlaylistUrl', playlistUrlFromClient);
            if (success) {
                currentPlaylistUrl = playlistUrlFromClient; 
                io.emit('playlistUpdated', currentPlaylistUrl);
                socket.emit('playlistUpdateSuccess', { message: 'Playlist atualizada!', url: currentPlaylistUrl });
            } else {
                socket.emit('playlistError', { message: 'Erro ao salvar URL no BD.' });
            }
        } else {
            socket.emit('playlistError', { message: 'URL da playlist inválida.' });
        }
    });

    socket.on('disconnect', () => {
        console.log('SERVER: Usuário desconectado:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    // loadAppConfig é chamado no callback do pool.connect
});
