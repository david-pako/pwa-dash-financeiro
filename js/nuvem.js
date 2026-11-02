/* Sincronização entre aparelhos pelo Firebase, com criptografia de ponta a ponta (js/cripto.js).
   - Login: o app leva você à página do Google e volta com um comprovante (id_token); nenhum script do
     Google roda dentro do app. O Firebase troca o comprovante por um acesso à SUA área na nuvem.
   - A nuvem guarda um único documento por conta (cofres/<uid>) com o plano embaralhado.
   - Mudanças dos dois lados são juntadas por mesclarPlanos() (js/dados.js).
   Usa S, render, aviso e perguntar de js/app.js. */
'use strict';

const CHAVE_SESSAO = 'dash.nuvem.sessao';   // login no Firebase (não dá acesso aos dados sem a frase-senha)
const CHAVE_SYNC = 'dash.nuvem.sync';       // {base, pendente, forcar, ultimo}

const N = {
  estado: 'desligada',  // desligada | entrar | frase | pronta
  email: null,
  chave: null, sal: null, it: CRIPTO_ITERACOES,
  temNuvem: null,       // a conta já tem dados na nuvem?
  rodando: null,        // sincronização em andamento (Promise)
  geracao: 0,           // conta as mudanças locais, para não perder uma feita durante o envio
  erro: null,
  timer: null,
};

const nuvemConfigurada = () => !!(NUVEM_CONFIG.apiKey && NUVEM_CONFIG.projectId && NUVEM_CONFIG.clientId);
const urlRetorno = () => new URL('./', location.origin + location.pathname).href;
const lerJson = (k, padrao) => { try{ return JSON.parse(localStorage.getItem(k)) || padrao; }catch(e){ return padrao; } };
const lerSessao = () => lerJson(CHAVE_SESSAO, null);
const lerSync = () => lerJson(CHAVE_SYNC, {base:null, pendente:false, forcar:false, ultimo:null});
const gravarSync = mudanca => localStorage.setItem(CHAVE_SYNC, JSON.stringify({...lerSync(), ...mudanca}));
const b64url = bytes => paraB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------------------------------------------------------------- conversa com o Google e o Firebase */
async function pedir(url, opcoes = {}){
  let r;
  try{ r = await fetch(url, opcoes); }
  catch(e){ throw Object.assign(new Error('Sem internet: não deu para falar com a nuvem.'), {semRede:true}); }
  const corpo = await r.json().catch(() => ({}));
  if(!r.ok){
    const msg = (corpo.error && (corpo.error.message || corpo.error.status)) || ('erro ' + r.status);
    throw Object.assign(new Error('A nuvem recusou: ' + msg), {status:r.status, codigo:msg});
  }
  return corpo;
}

function entrarComGoogle(){
  const estado = b64url(bytesAleatorios(16)), nonce = b64url(bytesAleatorios(16));
  sessionStorage.setItem('dash.nuvem.login', JSON.stringify({estado, nonce}));
  location.assign(NUVEM_CONFIG.apis.login + '?' + new URLSearchParams({
    client_id: NUVEM_CONFIG.clientId, redirect_uri: urlRetorno(), response_type: 'id_token',
    scope: 'openid email', nonce, state: estado, prompt: 'select_account',
  }));
}

// Na volta do Google, o comprovante vem depois do "#" no endereço.
async function voltaDoLogin(){
  const h = new URLSearchParams(location.hash.slice(1));
  if(!h.has('id_token') && !h.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.search);   // tira o comprovante do endereço
  let esperado = null;
  try{ esperado = JSON.parse(sessionStorage.getItem('dash.nuvem.login')); }catch(e){}
  sessionStorage.removeItem('dash.nuvem.login');
  if(h.has('error')) throw new Error('O Google não concluiu o login (' + h.get('error') + ').');
  if(!esperado || h.get('state') !== esperado.estado) throw new Error('Login recusado: a resposta não veio deste aparelho.');
  const idToken = h.get('id_token');
  let dados;
  try{ dados = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }catch(e){ dados = {}; }
  if(dados.nonce !== esperado.nonce) throw new Error('Login recusado: comprovante inválido.');
  const r = await pedir(NUVEM_CONFIG.apis.identidade + '/v1/accounts:signInWithIdp?key=' + NUVEM_CONFIG.apiKey, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({requestUri: urlRetorno(), postBody: new URLSearchParams({id_token: idToken, providerId: 'google.com'}).toString(),
      returnSecureToken: true}),
  });
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify({uid: r.localId, email: r.email, refresh: r.refreshToken,
    token: r.idToken, expira: Date.now() + (Number(r.expiresIn) - 60) * 1000}));
  return true;
}

// O acesso do Firebase vence a cada hora; o "refresh" pede outro sem precisar entrar de novo.
async function tokenAtual(){
  const s = lerSessao();
  if(!s) throw new Error('Entre com o Google primeiro.');
  if(s.expira > Date.now()) return s;
  let r;
  try{
    r = await pedir(NUVEM_CONFIG.apis.token + '/v1/token?key=' + NUVEM_CONFIG.apiKey, {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: s.refresh}).toString(),
    });
  }catch(e){
    if(e.status === 400 || e.status === 401){ localStorage.removeItem(CHAVE_SESSAO); N.estado = 'entrar'; }
    throw e;
  }
  const nova = {...s, token: r.id_token, refresh: r.refresh_token, expira: Date.now() + (Number(r.expires_in) - 60) * 1000};
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(nova));
  return nova;
}

const urlDoc = uid => NUVEM_CONFIG.apis.firestore + '/v1/projects/' + NUVEM_CONFIG.projectId +
  '/databases/(default)/documents/cofres/' + encodeURIComponent(uid);

// Devolve {updateTime, sal, it, iv, cifra} ou null se a conta ainda não tem nada na nuvem.
async function lerNuvem(){
  const s = await tokenAtual();
  try{
    const d = await pedir(urlDoc(s.uid), {headers: {Authorization: 'Bearer ' + s.token}});
    const f = d.fields || {};
    return {updateTime: d.updateTime, sal: f.sal.stringValue, it: Number(f.it.integerValue),
            iv: f.iv.stringValue, cifra: f.cifra.stringValue};
  }catch(e){
    if(e.status === 404) return null;
    throw e;
  }
}

// Grava só se a nuvem ainda estiver como da última vez (base). Se outro aparelho gravou antes, dá conflito.
async function gravarNuvem(plano, base){
  const s = await tokenAtual();
  const {iv, cifra} = await cifrar(N.chave, JSON.stringify(plano));
  const cond = base ? 'currentDocument.updateTime=' + encodeURIComponent(base) : 'currentDocument.exists=false';
  try{
    const d = await pedir(urlDoc(s.uid) + '?' + cond, {
      method: 'PATCH', headers: {Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json'},
      body: JSON.stringify({fields: {v: {integerValue: '1'}, sal: {stringValue: N.sal}, it: {integerValue: String(N.it)},
        iv: {stringValue: iv}, cifra: {stringValue: cifra}, em: {stringValue: new Date().toISOString()}}}),
    });
    return d.updateTime;
  }catch(e){
    if(e.status === 400 || e.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(e.codigo || '')) e.conflito = true;
    throw e;
  }
}

async function abrirNuvem(doc){
  const remoto = JSON.parse(await decifrar(N.chave, doc));
  const erros = validarPlano(remoto);
  if(erros.length) throw new Error('Os dados da nuvem têm um problema: ' + erros[0]);
  return normalizar(remoto);
}

/* ---------------------------------------------------------------- sincronizar */
function aplicarLocal(plano, updateTime, msg){
  const mudou = !S.plano || JSON.stringify(S.plano) !== JSON.stringify(plano);
  guardarPlano(plano);
  S.plano = plano;
  S.erroDados = null;
  gravarSync({base: updateTime, ultimo: new Date().toISOString()});
  if(mudou && msg) aviso(msg);
}

async function enviar(plano, base){
  const geracao = N.geracao;
  const updateTime = await gravarNuvem(plano, base);
  // se você mudou algo enquanto enviava, continua pendente e envia de novo em seguida
  const mudouNoMeio = geracao !== N.geracao;
  gravarSync({base: updateTime, pendente: mudouNoMeio, forcar: false, ultimo: new Date().toISOString()});
  if(mudouNoMeio) agendarSincronia();
}

function sincronizar(){
  if(N.estado !== 'pronta') return Promise.resolve();
  if(N.rodando) return N.rodando;
  N.rodando = (async () => {
    for(let tentativa = 1; ; tentativa++){
      try{
        await umaSincronia();
        N.erro = null;
        return;
      }catch(e){
        if(e.conflito && tentativa < 4) continue;   // outro aparelho gravou no meio: lê de novo e junta
        N.erro = e.semRede ? 'Sem internet. Sincroniza quando a conexão voltar.' : e.message;
        return;
      }
    }
  })().finally(() => { N.rodando = null; if(S.aba === 'dados' && !$('#modal').open) render(); else pintarStatus(); });
  return N.rodando;
}

async function umaSincronia(){
  const sync = lerSync(), geracao = N.geracao;
  const doc = await lerNuvem();
  if(!doc){ if(S.plano) await enviar(S.plano, null); return; }
  if(doc.sal !== N.sal){
    // a frase-senha foi trocada em outro aparelho: esta chave não abre mais
    await esquecerChave();
    Object.assign(N, {estado: 'frase', chave: null});
    throw new Error('A frase-senha da nuvem mudou. Digite a nova frase-senha.');
  }
  if(sync.forcar && S.plano){ await enviar(S.plano, doc.updateTime); return; }   // importação: este aparelho manda
  if(doc.updateTime === sync.base){ if(sync.pendente && S.plano) await enviar(S.plano, doc.updateTime); return; }
  // a nuvem mudou desde a última vez
  const remoto = await abrirNuvem(doc);
  if(geracao !== N.geracao) throw Object.assign(new Error('mudou no meio'), {conflito: true});
  if(!sync.pendente || !S.plano){
    aplicarLocal(remoto, doc.updateTime, 'Atualizado com a nuvem ✓');
    if(S.aba !== 'dados' && !$('#modal').open) render();
    return;
  }
  const junto = mesclarPlanos(S.plano, remoto);
  aplicarLocal(junto, doc.updateTime);
  if(!$('#modal').open) render();
  await enviar(junto, doc.updateTime);
}

// Chamado por app.js depois de cada mudança. forcar = importação/desfazer: este aparelho vira a verdade.
function nuvemMudou(forcar){
  if(!nuvemConfigurada() || !lerSessao()) return;
  N.geracao++;
  gravarSync(forcar ? {pendente: true, forcar: true} : {pendente: true});
  agendarSincronia();
}
function agendarSincronia(ms = 1500){
  clearTimeout(N.timer);
  N.timer = setTimeout(sincronizar, ms);
}

/* ---------------------------------------------------------------- frase-senha */
async function pedirFrase(){
  N.erro = null;
  const doc = await lerNuvem();
  N.temNuvem = !!doc;
  if(!doc){
    const r = await perguntar({rot:'Criptografia', titulo:'Crie sua frase-senha',
      texto:'Ela embaralha seus dados antes de irem para a nuvem e <b>nunca sai deste aparelho</b>. ' +
        'Use uma frase longa (ex.: quatro palavras soltas) e guarde num lugar seguro. <b>Se esquecer, ninguém recupera a cópia da nuvem</b> ' +
        '(os dados nos aparelhos e nos backups continuam).',
      campos:[{tipo:'senha', id:'f1', rotulo:'Frase-senha (pelo menos 12 caracteres)'}, {tipo:'senha', id:'f2', rotulo:'Repita a frase-senha'}],
      ok:'Criar'});
    if(!r) return;
    if(r.f1.length < 12){ aviso('Use pelo menos 12 caracteres.', true); return; }
    if(r.f1 !== r.f2){ aviso('As duas frases não são iguais.', true); return; }
    const sal = bytesAleatorios(16);
    N.chave = await derivarChave(r.f1, sal); N.sal = paraB64(sal); N.it = CRIPTO_ITERACOES;
    await guardarChave(N.chave, N.sal);
    N.estado = 'pronta';
    gravarSync({base: null, pendente: !!S.plano, forcar: false});
    render();
    await sincronizar();
    if(!N.erro) aviso('Sincronização ligada ✓');
    return;
  }
  const r = await perguntar({rot:'Criptografia', titulo:'Digite sua frase-senha',
    texto:'A mesma que você criou no primeiro aparelho. Ela fica guardada aqui para não precisar digitar de novo.',
    campos:[{tipo:'senha', id:'f', rotulo:'Frase-senha'}], ok:'Abrir'});
  if(!r) return;
  const chave = await derivarChave(r.f, deB64(doc.sal), doc.it);
  let remoto;
  try{ N.chave = chave; remoto = await abrirNuvem(doc); }
  catch(e){ N.chave = null; aviso(e.message, true); return; }
  N.sal = doc.sal; N.it = doc.it;
  await guardarChave(chave, doc.sal);
  N.estado = 'pronta';
  await primeiraConexao(remoto, doc.updateTime);
}

// Primeira vez neste aparelho: se ele e a nuvem têm dados diferentes, você decide. Nada é misturado sozinho.
async function primeiraConexao(remoto, updateTime){
  const local = S.plano;
  if(!local || JSON.stringify(local) === JSON.stringify(remoto)){
    if(local) gravarSync({base: updateTime, pendente: false, forcar: false});
    else aplicarLocal(remoto, updateTime);
    render();
    aviso('Sincronização ligada ✓');
    return;
  }
  const r = await perguntar({rot:'Primeira sincronização', titulo:'Este aparelho e a nuvem têm dados diferentes',
    texto:'<b>Nuvem:</b><br>' + resumoDoPlano(remoto) + '<br><br><b>Este aparelho:</b><br>' + resumoDoPlano(local) +
      '<br><br>Os dados que forem substituídos ficam guardados em "Desfazer última importação".',
    botoes:[
      {valor:'cancelar', rotulo:'Decidir depois', classe:'fantasma'},
      {valor:'juntar', rotulo:'Juntar os dois', classe:'fantasma'},
      {valor:'enviar', rotulo:'Vale este aparelho', classe:'fantasma'},
      {valor:'nuvem', rotulo:'Vale a nuvem', classe:'cheio'},
    ]});
  if(!r){ N.estado = 'frase'; N.chave = null; await esquecerChave(); render(); return; }
  if(r.botao === 'nuvem'){
    substituirPlano(remoto);
    S.plano = remoto;
    gravarSync({base: updateTime, pendente: false, forcar: false});
  } else if(r.botao === 'enviar'){
    gravarSync({base: updateTime, pendente: true, forcar: true});
  } else {
    const junto = mesclarPlanos(local, remoto);
    substituirPlano(junto);
    S.plano = junto;
    gravarSync({base: updateTime, pendente: true, forcar: false});
  }
  render();
  await sincronizar();
  if(!N.erro) aviso('Sincronização ligada ✓');
}

async function sairDaNuvem(){
  const r = await perguntar({rot:'Sincronização', titulo:'Desligar neste aparelho?',
    texto:'Os dados continuam neste aparelho e na nuvem. Só este aparelho para de sincronizar e esquece a frase-senha.',
    ok:'Desligar'});
  if(!r) return;
  await esquecerChave();
  localStorage.removeItem(CHAVE_SESSAO);
  localStorage.removeItem(CHAVE_SYNC);
  Object.assign(N, {estado: 'entrar', email: null, chave: null, sal: null, erro: null, temNuvem: null});
  render();
  aviso('Sincronização desligada neste aparelho.');
}

/* ---------------------------------------------------------------- início */
async function iniciarNuvem(){
  if(!nuvemConfigurada()) return;
  N.estado = 'entrar';
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') sincronizar(); });
  addEventListener('online', () => sincronizar());
  try{
    if(await voltaDoLogin() && S.aba !== 'dados') irAba('dados');
  }catch(e){ N.erro = e.message; render(); return; }
  const s = lerSessao();
  if(!s){ render(); return; }
  N.email = s.email;
  const guardada = await lerChave().catch(() => null);
  if(!guardada){ N.estado = 'frase'; render(); return; }
  N.chave = guardada.chave; N.sal = guardada.sal;
  N.estado = 'pronta';
  render();
  await sincronizar();
}
