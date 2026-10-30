/* Dash financeiro: tudo roda no aparelho, sem servidor.
   Por enquanto este arquivo só monta a casca do app e a troca de abas.
   Dados, cálculos e telas entram nos próximos passos. */
'use strict';

const VERSAO = '0.1.0';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------------------------------------------------------------- abas */
const ABAS = [
  {id:'resumo',   nome:'Resumo',     olho:'Visão geral'},
  {id:'ciclo',    nome:'Este ciclo', olho:'Ciclo de salário'},
  {id:'projecao', nome:'Projeção',   olho:'Próximos meses'},
  {id:'gastos',   nome:'Gastos',     olho:'Dia a dia'},
  {id:'ajustes',  nome:'Ajustes',    olho:'Plano'},
  {id:'dados',    nome:'Dados',      olho:'Importar e exportar'},
];

const S = {aba: 'resumo'};

/* ---------------------------------------------------------------- avisos */
let avisoTimer = null;
function aviso(msg, erro){
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('erro', !!erro);
  el.classList.add('on');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('on'), erro ? 5000 : 2600);
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

  $('#conteudo').innerHTML =
    `<div class="cartao"><div class="rot">${esc(aba.nome)}</div>` +
    `<div class="nada">Tela em construção.</div></div>`;

  $('#status').textContent = 'versão ' + VERSAO + ' · dados só neste aparelho';
}

function irAba(id){
  S.aba = id;
  render();
  window.scrollTo({top: 0});
}

$('#abas').addEventListener('click', e => {
  const bt = e.target.closest('[data-aba]');
  if(bt) irAba(bt.dataset.aba);
});

render();
