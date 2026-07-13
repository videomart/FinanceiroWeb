const PageDashboard = {
  chartInstance: null,

  async render(container) {
    container.innerHTML = '<div class="empty-state"><p>Carregando dashboard...</p></div>';
    try {
      const data = await API.get('/api/relatorios/resumo-geral');
      const previsao = await API.get('/api/relatorios/previsao?meses=12');
      this.build(container, data, previsao);
    } catch (e) {
      App.showError('contentArea', 'Erro ao carregar dashboard: ' + e.message);
    }
  },

  build(container, data, previsao) {
    container.innerHTML = `
      <div class="stats-grid fade-in">
        <div class="stat-card warning">
          <div class="stat-label">A Pagar (Pendente)</div>
          <div class="stat-value">${App.formatCurrency(data.aPagarPendente)}</div>
        </div>
        <div class="stat-card negative">
          <div class="stat-label">A Pagar (Atrasado)</div>
          <div class="stat-value">${App.formatCurrency(data.aPagarAtrasado)}</div>
        </div>
        <div class="stat-card positive">
          <div class="stat-label">Pago este Mês</div>
          <div class="stat-value">${App.formatCurrency(data.aPagarPagoMes)}</div>
        </div>
        <div class="stat-card info">
          <div class="stat-label">A Receber (Pendente)</div>
          <div class="stat-value">${App.formatCurrency(data.aReceberPendente)}</div>
        </div>
        <div class="stat-card positive">
          <div class="stat-label">Recebido este Mês</div>
          <div class="stat-value">${App.formatCurrency(data.aReceberRecebidoMes)}</div>
        </div>
        <div class="stat-card negative">
          <div class="stat-label">A Receber (Atrasado)</div>
          <div class="stat-value">${App.formatCurrency(data.aReceberAtrasado)}</div>
        </div>
        <div class="stat-card ${data.saldoDisponivel >= 0 ? 'positive' : 'negative'}">
          <div class="stat-label">Saldo do Mês</div>
          <div class="stat-value">${App.formatCurrency(data.saldoDisponivel)}</div>
        </div>
        <div class="stat-card info">
          <div class="stat-label">Recorr. Ativas</div>
          <div class="stat-value">${data.contasRecorrentes}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Previsão Financeira - Próximos 12 Meses</h3></div>
        <div class="chart-area"><canvas id="chartPrevisao"></canvas></div>
      </div>
    `;

    this.renderChart(previsao);
  },

  renderChart(previsao) {
    if (this.chartInstance) this.chartInstance.destroy();
    const ctx = document.getElementById('chartPrevisao');
    if (!ctx) return;
    const labels = previsao.map(p => {
      const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${meses[p.mes-1]}/${p.ano}`;
    });

    this.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Contas a Pagar', data: previsao.map(p => p.aPagar), backgroundColor: 'rgba(217,48,37,0.7)', borderColor: '#d93025', borderWidth: 1 },
          { label: 'Contas a Receber', data: previsao.map(p => p.aReceber), backgroundColor: 'rgba(15,157,88,0.7)', borderColor: '#0f9d58', borderWidth: 1 },
          { label: 'Saldo', data: previsao.map(p => p.saldo), backgroundColor: 'rgba(26,115,232,0.3)', borderColor: '#1a73e8', borderWidth: 1, type: 'line', pointRadius: 4 }
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
