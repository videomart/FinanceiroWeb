const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed`);
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `POST ${url} failed`); }
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `PUT ${url} failed`); }
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `DELETE ${url} failed`); }
    return res.json();
  }
};

const App = {
  currentPage: 'dashboard',
  charts: {},

  init() {
    this.updateDate();
    this.setupNavigation();
    this.setupModal();
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  updateDate() {
    const d = new Date();
    document.getElementById('currentDate').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  },

  setupNavigation() {
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      });
    });
  },

  setupModal() {
    document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });
  },

  openModal(title, bodyHtml, footerHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFooter').innerHTML = footerHtml || '';
    document.getElementById('modalOverlay').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
  },

  showLoading(containerId) {
    document.getElementById(containerId).innerHTML = '<div class="empty-state"><p>Carregando...</p></div>';
  },

  showError(containerId, msg) {
    document.getElementById(containerId).innerHTML = `<div class="empty-state"><p style="color:var(--danger)">${msg}</p></div>`;
  },

  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR');
  },

  getStatusBadge(status, labels) {
    const map = labels || { pendente: 'Pendente', pago: 'Pago', recebido: 'Recebido', atrasado: 'Atrasado', vencido: 'Vencido', cancelado: 'Cancelado' };
    return `<span class="badge badge-${status}">${map[status] || status}</span>`;
  },

  route() {
    const hash = window.location.hash || '#/dashboard';
    const page = hash.split('?')[0].replace('#/', '');
    const pageName = page || 'dashboard';

    document.querySelectorAll('.nav-item').forEach(i => {
      i.classList.toggle('active', i.dataset.page === pageName);
    });

    const titles = {
      'dashboard': 'Dashboard',
      'contas-pagar': 'Contas a Pagar',
      'contas-receber': 'Contas a Receber',
      'relatorios': 'Relatórios'
    };
    document.getElementById('pageTitle').textContent = titles[pageName] || 'Dashboard';

    this.currentPage = pageName;
    const area = document.getElementById('contentArea');

    switch (pageName) {
      case 'dashboard': PageDashboard.render(area); break;
      case 'contas-pagar': PageContasPagar.render(area); break;
      case 'contas-receber': PageContasReceber.render(area); break;
      case 'relatorios': PageRelatorios.render(area); break;
      default: window.location.hash = '#/dashboard';
    }
  }
};

async function getCategorias() {
  try {
    const res = await fetch('/api/categorias');
    if (res.ok) return await res.json();
  } catch (e) {}
  return [
    { id: 1, nome: 'Salário', tipo: 'receita' }, { id: 2, nome: 'Freelance', tipo: 'receita' },
    { id: 3, nome: 'Investimentos', tipo: 'receita' }, { id: 4, nome: 'Aluguel', tipo: 'despesa' },
    { id: 5, nome: 'Água', tipo: 'despesa' }, { id: 6, nome: 'Luz', tipo: 'despesa' },
    { id: 7, nome: 'Internet', tipo: 'despesa' }, { id: 8, nome: 'Telefone', tipo: 'despesa' },
    { id: 9, nome: 'Alimentação', tipo: 'despesa' }, { id: 10, nome: 'Transporte', tipo: 'despesa' },
    { id: 11, nome: 'Saúde', tipo: 'despesa' }, { id: 12, nome: 'Educação', tipo: 'despesa' },
    { id: 13, nome: 'Lazer', tipo: 'despesa' }, { id: 14, nome: 'Assinaturas', tipo: 'despesa' },
    { id: 15, nome: 'Impostos', tipo: 'despesa' }, { id: 16, nome: 'Outros', tipo: 'ambos' }
  ];
}

document.addEventListener('DOMContentLoaded', () => App.init());
