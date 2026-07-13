const PageContasPagar = {
  page: 1,
  filterStatus: '',

  async render(container) {
    App.showLoading('contentArea');
    try {
      const [stats, data] = await Promise.all([
        API.get('/api/contas-pagar/estatisticas'),
        API.get(`/api/contas-pagar?page=${this.page}&limit=50&status=${this.filterStatus}`)
      ]);
      this.build(container, stats, data);
    } catch (e) {
      App.showError('contentArea', 'Erro ao carregar contas: ' + e.message);
    }
  },

  build(container, stats, data) {
    container.innerHTML = `
      <div class="stats-grid fade-in">
        <div class="stat-card warning"><div class="stat-label">Pendentes</div><div class="stat-value">${stats.pendentes.quantidade}</div><small>${App.formatCurrency(stats.pendentes.total)}</small></div>
        <div class="stat-card negative"><div class="stat-label">Atrasadas</div><div class="stat-value">${stats.atrasadas.quantidade}</div><small>${App.formatCurrency(stats.atrasadas.total)}</small></div>
        <div class="stat-card positive"><div class="stat-label">Pagas</div><div class="stat-value">${stats.pagas.quantidade}</div><small>${App.formatCurrency(stats.pagas.total)}</small></div>
        <div class="stat-card info"><div class="stat-label">Vencendo em 7 dias</div><div class="stat-value">${stats.proximas.length}</div></div>
        <div class="stat-card info"><div class="stat-label">Recorrentes</div><div class="stat-value">${stats.recorrentes.quantidade}</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>Todas as Contas a Pagar</h3>
          <button class="btn btn-primary" onclick="PageContasPagar.abrirForm()">+ Nova Conta</button>
        </div>
        <div class="filter-bar">
          <select class="form-control" id="filterStatus" onchange="PageContasPagar.filtrar()">
            <option value="">Todos os status</option>
            <option value="pendente" ${this.filterStatus === 'pendente' ? 'selected' : ''}>Pendentes</option>
            <option value="pago" ${this.filterStatus === 'pago' ? 'selected' : ''}>Pagas</option>
            <option value="atrasado" ${this.filterStatus === 'atrasado' ? 'selected' : ''}>Atrasadas</option>
            <option value="cancelado" ${this.filterStatus === 'cancelado' ? 'selected' : ''}>Canceladas</option>
          </select>
        </div>
        <div class="table-container">
          <table>
            <thead><tr><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Categoria</th><th>Rec</th><th>Boleto</th><th>Status</th><th>Pagamento</th><th>Ações</th></tr></thead>
            <tbody>
              ${data.rows.length === 0 ? '<tr><td colspan="9" class="empty-state">Nenhuma conta encontrada</td></tr>' :
              data.rows.map(c => `<tr>
                <td><strong>${c.descricao}</strong>${c.observacao ? `<br><small>${c.observacao}</small>` : ''}</td>
                <td>${App.formatCurrency(c.valor)}</td>
                <td>${App.formatDate(c.data_vencimento)}</td>
                <td>${c.categoria_nome || '-'}</td>
                <td>${c.recorrente ? '<span class="badge badge-recebido">Sim</span>' : '-'}</td>
                <td>${c.codigo_barras ? '<span class="badge badge-info">&#128196;</span>' : '-'}</td>
                <td>${App.getStatusBadge(c.status)}</td>
                <td>${c.status === 'pago' ? `${App.formatDate(c.data_pagamento)}<br><small>${App.formatCurrency(c.valor_pago)}</small>` : '-'}</td>
                <td>
                  <div class="btn-group">
                    ${c.status !== 'pago' && c.status !== 'cancelado' ? `<button class="btn btn-success btn-sm" onclick="PageContasPagar.pagar(${c.id})">Pagar</button>` : ''}
                    <button class="btn btn-outline btn-sm" onclick="PageContasPagar.abrirForm(${c.id})">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="PageContasPagar.excluir(${c.id})">Excluir</button>
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  filtrar() {
    this.filterStatus = document.getElementById('filterStatus').value;
    this.page = 1;
    this.render(document.getElementById('contentArea'));
  },

  async abrirForm(id) {
    let c = { descricao: '', valor: '', data_vencimento: '', categoria_id: '', observacao: '', recorrente: false, frequencia: '', codigo_barras: '', linha_digitavel: '', data_emissao: '' };
    if (id) {
      try { c = await API.get(`/api/contas-pagar/${id}`); } catch (e) { return; }
    }
    const cats = await getCategorias();
    const hoje = new Date().toISOString().split('T')[0];

    App.openModal(id ? 'Editar Conta a Pagar' : 'Nova Conta a Pagar', `
      <div class="form-group">
        <label>Descrição *</label>
        <input class="form-control" id="f_descricao" value="${c.descricao}" placeholder="Ex: Aluguel">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Valor *</label>
          <input class="form-control" id="f_valor" type="number" step="0.01" value="${c.valor}" placeholder="0,00">
        </div>
        <div class="form-group">
          <label>Data de Vencimento *</label>
          <input class="form-control" id="f_data_vencimento" type="date" value="${c.data_vencimento}">
        </div>
      </div>
      <div class="form-group">
        <label>Categoria</label>
        <select class="form-control" id="f_categoria_id">
          <option value="">Selecione...</option>
          ${cats.filter(cat => cat.tipo === 'despesa' || cat.tipo === 'ambos').map(cat => `<option value="${cat.id}" ${cat.id === c.categoria_id ? 'selected' : ''}>${cat.nome}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Observação</label>
        <textarea class="form-control" id="f_observacao" rows="2">${c.observacao || ''}</textarea>
      </div>
      <hr>
      <h4 style="margin-bottom:12px">Recorrência</h4>
      <div class="form-row">
        <div class="form-group">
          <label>
            <input type="checkbox" id="f_recorrente" ${c.recorrente ? 'checked' : ''} onchange="document.getElementById('freqGroup').style.display=this.checked?'block':'none'">
            Conta Recorrente
          </label>
        </div>
        <div class="form-group" id="freqGroup" style="${c.recorrente ? 'display:block' : 'display:none'}">
          <label>Frequência</label>
          <select class="form-control" id="f_frequencia">
            <option value="mensal" ${c.frequencia === 'mensal' ? 'selected' : ''}>Mensal</option>
            <option value="semanal" ${c.frequencia === 'semanal' ? 'selected' : ''}>Semanal</option>
            <option value="quinzenal" ${c.frequencia === 'quinzenal' ? 'selected' : ''}>Quinzenal</option>
            <option value="bimestral" ${c.frequencia === 'bimestral' ? 'selected' : ''}>Bimestral</option>
            <option value="trimestral" ${c.frequencia === 'trimestral' ? 'selected' : ''}>Trimestral</option>
            <option value="semestral" ${c.frequencia === 'semestral' ? 'selected' : ''}>Semestral</option>
            <option value="anual" ${c.frequencia === 'anual' ? 'selected' : ''}>Anual</option>
          </select>
        </div>
      </div>
      <hr>
      <h4 style="margin-bottom:12px">Boleto</h4>
      <div class="form-row">
        <div class="form-group">
          <label>Código de Barras</label>
          <input class="form-control" id="f_codigo_barras" value="${c.codigo_barras || ''}" placeholder="Código de barras">
        </div>
        <div class="form-group">
          <label>Linha Digitável</label>
          <input class="form-control" id="f_linha_digitavel" value="${c.linha_digitavel || ''}" placeholder="Linha digitável">
        </div>
      </div>
      <div class="form-group">
        <label>Data de Emissão</label>
        <input class="form-control" id="f_data_emissao" type="date" value="${c.data_emissao || hoje}">
      </div>
    `, `
      <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="PageContasPagar.salvar(${id || ''})">Salvar</button>
    `);
  },

  async salvar(id) {
    const data = {
      descricao: document.getElementById('f_descricao').value,
      valor: parseFloat(document.getElementById('f_valor').value) || 0,
      data_vencimento: document.getElementById('f_data_vencimento').value,
      categoria_id: parseInt(document.getElementById('f_categoria_id').value) || null,
      observacao: document.getElementById('f_observacao').value,
      recorrente: document.getElementById('f_recorrente').checked,
      frequencia: document.getElementById('f_recorrente').checked ? document.getElementById('f_frequencia').value : null,
      codigo_barras: document.getElementById('f_codigo_barras').value || null,
      linha_digitavel: document.getElementById('f_linha_digitavel').value || null,
      data_emissao: document.getElementById('f_data_emissao').value || null
    };
    if (!data.descricao || !data.valor || !data.data_vencimento) {
      alert('Preencha descrição, valor e data de vencimento'); return;
    }
    try {
      if (id) { await API.put(`/api/contas-pagar/${id}`, data); }
      else { await API.post('/api/contas-pagar', data); }
      App.closeModal();
      this.render(document.getElementById('contentArea'));
    } catch (e) { alert('Erro ao salvar: ' + e.message); }
  },

  async pagar(id) {
    const conta = await API.get(`/api/contas-pagar/${id}`);
    const hoje = new Date().toISOString().split('T')[0];
    let msgRec = '';
    if (conta.recorrente) msgRec = '<p style="color:var(--success);margin-top:8px"><strong>Conta recorrente:</strong> ao pagar, será gerada automaticamente a próxima parcela.</p>';
    App.openModal('Registrar Pagamento', `
      <div class="form-group">
        <label>Conta</label>
        <p><strong>${conta.descricao}</strong></p>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Valor Original</label>
          <p><strong>${App.formatCurrency(conta.valor)}</strong></p>
        </div>
        <div class="form-group">
          <label>Valor Pago *</label>
          <input class="form-control" id="f_valor_pago" type="number" step="0.01" value="${conta.valor}">
        </div>
      </div>
      <div class="form-group">
        <label>Data do Pagamento *</label>
        <input class="form-control" id="f_data_pagamento" type="date" value="${hoje}">
      </div>
      ${msgRec}
    `, `
      <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
      <button class="btn btn-success" onclick="PageContasPagar.confirmarPagamento(${id})">Confirmar Pagamento</button>
    `);
  },

  async confirmarPagamento(id) {
    const data = {
      valor_pago: parseFloat(document.getElementById('f_valor_pago').value) || 0,
      data_pagamento: document.getElementById('f_data_pagamento').value
    };
    try {
      await API.put(`/api/contas-pagar/${id}/pagar`, data);
      App.closeModal();
      this.render(document.getElementById('contentArea'));
    } catch (e) { alert('Erro: ' + e.message); }
  },

  async excluir(id) {
    if (!confirm('Tem certeza?')) return;
    try {
      await API.del(`/api/contas-pagar/${id}`);
      this.render(document.getElementById('contentArea'));
    } catch (e) { alert('Erro: ' + e.message); }
  }
};
