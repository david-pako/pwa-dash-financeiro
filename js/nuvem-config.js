/* Endereço do projeto Firebase usado na sincronização.
   Estes valores NÃO são segredos: identificam o projeto, como um endereço. Quem protege os dados são
   o login, as regras do Firestore (só a sua conta lê a sua área) e a criptografia com a sua frase-senha.
   Vazio = sincronização desligada. */
'use strict';

const NUVEM_CONFIG = {
  apiKey: '',      // Firebase: Configurações do projeto → Seus apps → apiKey
  projectId: '',   // Firebase: Configurações do projeto → ID do projeto
  clientId: '',    // Google Cloud: APIs e serviços → Credenciais → ID do cliente OAuth (Web client)
  apis: {
    identidade: 'https://identitytoolkit.googleapis.com',
    token: 'https://securetoken.googleapis.com',
    firestore: 'https://firestore.googleapis.com',
    login: 'https://accounts.google.com/o/oauth2/v2/auth',
  },
};
