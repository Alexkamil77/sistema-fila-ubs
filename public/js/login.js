// public/js/login.js
document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginButton = document.getElementById('loginButton');
    const loginMessage = document.getElementById('loginMessage');

    loginButton.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        loginMessage.textContent = ''; // Limpa mensagens anteriores

        if (!username || !password) {
            loginMessage.textContent = 'Por favor, preencha usuário e senha.';
            return;
        }

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Armazenar o nome de usuário para usar no painel
                localStorage.setItem('loggedInUser', data.username);
                window.location.href = '/painel.html'; // Redireciona para o painel
            } else {
                loginMessage.textContent = data.message || 'Falha no login.';
            }
        } catch (error) {
            console.error('Erro ao tentar fazer login:', error);
            loginMessage.textContent = 'Erro de conexão com o servidor.';
        }
    });

    // Permitir login com Enter nos campos de input
    passwordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            loginButton.click(); // Simula o clique no botão de login
        }
    });

    usernameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            loginButton.click(); // Simula o clique no botão de login
        }
    });
});