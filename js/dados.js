/* Camada de dados: o plano inteiro (com os lançamentos) fica no localStorage deste aparelho.
   Nada sai daqui sem você mandar: exportar gera um arquivo, importar substitui tudo.
   Toda mudança é feita numa cópia; se não der para salvar, o plano de antes continua valendo. */
'use strict';

const CHAVE_PLANO = 'dash.plano';
const CHAVE_ANTERIOR = 'dash.plano.anterior';   // o que havia antes da última importação
const CHAVE_BACKUP = 'dash.ultimo-backup';      // quando foi o último "exportar"
const LIMITE_ARQUIVO = 2 * 1024 * 1024;         // um plano de verdade tem poucos KB

const arred = n => Math.round(n * 100) / 100;
const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

/* ---------------------------------------------------------------- validação */
const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehNum = v => typeof v === 'number' && Number.isFinite(v);
const ehTexto = v => typeof v === 'string' && v.trim() !== '';
const ehDia = v => Number.isInteger(v) && v >= 1 && v <= 31;
const ehMes = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const ehChaveCiclo = k => /^\d{4}-(0[1-9]|1[0-2])\|.+$/.test(k);
function ehData(v){
  if(typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00');
  return !isNaN(d) && iso(d) === v;   // recusa 2026-02-31
}

// Devolve a lista de problemas (vazia = plano ok). As mensagens dizem onde está o erro.
function validarPlano(p){
  const erros = [];
  const erro = (onde, msg) => erros.push(onde + ': ' + msg);
  if(!ehObjeto(p)) return ['O arquivo não tem um plano (esperava um objeto { ... }).'];

  if(!ehObjeto(p.saldo) || !ehNum(p.saldo.valor)) erro('saldo.valor', 'precisa ser um número');
  else if(p.saldo.conferido_em != null && !ehData(p.saldo.conferido_em)) erro('saldo.conferido_em', 'precisa ser uma data AAAA-MM-DD');

  if(!ehObjeto(p.salario)) erro('salario', 'está faltando');
  else {
    if(!ehNum(p.salario.valor) || p.salario.valor < 0) erro('salario.valor', 'precisa ser um número maior ou igual a zero');
    if(!ehDia(p.salario.dia)) erro('salario.dia', 'precisa ser um dia de 1 a 31');
  }
  if(!ehObjeto(p.dizimo)) erro('dizimo', 'está faltando');
  else {
    if(!ehNum(p.dizimo.pct) || p.dizimo.pct < 0 || p.dizimo.pct > 100) erro('dizimo.pct', 'precisa ser um percentual de 0 a 100');
    if(!ehDia(p.dizimo.dia)) erro('dizimo.dia', 'precisa ser um dia de 1 a 31');
  }
  if(!ehNum(p.meta_dia_a_dia) || p.meta_dia_a_dia < 0) erro('meta_dia_a_dia', 'precisa ser um número maior ou igual a zero');
  if(p.horizonte_meses != null && !(Number.isInteger(p.horizonte_meses) && p.horizonte_meses >= 1 && p.horizonte_meses <= 60))
    erro('horizonte_meses', 'precisa ser um número inteiro de 1 a 60');
  if(p.inicio != null && !ehMes(p.inicio)) erro('inicio', 'precisa ser um mês AAAA-MM');

  // contas, dívidas e cartões: os ids precisam ser únicos, porque "ajustes" e "pagos" usam "AAAA-MM|id"
  const ids = new Set(['salario', 'dizimo']);
  const conferirId = (onde, id) => {
    if(!ehTexto(id) || id.includes('|')) return erro(onde + '.id', 'precisa ser um texto sem "|"');
    if(ids.has(id)) return erro(onde + '.id', '"' + id + '" está repetido');
    ids.add(id);
  };
  const lista = (nome, conferir) => {
    if(!Array.isArray(p[nome])) return erro(nome, 'precisa ser uma lista [ ... ]');
    p[nome].forEach((x, n) => {
      const onde = nome + ' nº ' + (n + 1);
      if(!ehObjeto(x)) return erro(onde, 'precisa ser um objeto { ... }');
      conferirId(onde, x.id);
      if(!ehTexto(x.nome)) erro(onde + '.nome', 'precisa ser um texto');
      conferir(x, onde);
    });
  };
  lista('contas', (c, onde) => {
    if(!ehNum(c.valor) || c.valor < 0) erro(onde + '.valor', 'precisa ser um número maior ou igual a zero');
    if(c.dia != null && !ehDia(c.dia)) erro(onde + '.dia', 'precisa ser um dia de 1 a 31 (ou null)');
    if(c.casa != null && typeof c.casa !== 'boolean') erro(onde + '.casa', 'precisa ser true ou false');
    if(c.nota != null && typeof c.nota !== 'string') erro(onde + '.nota', 'precisa ser um texto');
  });
  lista('dividas', (d, onde) => {
    if(!ehNum(d.parcela) || d.parcela < 0) erro(onde + '.parcela', 'precisa ser um número maior ou igual a zero');
    if(!ehDia(d.dia)) erro(onde + '.dia', 'precisa ser um dia de 1 a 31');
    if(!ehMes(d.ate)) erro(onde + '.ate', 'precisa ser um mês AAAA-MM');
  });
  lista('cartoes', (c, onde) => {
    if(!ehDia(c.vence)) erro(onde + '.vence', 'precisa ser um dia de 1 a 31');
    if(c.fecha != null && !ehDia(c.fecha)) erro(onde + '.fecha', 'precisa ser um dia de 1 a 31 (ou null)');
    if(c.recebe_dia_a_dia != null && typeof c.recebe_dia_a_dia !== 'boolean') erro(onde + '.recebe_dia_a_dia', 'precisa ser true ou false');
    if(c.faturas == null) return;
    if(!ehObjeto(c.faturas)) return erro(onde + '.faturas', 'precisa ser um objeto { "AAAA-MM": {...} }');
    for(const [k, f] of Object.entries(c.faturas)){
      if(!ehMes(k)) erro(onde + '.faturas', '"' + k + '" não é um mês AAAA-MM');
      else if(!ehObjeto(f) || !ehNum(f.v) || f.v < 0) erro(onde + '.faturas.' + k + '.v', 'precisa ser um número maior ou igual a zero');
      else if(f.final != null && typeof f.final !== 'boolean') erro(onde + '.faturas.' + k + '.final', 'precisa ser true ou false');
    }
  });

  if(p.ajustes != null){
    if(!ehObjeto(p.ajustes)) erro('ajustes', 'precisa ser um objeto { "AAAA-MM|id": valor }');
    else for(const [k, v] of Object.entries(p.ajustes)){
      if(!ehChaveCiclo(k)) erro('ajustes', '"' + k + '" não segue o formato AAAA-MM|id');
      else if(!ehNum(v)) erro('ajustes.' + k, 'precisa ser um número');
    }
  }
  if(p.pagos != null){
    if(!ehObjeto(p.pagos)) erro('pagos', 'precisa ser um objeto { "AAAA-MM|id": true }');
    else for(const [k, v] of Object.entries(p.pagos)){
      if(!ehChaveCiclo(k)) erro('pagos', '"' + k + '" não segue o formato AAAA-MM|id');
      else if(typeof v !== 'boolean') erro('pagos.' + k, 'precisa ser true ou false');
    }
  }

  if(p.lancamentos != null){
    if(!Array.isArray(p.lancamentos)) erro('lancamentos', 'precisa ser uma lista [ ... ]');
    else {
      const vistos = new Set();
      p.lancamentos.forEach((l, n) => {
        const onde = 'lancamentos nº ' + (n + 1);
        if(!ehObjeto(l)) return erro(onde, 'precisa ser um objeto { ... }');
        if(!ehTexto(l.id)) erro(onde + '.id', 'precisa ser um texto');
        else if(vistos.has(l.id)) erro(onde + '.id', '"' + l.id + '" está repetido');
        else vistos.add(l.id);
        const e = erroLancamento(l);
        if(e) erro(onde, e);
      });
    }
  }
  return erros;
}

function erroLancamento(l){
  if(!ehNum(l.valor) || l.valor <= 0) return 'o valor precisa ser maior que zero';
  if(!ehData(l.data)) return 'a data precisa ser AAAA-MM-DD';
  if(l.descricao != null && typeof l.descricao !== 'string') return 'a descrição precisa ser um texto';
  return null;
}

// Cópia do plano com os campos opcionais preenchidos. Campos que o app não usa (ex.: "missoes")
// são mantidos como vieram, para nada se perder ao exportar de novo.
function normalizar(p){
  const n = structuredClone(p);
  n.ajustes = n.ajustes || {};
  n.pagos = n.pagos || {};
  n.lancamentos = n.lancamentos || [];
  n.horizonte_meses = n.horizonte_meses || 12;
  for(const c of n.cartoes) c.faturas = c.faturas || {};
  return n;
}

/* ---------------------------------------------------------------- guardar e ler */
// Devolve {plano} (plano pode ser null = app vazio) ou {erro, bruto} se o que está guardado tem problema.
function lerPlanoGuardado(){
  let txt;
  try{ txt = localStorage.getItem(CHAVE_PLANO); }
  catch(e){ return {erro: 'Este navegador não deixou ler os dados guardados.'}; }
  if(!txt) return {plano: null};
  let p;
  try{ p = JSON.parse(txt); }
  catch(e){ return {erro: 'Os dados guardados neste aparelho estão corrompidos.', bruto: txt}; }
  const erros = validarPlano(p);
  if(erros.length) return {erro: 'Os dados guardados têm um problema: ' + erros[0], bruto: txt};
  return {plano: normalizar(p)};
}

// Lança erro se não couber (localStorage cheio) ou se o navegador bloquear.
function guardarPlano(p){
  localStorage.setItem(CHAVE_PLANO, JSON.stringify(p));
}

// Aplica uma mudança numa cópia e só troca o plano se conseguir salvar.
function alterarPlano(atual, mudar){
  const novo = structuredClone(atual);
  mudar(novo);
  const erros = validarPlano(novo);
  if(erros.length) throw new Error('Mudança inválida: ' + erros[0]);
  guardarPlano(novo);
  return novo;
}

/* ---------------------------------------------------------------- importar e exportar */
function planoDoTexto(txt){
  let p;
  try{ p = JSON.parse(String(txt).replace(/^﻿/, '')); }
  catch(e){ return {erros: ['Não é um JSON válido (o arquivo pode estar cortado ou ser de outro tipo).']}; }
  const erros = validarPlano(p);
  return erros.length ? {erros} : {plano: normalizar(p)};
}

function lerArquivo(arquivo){
  if(arquivo.size > LIMITE_ARQUIVO) return Promise.reject(new Error('Arquivo grande demais para ser um plano.'));
  return arquivo.text();
}

// Substitui tudo, mas guarda o plano de antes para poder desfazer.
function substituirPlano(novo){
  const atual = localStorage.getItem(CHAVE_PLANO);
  if(atual) localStorage.setItem(CHAVE_ANTERIOR, atual);
  guardarPlano(novo);
}

const temAnterior = () => { try{ return !!localStorage.getItem(CHAVE_ANTERIOR); }catch(e){ return false; } };

// Troca o plano atual pelo de antes da última importação (e vice-versa: dá para desfazer o desfazer).
function trocarPeloAnterior(){
  const anterior = localStorage.getItem(CHAVE_ANTERIOR);
  if(!anterior) throw new Error('Não há dados anteriores guardados.');
  const r = planoDoTexto(anterior);
  if(!r.plano) throw new Error('Os dados anteriores têm um problema: ' + r.erros[0]);
  const atual = localStorage.getItem(CHAVE_PLANO);
  guardarPlano(r.plano);
  if(atual) localStorage.setItem(CHAVE_ANTERIOR, atual);
  else localStorage.removeItem(CHAVE_ANTERIOR);
  return r.plano;
}

const textoDoPlano = p => JSON.stringify(p, null, 1);
const nomeDoBackup = () => 'dash-financeiro-backup-' + iso(new Date()) + '.json';

function baixarArquivo(nome, texto){
  const url = URL.createObjectURL(new Blob([texto], {type: 'application/json'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function marcarBackup(){
  try{ localStorage.setItem(CHAVE_BACKUP, new Date().toISOString()); }catch(e){}
}
function ultimoBackup(){
  try{ const t = localStorage.getItem(CHAVE_BACKUP); return t ? new Date(t) : null; }catch(e){ return null; }
}

// Pede ao navegador para não apagar os dados sozinho quando faltar espaço.
// Devolve true (protegido), false (não protegido) ou null (navegador não suporta).
async function pedirPersistencia(){
  if(!(navigator.storage && navigator.storage.persist)) return null;
  try{ return (await navigator.storage.persisted()) || (await navigator.storage.persist()); }
  catch(e){ return null; }
}

/* ---------------------------------------------------------------- lançamentos do dia a dia */
function novoId(){
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function limparLancamento({valor, descricao, data}){
  const l = {valor: arred(valor), descricao: String(descricao ?? '').trim().slice(0, 80), data};
  const e = erroLancamento(l);
  if(e) throw new Error(e.replace(/^./, c => c.toUpperCase()) + '.');
  return l;
}

// As três funções abaixo mexem no plano que recebem: use dentro de alterarPlano().
function adicionarLancamento(p, dados){
  const item = {id: novoId(), ...limparLancamento(dados), criado_em: new Date().toISOString()};
  p.lancamentos.push(item);
  return item;
}
function editarLancamento(p, id, dados){
  const l = p.lancamentos.find(x => x.id === id);
  if(!l) throw new Error('Esse lançamento não existe mais.');
  Object.assign(l, limparLancamento(dados));
  return l;
}
function apagarLancamento(p, id){
  const n = p.lancamentos.findIndex(x => x.id === id);
  if(n < 0) throw new Error('Esse lançamento não existe mais.');
  return p.lancamentos.splice(n, 1)[0];
}
