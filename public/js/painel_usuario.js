// public/js/painel_usuario.js
document.addEventListener('DOMContentLoaded', () => {
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        window.location.href = '/';
        return;
    }

    const userInfoDisplay = document.getElementById('user-info');
    if(userInfoDisplay) userInfoDisplay.textContent = `Usuário: ${loggedInUser}`;

    const socket = io();

    const patientNameInput = document.getElementById('patientName');
    const priorityCheckbox = document.getElementById('priority');
    const addPatientButton = document.getElementById('addPatientButton');
    const myPatientListElement = document.getElementById('myPatientList');
    const noMyPatientsMessage = document.getElementById('noMyPatientsMessage');

    const playlistUrlInput = document.getElementById('playlistUrl');
    const updatePlaylistButton = document.getElementById('updatePlaylistButton');
    const playlistMessage = document.getElementById('playlistMessage');
    const logoutButton = document.getElementById('logoutButton');

    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            localStorage.removeItem('loggedInUser');
            window.location.href = '/';
        });
    }

    if (addPatientButton && patientNameInput && priorityCheckbox) {
        addPatientButton.addEventListener('click', () => {
            const name = patientNameInput.value.trim();
            const priority = priorityCheckbox.checked;
            if (name) {
                console.log('PAINEL_USUARIO: Emitindo addPatient:', { name, priority, addedBy: loggedInUser });
                socket.emit('addPatient', { name, priority, addedBy: loggedInUser });
                patientNameInput.value = '';
                priorityCheckbox.checked = false;
            } else {
                alert('Por favor, insira o nome do paciente.');
            }
        });
    }

    if (updatePlaylistButton && playlistUrlInput) {
        updatePlaylistButton.addEventListener('click', () => {
            const url = playlistUrlInput.value.trim();
            if (url) {
                socket.emit('updatePlaylist', url);
            } else {
                alert('Por favor, insira a URL da playlist.');
            }
        });
    }

    function renderMyPatientList(waitingList) {
        if (!myPatientListElement) return;
        myPatientListElement.innerHTML = ''; 
        let foundMyPatients = false;

        if (!Array.isArray(waitingList)) {
            console.error("PAINEL_USUARIO: renderMyPatientList recebeu algo que não é uma lista:", waitingList);
            if(noMyPatientsMessage) noMyPatientsMessage.style.display = 'block';
            return;
        }

        waitingList.forEach(patient => {
            // A função getQueueState no servidor agora mapeia added_by_username para addedBy
            if (patient.addedBy === loggedInUser) { 
                foundMyPatients = true;
                const listItem = document.createElement('li');
                listItem.className = patient.priority ? 'priority' : '';
                listItem.innerHTML = `
                    <span>${patient.name} ${patient.priority ? '(Prioridade)' : ''} - Status: ${translateStatus(patient.status)}</span>
                    <div class="patient-list-controls">
                        ${patient.status === 'waiting' ? `<button class="call-btn" data-id="${patient.id}">Chamar</button>` : ''}
                        ${patient.status === 'called' ? `
                            <button class="confirm-btn" data-id="${patient.id}">Confirmar Entrada</button>
                            <button class="cancel-btn" data-id="${patient.id}">Cancelar Chamada</button>
                        ` : ''}
                    </div>
                `;
                myPatientListElement.appendChild(listItem);
            }
        });

        if(noMyPatientsMessage) noMyPatientsMessage.style.display = foundMyPatients ? 'none' : 'block';

        document.querySelectorAll('.call-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const patientId = e.target.dataset.id;
                console.log(`PAINEL_USUARIO: Clicou em Chamar. ID: ${patientId}, Por: ${loggedInUser}`);
                socket.emit('callPatient', { patientId, calledBy: loggedInUser });
            });
        });
        document.querySelectorAll('.confirm-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const patientId = e.target.dataset.id;
                socket.emit('confirmPatientEntry', { patientId, confirmedBy: loggedInUser });
            });
        });
        document.querySelectorAll('.cancel-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const patientId = e.target.dataset.id;
                socket.emit('cancelCall', { patientId, cancelledBy: loggedInUser });
            });
        });
    }

    function translateStatus(status) {
        switch (status) {
            case 'waiting': return 'Aguardando';
            case 'called': return 'Chamado';
            case 'attended': return 'Atendido';
            default: return status;
        }
    }

    const adminUserManagementSection = document.getElementById('admin-user-management-section');
    if (loggedInUser === 'Admin' && adminUserManagementSection) {
        adminUserManagementSection.style.display = 'block';
        const newUsernameInput = document.getElementById('newUsername');
        const newUserPasswordInput = document.getElementById('newUserPassword');
        const adminAddUserButton = document.getElementById('adminAddUserButton');
        const adminUserMessage = document.getElementById('adminUserMessage');

        if (adminAddUserButton) {
            adminAddUserButton.addEventListener('click', () => {
                // ... (lógica do adminAddUser como antes)
                const usernameToAdd = newUsernameInput.value.trim();
                const passwordForNewUser = newUserPasswordInput.value.trim();
                if(adminUserMessage) adminUserMessage.textContent = '';

                if (!usernameToAdd || !passwordForNewUser) {
                    if(adminUserMessage) {
                        adminUserMessage.textContent = 'Por favor, preencha o nome e a senha do novo usuário.';
                        adminUserMessage.style.color = 'red';
                    }
                    return;
                }
                socket.emit('adminAddUser', {
                    usernameToAdd: usernameToAdd,
                    passwordForNewUser: passwordForNewUser,
                    adminUsername: loggedInUser 
                });
            });
        }
        socket.on('adminAddUserResponse', (response) => {
            if(adminUserMessage) {
                adminUserMessage.textContent = response.message;
                adminUserMessage.style.color = response.success ? 'green' : 'red';
            }
            if (response.success) {
                if(newUsernameInput) newUsernameInput.value = ''; 
            }
        });
    }

    socket.on('initialData', (data) => {
        console.log('PAINEL_USUARIO: Recebeu initialData', data);
        if (data.waitingList) renderMyPatientList(data.waitingList);
        if (data.currentPlaylistUrl && playlistUrlInput) {
            playlistUrlInput.value = data.currentPlaylistUrl;
        }
    });

    socket.on('updateWaitingList', (waitingList) => {
        console.log('PAINEL_USUARIO: Recebeu updateWaitingList do servidor. Lista:', waitingList); // LOG ADICIONADO AQUI
        renderMyPatientList(waitingList);
    });

    socket.on('playlistUpdated', (url) => { 
        if (playlistUrlInput) playlistUrlInput.value = url;
        if (playlistMessage) {
            playlistMessage.textContent = 'Playlist da sala de espera foi atualizada!';
            playlistMessage.style.color = 'blue';
            setTimeout(() => { if(playlistMessage) playlistMessage.textContent = '';}, 3000);
        }
    });
    socket.on('playlistUpdateSuccess', (data) => { 
        if (playlistMessage) {
            playlistMessage.textContent = data.message;
            playlistMessage.style.color = 'green';
        }
        setTimeout(() => { if(playlistMessage) playlistMessage.textContent = '';}, 3000);
    });
    socket.on('addPatientError', (data) => { alert(`Erro ao adicionar paciente: ${data.message}`); });
    socket.on('playlistError', (data) => { alert(`Erro na playlist: ${data.message}`); });
    socket.on('callError', (data) => { alert(`Erro ao chamar: ${data.message}`); });
    socket.on('confirmationError', (data) => { alert(`Erro na confirmação: ${data.message}`); });
    socket.on('cancelError', (data) => { alert(`Erro ao cancelar: ${data.message}`); });
});