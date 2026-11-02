/* Endereço do projeto Firebase usado na sincronização.
   Estes valores NÃO são segredos: identificam o projeto, como um endereço. Quem protege os dados são
   o login, as regras do Firestore (só a sua conta lê a sua área) e a criptografia com a sua frase-senha.
   Vazio = sincronização desligada. */
'use strict';

const NUVEM_CONFIG = {
  apiKey: 'AIzaSyBH-onqr500kalctpTZ2DrJTu-NWQzmoHU',   // Firebase: Configurações do projeto → Seus apps
  projectId: 'pwa-dash-financeiro',                   // Firebase: Configurações do projeto
  clientId: '975629038047-8u4kqkeg9jh94ku77t1e1fbob08brc83.apps.googleusercontent.com',   // Google Cloud: Credenciais (Web client)
  apis: {
    identidade: 'https://identitytoolkit.googleapis.com',
    token: 'https://securetoken.googleapis.com',
    firestore: 'https://firestore.googleapis.com',
    login: 'https://accounts.google.com/o/oauth2/v2/auth',
  },
};
