/* Cálculos do plano: ciclos de salário, contas de cada ciclo, saldo rolando e projeção.
   Portado do app antigo sem mudar as regras.
   Lê o plano de S.plano e a simulação de S.sim (os dois ficam em js/app.js). */
'use strict';

const DIA_CICLO = 5;   // o ciclo financeiro vai do dia 05 ao dia 04 do mês seguinte

/* ---------------------------------------------------------------- formatação */
const fmt2 = n => Math.abs(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const brl  = n => (n < -0.004 ? '−' : '') + 'R$ ' + fmt2(n);
const brl0 = n => (Math.round(n) < 0 ? '−' : '') + 'R$ ' + Math.abs(Math.round(n)).toLocaleString('pt-BR');

/* ---------------------------------------------------------------- datas e ciclos */
// ?hoje=AAAA-MM-DD no endereço finge outra data (só para testes)
function hojeData(){
  const q = new URLSearchParams(location.search).get('hoje');
  const d = q ? new Date(q + 'T12:00:00') : new Date();
  d.setHours(0,0,0,0);
  return d;
}
let HOJE = hojeData();
const dm  = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const nomeMes = k => { const [y,m] = k.split('-').map(Number); return MESES[m-1].replace(/^./, c => c.toUpperCase()) + '/' + String(y).slice(2); };
function somaMes(k, n){
  let [y,m] = k.split('-').map(Number);
  m += n;
  while(m > 12){ m -= 12; y++; }
  while(m < 1){ m += 12; y--; }
  return y + '-' + String(m).padStart(2,'0');
}
// Cada ciclo tem uma chave "AAAA-MM": o mês em que ele começa.
function chaveDoCiclo(d){
  const x = new Date(d);
  if(x.getDate() < DIA_CICLO) x.setMonth(x.getMonth() - 1, 1);
  return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0');
}
const K0 = () => chaveDoCiclo(HOJE);
function inicioCiclo(k){ const [y,m] = k.split('-').map(Number); return new Date(y, m-1, DIA_CICLO); }
function fimCiclo(k){ const [y,m] = k.split('-').map(Number); return new Date(y, m, DIA_CICLO - 1); }
function dataNoCiclo(k, dia){
  if(!dia) return null;
  const [y,m] = k.split('-').map(Number);
  const mi = dia >= DIA_CICLO ? m - 1 : m;               // dia 01–04 cai no mês seguinte
  const ultimo = new Date(y, mi + 1, 0).getDate();
  return new Date(y, mi, Math.min(dia, ultimo));
}
function cicloInfo(k){
  const ini = inicioCiclo(k), fim = fimCiclo(k);
  const total = Math.round((fim - ini) / 864e5) + 1;
  const passados = Math.max(0, Math.min(total, Math.round((HOJE - ini) / 864e5)));
  return {k, ini, fim, total, restam: Math.max(1, total - passados)};
}
const nomeCiclo = k => 'Ciclo ' + dm(inicioCiclo(k)) + ' – ' + dm(fimCiclo(k));

/* ---------------------------------------------------------------- regras do plano */
const P = () => S.plano;

// Valor que vale só para um ciclo (ex.: "2026-12|salario": 13º salário)
function ajuste(k, id){
  const v = (P().ajustes || {})[k + '|' + id];
  return typeof v === 'number' ? v : undefined;
}
function salarioDo(k){
  if(k > K0() && S.sim.salario != null) return S.sim.salario;
  return ajuste(k, 'salario') ?? P().salario.valor;
}
function dizimoDo(k){ return ajuste(k, 'dizimo') ?? Math.round(salarioDo(k) * P().dizimo.pct) / 100; }
function metaDo(k){
  if(k >= K0() && S.sim.meta != null) return S.sim.meta;
  return ajuste(k, 'meta') ?? P().meta_dia_a_dia;
}
function lancamentosDe(dIni, dFim){
  const a = iso(dIni), b = iso(dFim);
  return P().lancamentos.filter(l => l.data >= a && l.data <= b);
}
const soma = arr => arr.reduce((t, l) => t + l.valor, 0);
const lancadoNo = k => soma(lancamentosDe(inicioCiclo(k), fimCiclo(k)));
// Dia a dia de um ciclo: o que vai parar na fatura do mês seguinte.
// Ciclos futuros usam a meta; o atual e os passados usam a meta ou o que já foi anotado, o que for maior.
function diaADiaDo(k){ return k > K0() ? metaDo(k) : Math.max(metaDo(k), lancadoNo(k)); }

// Valor "normal" de um item, sem o ajuste do ciclo (para saber se um ajuste pode ser apagado)
function valorPadrao(i){
  const p = P();
  if(i.id === 'salario') return p.salario.valor;
  if(i.id === 'dizimo') return Math.round(salarioDo(i.k) * p.dizimo.pct) / 100;
  const c = p.contas.find(x => x.id === i.id); if(c) return c.valor;
  const d = p.dividas.find(x => x.id === i.id); if(d) return d.parcela;
  return i.valor;
}

// Tudo o que entra e sai num ciclo, em ordem de data.
function itensDoCiclo(k){
  const p = P(), it = [];
  it.push({id:'salario', nome:'Salário', entrada:true, valor:salarioDo(k), quando:dataNoCiclo(k, p.salario.dia), grupo:'renda'});
  it.push({id:'dizimo', nome:'Dízimo', valor:dizimoDo(k), quando:dataNoCiclo(k, p.dizimo.dia), grupo:'conta'});
  for(const c of p.contas){
    it.push({id:c.id, nome:c.nome, valor:ajuste(k, c.id) ?? c.valor, quando:dataNoCiclo(k, c.dia), grupo:'conta', nota:c.nota || ''});
  }
  for(const d of p.dividas){
    if(k <= d.ate) it.push({id:d.id, nome:d.nome, valor:ajuste(k, d.id) ?? d.parcela, quando:dataNoCiclo(k, d.dia), grupo:'divida', nota:'até ' + nomeMes(d.ate)});
  }
  for(const c of p.cartoes){
    const f = (c.faturas || {})[k];
    const base = f ? f.v : 0;
    const final = !!(f && f.final);
    const extra = (c.recebe_dia_a_dia && !final) ? diaADiaDo(somaMes(k, -1)) : 0;
    if(base + extra <= 0) continue;
    it.push({id:c.id, nome:'Fatura ' + c.nome, valor:arred(base + extra), base, extra, final,
             quando:dataNoCiclo(k, c.vence), grupo:'cartao',
             nota: final ? 'valor final' : extra ? 'parcelas ' + brl0(base) + ' + dia a dia ' + brl0(extra) : ''});
  }
  const depois = fimCiclo(k).getTime() + 1;
  for(const i of it){
    i.k = k;
    i.pago = !!(p.pagos || {})[k + '|' + i.id];
    i.ord = i.quando ? i.quando.getTime() : depois;
  }
  it.sort((a, b) => a.ord - b.ord || (a.entrada ? -1 : b.entrada ? 1 : 0));
  return it;
}
const efeito = i => i.entrada ? i.valor : -i.valor;

// Linha do tempo do ciclo atual: parte do saldo informado e aplica só o que ainda não foi pago.
// Contas com data do ciclo anterior que não foram marcadas entram no começo (como atrasadas),
// para nada sumir na virada do ciclo.
function fluxoAtual(){
  const k = K0();
  let s = P().saldo.valor, pior = null;
  const ant = somaMes(k, -1);
  const pendentesAnteriores = (P().inicio && ant >= P().inicio)
    ? itensDoCiclo(ant).filter(i => !i.pago && i.quando) : [];
  const linhas = pendentesAnteriores.concat(itensDoCiclo(k)).map(i => {
    if(i.pago) return {...i, saldo:null};
    s = arred(s + efeito(i));
    const l = {...i, saldo:s};
    if(!pior || s < pior.saldo) pior = l;
    return l;
  });
  return {linhas, fim:s, pior};
}

// Saldo acumulado ciclo a ciclo: o "piso" é o pior momento; "azul" é quando volta a ficar positivo.
function projecao(){
  const k0 = K0(), H = P().horizonte_meses || 12;
  const fa = fluxoAtual();
  const linhas = [{k:k0, atual:true, res:arred(fa.fim - P().saldo.valor), acum:fa.fim}];
  let acum = fa.fim;
  for(let n = 1; n <= H; n++){
    const k = somaMes(k0, n);
    const res = arred(itensDoCiclo(k).filter(i => !i.pago).reduce((t, i) => t + efeito(i), 0));
    acum = arred(acum + res);
    linhas.push({k, res, acum});
  }
  let piso = linhas[0];
  for(const l of linhas) if(l.acum < piso.acum) piso = l;
  const azul = piso.acum < 0 ? linhas.slice(linhas.indexOf(piso)).find(l => l.acum >= 0) || null : null;
  return {linhas, piso, azul};
}

// Próximos vencimentos: o que falta do ciclo atual + o ciclo seguinte, com o saldo rolando.
function proximos(){
  const fa = fluxoAtual();
  const atuais = fa.linhas.filter(l => !l.pago);
  let s = fa.fim;
  const seguintes = itensDoCiclo(somaMes(K0(), 1)).filter(i => !i.pago).map(i => { s = arred(s + efeito(i)); return {...i, saldo:s}; });
  return atuais.concat(seguintes);
}

/* ---------------------------------------------------------------- semanas do dia a dia */
// O ciclo é dividido em semanas de 7 dias a partir do dia 05; a meta é repartida pelos dias.
function semanasDoCiclo(k){
  const c = cicloInfo(k), meta = metaDo(k), lista = [];
  for(let ini = new Date(c.ini), n = 1; ini <= c.fim; n++){
    const fim = new Date(ini); fim.setDate(fim.getDate() + 6);
    if(fim > c.fim) fim.setTime(c.fim.getTime());
    const dias = Math.round((fim - ini) / 864e5) + 1;
    lista.push({n, ini:new Date(ini), fim, dias, gasto:soma(lancamentosDe(ini, fim)), orc:meta / c.total * dias,
                atual: HOJE >= ini && HOJE <= fim, futura: ini > HOJE});
    ini = new Date(fim); ini.setDate(ini.getDate() + 1);
  }
  return lista;
}
