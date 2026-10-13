// Indicadores → Avaliação da Experiência → aba "Extra Natal": acompanhamento
// do período de experiência dos contratados de Extra Natal (tag
// "extra.natal.AAAA" nos Grupos do Headcount). O período deles não segue os
// 45/90 dias da admissão: as datas vêm do calendário do DP (planilha
// calendario_extranatal_AAAA.xlsx), em que cada faixa de admissão termina a
// 1ª experiência e a prorrogação em datas fixas. A avaliação de cada período
// é liberada manualmente no Feedz 6 dias antes do término, e as respostas
// chegam pelas mesmas planilhas AVE 45 DIAS (1º período) e AVE 90 DIAS (2º).
(function () {
  const U = HUB_UTILS;
  const M = HUB_EXP_METRICS;
  const { kpi, empty, card } = HUB_UI;
  const esc = U.escapeHtml;
  const pct = v => U.fmtPct(v, 0);

  // Calendário por ano. Cada faixa: [admissão até, fim da 1ª experiência, fim
  // da prorrogação]. Dia sem linha na planilha (domingo/feriado) cai na faixa
  // do dia útil seguinte; admissão antes de "inicio" conta como "inicio".
  // "evitar" = admissões que a planilha marca como EVITAR (experiência curta).
  const CALENDARIOS = {
    2026: {
      inicio: '2026-10-06',
      faixas: [
        ['2026-10-17', '2026-11-14', '2026-12-31'],
        ['2026-10-31', '2026-11-29', '2026-12-31'],
        ['2026-11-16', '2026-11-29', '2027-01-31'],
        ['2026-12-24', '2026-12-31', '2027-01-31'],
        ['2026-12-31', '2027-01-31', '2027-02-21']
      ],
      evitar: [['2026-10-13', '2026-10-17'], ['2026-11-11', '2026-11-16'], ['2026-12-12', '2026-12-17'], ['2026-12-26', '2026-12-31']]
    }
  };
  const ANTECEDENCIA = 6; // a avaliação é liberada 6 dias antes do término do período

  function periodos(ano, adm) {
    const c = CALENDARIOS[ano];
    if (!c || !adm) return null;
    const a = adm < c.inicio ? c.inicio : adm;
    const fx = c.faixas.find(x => a <= x[0]);
    if (!fx) return null;
    return {
      lib1: U.addDays(fx[1], -ANTECEDENCIA), fim1: fx[1], lib2: U.addDays(fx[2], -ANTECEDENCIA), fim2: fx[2],
      evitar: c.evitar.some(e => adm >= e[0] && adm <= e[1]), antesDoInicio: adm < c.inicio
    };
  }

  const norm = s => U.normalizeText(s || '');
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
  const media = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

  function anosDisponiveis() {
    const set = new Set(Object.keys(CALENDARIOS).map(Number));
    for (const c of (window.HUB_DATA && window.HUB_DATA.colaboradores) || []) for (const a of M.anosNatal(c.grupos)) set.add(a);
    return Array.from(set).sort((a, b) => b - a);
  }

  // Situação de cada período. "row" = linha da AVE (45 ou 90) do colaborador:
  // só existe depois que a avaliação é liberada no Feedz e a planilha sobe.
  function etapa(row, lib, fim, hoje, saida) {
    const e = { row, lib, fim, sit: null, dias: null, martelo: row ? row.martelo : null, nota: null, data: row ? row.data_avaliacao : null, auto: row ? row.status_auto : null };
    if (row) e.nota = media(M.CORE.map(c => (row.notas_gestor || {})[c]).filter(v => v >= 1 && v <= 4));
    if (row && row.status_gestor === 'concluida') { e.sit = fim && e.data && e.data > fim ? 'concluida_atraso' : 'concluida'; return e; }
    if (saida) { e.sit = lib && saida < lib ? 'saiu_antes' : 'saiu_sem'; return e; }
    if (!lib) { e.sit = row ? 'em_andamento' : 'sem_calendario'; return e; }
    if (hoje < lib) { e.sit = 'aguardando'; e.dias = dias(hoje, lib); return e; }
    if (hoje <= fim) { e.sit = row ? 'em_andamento' : 'liberar'; e.dias = dias(hoje, fim); return e; }
    e.sit = row ? 'vencida' : 'vencida_nao_liberada'; e.dias = dias(fim, hoje);
    return e;
  }

  function montar(ano, f) {
    const hoje = U.todayISO();
    const ini = `${ano}-08-01`, fimJanela = `${ano + 1}-02-28`;
    const naJanela = d => !!d && d >= ini && d <= fimJanela;
    const idx = rows => {
      const m = new Map();
      const add = (k, r) => { if (!m.has(k)) m.set(k, []); m.get(k).push(r); };
      for (const r of rows || []) {
        if (r.cpf != null && String(r.cpf).trim()) add('c:' + String(r.cpf).trim(), r);
        const n = norm(r.nome); if (n) add('n:' + n, r);
      }
      return m;
    };
    const i45 = idx(window.HUB_EXPERIENCIA_DATA[45]), i90 = idx(window.HUB_EXPERIENCIA_DATA[90]);
    const achar = (m, c, admHC) => {
      const cand = (c.cpf && String(c.cpf).trim() && m.get('c:' + String(c.cpf).trim())) || m.get('n:' + norm(c.nome_completo || c.nome)) || [];
      const adm = r => String(r.data_admissao || '').slice(0, 10);
      return cand.find(r => admHC && adm(r) === admHC) || cand.find(r => naJanela(adm(r))) || null;
    };
    const out = [];
    for (const c of (window.HUB_DATA && window.HUB_DATA.colaboradores) || []) {
      if (!M.anosNatal(c.grupos).includes(ano)) continue;
      if (f) {
        if (!U.matchesAny(c.unidade, f.unidade) || !U.matchesAny(c.departamento, f.departamento)) continue;
        if (f.gestor && !U.normIncludes(c.gestor_direto, f.gestor)) continue;
        if (f.colaborador && !U.normIncludes(c.nome_completo || c.nome, f.colaborador)) continue;
      }
      const admHC = c.data_admissao ? String(c.data_admissao).slice(0, 10) : null;
      const admOk = naJanela(admHC) ? admHC : null;
      const r45 = achar(i45, c, admOk), r90 = achar(i90, c, admOk);
      const adm = admOk || [r45, r90].filter(Boolean).map(r => String(r.data_admissao || '').slice(0, 10)).find(naJanela) || null;
      const sit = norm(c.situacao);
      const saidaHC = c.ultimo_dia_trabalhado ? String(c.ultimo_dia_trabalhado).slice(0, 10) : null;
      // Recontratado depois da temporada: a situação/saída atual do Headcount não é a do contrato de Natal.
      const saida = sit === 'desligado' && admOk ? (saidaHC || hoje) : null;
      const p = periodos(ano, adm) || {};
      out.push({
        nome: c.nome_completo || c.nome, cargo: c.cargo || 'Não informado', unidade: c.unidade || 'Não informado', departamento: c.departamento,
        gestor: c.gestor_direto || 'Não informado', adm, situacao: admOk ? sit : null, saida: saida ? saidaHC : null,
        evitar: !!p.evitar, antesDoInicio: !!p.antesDoInicio, semCalendario: !p.fim1,
        e1: etapa(r45, p.lib1 || null, p.fim1 || null, hoje, saida),
        e2: etapa(r90, p.lib2 || null, p.fim2 || null, hoje, saida)
      });
    }
    return out;
  }

  const SIT = {
    liberar: ['#d03b3b', 'Liberar no Feedz'], aguardando: ['#8A8F98', 'Aguardando liberação'], em_andamento: ['#eda100', 'Liberada — sem resposta'],
    concluida: ['#1baf7a', 'Concluída'], concluida_atraso: ['#6cbf6c', 'Concluída após o término'], vencida: ['#9b1c1c', 'Vencida — sem resposta'],
    vencida_nao_liberada: ['#9b1c1c', 'Vencida — não liberada'], saiu_antes: ['#8A8F98', 'Saiu antes da liberação'], saiu_sem: ['#e5533d', 'Desligado sem avaliação'],
    sem_calendario: ['#C9D0DA', 'Sem calendário']
  };
  const ABERTAS = ['liberar', 'em_andamento', 'vencida', 'vencida_nao_liberada'];
  const FEITAS = ['concluida', 'concluida_atraso'];

  function pillEtapa(e) {
    const [cor, txt] = SIT[e.sit] || SIT.sem_calendario;
    let extra = '';
    if (e.sit === 'aguardando') extra = ` · em ${e.dias}d`;
    else if (e.sit === 'liberar' || e.sit === 'em_andamento') extra = e.dias === null ? '' : ` · termina em ${e.dias}d`;
    else if (e.sit === 'vencida' || e.sit === 'vencida_nao_liberada') extra = ` · há ${e.dias}d`;
    return `<span class="ave-pill" style="--c:${cor}">${txt}${extra}</span>`;
  }
  function celEtapa(e) {
    const datas = e.lib ? `<div style="font-size:10.5px;color:var(--muted)">liberar ${U.fmtDateBR(e.lib)} · término ${U.fmtDateBR(e.fim)}</div>` : '';
    const res = FEITAS.includes(e.sit)
      ? `<div style="font-size:10.5px;margin-top:2px">${e.martelo ? `<b style="color:${M.CORES_MARTELO[e.martelo]}">${esc(M.MARTELO_CURTO[e.martelo])}</b>` : 'Sem decisão'}${e.nota === null ? '' : ` · nota ${U.fmt1(e.nota)}`}${e.data ? ` · ${U.fmtDateBR(e.data)}` : ''}</div>` : '';
    return `<td>${pillEtapa(e)}${datas}${res}</td>`;
  }

  const estado = { ano: null, busca: '', filtro: 'todos' };
  const FILTROS = {
    todos: ['Situação: todas', () => true],
    liberar: ['Liberar no Feedz agora', r => r.e1.sit === 'liberar' || r.e2.sit === 'liberar'],
    proximas: ['Liberam nos próximos 7 dias', r => [r.e1, r.e2].some(e => e.sit === 'aguardando' && e.dias <= 7)],
    andamento: ['Liberadas — sem resposta do gestor', r => r.e1.sit === 'em_andamento' || r.e2.sit === 'em_andamento'],
    vencidas: ['Vencidas', r => [r.e1, r.e2].some(e => e.sit === 'vencida' || e.sit === 'vencida_nao_liberada')],
    concluidas: ['Com avaliação concluída', r => FEITAS.includes(r.e1.sit) || FEITAS.includes(r.e2.sit)],
    deslig: ['Desligados sem avaliação', r => r.e1.sit === 'saiu_antes' || r.e1.sit === 'saiu_sem'],
    evitar: ['Admissão em data a evitar', r => r.evitar]
  };

  function resumoEtapa(rows, k) {
    const es = rows.map(r => r[k]);
    const n = s => es.filter(e => e.sit === s).length;
    const feitas = es.filter(e => FEITAS.includes(e.sit));
    const dec = feitas.filter(e => e.martelo >= 1 && e.martelo <= 4);
    const base = es.filter(e => e.sit !== 'aguardando' && e.sit !== 'saiu_antes' && e.sit !== 'sem_calendario').length;
    return {
      liberar: n('liberar'), aguardando: n('aguardando'), andamento: n('em_andamento'), vencidas: n('vencida') + n('vencida_nao_liberada'),
      feitas: feitas.length, base, taxa: base ? feitas.length / base : null,
      aprov: dec.filter(e => e.martelo >= 3).length, reprov: dec.filter(e => e.martelo <= 2).length, decididos: dec.length,
      nota: media(feitas.map(e => e.nota).filter(v => v !== null))
    };
  }

  function exportar(rows, ano) {
    const cab = ['Colaborador', 'Situação', 'Cargo', 'Unidade', 'Departamento', 'Gestor', 'Admissão', 'Data a evitar', 'Saída',
      '1º período — liberar em', '1º período — término', '1º período — situação', '1º período — avaliado em', '1º período — Batendo o Martelo', '1º período — nota gestor',
      '2º período — liberar em', '2º período — término', '2º período — situação', '2º período — avaliado em', '2º período — Batendo o Martelo', '2º período — nota gestor'];
    const cel = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const et = e => [e.lib, e.fim, (SIT[e.sit] || [])[1], e.data, e.martelo ? M.MARTELO[e.martelo] : '', e.nota === null ? '' : e.nota.toFixed(2).replace('.', ',')];
    const linhas = rows.map(r => [r.nome, r.situacao ? M.SITUACOES[r.situacao] || r.situacao : '', r.cargo, r.unidade, r.departamento, r.gestor, r.adm, r.evitar ? 'Sim' : '', r.saida]
      .concat(et(r.e1)).concat(et(r.e2)).map(cel).join(';'));
    const blob = new Blob(['﻿' + [cab.map(cel).join(';')].concat(linhas).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `avaliacao-experiencia-extra-natal-${ano}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function render(body, f) {
    const anos = anosDisponiveis();
    if (!estado.ano || !anos.includes(estado.ano)) estado.ano = anos.includes(new Date().getFullYear()) ? new Date().getFullYear() : anos[0];
    const ano = estado.ano;
    const cal = CALENDARIOS[ano];
    const rows = montar(ano, f);
    const a1 = resumoEtapa(rows, 'e1'), a2 = resumoEtapa(rows, 'e2');
    const ativos = rows.filter(r => r.situacao !== 'desligado').length;
    const deslig = rows.filter(r => r.situacao === 'desligado');
    const desligSem = deslig.filter(r => !FEITAS.includes(r.e1.sit) && !FEITAS.includes(r.e2.sit)).length;
    const prox7 = rows.filter(FILTROS.proximas[1]).length;

    const seletor = `<div class="toolbar">
      <span style="font-size:12px;color:var(--text2);font-weight:700">Ano do Extra Natal</span>
      <select id="natal-ano">${anos.map(a => `<option value="${a}" ${a === ano ? 'selected' : ''}>${a}${CALENDARIOS[a] ? '' : ' (histórico)'}</option>`).join('')}</select>
      <span style="font-size:11.5px;color:var(--muted)">Colaboradores com a tag <b>extra.natal.${ano}</b> no Headcount. O filtro de datas da barra superior não se aplica aqui.</span>
    </div>`;

    if (!rows.length) {
      body.innerHTML = seletor + empty(`Nenhum colaborador com a tag extra.natal.${ano} nos filtros selecionados.`, 'A tag vem da coluna Grupos do Headcount (planilha de Colaboradores).');
      body.querySelector('#natal-ano').addEventListener('change', e => { estado.ano = Number(e.target.value); render(body, f); });
      return;
    }

    const aviso = cal ? '' : `<div class="insight info" style="margin-bottom:16px"><span class="ic">&#8505;&#65039;</span><span><strong>Histórico:</strong> não há calendário de experiência cadastrado para ${ano}, então as datas de liberação e término não são calculadas — a tela mostra só as avaliações que foram respondidas (planilhas AVE 45 e 90 dias).</span></div>`;
    const kpis = `<div class="kpi-grid">
      ${kpi('Contratados Extra Natal', U.fmtInt(rows.length), `${U.fmtInt(ativos)} ativos · ${U.fmtInt(deslig.length)} desligados`, 'var(--p1)')}
      ${cal ? kpi('Liberar no Feedz agora', U.fmtInt(a1.liberar + a2.liberar), `${U.fmtInt(a1.liberar)} do 1º período · ${U.fmtInt(a2.liberar)} do 2º${prox7 ? ` · +${U.fmtInt(prox7)} liberam em 7 dias` : ''}`, a1.liberar + a2.liberar ? 'var(--critical)' : '#1baf7a') : ''}
      ${kpi('Liberadas sem resposta do gestor', U.fmtInt(a1.andamento + a2.andamento), `${U.fmtInt(a1.andamento)} do 1º período · ${U.fmtInt(a2.andamento)} do 2º`, a1.andamento + a2.andamento ? '#eda100' : '#1baf7a')}
      ${cal ? kpi('Vencidas', U.fmtInt(a1.vencidas + a2.vencidas), `período encerrado sem avaliação · ${U.fmtInt(a1.vencidas)} do 1º · ${U.fmtInt(a2.vencidas)} do 2º`, a1.vencidas + a2.vencidas ? 'var(--critical)' : '#1baf7a') : ''}
      ${kpi('1º período — concluídas', a1.taxa === null ? U.fmtInt(a1.feitas) : pct(a1.taxa), a1.base ? `${U.fmtInt(a1.feitas)} de ${U.fmtInt(a1.base)} ${cal ? "já liberadas" : "contratados"}${a1.aguardando ? ` · ${U.fmtInt(a1.aguardando)} aguardando` : ''}` : (a1.aguardando ? `${U.fmtInt(a1.aguardando)} aguardando liberação` : 'nenhuma liberada'), '#4a3aa7')}
      ${kpi('2º período — concluídas', a2.taxa === null ? U.fmtInt(a2.feitas) : pct(a2.taxa), a2.base ? `${U.fmtInt(a2.feitas)} de ${U.fmtInt(a2.base)} ${cal ? "já liberadas" : "contratados"}${a2.aguardando ? ` · ${U.fmtInt(a2.aguardando)} aguardando` : ''}` : (a2.aguardando ? `${U.fmtInt(a2.aguardando)} aguardando liberação` : 'nenhuma liberada'), '#805AD5')}
      ${kpi('Aprovados (1º período)', a1.decididos ? pct(a1.aprov / a1.decididos) : '—', `${U.fmtInt(a1.aprov)} aprovados · ${U.fmtInt(a1.reprov)} reprovados de ${U.fmtInt(a1.decididos)} decisões`, '#1baf7a')}
      ${kpi('Aprovados (2º período)', a2.decididos ? pct(a2.aprov / a2.decididos) : '—', `${U.fmtInt(a2.aprov)} aprovados · ${U.fmtInt(a2.reprov)} reprovados de ${U.fmtInt(a2.decididos)} decisões`, '#1baf7a')}
      ${kpi('Nota média do gestor', a1.nota === null ? '—' : U.fmt1(a1.nota), a2.nota === null ? '1º período' : `1º período · ${U.fmt1(a2.nota)} no 2º`, '#4a3aa7')}
      ${kpi('Desligados sem avaliação', U.fmtInt(desligSem), deslig.length ? `de ${U.fmtInt(deslig.length)} desligados do Extra Natal` : 'nenhum desligado', desligSem ? 'var(--critical)' : '#1baf7a')}
    </div>`;

    // Por unidade
    const porUn = new Map();
    for (const r of rows) { if (!porUn.has(r.unidade)) porUn.set(r.unidade, []); porUn.get(r.unidade).push(r); }
    const linhasUn = Array.from(porUn.entries()).sort((a, b) => b[1].length - a[1].length).map(([u, rs]) => {
      const x1 = resumoEtapa(rs, 'e1'), x2 = resumoEtapa(rs, 'e2');
      const pend = x1.liberar + x2.liberar + x1.andamento + x2.andamento + x1.vencidas + x2.vencidas;
      return `<tr><td>${esc(u)}</td><td><b>${U.fmtInt(rs.length)}</b></td><td>${U.fmtInt(rs.filter(r => r.situacao === 'desligado').length)}</td><td>${U.fmtInt(x1.feitas)}</td><td>${U.fmtInt(x2.feitas)}</td><td>${pend ? `<b style="color:var(--critical)">${U.fmtInt(pend)}</b>` : '<span style="color:var(--muted)">0</span>'}</td></tr>`;
    }).join('');
    const tabUn = `<div class="table-wrap"><table class="dt"><thead><tr><th>Unidade</th><th>Contratados</th><th>Desligados</th><th>1º período concluídas</th><th>2º período concluídas</th><th title="A liberar agora, liberadas sem resposta ou vencidas">Pendências</th></tr></thead><tbody>${linhasUn}</tbody></table></div>`;

    const tabCal = cal ? `<div class="table-wrap"><table class="dt"><thead><tr><th>Admissão</th><th>Liberar 1ª avaliação</th><th>Término da 1ª experiência</th><th>Liberar 2ª avaliação</th><th>Término da prorrogação</th></tr></thead><tbody>${cal.faixas.map((x, i) => {
      const de = i === 0 ? cal.inicio : U.addDays(cal.faixas[i - 1][0], 1);
      return `<tr><td>${i === 0 ? 'até' : U.fmtDateBR(de) + ' a'} ${U.fmtDateBR(x[0])}</td><td>${U.fmtDateBR(U.addDays(x[1], -ANTECEDENCIA))}</td><td>${U.fmtDateBR(x[1])}</td><td>${U.fmtDateBR(U.addDays(x[2], -ANTECEDENCIA))}</td><td>${U.fmtDateBR(x[2])}</td></tr>`;
    }).join('')}</tbody></table></div><p style="font-size:11.5px;color:var(--muted);margin-top:8px">Calendário do DP (calendario_extranatal_${ano}.xlsx). A avaliação é liberada ${ANTECEDENCIA} dias antes do término de cada período. Admissões antes de ${U.fmtDateBR(cal.inicio)} seguem a primeira faixa.</p>` : '';

    body.innerHTML = `
      ${seletor}${aviso}${kpis}
      <div class="grid2">
        ${card('Extra Natal por unidade', '&#128205;', tabUn)}
        ${cal ? card(`Calendário de experiência — Extra Natal ${ano}`, '&#128197;', tabCal) : ''}
      </div>
      <div style="margin-top:16px">
        <div class="toolbar">
          <input type="text" id="natal-busca" placeholder="Buscar colaborador, cargo, unidade ou gestor..." value="${esc(estado.busca)}">
          <select id="natal-filtro">${Object.keys(FILTROS).map(k => `<option value="${k}" ${estado.filtro === k ? 'selected' : ''}>${FILTROS[k][0]}</option>`).join('')}</select>
          <button type="button" class="btn btn-outline btn-sm" id="natal-csv" style="width:auto">Exportar CSV</button>
        </div>
        <div id="natal-tabela"></div>
      </div>`;

    let visiveis = [];
    const desenhar = () => {
      const b = norm(estado.busca);
      visiveis = rows.filter(FILTROS[estado.filtro][1]).filter(r => !b || norm([r.nome, r.cargo, r.unidade, r.gestor].join(' ')).includes(b))
        .sort((x, y) => String(x.e1.lib || x.adm || '9').localeCompare(String(y.e1.lib || y.adm || '9')) || String(x.adm || '').localeCompare(String(y.adm || '')) || x.nome.localeCompare(y.nome, 'pt-BR'));
      const alvo = body.querySelector('#natal-tabela');
      if (!visiveis.length) { alvo.innerHTML = empty('Nenhum colaborador encontrado com esses filtros.'); return; }
      alvo.innerHTML = `<p style="font-size:11.5px;color:var(--muted);margin-bottom:8px">${U.fmtInt(visiveis.length)} de ${U.fmtInt(rows.length)} colaboradores · ordenados pela data de liberação da 1ª avaliação</p>
        <div class="table-wrap" style="max-height:none"><table class="dt"><thead><tr><th>Colaborador</th><th>Unidade / gestor</th><th>Admissão</th><th title="Respostas da planilha AVE 45 DIAS">1º período</th><th title="Respostas da planilha AVE 90 DIAS">2º período (prorrogação)</th></tr></thead><tbody>${visiveis.map(r => `<tr>
          <td><b>${esc(r.nome)}</b> ${r.situacao && M.SITUACOES[r.situacao] ? `<span class="ave-pill" style="--c:${M.CORES_SITUACAO[r.situacao]}">${M.SITUACOES[r.situacao]}</span>` : ''}<div style="color:var(--muted);font-size:10.5px">${esc(r.cargo)}</div></td>
          <td>${esc(r.unidade)}<div style="color:var(--muted);font-size:10.5px">${esc(r.gestor)}</div></td>
          <td>${r.adm ? U.fmtDateBR(r.adm) : '—'}${r.saida ? `<div style="color:var(--muted);font-size:10.5px">saída ${U.fmtDateBR(r.saida)}</div>` : ''}${r.evitar ? '<div><span class="ave-pill" style="--c:#eb6834" title="A planilha do DP marca esta data de admissão como EVITAR (experiência curta)">Data a evitar</span></div>' : ''}${r.antesDoInicio ? '<div style="color:var(--muted);font-size:10.5px" title="Admissão anterior ao início do calendário: segue a primeira faixa">segue 1ª faixa</div>' : ''}</td>
          ${celEtapa(r.e1)}${celEtapa(r.e2)}</tr>`).join('')}</tbody></table></div>`;
    };
    desenhar();
    body.querySelector('#natal-ano').addEventListener('change', e => { estado.ano = Number(e.target.value); render(body, f); });
    body.querySelector('#natal-busca').addEventListener('input', e => { estado.busca = e.target.value; desenhar(); });
    body.querySelector('#natal-filtro').addEventListener('change', e => { estado.filtro = e.target.value; desenhar(); });
    body.querySelector('#natal-csv').addEventListener('click', () => exportar(visiveis, ano));
  }

  function contagemAtual() {
    const ano = new Date().getFullYear();
    return ((window.HUB_DATA && window.HUB_DATA.colaboradores) || []).filter(c => M.anosNatal(c.grupos).includes(ano)).length;
  }

  window.HUB_EXP_NATAL = { CALENDARIOS, periodos, montar, render, contagemAtual };
})();
