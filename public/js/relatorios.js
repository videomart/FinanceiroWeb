const PageRelatorios = {
  chartInstance: null,

  async render(container) {
    App.showLoading('contentArea');
    try {
      const [previsao, resumo, vencimentos, categorias] = await Promise.all([
        API.get('/api/relatorios/previsao?meses=6'),
        API.get('/api/relatorios/resumo-geral'),
        API.get('/api/relatorios/proximos-vencimentos?dias=30'),
        API.get('/api/relatorios/por-categoria')
      ]);
      this.build(container, previsao, resumo, vencimentos, categorias);
    } catch (e) {
      App.showError('contentArea', 'Erro ao carregar relatórios: ' + e.message);
    }
  },

  build(container, previsao, resumo, vencimentos, categorias) {
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const hoje = new Date();
    const mesAtual = meses[hoje.getMonth()];

    container.innerHTML = `
      <div class="stats-grid fade-in">
        <div class="stat-card warning"><div class="stat-label">Saldo Atual (${mesAtual})</div><div class="stat-value">${App.formatCurrency(resumo.saldoDisponivel)}</div></div>
        <div class="stat-card negative"><div class="stat-label">A Pagar Total</div><div class="stat-value">${App.formatCurrency(resumo.aPagarPendente + resumo.aPagarAtrasado)}</div></div>
        <div class="stat-card positive"><div class="stat-label">A Receber Total</div><div class="stat-value">${App.formatCurrency(resumo.aReceberPendente + resumo.aReceberAtrasado)}</div></div>
        <div class="stat-card info"><div class="stat-label">Venc. nos próximos 30d</div><div class="stat-value">${vencimentos.length}</div></div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-header"><h3>Previsão Próximos 6 Meses</h3></div>
          <div class="table-container">
            <table>
              <thead><tr><th>Mês</th><th>A Pagar</th><th>A Receber</th><th>Saldo Previsto</th></tr></thead>
              <tbody>
                ${previsao.map(p => `<tr>
                  <td><strong>${meses[p.mes-1]}/${p.ano}</strong></td>
                  <td class="${p.aPagar > 0 ? 'negative' : ''}">${App.formatCurrency(p.aPagar)}</td>
                  <td class="${p.aReceber > 0 ? 'positive' : ''}">${App.formatCurrency(p.aReceber)}</td>
                  <td class="${p.saldo >= 0 ? 'positive' : 'negative'}"><strong>${App.formatCurrency(p.saldo)}</strong></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Contas por Categoria</h3></div>
          <div class="table-container">
            <table>
              <thead><tr><th>Categoria</th><th>A Pagar</th><th>A Receber</th></tr></thead>
              <tbody>
                ${(() => {
                  const todasCats = new Set();
                  categorias.pagar.forEach(c => todasCats.add(c.nome));
                  categorias.receber.forEach(c => todasCats.add(c.nome));
                  if (todasCats.size === 0) return '<tr><td colspan="3" class="empty-state">Nenhuma categoria</td></tr>';
                  return Array.from(todasCats).map(nome => {
                    const pag = categorias.pagar.find(c => c.nome === nome);
                    const rec = categorias.receber.find(c => c.nome === nome);
                    return `<tr>
                      <td>${nome || 'Sem categoria'}</td>
                      <td class="negative">${pag ? App.formatCurrency(pag.total) : '-'}</td>
                      <td class="positive">${rec ? App.formatCurrency(rec.total) : '-'}</td>
                    </tr>`;
                  }).join('');
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Próximos Vencimentos (30 dias)</h3></div>
        <div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Tipo</th><th>Status</th></tr></thead>
            <tbody>
              ${vencimentos.length === 0 ? '<tr><td colspan="5" class="empty-state">Nenhum vencimento nos próximos 30 dias</td></tr>' :
              vencimentos.map(v => `<tr>
                <td>${App.formatDate(v.data_vencimento)}</td>
                <td>${v.descricao}</td>
                <td>${App.formatCurrency(v.valor)}</td>
                <td><span class="badge ${v.tipo === 'pagar' ? 'badge-atrasado' : 'badge-recebido'}">${v.origem}</span></td>
                <td>${App.getStatusBadge(v.status)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Gráfico de Previsão</h3></div>
        <div class="chart-area"><canvas id="chartRelatorio"></canvas></div>
      </div>
    `;

    this.renderChart(previsao);
  },

  renderChart(previsao) {
    if (this.chartInstance) this.chartInstance.destroy();
    const ctx = document.getElementById('chartRelatorio');
    if (!ctx) return;
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const labels = previsao.map(p => `${meses[p.mes-1]}/${p.ano}`);

    this.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'A Pagar', data: previsao.map(p => p.aPagar), backgroundColor: 'rgba(217,48,37,0.7)', borderColor: '#d93025', borderWidth: 1 },
          { label: 'A Receber', data: previsao.map(p => p.aReceber), backgroundColor: 'rgba(15,157,88,0.7)', borderColor: '#0f9d58', borderWidth: 1 },
          { label: 'Saldo', data: previsao.map(p => p.saldo), type: 'line', borderColor: '#1a73e8', backgroundColor: 'rgba(26,115,232,0.1)', fill: true, pointRadius: 4, tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR') } } }
      }
    });
  }
};
