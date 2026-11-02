# Dash financeiro

Painel financeiro pessoal em forma de PWA (Progressive Web App, um site que pode ser
instalado no celular e funciona sem internet).

Ele mostra o saldo, as contas do ciclo de salário, a projeção dos próximos meses e os gastos
do dia a dia.

## Onde ficam os dados

- **Este repositório não tem nenhum dado financeiro.** O código é público e o app abre vazio.
- Os dados ficam **no navegador do aparelho** de quem usa.
- Os dados entram por **importação de um arquivo JSON** e saem por **exportação** (backup).
- Importar **substitui tudo**. Por isso o app sempre sugere exportar um backup antes.
- O app não carrega scripts nem fontes de outros sites.

### Sincronização (opcional)

- Liga na tela **Dados**: entrar com Google e criar uma **frase-senha**.
- Antes de sair do aparelho, o plano é **embaralhado com a frase-senha** (AES-GCM, chave tirada da
  frase com PBKDF2). A nuvem (Firestore, do Firebase) só guarda o resultado embaralhado; nem o
  Google consegue ler. **Se a frase-senha for esquecida, a cópia da nuvem não pode ser recuperada**
  (os aparelhos e os backups continuam valendo).
- O login vai à página do Google e volta com um comprovante: nenhum script do Google roda no app.
  As únicas conexões de fora são com os endereços do Firebase.
- As regras de acesso do Firestore estão em `firestore.rules`: cada conta só lê o próprio cofre.
- Os identificadores em `js/nuvem-config.js` não são segredos; sem eles, a sincronização fica
  desligada.

## Decisões do projeto

- Um único usuário. Sem servidor próprio; a sincronização entre aparelhos é opcional e
  criptografada de ponta a ponta.
- O formato do JSON segue o "plano" do app anterior, para que os dados possam ser migrados.
- O mês financeiro é o **ciclo de salário**, e não o mês do calendário.
- Lançamentos do dia a dia podem ser adicionados e editados no próprio app.
- O arquivo `exemplo-ficticio.json` é o único JSON permitido no repositório, e só tem dados
  inventados.
