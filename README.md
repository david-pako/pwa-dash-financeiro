# Dash financeiro

Painel financeiro pessoal em forma de PWA (Progressive Web App, um site que pode ser
instalado no celular e funciona sem internet).

Ele mostra o saldo, as contas do ciclo de salário, a projeção dos próximos meses e os gastos
do dia a dia.

## Onde ficam os dados

- **Este repositório não tem nenhum dado financeiro.** O código é público e o app abre vazio.
- Os dados ficam **só no navegador do aparelho** de quem usa. Nada é enviado para servidor
  nenhum.
- Os dados entram por **importação de um arquivo JSON** e saem por **exportação** (backup).
- Importar **substitui tudo**. Por isso o app sempre sugere exportar um backup antes.
- O app não carrega scripts nem fontes de outros sites.
- Se houver PIN, ele só esconde a tela. **Ele não criptografa os dados.**

## Decisões do projeto

- Um único usuário. Sem servidor e sem sincronização pela nuvem.
- O formato do JSON segue o "plano" do app anterior, para que os dados possam ser migrados.
- O mês financeiro é o **ciclo de salário**, e não o mês do calendário.
- Lançamentos do dia a dia podem ser adicionados e editados no próprio app.
- O arquivo `exemplo-ficticio.json` é o único JSON permitido no repositório, e só tem dados
  inventados.
