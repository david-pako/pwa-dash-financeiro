/* Dash financeiro: tudo roda no aparelho, sem servidor.
   Este arquivo cuida da tela; guardar, validar, importar e exportar ficam em js/dados.js.
   Botões usam data-acao="..." (a CSP bloqueia onclick="..." no HTML). */
'use strict';

const VERSAO = '0.3.0';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------------------------------------------------------------- formatação */
// fmt2, brl, brl0, dm e nomeMes ficam em js/calculos.js
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
  sim: {salario: null, meta: null},   // simulação da Projeção (não é salva)
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

  HOJE = hojeData();   // o app pode ficar aberto de um dia para o outro
  const tela = TELAS[aba.id];
  $('#conteudo').innerHTML =
    aba.id === 'dados' ? abaDados() :
    !S.plano ? semDados() :
    tela ? tela() :
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

/* ---------------------------------------------------------------- salvar */
const numeroValido = (n, podeZero) => Number.isFinite(n) && (podeZero ? n >= 0 : n > 0);

// Aplica a mudança no plano e guarda no aparelho. Se não der, nada muda.
function salvar(mudar, msgOk){
  try{
    S.plano = alterarPlano(S.plano, mudar);
  }catch(e){
    aviso(e.name === 'QuotaExceededError' ? 'Sem espaço neste aparelho: não salvou.' : e.message || 'Não consegui salvar.', true);
    return false;
  }
  render();
  aviso(msgOk || 'Salvo ✓');
  return true;
}

/* ---------------------------------------------------------------- itens do ciclo (Resumo e Este ciclo) */
function quandoTxt(i){
  if(!i.quando) return 'quando precisar';
  const dias = Math.round((i.quando - HOJE) / 864e5);
  if(i.pago) return dm(i.quando);
  if(dias < 0) return 'venceu ' + dm(i.quando);
  if(dias === 0) return 'vence HOJE';
  if(dias === 1) return 'amanhã · ' + dm(i.quando);
  return dm(i.quando);
}

// Linha de um item: o quadrado marca pago/recebido; o nome abre a edição do valor.
function linhaItem(i, opts = {}){
  const atrasado = !i.pago && i.quando && i.quando < HOJE;
  const hoje = !i.pago && i.quando && +i.quando === +HOJE;
  const anterior = i.k < K0();
  const tag = (anterior ? '<span class="tag" style="color:var(--vermelho)">ciclo anterior</span>' : '')
    + (atrasado ? `<span class="tag" style="color:var(--vermelho)">${i.entrada ? 'chegou?' : 'atrasado?'}</span>` : hoje ? '<span class="tag ouro">hoje</span>' : '');
  const saldo = (opts.saldo && i.saldo != null) ? `<small class="saldo-linha ${i.saldo < 0 ? 'neg' : ''}">saldo ${brl0(i.saldo)}</small>` : '';
  const clicavel = i.k === K0() || i.k === somaMes(K0(), -1);
  const alvo = `data-k="${i.k}" data-id="${esc(i.id)}"`;
  return `<div class="item ${i.pago ? 'feito' : ''}">
    <span class="esq">
      ${clicavel ? `<button class="marcador" aria-label="${i.pago ? 'desmarcar' : i.entrada ? 'marcar como recebido' : 'marcar como pago'}" data-acao="pago" ${alvo}>${i.pago ? '✓' : ''}</button>`
                 : `<span class="marcador" style="opacity:.35"></span>`}
      <button style="text-align:left" data-acao="editar-item" ${alvo}>
        <span class="nome">${esc(i.nome)}${tag}</span>
        <span class="dia">${quandoTxt(i)}${i.nota ? ' · ' + esc(i.nota) : ''}</span>
      </button>
    </span>
    <span class="val ${i.entrada ? 'pos' : ''}">${i.entrada ? '+' : ''}${brl(i.valor)}${saldo}</span>
  </div>`;
}

function alternarPago({k, id}){
  const i = itensDoCiclo(k).find(x => x.id === id);
  if(!i) return;
  const marcar = !i.pago, chave = k + '|' + id, sinal = i.entrada ? 1 : -1;
  salvar(p => {
    if(marcar){ p.pagos[chave] = true; p.saldo.valor = arred(p.saldo.valor + sinal * i.valor); }
    else { delete p.pagos[chave]; p.saldo.valor = arred(p.saldo.valor - sinal * i.valor); }
  }, marcar ? `${i.nome}: ${i.entrada ? 'recebido' : 'pago'} ✓ (saldo ${i.entrada ? '+' : '−'}${brl0(i.valor)})` : `${i.nome} desmarcado (saldo voltou)`);
}

async function editarItem({k, id}){
  const i = itensDoCiclo(k).find(x => x.id === id);
  if(!i) return;
  const cartao = i.grupo === 'cartao';
  const campos = [{tipo:'numero', id:'valor', rotulo: cartao ? 'Valor da fatura' : 'Valor neste ciclo', valor: cartao && !i.final ? i.base : i.valor}];
  let texto = '';
  if(cartao){
    campos.push({tipo:'check', id:'final', rotulo:'Valor final (fatura fechada, com tudo)', valor: i.final || k <= K0()});
    if(i.extra) texto = `Sem marcar "valor final", o app soma o dia a dia previsto (${brl0(i.extra)}) a este valor.`;
  } else if(i.id !== 'salario' && i.id !== 'dizimo'){
    texto = 'Muda só este ciclo. Para mudar todos os meses, use Ajustes.';
  } else if(i.id === 'dizimo'){
    texto = 'Padrão: ' + P().dizimo.pct + '% do salário deste ciclo (' + brl(Math.round(salarioDo(k) * P().dizimo.pct) / 100) + ').';
  }
  if(k === K0() || k === somaMes(K0(), -1)) campos.push({tipo:'check', id:'pago', rotulo: i.entrada ? 'Recebido (soma no saldo)' : 'Pago (sai do saldo)', valor:i.pago});
  const r = await perguntar({rot:nomeCiclo(k), titulo:i.nome, texto, campos});
  if(!r) return;
  if(!numeroValido(r.valor, true)){ aviso('Valor inválido.', true); return; }
  const novoValor = cartao && !r.final ? arred(r.valor + (i.extra || 0)) : r.valor;
  salvar(p => {
    const chave = k + '|' + i.id;
    if(cartao){
      p.cartoes.find(x => x.id === i.id).faturas[k] = {v:arred(r.valor), final:!!r.final};
    } else {
      if(Math.abs(r.valor - valorPadrao(i)) < 0.005) delete p.ajustes[chave];
      else p.ajustes[chave] = arred(r.valor);
    }
    if(r.pago !== undefined && r.pago !== i.pago){
      const sinal = i.entrada ? 1 : -1;
      if(r.pago){ p.pagos[chave] = true; p.saldo.valor = arred(p.saldo.valor + sinal * novoValor); }
      else { delete p.pagos[chave]; p.saldo.valor = arred(p.saldo.valor - sinal * i.valor); }
    }
  });
}

async function editarSaldo(){
  const r = await perguntar({rot:'Saldo', titulo:'Quanto tem na conta agora?',
    texto:'Use o número do app do banco. A partir dele, o app desconta o que você marcar como pago.',
    campos:[{tipo:'numero', id:'v', valor:P().saldo.valor}]});
  if(!r) return;
  if(!Number.isFinite(r.v)){ aviso('Valor inválido.', true); return; }
  salvar(p => { p.saldo = {...p.saldo, valor:arred(r.v), conferido_em:iso(HOJE)}; }, 'Saldo conferido ✓');
}

/* ---------------------------------------------------------------- gráfico da projeção */
function grafico(pr){
  const L = pr.linhas, W = 340, H = 176, topo = 16, base = 36, esq = 4, dir = 4;
  const vals = L.map(l => l.acum);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals), rng = (max - min) || 1;
  const y = v => topo + (max - v) / rng * (H - topo - base);
  const bw = (W - esq - dir) / L.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo acumulado por mês">`;
  svg += `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#1E3A5F" stroke-width="1"/>`;
  L.forEach((l, i) => {
    const x = esq + i * bw + bw * .16, w = bw * .68;
    const y1 = Math.min(y(l.acum), y(0)), h = Math.max(1, Math.abs(y(l.acum) - y(0)));
    const cor = l.acum < 0 ? '#A8372B' : '#2D6A4F';
    svg += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${cor}" opacity="${l === pr.piso || l === pr.azul ? 1 : .62}"/>`;
    svg += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${nomeMes(l.k).slice(0, 3)}</text>`;
  });
  const marcar = (l, txt) => {
    const i = L.indexOf(l), x = esq + i * bw + bw / 2;
    const yy = l.acum < 0 ? y(l.acum) + 13 : Math.max(10, y(l.acum) - 4);
    const anc = i < 2 ? 'start' : i > L.length - 3 ? 'end' : 'middle';
    svg += `<text x="${x.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anc}" style="font-weight:700;fill:${l.acum < 0 ? '#A8372B' : '#2D6A4F'}">${txt}</text>`;
  };
  if(pr.piso.acum < 0) marcar(pr.piso, brl0(pr.piso.acum));
  const ult = L[L.length - 1];
  if(ult !== pr.piso) marcar(ult, brl0(ult.acum));
  return svg + `</svg>`;
}

/* ---------------------------------------------------------------- tela Resumo */
function abaResumo(){
  const p = P(), fa = fluxoAtual(), pr = projecao(), prox = proximos();
  const fim = fimCiclo(K0());
  const agora = fa.linhas.filter(i => !i.pago && i.quando && (i.quando - HOJE) / 864e5 <= 3);
  const seguintes = prox.filter(i => !i.quando || i.quando >= HOJE).slice(0, 10);
  const primeiroNeg = prox.find(i => i.saldo < 0);
  const conferido = p.saldo.conferido_em ? 'conferido em ' + dm(dataDoIso(p.saldo.conferido_em)) : 'sem data de conferência';

  return `
  <button class="cartao heroi ${p.saldo.valor < 0 ? 'alerta' : ''}" style="width:100%;text-align:left" data-acao="editar-saldo">
    <div class="risco"></div>
    <div class="rot">Saldo em conta · ${conferido}</div>
    <div class="heroi-n"><span class="cif">R$</span>${p.saldo.valor < 0 ? '−' : ''}${fmt2(p.saldo.valor)}</div>
    <div class="heroi-sub">Fim deste ciclo (${dm(fim)}): <b>${brl(fa.fim)}</b>.
      ${!primeiroNeg ? '<br>Nada fica negativo nos próximos dois ciclos.'
        : (primeiroNeg.quando && primeiroNeg.quando < HOJE) ? '<br>Com as contas ainda não marcadas, <b>o saldo já fica negativo</b>. Marque o que já pagou.'
        : `<br>Fica negativo em <b>${primeiroNeg.quando ? dm(primeiroNeg.quando) : 'fim do ciclo'}</b>, no pagamento de ${esc(primeiroNeg.nome)}.`}
      <br><span style="opacity:.7">toque para atualizar o saldo</span></div>
  </button>

  <div class="cartao">
    <div class="rot">Para pagar agora</div>
    ${agora.length ? agora.map(i => linhaItem(i)).join('') : '<div class="nada">Nada vencido nem vencendo nos próximos 3 dias.</div>'}
    <div class="mini" style="margin-top:8px">Toque no quadrado quando pagar: o valor sai do saldo sozinho.</div>
  </div>

  <div class="cartao">
    <div class="rot">Próximos vencimentos · com o saldo rolando</div>
    ${seguintes.length ? seguintes.map(i => linhaItem(i, {saldo:true})).join('') : '<div class="nada">Nada pela frente.</div>'}
  </div>

  <button class="cartao" style="width:100%;text-align:left" data-aba="projecao">
    <div class="rot">O plano até ${nomeMes(pr.linhas[pr.linhas.length - 1].k)}</div>
    <div class="grandes">
      <div class="grande"><div class="mini">Pior momento</div><div class="n ${pr.piso.acum < 0 ? 'neg' : 'pos'}">${brl0(pr.piso.acum)}</div><div class="mini">em ${nomeMes(pr.piso.k)}</div></div>
      <div class="grande"><div class="mini">Volta ao azul</div><div class="n ${pr.azul || pr.piso.acum >= 0 ? 'pos' : 'neg'}">${pr.azul ? nomeMes(pr.azul.k) : pr.piso.acum >= 0 ? 'já está' : 'depois'}</div><div class="mini">${pr.azul ? brl0(pr.azul.acum) : pr.piso.acum >= 0 ? 'sem buraco' : 'fora do horizonte'}</div></div>
    </div>
    <div class="grafico" style="margin-top:12px">${grafico(pr)}</div>
    <div class="mini" style="margin-top:6px">Salário ${brl0(salarioDo(somaMes(K0(), 1)))} · dia a dia ${brl0(metaDo(somaMes(K0(), 1)))}/mês · toque para detalhar</div>
  </button>`;
}

/* ---------------------------------------------------------------- tela Este ciclo */
function abaCiclo(){
  const k = K0(), fa = fluxoAtual();
  const pend = fa.linhas.filter(i => !i.pago);
  const entra = pend.filter(i => i.entrada).reduce((t, i) => t + i.valor, 0);
  const sai = pend.filter(i => !i.entrada).reduce((t, i) => t + i.valor, 0);
  const lancado = lancadoNo(k), meta = metaDo(k);
  const pct = meta > 0 ? Math.min(100, lancado / meta * 100) : 100;
  const cartao = P().cartoes.find(c => c.recebe_dia_a_dia);
  return `
  <div class="cartao">
    <div class="rot">${nomeCiclo(k)}</div>
    <div class="grandes">
      <div class="grande"><div class="mini">Ainda entra</div><div class="n pos">${brl0(entra)}</div></div>
      <div class="grande"><div class="mini">Ainda sai</div><div class="n">${brl0(sai)}</div></div>
      <div class="grande"><div class="mini">Saldo hoje</div><div class="n">${brl0(P().saldo.valor)}</div></div>
      <div class="grande"><div class="mini">Fecha em</div><div class="n ${fa.fim < 0 ? 'neg' : 'pos'}">${brl0(fa.fim)}</div></div>
    </div>
  </div>

  <div class="cartao">
    <div class="rot">Tudo do ciclo</div>
    ${fa.linhas.map(i => linhaItem(i, {saldo:true})).join('')}
    <div class="mini" style="margin-top:8px">Quadrado = pago/recebido (mexe no saldo). Toque no nome para mudar o valor só deste ciclo.</div>
  </div>

  <button class="cartao" style="width:100%;text-align:left" data-aba="gastos">
    <div class="rot">Dia a dia deste ciclo</div>
    <div class="barra"><i class="${lancado >= meta ? 'estouro' : lancado > meta * .75 ? 'alto' : ''}" style="width:${pct}%"></i></div>
    <div class="legenda"><span>Anotado: <b>${brl0(lancado)}</b></span><span>meta ${brl0(meta)}</span></div>
    <div class="mini" style="margin-top:10px">Isso não sai da conta agora: vai para a fatura ${cartao ? 'do ' + esc(cartao.nome) : 'do cartão'} de ${nomeMes(somaMes(k, 1))}.
      A projeção usa a meta ou o anotado, o que for maior. Toque para ver os gastos.</div>
  </button>`;
}

/* ---------------------------------------------------------------- telas prontas */
const TELAS = {
  resumo: abaResumo,
  ciclo: abaCiclo,
};

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
  'pago': bt => alternarPago(bt.dataset),
  'editar-item': bt => editarItem(bt.dataset),
  'editar-saldo': editarSaldo,
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
  let recarregando = false;
  // Versão nova assumiu: recarrega sozinho, a não ser que uma janela de diálogo esteja aberta.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(!jaTinha || recarregando) return;
    if($('#modal').open) return aviso('App atualizado. Feche e abra de novo para usar a versão nova.');
    recarregando = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    // Procura versão nova ao abrir e ao voltar para o app (no celular ele pode ficar dias aberto).
    // Sem internet a procura falha em silêncio, e o app segue com a versão guardada.
    const procurar = () => reg.update().catch(() => {});
    if(jaTinha) procurar();
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') procurar(); });
  }).catch(() => { S.semOffline = true; render(); });
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
