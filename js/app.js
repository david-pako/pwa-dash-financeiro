/* Dash financeiro: tudo roda no aparelho, sem servidor.
   Este arquivo cuida da tela; guardar, validar, importar e exportar ficam em js/dados.js.
   Botões usam data-acao="..." (a CSP bloqueia onclick="..." no HTML). */
'use strict';

const VERSAO = '0.2.0';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------------------------------------------------------------- formatação */
const fmt2 = n => Math.abs(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const brl  = n => (n < -0.004 ? '−' : '') + 'R$ ' + fmt2(n);
const dm   = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
const dma  = d => dm(d) + '/' + d.getFullYear();
const dataDoIso = s => new Date(s + 'T12:00:00');
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

function lerNumero(txt){
  let s = String(txt ?? '').replace(/R\$|\s/g, '');
  if(!s) return NaN;
  if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Number(s);
}

function haQuantosDias(d){
  const dias = Math.floor((Date.now() - d.getTime()) / 864e5);
  return dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : 'há ' + dias + ' dias';
}

/* ---------------------------------------------------------------- abas e estado */
const ABAS = [
  {id:'resumo',   nome:'Resumo',     olho:'Visão geral'},
  {id:'ciclo',    nome:'Este ciclo', olho:'Ciclo de salário'},
  {id:'projecao', nome:'Projeção',   olho:'Próximos meses'},
  {id:'gastos',   nome:'Gastos',     olho:'Dia a dia'},
  {id:'ajustes',  nome:'Ajustes',    olho:'Plano'},
  {id:'dados',    nome:'Dados',      olho:'Importar e exportar'},
];

const S = {
  aba: 'resumo',
  plano: null,          // o plano em uso (null = app vazio)
  erroDados: null,      // {erro, bruto} se o que está guardado tem problema
  persistente: null,    // true / false / null (não sabemos)
  semOffline: false,
};

/* ---------------------------------------------------------------- avisos e modal */
let avisoTimer = null;
function aviso(msg, erro){
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('erro', !!erro);
  el.classList.add('on');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('on'), erro ? 5000 : 2600);
}

// Abre a janela de diálogo e espera a resposta.
// texto: HTML (use esc() no que vier dos dados). campos: [{tipo:'numero'|'texto'|'data'|'area'|'check', id, rotulo, valor}]
// botoes: [{valor, rotulo, classe}]; o primeiro costuma ser o "Cancelar".
// Devolve {botao, ...valores dos campos} ou null se cancelar / apertar Esc.
function perguntar({rot = '', titulo, texto = '', campos = [], ok = 'Salvar', botoes}){
  botoes = botoes || [{valor:'cancelar', rotulo:'Cancelar', classe:'fantasma'}, {valor:'ok', rotulo:ok, classe:'cheio'}];
  return new Promise(resolve => {
    const dlg = $('#modal'), box = $('#modal-campos');
    $('#modal-rot').textContent = rot;
    $('#modal-t').textContent = titulo;
    $('#modal-txt').innerHTML = texto;
    $('#modal-botoes').innerHTML = botoes.map(b =>
      `<button class="bt ${b.classe || ''}" value="${esc(b.valor)}" type="submit">${esc(b.rotulo)}</button>`).join('');
    box.innerHTML = '';
    for(const c of campos){
      if(c.tipo === 'check'){
        const lab = document.createElement('label'); lab.className = 'check';
        const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!c.valor; inp.dataset.id = c.id;
        lab.append(inp, document.createTextNode(c.rotulo));
        box.append(lab);
      } else {
        if(c.rotulo){ const r = document.createElement('div'); r.className = 'mini'; r.textContent = c.rotulo; box.append(r); }
        const inp = document.createElement(c.tipo === 'area' ? 'textarea' : 'input');
        inp.className = 'campo'; inp.dataset.id = c.id;
        if(c.tipo === 'data') inp.type = 'date';
        if(c.tipo === 'numero'){
          inp.inputMode = 'decimal';
          inp.value = (c.valor === '' || c.valor == null) ? '' : Number(c.valor).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2, useGrouping:false});
        } else inp.value = c.valor ?? '';
        if(c.placeholder) inp.placeholder = c.placeholder;
        box.append(inp);
      }
    }
    dlg.returnValue = '';
    dlg.onclose = () => {
      const botao = dlg.returnValue;
      if(!botao || botao === 'cancelar') return resolve(null);
      const out = {botao};
      for(const c of campos){
        const el = box.querySelector('[data-id="' + c.id + '"]');
        out[c.id] = c.tipo === 'check' ? el.checked : c.tipo === 'numero' ? lerNumero(el.value) : el.value;
      }
      resolve(out);
    };
    dlg.showModal();
    const primeiro = box.querySelector('input:not([type=checkbox]), textarea');
    if(primeiro) setTimeout(() => { primeiro.focus(); if(primeiro.select) primeiro.select(); }, 60);
  });
}

/* ---------------------------------------------------------------- render */
function render(){
  const aba = ABAS.find(a => a.id === S.aba) || ABAS[0];
  $('#olho').textContent = aba.olho;
  $('#titulo').textContent = aba.nome;
  document.title = aba.nome + ' · Dash financeiro';

  $('#abas').innerHTML = ABAS.map(a =>
    `<button class="aba${a.id === aba.id ? ' on' : ''}" data-aba="${a.id}"` +
    `${a.id === aba.id ? ' aria-current="page"' : ''}>${esc(a.nome)}</button>`).join('');
  $('#abas .on').scrollIntoView({block:'nearest', inline:'nearest'});   // aba ativa sempre visível

  $('#conteudo').innerHTML =
    aba.id === 'dados' ? abaDados() :
    !S.plano ? semDados() :
    `<div class="cartao"><div class="rot">${esc(aba.nome)}</div><div class="nada">Tela em construção.</div></div>`;

  $('#status').innerHTML = 'versão ' + VERSAO + ' · dados só neste aparelho' +
    (S.semOffline ? ' · <span class="erro">modo sem internet indisponível</span>' : '');
}

function irAba(id){
  S.aba = id;
  render();
  window.scrollTo({top: 0});
}

function semDados(){
  return `<div class="cartao"><div class="rot">Nenhum dado ainda</div>
    <div class="texto">Este aparelho ainda não tem um plano. Importe um arquivo de backup ou carregue o exemplo fictício para conhecer o app.</div>
    <div class="linha-b" style="margin-top:14px"><button class="bt cheio" data-acao="ir-dados">Ir para Dados</button></div></div>`;
}

/* ---------------------------------------------------------------- tela Dados */
function abaDados(){
  const p = S.plano, bk = ultimoBackup();
  let h = '';

  if(S.erroDados){
    h += `<div class="cartao heroi alerta"><div class="rot">Problema nos dados guardados</div>
      <div class="heroi-sub">${esc(S.erroDados.erro)}<br>Baixe os dados como estão (para não perder nada) e depois importe um backup bom.</div>
      <div class="linha-b" style="margin-top:14px"><button class="bt cheio" data-acao="baixar-bruto">Baixar dados como estão</button></div></div>`;
  }

  if(p){
    const nLanc = p.lancamentos.length;
    const velho = !bk || Date.now() - bk.getTime() > 14 * 864e5;
    h += `<div class="cartao"><div class="rot">Neste aparelho</div>
      <div class="grandes">
        <div class="grande"><div class="mini">Saldo</div><div class="n">${brl(p.saldo.valor)}</div>
          <div class="mini">${p.saldo.conferido_em ? 'conferido em ' + dm(dataDoIso(p.saldo.conferido_em)) : 'sem data de conferência'}</div></div>
        <div class="grande"><div class="mini">Lançamentos</div><div class="n">${nLanc}</div>
          <div class="mini">${nLanc ? 'último em ' + dm(dataDoIso(p.lancamentos.map(l => l.data).sort().pop())) : 'nenhum ainda'}</div></div>
      </div>
      <div class="mini" style="margin-top:12px">${plural(p.contas.length, 'conta fixa', 'contas fixas')} · ${plural(p.dividas.length, 'dívida', 'dívidas')} · ${plural(p.cartoes.length, 'cartão', 'cartões')}</div>
      <div class="legenda"><span>Último backup</span><b class="${velho ? 'neg' : ''}">${bk ? dma(bk) + ' (' + haQuantosDias(bk) + ')' : 'nunca'}</b></div>
      <div class="legenda"><span>Proteção contra limpeza automática</span><b>${S.persistente === true ? 'ativada' : S.persistente === false ? 'não ativada' : 'desconhecida'}</b></div>
    </div>`;

    h += `<div class="cartao"><div class="rot">Backup</div>
      <div class="mini">Gera um arquivo .json com tudo: plano e lançamentos. Guarde num lugar seguro (e privado) fora do celular.</div>
      <div class="linha-b" style="margin-top:12px"><button class="bt cheio" data-acao="exportar">Exportar backup</button></div></div>`;
  }

  h += `<div class="cartao"><div class="rot">Importar</div>
    <div class="mini">${p ? '<b>Substitui tudo</b> o que está neste aparelho pelo conteúdo do arquivo. O app vai sugerir um backup antes.' : 'Escolha um arquivo de backup (.json) para começar.'}</div>
    <div class="linha-b" style="margin-top:12px">
      <button class="bt${p ? '' : ' cheio'}" data-acao="importar">Importar arquivo</button>
      <button class="bt fantasma" data-acao="exemplo">Carregar exemplo fictício</button>
    </div>
    ${temAnterior() ? `<div class="linha-b" style="margin-top:8px"><button class="bt fantasma" data-acao="desfazer">Desfazer última importação</button></div>` : ''}
  </div>`;

  h += `<div class="mini" style="text-align:center;padding:0 8px">Os dados ficam só no navegador deste aparelho. Nada é enviado para servidor nenhum.
    Se você limpar os dados do navegador ou desinstalar o app, eles se perdem: por isso o backup.</div>`;
  return h;
}

function resumoDoPlano(p){
  const datas = p.lancamentos.map(l => l.data).sort();
  return `<b>Saldo:</b> ${brl(p.saldo.valor)}${p.saldo.conferido_em ? ' (conferido em ' + dma(dataDoIso(p.saldo.conferido_em)) + ')' : ''}<br>
    <b>Salário:</b> ${brl(p.salario.valor)} no dia ${p.salario.dia}<br>
    ${plural(p.contas.length, 'conta fixa', 'contas fixas')}, ${plural(p.dividas.length, 'dívida', 'dívidas')}, ${plural(p.cartoes.length, 'cartão', 'cartões')}<br>
    ${plural(p.lancamentos.length, 'lançamento', 'lançamentos')}${datas.length ? ' (de ' + dm(dataDoIso(datas[0])) + ' a ' + dma(dataDoIso(datas[datas.length - 1])) + ')' : ''}`;
}

/* ---------------------------------------------------------------- ações da tela Dados */
function exportar(){
  baixarArquivo(nomeDoBackup(), textoDoPlano(S.plano));
  marcarBackup();
  render();
  aviso('Backup gerado: ' + nomeDoBackup());
}

// Antes de substituir, sugere o backup. Devolve true para seguir em frente.
async function sugerirBackup(oQue){
  if(!S.plano) return true;
  const bk = ultimoBackup();
  const r = await perguntar({
    rot: 'Antes de ' + oQue, titulo: 'Fazer backup primeiro?',
    texto: 'Isso vai <b>substituir tudo</b> o que está neste aparelho. Último backup: <b>' +
      (bk ? dma(bk) + ' (' + haQuantosDias(bk) + ')' : 'nunca') + '</b>.<br>' +
      'Se escolher "Exportar backup", o arquivo é gerado e você continua em seguida.',
    botoes: [
      {valor:'cancelar', rotulo:'Cancelar', classe:'fantasma'},
      {valor:'seguir', rotulo:'Continuar sem backup', classe:'fantasma'},
      {valor:'backup', rotulo:'Exportar backup', classe:'cheio'},
    ],
  });
  if(!r) return false;
  if(r.botao === 'backup') exportar();
  return true;
}

async function confirmarESubstituir(novo, origem){
  const r = await perguntar({
    rot: origem, titulo: S.plano ? 'Substituir tudo por isto?' : 'Carregar estes dados?',
    texto: resumoDoPlano(novo) + (S.plano ? '<br><br>Os dados atuais deste aparelho serão trocados. Dá para voltar com "Desfazer última importação".' : ''),
    botoes: [
      {valor:'cancelar', rotulo:'Cancelar', classe:'fantasma'},
      {valor:'ok', rotulo: S.plano ? 'Substituir tudo' : 'Carregar', classe: S.plano ? 'perigo' : 'cheio'},
    ],
  });
  if(!r) return;
  try{
    substituirPlano(novo);
  }catch(e){
    aviso('Não consegui salvar neste aparelho (sem espaço ou bloqueado). Nada foi mudado.', true);
    return;
  }
  S.plano = novo;
  S.erroDados = null;
  S.persistente = await pedirPersistencia();
  render();
  aviso('Dados carregados ✓');
}

async function importar(){
  if(!await sugerirBackup('importar')) return;
  const inp = $('#arquivo');
  inp.value = '';
  inp.click();
}

async function arquivoEscolhido(arquivo){
  let r;
  try{ r = planoDoTexto(await lerArquivo(arquivo)); }
  catch(e){ aviso(e.message || 'Não consegui ler o arquivo.', true); return; }
  if(!r.plano){
    const lista = r.erros.slice(0, 8).map(e => '• ' + esc(e)).join('<br>') + (r.erros.length > 8 ? '<br>• … e mais ' + (r.erros.length - 8) : '');
    await perguntar({rot:'Importar', titulo:'Esse arquivo não serve', texto:'Nada foi mudado. Problemas encontrados:<br>' + lista,
      botoes:[{valor:'cancelar', rotulo:'Fechar', classe:'cheio'}]});
    return;
  }
  await confirmarESubstituir(r.plano, 'Importar ' + arquivo.name);
}

async function carregarExemplo(){
  if(!await sugerirBackup('carregar o exemplo')) return;
  let r;
  try{ r = planoDoTexto(await (await fetch('exemplo-ficticio.json')).text()); }
  catch(e){ aviso('Não consegui abrir o exemplo.', true); return; }
  if(!r.plano){ aviso('O exemplo está com problema: ' + r.erros[0], true); return; }
  await confirmarESubstituir(r.plano, 'Exemplo fictício');
}

async function desfazer(){
  const r = await perguntar({rot:'Desfazer', titulo:'Voltar aos dados de antes?',
    texto:'Troca os dados atuais pelos que estavam aqui antes da última importação. Os atuais ficam guardados: dá para desfazer de novo.',
    ok:'Voltar'});
  if(!r) return;
  try{ S.plano = trocarPeloAnterior(); S.erroDados = null; }
  catch(e){ aviso(e.message, true); return; }
  render();
  aviso('Dados anteriores de volta ✓');
}

function baixarBruto(){
  baixarArquivo('dash-financeiro-dados-com-problema-' + iso(new Date()) + '.json', S.erroDados.bruto || '');
}

/* ---------------------------------------------------------------- cliques */
const ACOES = {
  'ir-dados': () => irAba('dados'),
  'exportar': exportar,
  'importar': importar,
  'exemplo': carregarExemplo,
  'desfazer': desfazer,
  'baixar-bruto': baixarBruto,
};

document.addEventListener('click', e => {
  const aba = e.target.closest('[data-aba]');
  if(aba) return irAba(aba.dataset.aba);
  const bt = e.target.closest('[data-acao]');
  if(bt && ACOES[bt.dataset.acao]) ACOES[bt.dataset.acao](bt);
});

$('#arquivo').addEventListener('change', e => {
  const f = e.target.files[0];
  if(f) arquivoEscolhido(f);
});

/* ---------------------------------------------------------------- service worker */
if('serviceWorker' in navigator){
  const jaTinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(jaTinha) aviso('App atualizado. Feche e abra de novo para usar a versão nova.');
  });
  navigator.serviceWorker.register('sw.js').catch(() => { S.semOffline = true; render(); });
}

/* ---------------------------------------------------------------- início */
const lido = lerPlanoGuardado();
if(lido.erro) S.erroDados = lido;
S.plano = lido.plano || null;
if(!S.plano) S.aba = 'dados';
if(navigator.storage && navigator.storage.persisted){
  navigator.storage.persisted().then(v => { S.persistente = v; if(S.aba === 'dados') render(); }).catch(() => {});
}
render();
