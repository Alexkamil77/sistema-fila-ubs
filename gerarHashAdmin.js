// gerarHashAdmin.js
const bcrypt = require('bcryptjs'); // Certifique-se de que está usando bcryptjs
const saltRounds = 10;
const plainPassword = 'admin'; // A senha que você quer para o Admin

bcrypt.hash(plainPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error("Erro ao gerar hash:", err);
        return;
    }
    console.log(`\nPara a senha em texto plano: '${plainPassword}'`);
    console.log(`O hash Bcryptjs gerado é: ${hash}`);
    console.log("\nExecute o seguinte comando SQL no seu banco de dados PostgreSQL no Render (via psql):");
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE username = 'Admin';`);
});