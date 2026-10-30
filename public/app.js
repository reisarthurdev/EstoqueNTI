const $ = (selector, el = document) => el.querySelector(selector);
const $$ = (selector, el = document) => [...el.querySelectorAll(selector)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = d => (d ? new Date(d.replace(' ', 'T')).toLocaleString('pt-BR') : '');
const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '');
const isoDate = d => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD no fuso local
const norm = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const raw = html => ({ raw: html });
const telHref = phone => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
const APP = 'Estoque NTI';
const HAS_POPOVER = 'showPopover' in HTMLElement.prototype;

// ---------- estilo: azul claro + vidro fosco (as classes .glass etc. ficam em styles/input.css) ----------
const GLASS = 'glass rounded-2xl';
const FIELD = 'min-h-11 sm:min-h-0 rounded-xl border border-white/80 bg-white/60 px-3 py-2 text-base sm:text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-sky-400 focus:bg-white/90 focus:outline-none focus:ring-2 focus:ring-sky-300/60';
const INPUT = `mt-1 block w-full ${FIELD}`;
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500';
const BTN = `cursor-pointer rounded-xl bg-sky-500 px-4 py-2.5 sm:py-2 text-sm font-medium text-white shadow-md shadow-sky-500/30 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN2 = `cursor-pointer rounded-xl border border-white/80 bg-white/60 px-3 py-2.5 sm:py-2 text-sm text-slate-700 shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
const BTN3 = `cursor-pointer rounded-lg border border-white/80 bg-white/60 px-3 py-3 text-xs sm:px-2.5 sm:py-1.5 text-slate-600 transition hover:bg-white/90 ${FOCUS}`;
const LINK = `text-sky-600 transition hover:text-sky-800 ${FOCUS}`;
const FOOTLINK = 'inline-block py-3 sm:py-0';
const DANGER = `text-rose-500 transition hover:text-rose-700 ${FOCUS}`;
const CHEVRON = '<svg class="h-4 w-4 shrink-0 text-slate-400 transition-transform" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>';
const HAMBURGER = '<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg>';

const STATUS = { disponivel: 'Disponível', indisponivel: 'Indisponível', em_uso: 'Em uso', manutencao: 'Manutenção', baixado: 'Baixado' };
const COLORS = {
  disponivel: 'bg-emerald-100/80 text-emerald-700', indisponivel: 'bg-rose-100/80 text-rose-700',
  em_uso: 'bg-sky-100/80 text-sky-700', manutencao: 'bg-amber-100/80 text-amber-700', baixado: 'bg-slate-200/80 text-slate-600',
};
const TYPES = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' };
const TYPE_COLORS = { entrada: 'bg-emerald-100/80 text-emerald-700', saida: 'bg-rose-100/80 text-rose-700', ajuste: 'bg-sky-100/80 text-sky-700' };
const typeBadge = t => raw(`<span class="rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[t]}">${TYPES[t]}</span>`);

const FILTER_KEYS = ['q', 'category_id', 'location_id', 'status'];
const REPORT_KEYS = ['q', 'type', 'category_id', 'location_id', 'user_id', 'from', 'to'];

let me;
let appConfig = {};
let cache = {};
let reportUsers = [];
let greetingText = '';
let movTab = 'history';
const lookups = { categories: [], locations: [] };
const f = { page: 1 };
const rf = { page: 1, sort: 'created_at', order: 'desc', limit: 25 };
const canWrite = () => me.role !== 'leitor';
const isAdmin = () => me.role === 'admin';

// ---------- infra ----------
// Aviso na camada de cima do navegador (popover): aparece até por cima de janelas abertas.
function hideToast() {
  const el = $('#toast');
  if (HAS_POPOVER) { try { el.hidePopover(); } catch { /* já estava fechado */ } }
  el.className = 'hidden';
}
function toast(message, ok = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${ok ? 'toast-ok' : 'toast-err'}`;
  el.setAttribute('role', ok ? 'status' : 'alert');
  if (HAS_POPOVER) {
    try { el.hidePopover(); } catch { /* ainda não estava aberto */ }
    el.showPopover();
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, ok ? 4000 : 7000);
}
$('#toast').onclick = hideToast;
addEventListener('unhandledrejection', e => { if (!e.reason?.handled) toast(e.reason?.message ?? 'Erro inesperado'); });

async function api(path, { body, ...opts } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts, body: body && JSON.stringify(body) });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a rede e tente de novo.');
  }
  if (res.status === 401 && path !== '/auth/login') {
    me = null;
    showLogin('Sua sessão expirou. Entre de novo.');
    throw Object.assign(new Error('Sessão expirada'), { handled: true });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Erro do servidor (HTTP ${res.status}). Tente de novo em instantes.`);
  return data;
}

async function loadLookups() {
  [lookups.categories, lookups.locations] = await Promise.all([api('/categories'), api('/locations')]);
}

const sel = (name, options, label, current, cls = INPUT) =>
  `<select name="${name}" class="${cls}">${label ? `<option value="">${label}</option>` : ''}${options
    .map(([v, t]) => `<option value="${v}" ${String(current) === String(v) ? 'selected' : ''}>${esc(t)}</option>`)
    .join('')}</select>`;

// ---------- seletor de local: lista com busca e setinha, sem digitação livre ----------
function picker(name, current, emptyLabel, { button = `mt-1 ${FIELD}`, wrap = '' } = {}) {
  const selected = lookups.locations.find(l => String(l.id) === String(current));
  const items = [['', emptyLabel], ...lookups.locations.map(l => [l.id, l.name])];
  const option = ([id, label]) => `<li data-id="${id}" class="cursor-pointer rounded-lg px-3 py-1.5 hover:bg-sky-100 ${String(id) === String(current ?? '') ? 'bg-sky-100 font-medium text-sky-800' : ''}">${esc(label)}</li>`;
  // popover="manual": o menu vai para a "camada de cima" do navegador (acima de janelas, tabelas e rolagens),
  // então nunca é cortado nem empurra o conteúdo. As classes absolute/z-30 só valem em navegadores sem essa API.
  return `<div class="relative ${wrap}" data-picker>
    <input type="hidden" name="${name}" value="${esc(current ?? '')}">
    <button type="button" data-toggle aria-haspopup="listbox" class="${button} flex w-full items-center justify-between gap-2 text-left">
      <span data-label class="min-w-0 flex-1 truncate ${selected ? '' : 'text-slate-400'}">${esc(selected?.name ?? emptyLabel)}</span>${CHEVRON}</button>
    <div data-panel popover="manual" class="picker-menu hidden absolute left-0 z-30 mt-1 w-full min-w-72 rounded-xl p-2">
      <input data-search placeholder="Buscar local..." autocomplete="off" aria-label="Buscar local" class="${FIELD} w-full">
      <ul data-list class="mt-2 max-h-56 overflow-y-auto text-sm">${items.map(option).join('')}
        <li data-empty class="hidden px-3 py-2 text-slate-400">Nenhum local encontrado</li></ul></div></div>`;
}

const filterOptions = (root, text) => {
  const needle = norm(text);
  const options = $$('li[data-id]', root);
  options.forEach(li => li.classList.toggle('hidden', !norm(li.textContent).includes(needle)));
  $('[data-empty]', root).classList.toggle('hidden', options.some(li => !li.classList.contains('hidden')));
};

let pickerOpenedAt = 0;

function openPicker(root) {
  const panel = $('[data-panel]', root);
  panel.classList.remove('hidden');
  if (HAS_POPOVER) {
    // Posição em coordenadas da tela, colada no botão: abre para baixo e vira para cima se faltar espaço.
    const rect = $('[data-toggle]', root).getBoundingClientRect();
    const spaceBelow = innerHeight - rect.bottom - 12;
    const openUp = spaceBelow < 260 && rect.top > spaceBelow;
    const room = (openUp ? rect.top : spaceBelow) - 12;
    $('[data-list]', root).style.maxHeight = `${Math.max(96, Math.min(224, room - 64))}px`;
    const width = Math.min(Math.max(rect.width, 288), innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    const vertical = openUp ? `bottom:${innerHeight - rect.top + 4}px` : `top:${rect.bottom + 4}px`;
    panel.style.cssText = `position:fixed;inset:auto;margin:0;left:${left}px;width:${width}px;${vertical}`;
    panel.showPopover();
  }
  root.setAttribute('data-open', '');
  pickerOpenedAt = performance.now();
  const search = $('[data-search]', root);
  search.value = '';
  filterOptions(root, '');
  search.focus();
  $('li.font-medium', root)?.scrollIntoView?.({ block: 'nearest' });
}

function closePicker(root) {
  const panel = $('[data-panel]', root);
  if (HAS_POPOVER && root.hasAttribute('data-open')) {
    try { panel.hidePopover(); } catch { /* já estava fechado */ }
  }
  panel.classList.add('hidden');
  root.removeAttribute('data-open');
}

const closeAllPickers = () => $$('[data-picker][data-open]').forEach(closePicker);

document.addEventListener('click', e => {
  const root = e.target.closest('[data-picker]');
  $$('[data-picker]').forEach(other => { if (other !== root) closePicker(other); });
  if (!e.target.closest('[data-menu], [data-menu-panel]')) closeMenu();
  if (!root) return;

  if (e.target.closest('[data-toggle]')) {
    return root.hasAttribute('data-open') ? closePicker(root) : openPicker(root);
  }
  const option = e.target.closest('li[data-id]');
  if (option) {
    const hidden = $('input[type=hidden]', root);
    hidden.value = option.dataset.id;
    const label = $('[data-label]', root);
    label.textContent = option.textContent;
    label.classList.toggle('text-slate-400', !option.dataset.id);
    // destaca só a opção escolhida (ao reabrir a lista, ela aparece marcada)
    $$('li[data-id]', root).forEach(li => li.classList.remove('bg-sky-100', 'font-medium', 'text-sky-800'));
    option.classList.add('bg-sky-100', 'font-medium', 'text-sky-800');
    closePicker(root);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
// O menu é posicionado na tela, então fecha ao rolar a página/janela ou redimensionar (rolar a própria lista não fecha).
document.addEventListener('scroll', e => {
  if (performance.now() - pickerOpenedAt < 200 || e.target.closest?.('[data-panel]')) return;
  closeAllPickers();
}, true);
addEventListener('resize', closeAllPickers);
document.addEventListener('input', e => {
  if (e.target.matches?.('[data-search]')) filterOptions(e.target.closest('[data-picker]'), e.target.value);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
  if (!e.target.matches?.('[data-search]')) return;
  const root = e.target.closest('[data-picker]');
  if (e.key === 'Enter') {
    e.preventDefault(); // não deixa o Enter salvar o formulário
    $('li[data-id]:not(.hidden)', root)?.click();
  }
  if (e.key === 'Escape') {
    e.preventDefault(); // fecha só o menu, não a janela
    closePicker(root);
    $('[data-toggle]', root).focus();
  }
});

// Tabela. No celular (CSS .stack) cada linha vira um cartão; hideMobile esconde colunas menos importantes só no celular.
const tableHtml = (heads, rows, { sticky = false, hideMobile = [] } = {}) => `<table class="stack w-full text-left text-sm">
    <thead class="${sticky ? 'sticky top-0 z-10 bg-sky-50' : 'bg-sky-100/50'} text-xs uppercase tracking-wide text-sky-900/60"><tr>${heads.map(h => `<th class="px-4 py-3 font-medium">${h}</th>`).join('')}</tr></thead>
    <tbody class="divide-y divide-white/60">${rows.map(r => `<tr class="transition hover:bg-white/40">${r.map((c, i) => `<td data-label="${esc(heads[i])}" class="px-4 py-3 ${hideMobile.includes(heads[i]) ? 'hide-mobile' : ''}">${c?.raw ?? esc(c)}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${heads.length}" data-label="" class="p-8 text-center text-slate-400">Nada encontrado.</td></tr>`}</tbody></table>`;

const table = (heads, rows, opts) => `<div class="${GLASS} overflow-x-auto">${tableHtml(heads, rows, opts)}</div>`;

const pagination = (total, page, pages, attr) => `<div class="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600"><span>${total} item(ns)</span>
  <span class="flex items-center gap-2"><button data-${attr}="-1" ${page <= 1 ? 'disabled' : ''} class="${BTN2}">Anterior</button><span>${page}/${pages}</span><button data-${attr}="1" ${page >= pages ? 'disabled' : ''} class="${BTN2}">Próxima</button></span></div>`;

// Janela de formulário. Erros aparecem DENTRO da janela (e a janela continua aberta); durante o envio o botão fica travado.
function modal(title, body, onSubmit, { submitLabel = 'Salvar' } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'glass-strong m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-3xl p-5 text-slate-800 backdrop:bg-sky-950/20 backdrop:backdrop-blur-sm sm:p-6';
  dialog.innerHTML = `<form class="space-y-4"><h2 class="text-lg font-semibold text-sky-900">${title}</h2>${body}
    <p data-error role="alert" class="hidden rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700"></p>
    <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" data-close class="${BTN2}">Cancelar</button><button data-submit class="${BTN}">${submitLabel}</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.onclose = () => dialog.remove();
  $('[data-close]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const error = $('[data-error]', dialog);
    const submit = $('[data-submit]', dialog);
    const data = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v === '' ? null : v]));
    error.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Salvando...';
    try {
      await onSubmit(data);
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
      error.scrollIntoView?.({ block: 'nearest' });
    } finally {
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  };
  return dialog;
}

// ---------- layout: login, cabeçalho, menu do celular, rodapé ----------
function footerHtml() {
  const { supportEmail, supportPhone } = appConfig;
  const contact = [
    supportEmail && `<a href="mailto:${esc(supportEmail)}" class="${LINK} ${FOOTLINK}">${esc(supportEmail)}</a>`,
    supportPhone && `<a href="${esc(telHref(supportPhone))}" class="${LINK} ${FOOTLINK}">${esc(supportPhone)}</a>`,
  ].filter(Boolean).join(' · ');
  const links = me ? `<nav aria-label="Rodapé" class="flex flex-wrap gap-x-4 gap-y-2">${visibleRoutes().map(r => `<a href="#/${r.path}" class="${LINK} ${FOOTLINK}">${r.label}</a>`).join('')}</nav>` : '';
  return `<footer class="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-xs text-slate-500 sm:px-6 lg:h-12 lg:py-0">
    <span>© ${new Date().getFullYear()} ${APP}</span>${links}${contact ? `<span>Suporte NTI: ${contact}</span>` : ''}</footer>`;
}

function showLogin(notice = '') {
  document.title = `Entrar · ${APP}`;
  $('#app').innerHTML = `<div class="flex min-h-screen flex-col">
    <div class="grid flex-1 place-items-center p-4">
      <form id="login" class="glass-strong w-full max-w-sm space-y-4 rounded-3xl p-6 sm:p-8">
        <div class="flex items-center gap-3"><img src="/favicon.svg" width="40" height="40" alt="" class="h-10 w-10">
          <div><h1 class="text-2xl font-semibold text-sky-900">${APP}</h1><p class="text-sm text-slate-500">Entre para gerenciar os itens</p></div></div>
        <p id="loginError" role="alert" class="${notice ? '' : 'hidden'} rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">${esc(notice)}</p>
        <label class="block text-sm text-slate-600">E-mail<input name="email" type="email" autocomplete="username" required class="${INPUT}"></label>
        <label class="block text-sm text-slate-600">Senha<input name="password" type="password" autocomplete="current-password" required class="${INPUT}"></label>
        <button class="${BTN} w-full">Entrar</button></form></div>
    ${footerHtml()}</div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const error = $('#loginError');
    const button = $('button', e.target);
    error.classList.add('hidden');
    button.disabled = true;
    button.textContent = 'Entrando...';
    try {
      me = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      await shell();
    } catch (err) {
      console.error('Falha ao entrar:', err);
      if (!error.isConnected) return toast(err.message); // o formulário já foi trocado pela tela principal
      error.textContent = err.message;
      error.classList.remove('hidden');
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  };
}

// Rotas: o endereço (#/itens etc.) é a fonte da verdade. Logo, o botão voltar, o F5 e os links do rodapé funcionam.
const ROUTES = [
  { path: 'painel', label: 'Painel', view: () => dashboard() },
  { path: 'itens', label: 'Itens', view: () => equipments() },
  { path: 'movimentacoes', label: 'Movimentações', view: () => movements() },
  { path: 'usuarios', label: 'Usuários', view: () => users(), admin: true },
];
const visibleRoutes = () => ROUTES.filter(r => !r.admin || isAdmin());

function closeMenu() {
  $('[data-menu-panel]')?.classList.add('hidden');
  $('[data-menu]')?.setAttribute('aria-expanded', 'false');
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  me = null;
  history.replaceState(null, '', location.pathname + location.search);
  showLogin();
  toast('Você saiu do sistema', true);
}

async function shell() {
  await loadLookups();
  greetingText = greeting();
  const link = (r, cls) => `<a href="#/${r.path}" data-route="${r.path}" class="${cls} ${FOCUS}">${r.label}</a>`;
  $('#app').innerHTML = `<div class="flex min-h-screen flex-col">
    <header class="glass sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
      <a href="#/painel" aria-label="${APP}: ir para o painel" class="flex min-h-10 shrink-0 items-center gap-2 ${FOCUS}">
        <img src="/favicon.svg" width="32" height="32" alt="" class="h-8 w-8"><b class="text-lg text-sky-900">${APP}</b></a>
      <nav aria-label="Principal" class="ml-2 hidden gap-1 md:flex">${visibleRoutes().map(r => link(r, 'rounded-xl px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white/60')).join('')}</nav>
      <span class="ml-auto hidden text-sm text-slate-500 md:inline">${esc(me.name)} · ${me.role}</span>
      <button data-logout class="hidden text-sm md:inline ${DANGER}">Sair</button>
      <button type="button" data-menu aria-expanded="false" aria-controls="menu-panel" aria-label="Abrir menu" class="ml-auto grid h-10 w-10 place-items-center rounded-xl border border-white/80 bg-white/60 text-sky-900 md:hidden ${FOCUS}">${HAMBURGER}</button>
      <div id="menu-panel" data-menu-panel class="solid-menu absolute inset-x-3 top-full mt-2 hidden rounded-2xl p-2 md:hidden">
        ${visibleRoutes().map(r => link(r, 'block rounded-xl px-4 py-3 text-base text-slate-700 hover:bg-sky-50')).join('')}
        <div class="mt-1 flex items-center justify-between gap-3 border-t border-sky-100 px-4 pb-2 pt-3 text-sm text-slate-500"><span class="truncate">${esc(me.name)} · ${me.role}</span><button data-logout class="py-1 ${DANGER}">Sair</button></div></div>
    </header>
    <main id="view" class="mx-auto w-full max-w-7xl flex-1 px-4 pb-2 pt-6 sm:px-6"></main>
    ${footerHtml()}</div>`;
  $('[data-menu]').onclick = () => {
    const panel = $('[data-menu-panel]');
    const opening = panel.classList.toggle('hidden') === false;
    $('[data-menu]').setAttribute('aria-expanded', String(opening));
  };
  $('[data-menu-panel]').onclick = e => { if (e.target.closest('a')) closeMenu(); };
  $$('[data-logout]').forEach(b => { b.onclick = logout; });
  await navigate();
}

const notFoundView = () => `<div class="${GLASS} mx-auto mt-6 max-w-md p-8 text-center">
  <p class="text-5xl font-semibold text-sky-500">404</p>
  <h1 class="mt-2 text-xl font-semibold text-sky-900">Página não encontrada</h1>
  <p class="mt-2 text-sm text-slate-500">Esse endereço não existe ou você não tem acesso a ele.</p>
  <a href="#/painel" class="${BTN} mt-6 inline-block">Voltar ao painel</a></div>`;

const errorView = message => `<div role="alert" class="${GLASS} mx-auto mt-6 max-w-md p-8 text-center">
  <h1 class="text-lg font-semibold text-rose-600">Não foi possível carregar</h1>
  <p class="mt-2 text-sm text-slate-600">${esc(message)}</p>
  <button type="button" data-retry class="${BTN} mt-6">Tentar de novo</button></div>`;

async function navigate() {
  if (!me) return;
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/painel');
  const [path, sub] = location.hash.replace(/^#\/?/, '').split('/');
  const route = visibleRoutes().find(r => r.path === path);
  const valid = route && (!sub || (path === 'movimentacoes' && sub === 'relatorio' && isAdmin()));
  closeMenu();
  $$('[data-route]').forEach(a => {
    const active = a.dataset.route === route?.path;
    a.classList.toggle('active', active);
    active ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  if (!valid) {
    document.title = `Página não encontrada · ${APP}`;
    $('#view').innerHTML = notFoundView();
    return;
  }
  movTab = sub === 'relatorio' ? 'report' : 'history';
  document.title = `${sub === 'relatorio' ? 'Relatório · Movimentações' : route.label} · ${APP}`;
  try {
    await route.view();
  } catch (err) {
    if (err.handled) return;
    $('#view').innerHTML = errorView(err.message);
    $('[data-retry]').onclick = navigate;
  }
  scrollTo(0, 0);
}

// ---------- painel ----------
// Frases de boas-vindas: um sorteio a cada login, misturando as de qualquer hora com as do período do dia.
const GREETINGS = {
  any: [
    'Olá, {nome}', 'Oi, {nome}! Tudo certo por aqui', 'Que bom te ver, {nome}', 'Bem-vindo de volta, {nome}',
    'De volta ao trabalho, {nome}?', 'Vamos organizar esse estoque, {nome}?', 'Tudo pronto para hoje, {nome}',
    'E aí, {nome}? Vamos lá', 'Salve, {nome}', 'Por onde começamos, {nome}?', 'Como estão as coisas, {nome}?',
    'Mais um dia no NTI, {nome}', 'O estoque está te esperando, {nome}', 'Tudo sob controle, {nome}?',
    'Que a contagem bata hoje, {nome}!', 'Pronto para mais um dia, {nome}?', 'Olá, {nome}! O que vamos conferir hoje?',
    'Bora lá, {nome}',
  ],
  morning: [
    'Bom dia, {nome}', 'Bom dia, {nome}! Café na mão?', 'Começando o dia com o estoque em ordem, {nome}',
    'Bom dia, {nome}! Vamos nessa', 'Manhã produtiva pela frente, {nome}',
  ],
  afternoon: [
    'Boa tarde, {nome}', 'Boa tarde, {nome}! Como vai o dia?', 'Metade do dia vencida, {nome}',
    'Boa tarde, {nome}! Hora de conferir as saídas', 'Tarde de trabalho, {nome}',
  ],
  evening: [
    'Boa noite, {nome}', 'Boa noite, {nome}! Ainda por aqui?', 'Fechando o dia, {nome}?',
    'Hora de fechar as pendências, {nome}', 'Noite de conferência, {nome}',
  ],
  night: [
    'Boa madrugada, {nome}', 'Madrugando, {nome}?', 'Trabalhando até tarde, {nome}?', 'Não se esqueça de descansar, {nome}',
  ],
};

function greeting() {
  const hour = new Date().getHours();
  const period = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const pool = [...GREETINGS.any, ...GREETINGS[period]];
  return pool[Math.floor(Math.random() * pool.length)].replaceAll('{nome}', me.name.split(' ')[0]);
}

const list = (items, fn) => items.length
  ? `<ul class="divide-y divide-white/60 text-sm">${items.map(i => `<li class="flex justify-between gap-2 py-2.5">${fn(i)}</li>`).join('')}</ul>`
  : '<p class="text-sm text-slate-400">Nada por aqui.</p>';

async function dashboard() {
  const d = await api('/dashboard');
  const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heads = ['Item', 'Patrimônio / Série', 'Categoria', 'Local', 'Movimento', 'Qtd', 'Status', 'Data'];
  const rows = d.recent.map(m => [
    itemCell(m), idCell(m), m.category, m.location,
    raw(`${typeBadge(m.type).raw}<b class="ml-2 text-slate-800">${m.moved}</b>`),
    qtyCell(m), statusBadge(m.status), fmt(m.created_at),
  ]);
  // Em telas grandes a altura é "tela - cabeçalho (3.5rem) - margens (2rem) - rodapé (3rem)": o painel chega até o rodapé.
  $('#view').innerHTML = `<div class="flex flex-col gap-5 lg:h-[calc(100vh_-_8.5rem)]">
    <div><h1 class="text-2xl font-semibold text-sky-900 sm:text-3xl">${esc(greetingText)}</h1>
      <p class="text-sm text-slate-500">${esc(date.charAt(0).toUpperCase() + date.slice(1))}</p></div>
    <div class="${GLASS} w-fit min-w-48 p-5"><div class="text-sm text-slate-500">Itens ativos</div>
      <div class="mt-1 text-3xl font-semibold text-sky-700">${d.totals.equipments}</div></div>
    <div class="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row">
      <section class="${GLASS} flex max-h-96 flex-col overflow-hidden p-5 lg:max-h-none lg:w-80 lg:shrink-0">
        <h2 class="mb-2 font-medium text-sky-900">Estoque baixo</h2>
        <div class="min-h-0 flex-1 overflow-y-auto">${list(d.low, p => `<span>${esc(p.name)}</span><b class="text-rose-500">${p.quantity}/${p.min_quantity}</b>`)}</div></section>
      <section class="${GLASS} flex min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
        <h2 class="px-5 pb-3 pt-5 font-medium text-sky-900">Últimas movimentações</h2>
        <div class="min-h-0 flex-1 overflow-auto">${tableHtml(heads, rows, { sticky: true, hideMobile: ['Patrimônio / Série', 'Categoria'] })}</div></section></div></div>`;
}

// ---------- itens ----------
const FIELDS = [
  ['name', 'Nome', 'text', true], ['asset_tag', 'Patrimônio', 'text'], ['serial_number', 'Nº de série', 'text'],
  ['brand', 'Marca', 'text'], ['model', 'Modelo', 'text'], ['category_id', 'Categoria', 'cats'], ['location_id', 'Local', 'locs'],
  ['quantity', 'Quantidade', 'int'], ['min_quantity', 'Estoque mínimo', 'int'], ['unit_cost', 'Custo unitário (R$)', 'number'],
  ['status', 'Status', 'status'], ['purchase_date', 'Data da compra', 'date'],
  ['warranty_until', 'Garantia até', 'date'], ['notes', 'Observações', 'textarea'],
];

// Miniatura com tamanho fixo (não "pula" o layout), carregamento preguiçoso e decodificação fora da thread principal.
const thumb = p => p.image_url
  ? `<img src="${esc(p.image_url)}" alt="" width="44" height="44" loading="lazy" decoding="async" class="h-11 w-11 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-white/80">`
  : '<div class="h-11 w-11 shrink-0 rounded-xl bg-sky-100/70 ring-1 ring-white/80"></div>';

// Células compartilhadas pela página de itens e pelo painel
const itemCell = p => raw(`<div class="flex min-w-0 items-center gap-3">${thumb(p)}<div class="min-w-0"><div class="font-medium text-slate-800">${esc(p.name)}</div><div class="text-xs text-slate-500">${esc([p.brand, p.model].filter(Boolean).join(' '))}</div></div></div>`);
const idCell = p => raw(`${esc(p.asset_tag)}<div class="text-xs text-slate-500">${esc(p.serial_number)}</div>`);
const qtyCell = p => raw(`<b class="${p.quantity <= p.min_quantity ? 'text-rose-500' : 'text-slate-800'}">${p.quantity}</b>`);
const statusBadge = status => raw(`<span class="rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[status]}">${STATUS[status]}</span>`);

const query = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v));

function newLocationForm() {
  modal('Novo local', `<label class="block text-sm text-slate-600">Nome do local
    <input name="name" required minlength="2" maxlength="80" autocomplete="off" class="${INPUT}"></label>`, async data => {
    await api('/locations', { method: 'POST', body: data });
    await loadLookups();
    toast(`Local "${data.name}" criado`, true);
    equipments();
  }, { submitLabel: 'Criar local' });
}

function equipments() {
  Object.assign(f, Object.fromEntries(FILTER_KEYS.map(k => [k, ''])), { page: 1 });
  $('#view').innerHTML = `<form id="filters" class="${GLASS} relative z-20 mb-4 flex flex-wrap items-center gap-2 p-3">
    <input name="q" type="search" placeholder="Buscar nome, patrimônio, série, marca..." aria-label="Buscar itens" class="${FIELD} w-full sm:w-72">
    ${sel('category_id', lookups.categories.map(c => [c.id, c.name]), 'Categoria', '', `${FIELD} w-full sm:w-auto`)}
    ${picker('location_id', '', 'Todos os locais', { button: `${FIELD} w-full`, wrap: 'w-full sm:w-56' })}
    ${sel('status', Object.entries(STATUS), 'Status', '', `${FIELD} w-full sm:w-auto`)}
    ${isAdmin() ? `<button type="button" data-add="locations" class="${BTN2} w-full sm:w-auto">+ Local</button>` : ''}
    ${canWrite() ? `<button type="button" id="new" class="${BTN} w-full sm:ml-auto sm:w-auto">Novo item</button>` : ''}</form>
    <div id="table"></div>`;

  const form = $('#filters');
  let timer;
  form.onsubmit = e => e.preventDefault();
  form.oninput = e => {
    if (e.target.matches('[data-search]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const data = new FormData(form);
      FILTER_KEYS.forEach(k => (f[k] = data.get(k) || ''));
      f.page = 1;
      loadEquipments();
    }, 250);
  };
  form.onclick = e => {
    if (e.target.closest('#new')) equipmentForm();
    if (e.target.closest('[data-add]')) newLocationForm();
  };
  return loadEquipments();
}

async function loadEquipments() {
  const q = query();
  const { rows, total, limit } = await api(`/equipments?${q}`);
  cache = Object.fromEntries(rows.map(p => [p.id, p]));
  const pages = Math.max(1, Math.ceil(total / limit));
  const actions = p => `${canWrite() ? `<button data-act="move" data-id="${p.id}" class="py-1 ${LINK}">Movimentar</button>
    <button data-act="edit" data-id="${p.id}" class="py-1 ${LINK}">Editar</button>` : ''}
    ${isAdmin() ? `<button data-act="del" data-id="${p.id}" class="py-1 ${DANGER}">Excluir</button>` : ''}`;

  $('#table').innerHTML = table(
    ['Item', 'Patrimônio / Série', 'Categoria', 'Local', 'Qtd', 'Status', ''],
    rows.map(p => [
      itemCell(p), idCell(p), p.category, p.location, qtyCell(p), statusBadge(p.status),
      raw(`<div class="flex flex-wrap justify-end gap-x-4 gap-y-1 md:flex-nowrap md:whitespace-nowrap">${actions(p)}</div>`),
    ]),
  ) + pagination(total, f.page, pages, 'step');

  $('#table').onclick = async e => {
    const { act, id, step } = e.target.dataset;
    if (step) {
      f.page = Math.min(pages, Math.max(1, f.page + Number(step)));
      return loadEquipments();
    }
    if (act === 'edit') equipmentForm(cache[id]);
    if (act === 'move') moveForm(cache[id]);
    if (act === 'del' && confirm(`Excluir "${cache[id].name}" e todo o histórico dele?`)) {
      await api(`/equipments/${id}`, { method: 'DELETE' });
      toast('Item excluído', true);
      loadEquipments();
    }
  };
}

function equipmentForm(p) {
  const v = p ?? {};
  const cell = ([name, label, type, required]) => {
    const val = v[name] ?? (type === 'number' || type === 'int' ? 0 : '');
    const attrs = `name="${name}" ${required ? 'required' : ''} class="${INPUT}"`;
    const control = {
      textarea: () => `<textarea ${attrs} rows="2">${esc(val)}</textarea>`,
      cats: () => sel(name, lookups.categories.map(c => [c.id, c.name]), '—', val),
      locs: () => picker('location_id', v.location_id, 'Nenhum'),
      status: () => sel(name, Object.entries(STATUS).filter(([k]) => k !== 'indisponivel'), '', v.status ?? 'disponivel'),
      int: () => `<input type="number" inputmode="numeric" ${attrs} value="${esc(val)}" min="0" step="1">`,
    }[type]?.() ?? `<input type="${type}" ${attrs} value="${esc(val)}" ${type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''}>`;
    // O seletor de local não pode ficar dentro de <label>: o clique numa opção reabriria a lista.
    const tag = type === 'locs' ? 'div' : 'label';
    return `<${tag} class="${['name', 'notes'].includes(name) ? 'sm:col-span-2' : ''} text-sm text-slate-600">${label}${control}</${tag}>`;
  };
  const imageBlock = `<div class="text-sm text-slate-600 sm:col-span-2">Imagem
    <div class="mt-1 flex items-center gap-3">
      <img id="imgPreview" src="${esc(v.image_url ?? '')}" alt="Imagem do item" width="64" height="64" decoding="async" class="h-16 w-16 rounded-xl object-cover ring-1 ring-white/80 ${v.image_url ? '' : 'hidden'}">
      <input type="hidden" name="image_url" value="${esc(v.image_url ?? '')}">
      <button type="button" id="imgSearch" class="${BTN2}">Buscar imagem pelo nome</button>
</div>
    <div id="imgResults" class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"></div></div>`;

  const dialog = modal(p ? 'Editar item' : 'Novo item', `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">${FIELDS.map(cell).join('')}${imageBlock}</div>`, async data => {
    await api(p ? `/equipments/${p.id}` : '/equipments', { method: p ? 'PUT' : 'POST', body: data });
    toast('Item salvo', true);
    loadEquipments();
  });

  const results = $('#imgResults', dialog);
  $('#imgSearch', dialog).onclick = async () => {
    const q = $('[name=name]', dialog).value.trim();
    if (q.length < 2) return toast('Digite o nome do item primeiro');
    results.textContent = 'Buscando...';
    try {
      const urls = await api(`/equipments/images?q=${encodeURIComponent(q)}`);
      results.innerHTML = urls.map(u => `<img src="${esc(u)}" data-url="${esc(u)}" alt="Opção de imagem" width="120" height="80" loading="lazy" decoding="async" class="h-20 w-full cursor-pointer rounded-xl object-cover ring-1 ring-white/80 transition hover:ring-2 hover:ring-sky-400">`).join('')
        || 'Nenhuma imagem encontrada para esse nome.';
    } catch (err) {
      results.innerHTML = `<p role="alert" class="col-span-full text-sm text-rose-600">${esc(err.message)}</p>`;
    }
  };
  results.onclick = e => {
    const { url } = e.target.dataset;
    if (!url) return;
    $('[name=image_url]', dialog).value = url;
    const preview = $('#imgPreview', dialog);
    preview.src = url;
    preview.classList.remove('hidden');
  };
}

function moveForm(p) {
  const dialog = modal(`Movimentar: ${esc(p.name)} (saldo ${p.quantity})`, `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="text-sm text-slate-600">Tipo${sel('type', Object.entries(TYPES).map(([k, t]) => [k, k === 'ajuste' ? 'Ajuste (define o saldo)' : t]), '', 'saida')}</label>
    <label class="text-sm text-slate-600">Quantidade <span class="text-xs text-slate-400">(a saída não passa do saldo)</span><input name="quantity" type="number" inputmode="numeric" min="0" step="1" required class="${INPUT}"></label>
    <div class="text-sm text-slate-600 sm:col-span-2">Local (destino ou origem)${picker('location_id', '', 'Nenhum')}</div>
    <label class="text-sm text-slate-600 sm:col-span-2">Responsável (quem retirou ou entregou)<input name="responsible" class="${INPUT}"></label>
    <label class="text-sm text-slate-600 sm:col-span-2">Observação<input name="note" class="${INPUT}"></label></div>`, async data => {
    const { quantity } = await api('/movements', { method: 'POST', body: { ...data, equipment_id: p.id } });
    toast(quantity === 0 ? 'Movimentação registrada. Estoque zerado: item Indisponível' : 'Movimentação registrada', true);
    loadEquipments();
  });
  const type = $('[name=type]', dialog);
  const qty = $('[name=quantity]', dialog);
  type.onchange = () => (type.value === 'saida' ? qty.setAttribute('max', p.quantity) : qty.removeAttribute('max'));
  type.onchange();
}

// ---------- movimentações: histórico (todos) e relatório (admin) ----------
function movements() {
  if (movTab === 'report' && !isAdmin()) movTab = 'history';
  const tabs = [['history', 'Histórico', '#/movimentacoes'], ...(isAdmin() ? [['report', 'Relatório', '#/movimentacoes/relatorio']] : [])];
  $('#view').innerHTML = `<div class="mb-4 flex gap-2">${tabs.map(([k, label, href]) => `<a href="${href}" ${k === movTab ? 'aria-current="page"' : ''} class="rounded-xl px-4 py-2.5 text-sm transition ${FOCUS} ${k === movTab ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30' : 'glass text-slate-600'}">${label}</a>`).join('')}</div>
    <div id="mbody"></div>`;
  return movTab === 'report' ? report() : movementsHistory();
}

async function movementsHistory() {
  const rows = await api('/movements');
  $('#mbody').innerHTML = table(
    ['Data', 'Item', 'Tipo', 'Qtd', 'Saldo', 'Local', 'Responsável', 'Obs.', 'Usuário'],
    rows.map(m => [fmt(m.created_at), m.equipment, typeBadge(m.type), m.quantity, m.balance_after, m.location, m.responsible, m.note, m.user]),
    { hideMobile: ['Obs.', 'Usuário'] },
  );
}

const reportQs = (extra = {}) => new URLSearchParams(Object.entries({ ...rf, ...extra }).filter(([, v]) => v));

async function report() {
  reportUsers = await api('/users');
  Object.assign(rf, Object.fromEntries(REPORT_KEYS.map(k => [k, ''])), { page: 1, sort: 'created_at', order: 'desc', limit: 25 });
  const sorts = [['created_at:desc', 'Mais recentes'], ['created_at:asc', 'Mais antigos'], ['equipment:asc', 'Item A-Z'], ['quantity:desc', 'Maior quantidade']];
  const presets = [['today', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['month', 'Este mês'], ['clear', 'Limpar filtros']];
  $('#mbody').innerHTML = `<form id="rfilters" class="${GLASS} relative z-20 mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
    <input name="q" type="search" placeholder="Buscar item, patrimônio, série, responsável, observação..." aria-label="Buscar no relatório" class="${FIELD} w-full md:col-span-2">
    ${sel('type', Object.entries(TYPES), 'Todos os tipos', '', `${FIELD} w-full`)}
    ${sel('category_id', lookups.categories.map(c => [c.id, c.name]), 'Todas as categorias', '', `${FIELD} w-full`)}
    ${picker('location_id', '', 'Todos os locais', { button: `${FIELD} w-full` })}
    ${sel('user_id', reportUsers.map(u => [u.id, u.name]), 'Todos os usuários', '', `${FIELD} w-full`)}
    <label class="text-xs text-slate-500">De<input type="date" name="from" class="${INPUT}"></label>
    <label class="text-xs text-slate-500">Até<input type="date" name="to" class="${INPUT}"></label>
    <div class="flex flex-wrap items-center gap-2 md:col-span-4">
      ${presets.map(([k, label]) => `<button type="button" data-preset="${k}" class="${BTN3}">${label}</button>`).join('')}
      <span class="flex w-full gap-2 md:ml-auto md:w-auto">${sel('sort', sorts, '', 'created_at:desc', `${FIELD} min-w-0 flex-1`)}${sel('limit', [[25, '25 por página'], [50, '50 por página'], [100, '100 por página']], '', 25, `${FIELD} min-w-0 flex-1`)}</span>
    </div></form>
    <div id="rsummary" class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4"></div>
    <div class="mb-3 flex flex-wrap gap-2">
      <a id="rcsv" class="${BTN2}">Exportar CSV</a><a id="rxlsx" class="${BTN2}">Exportar Excel</a>
      <button type="button" id="rprint" class="${BTN2}">Imprimir</button></div>
    <div id="rtable"></div>`;

  const form = $('#rfilters');
  let timer;
  form.onsubmit = e => e.preventDefault();
  form.oninput = e => {
    if (e.target.matches('[data-search]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const data = new FormData(form);
      REPORT_KEYS.forEach(k => (rf[k] = data.get(k) || ''));
      [rf.sort, rf.order] = data.get('sort').split(':');
      rf.limit = Number(data.get('limit'));
      rf.page = 1;
      loadReport();
    }, 250);
  };
  $('#mbody').onclick = e => {
    const { preset, rstep } = e.target.dataset;
    if (preset === 'clear') return report();
    if (preset) {
      const today = new Date();
      const from = new Date(today);
      if (preset === 'month') from.setDate(1);
      else from.setDate(today.getDate() - (preset === 'today' ? 0 : Number(preset) - 1));
      $('[name=from]', form).value = isoDate(from);
      $('[name=to]', form).value = isoDate(today);
      $('[name=to]', form).dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (rstep) {
      rf.page = Math.max(1, rf.page + Number(rstep));
      loadReport();
    }
    if (e.target.id === 'rprint') printReport();
  };
  return loadReport();
}

async function loadReport() {
  const { rows, summary, limit } = await api(`/reports/movements?${reportQs()}`);
  const exportQs = reportQs();
  ['page', 'limit'].forEach(k => exportQs.delete(k));
  $('#rcsv').href = `/api/reports/movements/export.csv?${exportQs}`;
  $('#rxlsx').href = `/api/reports/movements/export.xlsx?${exportQs}`;

  const stat = (label, value) => `<div class="${GLASS} p-4"><div class="text-xs text-slate-500">${label}</div><div class="mt-1 text-2xl font-semibold text-sky-700">${value}</div></div>`;
  $('#rsummary').innerHTML = stat('Movimentações', summary.total) + stat('Unidades que entraram', summary.units_in)
    + stat('Unidades que saíram', summary.units_out) + stat('Ajustes', summary.adjustments);

  const pages = Math.max(1, Math.ceil(summary.total / limit));
  rf.page = Math.min(rf.page, pages);
  $('#rtable').innerHTML = table(
    ['Data', 'Item', 'Tipo', 'Qtd', 'Saldo', 'Local', 'Responsável', 'Obs.', 'Usuário'],
    rows.map(m => [
      fmt(m.created_at),
      raw(`<div class="font-medium text-slate-800">${esc(m.equipment)}</div><div class="text-xs text-slate-500">${esc(m.asset_tag)}</div>`),
      typeBadge(m.type), m.quantity, m.balance_after, m.location, m.responsible, m.note, m.user,
    ]),
    { hideMobile: ['Obs.', 'Usuário'] },
  ) + pagination(summary.total, rf.page, pages, 'rstep');
}

async function printReport() {
  const { rows, summary } = await api(`/reports/movements?${reportQs({ page: 1, limit: 5000 })}`);
  const nameOf = (list, id) => list.find(x => String(x.id) === String(id))?.name ?? id;
  const applied = [
    rf.q && `Busca: "${rf.q}"`,
    rf.type && `Tipo: ${TYPES[rf.type]}`,
    rf.category_id && `Categoria: ${nameOf(lookups.categories, rf.category_id)}`,
    rf.location_id && `Local: ${nameOf(lookups.locations, rf.location_id)}`,
    rf.user_id && `Usuário: ${nameOf(reportUsers, rf.user_id)}`,
    (rf.from || rf.to) && `Período: ${fmtDate(rf.from) || 'início'} a ${fmtDate(rf.to) || 'hoje'}`,
  ].filter(Boolean);
  const heads = ['Data', 'Item', 'Patrimônio', 'Tipo', 'Qtd', 'Saldo', 'Local', 'Responsável', 'Obs.', 'Usuário'];
  $('#print-area').innerHTML = `<h1>Relatório de movimentações</h1>
    <p>${APP} · gerado em ${esc(new Date().toLocaleString('pt-BR'))} por ${esc(me.name)}</p>
    <p><b>Filtros:</b> ${applied.length ? esc(applied.join(' · ')) : 'nenhum (todas as movimentações)'}</p>
    <p><b>Total:</b> ${summary.total} movimentações · <b>Entraram:</b> ${summary.units_in} un. · <b>Saíram:</b> ${summary.units_out} un. · <b>Ajustes:</b> ${summary.adjustments}</p>
    ${rows.length < summary.total ? `<p><b>Atenção:</b> mostrando as primeiras ${rows.length} de ${summary.total}. Use a exportação para Excel para ter tudo.</p>` : ''}
    <table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(m => `<tr>
      ${[fmt(m.created_at), m.equipment, m.asset_tag, TYPES[m.type], m.quantity, m.balance_after, m.location, m.responsible, m.note, m.user]
        .map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="sign">Conferido por: ______________________________ &nbsp; Data: ____/____/________</p>`;
  window.print();
}
addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });

// ---------- usuários ----------
async function users() {
  const rows = await api('/users');
  $('#view').innerHTML = `<div id="users"><div class="mb-4 sm:text-right"><button id="newUser" class="${BTN} w-full sm:w-auto">Novo usuário</button></div>${table(
    ['Nome', 'E-mail', 'Perfil', ''],
    rows.map(u => [u.name, u.email, u.role, raw(`<button data-id="${u.id}" data-name="${esc(u.name)}" data-active="${u.active}" class="py-1 ${LINK}">${u.active ? 'Desativar' : 'Ativar'}</button>`)]),
  )}</div>`;
  $('#newUser').onclick = () => modal('Novo usuário', `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="text-sm text-slate-600">Nome<input name="name" required class="${INPUT}"></label>
    <label class="text-sm text-slate-600">E-mail<input name="email" type="email" required class="${INPUT}"></label>
    <label class="text-sm text-slate-600">Senha (mín. 8)<input name="password" type="password" minlength="8" autocomplete="new-password" required class="${INPUT}"></label>
    <label class="text-sm text-slate-600">Perfil${sel('role', [['admin', 'Admin'], ['tecnico', 'Técnico'], ['leitor', 'Leitor']], '', 'tecnico')}</label></div>`,
  async data => {
    await api('/users', { method: 'POST', body: data });
    toast(`Usuário ${data.name} criado`, true);
    users();
  }, { submitLabel: 'Criar usuário' });
  $('#users').onclick = async e => {
    const { id, active, name } = e.target.dataset;
    if (!id) return;
    const activate = active !== '1';
    await api(`/users/${id}`, { method: 'PATCH', body: { active: activate ? 1 : 0 } });
    toast(`${name} ${activate ? 'ativado' : 'desativado'}`, true);
    users();
  };
}

// ---------- boot ----------
const [meRes, config] = await Promise.all([
  fetch('/api/auth/me'),
  fetch('/api/config').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
]);
appConfig = config;
addEventListener('hashchange', navigate);
if (meRes.ok) {
  me = await meRes.json();
  await shell();
} else {
  showLogin();
}
