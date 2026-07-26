const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const routes = ['dashboard', 'journals', 'todos', 'accounting', 'settings'];
let chart;

const state = {
  accounts: [],
  categories: [],
};

const articleState = {
  list: [],
  selectedId: null,
  status: 'all',
  q: '',
  mode: 'edit',
  sourceMode: false,
};

const accountingState = {
  mode: 'month',
  month: thisMonth(),
  year: String(new Date().getFullYear()),
  from: monthStart(thisMonth()),
  to: monthEnd(thisMonth()),
  kind: '',
  category_id: '',
  account_id: '',
  q: '',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function today() {
  return formatLocalDate(new Date());
}

function thisMonth() {
  return today().slice(0, 7);
}

function thisYear() {
  return today().slice(0, 4);
}

function yearStart(year = thisYear()) {
  return `${year}-01-01`;
}

function yearEnd(year = thisYear()) {
  return `${year}-12-31`;
}

function monthStart(month = thisMonth()) {
  return `${month}-01`;
}

function monthEnd(month = thisMonth()) {
  const [year, mon] = month.split('-').map(Number);
  return formatLocalDate(new Date(year, mon, 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toastEl.hidden = true; }, 2800);
}

function setError(error) {
  app.innerHTML = `<div class="page-error">${escapeHtml(error.message || error)}</div>`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  if (res.redirected && res.url.includes('/login')) {
    location.href = res.url;
    return null;
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

function getForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function withQuery(path, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') qs.set(key, value);
  });
  const text = qs.toString();
  return text ? `${path}?${text}` : path;
}

function routeName() {
  const name = location.hash.replace('#', '') || 'dashboard';
  return routes.includes(name) ? name : 'dashboard';
}

function setActiveNav() {
  document.querySelectorAll('[data-route]').forEach((node) => {
    node.classList.toggle('active', node.dataset.route === routeName());
  });
}

async function loadLookups() {
  const [accounts, categories] = await Promise.all([
    api('/api/accounts?include_inactive=1'),
    api('/api/categories?include_inactive=1'),
  ]);
  state.accounts = accounts || [];
  state.categories = categories || [];
}

function accountOptions(selected = '') {
  return `<option value="">未指定</option>${state.accounts.map((account) => `
    <option value="${account.id}" ${String(selected) === String(account.id) ? 'selected' : ''}>${escapeHtml(account.name)}${account.is_active ? '' : '（停用）'}</option>
  `).join('')}`;
}

function categoryOptions(kind = '', selected = '') {
  const cats = state.categories.filter((cat) => !kind || cat.kind === kind);
  return `<option value="">未分类</option>${cats.map((cat) => `
    <option value="${cat.id}" ${String(selected) === String(cat.id) ? 'selected' : ''}>${escapeHtml(cat.name)}${cat.is_active ? '' : '（停用）'}</option>
  `).join('')}`;
}

function pageHead(title, subtitle, action = '') {
  return `
    <div class="page-head">
      <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
      <div class="actions">${action}</div>
    </div>
  `;
}

async function renderDashboard() {
  app.innerHTML = '<div class="loading">加载首页...</div>';
  const month = thisMonth();
  await loadLookups();
  const [summary, todos, transactions, journals, monthly, byCategory] = await Promise.all([
    api(`/api/accounting/summary?month=${month}`),
    api('/api/todos?status=open'),
    api(withQuery('/api/transactions', { from: monthStart(month), to: monthEnd(month), limit: 6 })),
    api('/api/journals?limit=5'),
    api(`/api/accounting/monthly?to_month=${month}`),
    api(withQuery('/api/accounting/by-category', { from: monthStart(month), to: monthEnd(month), kind: 'expense' })),
  ]);

  app.innerHTML = `
    ${pageHead('首页', '快速查看今天要做的事、本月收支和最近日志。', '<a class="button" href="#journals">写今天日志</a>')}
    <section class="grid four">
      <div class="card stat"><span class="label">未完成 Todo</span><span class="value">${todos.length}</span></div>
      <div class="card stat income"><span class="label">本月收入</span><span class="value">¥${money(summary.income_total)}</span></div>
      <div class="card stat expense"><span class="label">本月支出</span><span class="value">¥${money(summary.expense_total)}</span></div>
      <div class="card stat net"><span class="label">本月结余</span><span class="value">¥${money(summary.net_total)}</span></div>
    </section>
    <section class="grid two" style="margin-top:16px">
      <div class="card"><h3>近 12 月收支</h3><canvas id="monthly-chart" height="150"></canvas></div>
      <div class="card"><h3>本月支出分类</h3>${summaryList(byCategory, 'category_name', 'total')}</div>
    </section>
    <section class="grid two" style="margin-top:16px">
      <div class="card"><h3>待办事项</h3>${todoMiniList(todos.slice(0, 8))}</div>
      <div class="card"><h3>最近日志</h3>${journalMiniList(journals)}</div>
    </section>
    <section class="card" style="margin-top:16px"><h3>最近流水</h3>${transactionsTable(transactions, false)}</section>
  `;
  drawMonthlyChart(monthly);
}

function drawMonthlyChart(rows) {
  const canvas = document.querySelector('#monthly-chart');
  if (!canvas || !window.Chart) return;
  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.month),
      datasets: [
        { label: '收入', data: rows.map((r) => r.income_total), backgroundColor: '#16a34a' },
        { label: '支出', data: rows.map((r) => r.expense_total), backgroundColor: '#dc2626' },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
  });
}

function summaryList(rows, labelKey, valueKey) {
  if (!rows.length) return '<div class="empty">暂无统计数据</div>';
  return `<div class="list">${rows.map((row) => `
    <div class="item">
      <strong>${escapeHtml(row[labelKey])}</strong>
      <span style="float:right;font-weight:900">¥${money(row[valueKey])}</span>
      <div class="muted">${row.count ? `${row.count} 笔` : ''}</div>
    </div>
  `).join('')}</div>`;
}

function todoMiniList(rows) {
  if (!rows.length) return '<div class="empty">暂无未完成 Todo</div>';
  return `<div class="list">${rows.map((todo) => `
    <div class="item">
      <h4>${escapeHtml(todo.title)}</h4>
      <p>${escapeHtml(todo.notes || '')}</p>
      <div class="item-meta"><span class="badge ${todo.priority}">${priorityText(todo.priority)}</span>${todo.due_date ? `<span>截止 ${escapeHtml(todo.due_date)}</span>` : ''}</div>
    </div>
  `).join('')}</div>`;
}

function journalMiniList(rows) {
  if (!rows.length) return '<div class="empty">暂无文章</div>';
  return `<div class="list">${rows.map((journal) => `
    <div class="item">
      <h4>${escapeHtml(journal.title || '未命名文章')}</h4>
      <p>${escapeHtml(journal.excerpt || journal.summary || (journal.content_text || journal.body || '').slice(0, 120))}</p>
      <div class="item-meta"><span class="badge ${journal.status}">${journal.status === 'published' ? '已发布' : '草稿'}</span><span>${escapeHtml(journal.entry_date)}</span><span>${escapeHtml(journal.tags || '')}</span></div>
    </div>
  `).join('')}</div>`;
}

function articleStatusText(status) {
  return status === 'published' ? '已发布' : '草稿';
}

async function loadArticles() {
  articleState.list = await api(withQuery('/api/journals', {
    status: articleState.status,
    q: articleState.q,
    limit: 200,
  })) || [];
  if (!articleState.selectedId && articleState.list.length) articleState.selectedId = articleState.list[0].id;
  return articleState.list;
}

function blankArticle() {
  return {
    id: '', entry_date: today(), title: '', mood: '', tags: '', summary: '', slug: '', status: 'draft',
    content_html: '<p>开始写你的技术文章...</p>', content_text: '', body: '', excerpt: '',
  };
}

function articleCard(article) {
  return `
    <button class="article-card ${String(article.id) === String(articleState.selectedId) ? 'active' : ''}" data-select-article="${article.id}">
      <span class="badge ${article.status}">${articleStatusText(article.status)}</span>
      <strong>${escapeHtml(article.title || '未命名文章')}</strong>
      <small>${escapeHtml(article.entry_date)} · ${escapeHtml(article.tags || '无标签')}</small>
      <p>${escapeHtml(article.excerpt || article.summary || (article.content_text || article.body || '').slice(0, 100))}</p>
    </button>
  `;
}

function renderArticleLibrary() {
  const target = document.querySelector('#article-library');
  if (!target) return;
  target.innerHTML = articleState.list.length ? articleState.list.map(articleCard).join('') : '<div class="empty">暂无文章</div>';
}

function editorToolbar() {
  return `
    <div class="editor-toolbar">
      <button type="button" data-format="formatBlock" data-value="p">正文</button>
      <button type="button" data-format="formatBlock" data-value="h1">H1</button>
      <button type="button" data-format="formatBlock" data-value="h2">H2</button>
      <button type="button" data-format="bold">B</button>
      <button type="button" data-format="italic">I</button>
      <button type="button" data-format="insertUnorderedList">列表</button>
      <button type="button" data-format="insertOrderedList">编号</button>
      <button type="button" data-action="link">链接</button>
      <button type="button" data-action="inline-code">行内代码</button>
      <button type="button" data-action="code-block">代码块</button>
      <button type="button" data-format="formatBlock" data-value="blockquote">引用</button>
      <button type="button" data-format="insertHorizontalRule">分割线</button>
      <button type="button" data-action="source">HTML</button>
    </div>
  `;
}

function renderArticleEditor(article = blankArticle()) {
  const target = document.querySelector('#article-main');
  if (!target) return;
  target.innerHTML = `
    <form id="article-form" class="editor-shell">
      <input type="hidden" name="id" value="${escapeHtml(article.id || '')}">
      <input class="editor-title" name="title" placeholder="文章标题" value="${escapeHtml(article.title || '')}">
      <div class="editor-meta">
        <label>日期<input name="entry_date" type="date" value="${escapeHtml(article.entry_date || today())}"></label>
        <label>状态<select name="status"><option value="draft" ${article.status !== 'published' ? 'selected' : ''}>草稿</option><option value="published" ${article.status === 'published' ? 'selected' : ''}>已发布</option></select></label>
        <label>标签<input name="tags" placeholder="fastapi,js" value="${escapeHtml(article.tags || '')}"></label>
        <label>Slug<input name="slug" placeholder="article-slug" value="${escapeHtml(article.slug || '')}"></label>
      </div>
      <label class="editor-summary">摘要<input name="summary" placeholder="一句话概括文章" value="${escapeHtml(article.summary || '')}"></label>
      ${editorToolbar()}
      <div id="rich-editor" class="rich-editor prose" contenteditable="true">${article.content_html || '<p></p>'}</div>
      <textarea id="source-editor" class="source-editor" hidden>${escapeHtml(article.content_html || '')}</textarea>
      <div class="actions editor-actions">
        <button type="submit">保存</button>
        <button type="button" class="ok" id="publish-article">发布</button>
        <button type="button" class="secondary" id="unpublish-article">转草稿</button>
        <button type="button" class="secondary" id="read-article">阅读视图</button>
        <button type="button" class="danger" id="delete-article">删除</button>
      </div>
    </form>
  `;
  bindArticleEditor(article);
  renderArticleToc();
}

function renderArticleReader(article) {
  const target = document.querySelector('#article-main');
  if (!target) return;
  target.innerHTML = `
    <article class="article-reader">
      <div class="item-meta"><span class="badge ${article.status}">${articleStatusText(article.status)}</span><span>${escapeHtml(article.entry_date)}</span><span>${escapeHtml(article.tags || '')}</span></div>
      <h1>${escapeHtml(article.title || '未命名文章')}</h1>
      ${article.summary ? `<p class="article-summary">${escapeHtml(article.summary)}</p>` : ''}
      <div id="article-content" class="prose">${article.content_html || ''}</div>
      <div class="actions"><button id="edit-article" class="secondary">返回编辑</button></div>
    </article>
  `;
  addCodeCopyButtons(target);
  document.querySelector('#edit-article').addEventListener('click', () => { articleState.mode = 'edit'; renderArticleEditor(article); });
  renderArticleToc(document.querySelector('#article-content'));
}

function collectArticlePayload() {
  const form = document.querySelector('#article-form');
  const source = document.querySelector('#source-editor');
  const editor = document.querySelector('#rich-editor');
  const data = getForm(form);
  data.content_html = source && !source.hidden ? source.value : editor.innerHTML;
  data.content_text = editor.textContent || '';
  data.body = data.content_text;
  return data;
}

function bindArticleEditor(article) {
  const form = document.querySelector('#article-form');
  const editor = document.querySelector('#rich-editor');
  const source = document.querySelector('#source-editor');
  document.querySelector('.editor-toolbar').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    event.preventDefault();
    editor.focus();
    if (button.dataset.format) document.execCommand(button.dataset.format, false, button.dataset.value || null);
    if (button.dataset.action === 'link') {
      const url = prompt('输入链接 URL');
      if (url) document.execCommand('createLink', false, url);
    }
    if (button.dataset.action === 'inline-code') document.execCommand('insertHTML', false, `<code>${getSelection().toString() || 'code'}</code>`);
    if (button.dataset.action === 'code-block') document.execCommand('insertHTML', false, '<pre><code data-language="">// code</code></pre><p></p>');
    if (button.dataset.action === 'source') {
      if (source.hidden) { source.value = editor.innerHTML; source.hidden = false; editor.hidden = true; }
      else { editor.innerHTML = source.value; source.hidden = true; editor.hidden = false; renderArticleToc(); }
    }
    renderArticleToc();
  });
  editor.addEventListener('input', renderArticleToc);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = collectArticlePayload();
    const id = payload.id;
    delete payload.id;
    const saved = await api(id ? `/api/journals/${id}` : '/api/journals', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    articleState.selectedId = saved.id;
    showToast('文章已保存');
    await renderJournals(false);
  });
  document.querySelector('#publish-article').addEventListener('click', async () => {
    const payload = collectArticlePayload();
    payload.status = 'published';
    const id = payload.id;
    delete payload.id;
    const saved = await api(id ? `/api/journals/${id}` : '/api/journals', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    articleState.selectedId = saved.id;
    showToast('文章已发布');
    await renderJournals(false);
  });
  document.querySelector('#unpublish-article').addEventListener('click', async () => {
    if (!article.id) return;
    await api(`/api/journals/${article.id}/unpublish`, { method: 'POST' });
    showToast('已转为草稿');
    await renderJournals(false);
  });
  document.querySelector('#read-article').addEventListener('click', async () => {
    const current = article.id ? await api(`/api/journals/${article.id}`) : { ...article, ...collectArticlePayload() };
    articleState.mode = 'read';
    renderArticleReader(current);
  });
  document.querySelector('#delete-article').addEventListener('click', async () => {
    if (!article.id || !confirm('确定删除这篇文章吗？')) return;
    await api(`/api/journals/${article.id}`, { method: 'DELETE' });
    articleState.selectedId = null;
    showToast('文章已删除');
    await renderJournals(false);
  });
}

function renderArticleToc(root = document.querySelector('#rich-editor')) {
  const toc = document.querySelector('#article-toc');
  if (!toc || !root) return;
  const headings = [...root.querySelectorAll('h1,h2,h3')];
  headings.forEach((heading, index) => { if (!heading.id) heading.id = `heading-${index}`; });
  toc.innerHTML = headings.length ? headings.map((h) => `<button type="button" class="toc-link toc-${h.tagName.toLowerCase()}" data-toc-target="${h.id}">${escapeHtml(h.textContent || '未命名标题')}</button>`).join('') : '<span class="muted">添加标题后自动生成目录</span>';
  toc.onclick = (event) => {
    const button = event.target.closest('[data-toc-target]');
    if (!button) return;
    root.querySelector(`#${button.dataset.tocTarget}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

function addCodeCopyButtons(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.textContent = '复制';
    button.addEventListener('click', () => navigator.clipboard?.writeText(pre.innerText));
    pre.appendChild(button);
  });
}

async function renderJournals(resetSelection = true) {
  app.innerHTML = '<div class="loading">加载技术文章...</div>';
  if (resetSelection) articleState.selectedId = null;
  await loadArticles();
  const selected = articleState.selectedId ? await api(`/api/journals/${articleState.selectedId}`) : blankArticle();
  app.innerHTML = `
    ${pageHead('技术博客', '像 GitBook/Notion 一样沉淀技术文章、代码片段和复盘。', '<button id="new-article">新建文章</button>')}
    <section class="journal-workspace">
      <aside class="article-sidebar card">
        <div class="toolbar vertical">
          <div class="field"><label>搜索</label><input id="article-q" value="${escapeHtml(articleState.q)}" placeholder="标题/正文/标签"></div>
          <div class="field"><label>状态</label><select id="article-status"><option value="all">全部</option><option value="draft">草稿</option><option value="published">已发布</option></select></div>
          <button id="article-search">筛选</button>
        </div>
        <div id="article-library" class="article-library"></div>
      </aside>
      <main id="article-main"></main>
      <aside class="article-toc card"><h3>目录</h3><div id="article-toc"></div></aside>
    </section>
  `;
  document.querySelector('#article-status').value = articleState.status;
  renderArticleLibrary();
  renderArticleEditor(selected);
  bindJournals();
}

function bindJournals() {
  document.querySelector('#new-article').addEventListener('click', () => { articleState.selectedId = null; articleState.mode = 'edit'; renderArticleEditor(blankArticle()); });
  document.querySelector('#article-search').addEventListener('click', async () => {
    articleState.q = document.querySelector('#article-q').value;
    articleState.status = document.querySelector('#article-status').value;
    articleState.selectedId = null;
    await loadArticles();
    renderArticleLibrary();
    renderArticleEditor(articleState.list[0] ? await api(`/api/journals/${articleState.list[0].id}`) : blankArticle());
  });
  document.querySelector('#article-library').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-select-article]');
    if (!button) return;
    articleState.selectedId = button.dataset.selectArticle;
    renderArticleLibrary();
    const article = await api(`/api/journals/${articleState.selectedId}`);
    renderArticleEditor(article);
  });
}

async function renderTodos() {
  app.innerHTML = '<div class="loading">加载 Todo...</div>';
  const rows = await api('/api/todos?status=open');
  app.innerHTML = `
    ${pageHead('Todo', '记录任务、优先级、截止日期和完成状态。')}
    <section class="grid two">
      <form id="todo-form" class="card form-grid">
        <input type="hidden" name="id">
        <div class="field full"><label>任务</label><input name="title" required placeholder="要做什么？"></div>
        <div class="field third"><label>状态</label><select name="status"><option value="open">未完成</option><option value="done">已完成</option><option value="archived">归档</option></select></div>
        <div class="field third"><label>优先级</label><select name="priority"><option value="normal">普通</option><option value="high">高</option><option value="low">低</option></select></div>
        <div class="field third"><label>截止日期</label><input name="due_date" type="date"></div>
        <div class="field full"><label>备注</label><textarea name="notes" placeholder="补充说明"></textarea></div>
        <div class="actions field full"><button>保存 Todo</button><button type="button" class="secondary" id="todo-reset">清空</button></div>
      </form>
      <div class="card">
        <h3>任务列表</h3>
        <div class="toolbar">
          <div class="field"><label>状态</label><select id="todo-status"><option value="open">未完成</option><option value="done">已完成</option><option value="archived">归档</option><option value="all">全部</option></select></div>
          <div class="field"><label>搜索</label><input id="todo-q" placeholder="任务/备注"></div>
          <button id="todo-search">筛选</button>
        </div>
        <div id="todo-list">${todosList(rows)}</div>
      </div>
    </section>
  `;
  bindTodos();
}

function priorityText(value) {
  return ({ high: '高', normal: '普通', low: '低' })[value] || value;
}

function statusText(value) {
  return ({ open: '未完成', done: '已完成', archived: '归档' })[value] || value;
}

function todosList(rows) {
  if (!rows.length) return '<div class="empty">暂无 Todo</div>';
  return `<div class="list">${rows.map((todo) => `
    <article class="item">
      <h4>${todo.status === 'done' ? '✅ ' : ''}${escapeHtml(todo.title)}</h4>
      <p>${escapeHtml(todo.notes || '')}</p>
      <div class="item-meta">
        <span class="badge">${statusText(todo.status)}</span>
        <span class="badge ${todo.priority}">${priorityText(todo.priority)}</span>
        ${todo.due_date ? `<span>截止 ${escapeHtml(todo.due_date)}</span>` : ''}
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="secondary" data-edit-todo="${todo.id}">编辑</button>
        ${todo.status === 'done' ? `<button class="ok" data-reopen-todo="${todo.id}">重开</button>` : `<button class="ok" data-complete-todo="${todo.id}">完成</button>`}
        <button class="danger" data-delete-todo="${todo.id}">删除</button>
      </div>
    </article>
  `).join('')}</div>`;
}

function bindTodos() {
  const form = document.querySelector('#todo-form');
  const list = document.querySelector('#todo-list');
  document.querySelector('#todo-reset').addEventListener('click', () => { form.reset(); form.id.value = ''; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = getForm(form);
    const id = data.id;
    delete data.id;
    await api(id ? `/api/todos/${id}` : '/api/todos', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    showToast('Todo 已保存');
    await renderTodos();
  });
  document.querySelector('#todo-search').addEventListener('click', async () => {
    const rows = await api(withQuery('/api/todos', { status: document.querySelector('#todo-status').value, q: document.querySelector('#todo-q').value }));
    list.innerHTML = todosList(rows);
  });
  list.addEventListener('click', async (event) => {
    const editId = event.target.dataset.editTodo;
    const completeId = event.target.dataset.completeTodo;
    const reopenId = event.target.dataset.reopenTodo;
    const deleteId = event.target.dataset.deleteTodo;
    if (editId) {
      const rows = await api('/api/todos?status=all');
      const row = rows.find((item) => String(item.id) === String(editId));
      if (!row) return;
      form.id.value = row.id;
      form.title.value = row.title || '';
      form.notes.value = row.notes || '';
      form.status.value = row.status || 'open';
      form.priority.value = row.priority || 'normal';
      form.due_date.value = row.due_date || '';
      form.scrollIntoView({ behavior: 'smooth' });
    }
    if (completeId) { await api(`/api/todos/${completeId}/complete`, { method: 'POST' }); showToast('Todo 已完成'); await renderTodos(); }
    if (reopenId) { await api(`/api/todos/${reopenId}/reopen`, { method: 'POST' }); showToast('Todo 已重开'); await renderTodos(); }
    if (deleteId && confirm('确定删除这个 Todo 吗？')) { await api(`/api/todos/${deleteId}`, { method: 'DELETE' }); showToast('Todo 已删除'); await renderTodos(); }
  });
}

function accountingRange() {
  if (accountingState.mode === 'year') return { from: yearStart(accountingState.year), to: yearEnd(accountingState.year) };
  if (accountingState.mode === 'custom') return { from: accountingState.from, to: accountingState.to };
  return { from: monthStart(accountingState.month), to: monthEnd(accountingState.month) };
}

function accountingSummaryParams() {
  if (accountingState.mode === 'year') return { year: accountingState.year };
  if (accountingState.mode === 'custom') return { from: accountingState.from, to: accountingState.to };
  return { month: accountingState.month };
}

function accountingPeriodLabel() {
  if (accountingState.mode === 'year') return `${accountingState.year} 年`;
  if (accountingState.mode === 'custom') return `${accountingState.from} 至 ${accountingState.to}`;
  return `${accountingState.month} 月`;
}

async function renderAccounting() {
  app.innerHTML = '<div class="loading">加载记账...</div>';
  await loadLookups();
  app.innerHTML = `
    ${pageHead('记账', '记录收入支出流水，支持按月份、年份和自定义日期范围统计。')}
    <section id="accounting-stats" class="grid four"></section>
    <section class="grid two" style="margin-top:16px">
      <form id="txn-form" class="card form-grid">
        <input type="hidden" name="id">
        <div class="field quarter"><label>日期</label><input name="txn_date" type="date" value="${today()}" required></div>
        <div class="field quarter"><label>类型</label><select name="kind" id="txn-kind"><option value="expense">支出</option><option value="income">收入</option></select></div>
        <div class="field quarter"><label>金额</label><input name="amount" type="number" step="0.01" min="0.01" required></div>
        <div class="field quarter"><label>账户</label><select name="account_id">${accountOptions()}</select></div>
        <div class="field half"><label>分类</label><select name="category_id" id="txn-category">${categoryOptions('expense')}</select></div>
        <div class="field half"><label>对方/商户</label><input name="counterparty" placeholder="可选"></div>
        <div class="field half"><label>标签</label><input name="tags" placeholder="food,work"></div>
        <div class="field half"><label>备注</label><input name="notes" placeholder="说明"></div>
        <div class="actions field full"><button>保存流水</button><button type="button" class="secondary" id="txn-reset">清空</button></div>
      </form>
      <div class="card">
        <h3 id="accounting-stats-title">统计</h3>
        <div class="grid two">
          <div id="category-stats"></div>
          <div id="account-stats"></div>
        </div>
      </div>
    </section>
    <section class="card" style="margin-top:16px">
      <h3>流水列表</h3>
      <div class="toolbar">
        <div class="field"><label>周期</label><select id="txn-period-mode"><option value="month">按月份</option><option value="year">按年份</option><option value="custom">自定义</option></select></div>
        <div class="field period-field period-month"><label>月份</label><input id="txn-month" type="month" value="${accountingState.month}"></div>
        <div class="field period-field period-year"><label>年份</label><input id="txn-year" type="number" min="1970" max="2999" value="${accountingState.year}"></div>
        <div class="field period-field period-custom"><label>从</label><input id="txn-from" type="date" value="${accountingState.from}"></div>
        <div class="field period-field period-custom"><label>到</label><input id="txn-to" type="date" value="${accountingState.to}"></div>
        <div class="field"><label>类型</label><select id="txn-filter-kind"><option value="">全部</option><option value="expense">支出</option><option value="income">收入</option></select></div>
        <div class="field"><label>分类</label><select id="txn-filter-category">${categoryOptions()}</select></div>
        <div class="field"><label>账户</label><select id="txn-filter-account">${accountOptions()}</select></div>
        <div class="field"><label>关键词</label><input id="txn-q" placeholder="备注/商户/标签"></div>
        <button id="txn-search">筛选</button>
      </div>
      <div class="card" style="box-shadow:none;margin-bottom:14px"><h3>趋势</h3><canvas id="monthly-chart" height="120"></canvas></div>
      <div id="txn-list"></div>
    </section>
  `;
  bindAccounting();
  await refreshAccountingData();
}

function transactionsTable(rows, editable = true) {
  if (!rows.length) return '<div class="empty">暂无流水</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>日期</th><th>类型</th><th>金额</th><th>分类</th><th>账户</th><th>商户/对方</th><th>备注</th>${editable ? '<th>操作</th>' : ''}</tr></thead>
    <tbody>${rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.txn_date)}</td>
        <td><span class="badge ${row.kind}">${row.kind === 'income' ? '收入' : '支出'}</span></td>
        <td class="${row.kind === 'income' ? 'money-income' : 'money-expense'}">${row.kind === 'income' ? '+' : '-'}¥${money(row.amount)}</td>
        <td>${escapeHtml(row.category_name || '未分类')}</td>
        <td>${escapeHtml(row.account_name || '未指定')}</td>
        <td>${escapeHtml(row.counterparty || '')}</td>
        <td>${escapeHtml(row.notes || row.tags || '')}</td>
        ${editable ? `<td><div class="actions"><button class="secondary" data-edit-txn="${row.id}">编辑</button><button class="danger" data-delete-txn="${row.id}">删除</button></div></td>` : ''}
      </tr>
    `).join('')}</tbody>
  </table></div>`;
}

function syncAccountingControls() {
  const mode = document.querySelector('#txn-period-mode')?.value || accountingState.mode;
  document.querySelectorAll('.period-field').forEach((node) => { node.style.display = 'none'; });
  document.querySelectorAll(`.period-${mode}`).forEach((node) => { node.style.display = 'grid'; });
}

function readAccountingControls() {
  accountingState.mode = document.querySelector('#txn-period-mode').value;
  accountingState.month = document.querySelector('#txn-month').value || thisMonth();
  accountingState.year = document.querySelector('#txn-year').value || thisYear();
  accountingState.from = document.querySelector('#txn-from').value || monthStart(thisMonth());
  accountingState.to = document.querySelector('#txn-to').value || today();
  accountingState.kind = document.querySelector('#txn-filter-kind').value;
  accountingState.category_id = document.querySelector('#txn-filter-category').value;
  accountingState.account_id = document.querySelector('#txn-filter-account').value;
  accountingState.q = document.querySelector('#txn-q').value;
}

async function refreshAccountingData() {
  const range = accountingRange();
  const summaryParams = accountingSummaryParams();
  const monthlyParams = accountingState.mode === 'year'
    ? { from_month: `${accountingState.year}-01`, to_month: `${accountingState.year}-12` }
    : { to_month: accountingState.month };
  const [summary, transactions, byCategory, byAccount, monthly] = await Promise.all([
    api(withQuery('/api/accounting/summary', summaryParams)),
    api(withQuery('/api/transactions', { ...range, kind: accountingState.kind, category_id: accountingState.category_id, account_id: accountingState.account_id, q: accountingState.q, limit: 300 })),
    api(withQuery('/api/accounting/by-category', { ...range, kind: 'expense' })),
    api(withQuery('/api/accounting/by-account', range)),
    api(withQuery('/api/accounting/monthly', monthlyParams)),
  ]);
  document.querySelector('#accounting-stats').innerHTML = `
    <div class="card stat income"><span class="label">${accountingPeriodLabel()} 收入</span><span class="value">¥${money(summary.income_total)}</span></div>
    <div class="card stat expense"><span class="label">${accountingPeriodLabel()} 支出</span><span class="value">¥${money(summary.expense_total)}</span></div>
    <div class="card stat net"><span class="label">${accountingPeriodLabel()} 结余</span><span class="value">¥${money(summary.net_total)}</span></div>
    <div class="card stat"><span class="label">流水数</span><span class="value">${summary.transaction_count}</span></div>
  `;
  document.querySelector('#accounting-stats-title').textContent = `${accountingPeriodLabel()} 统计`;
  document.querySelector('#category-stats').innerHTML = summaryList(byCategory, 'category_name', 'total');
  document.querySelector('#account-stats').innerHTML = summaryList(byAccount, 'account_name', 'net_total');
  document.querySelector('#txn-list').innerHTML = transactionsTable(transactions, true);
  drawMonthlyChart(monthly);
}

function bindAccounting() {
  const form = document.querySelector('#txn-form');
  const list = document.querySelector('#txn-list');
  const kind = document.querySelector('#txn-kind');
  const category = document.querySelector('#txn-category');
  document.querySelector('#txn-period-mode').value = accountingState.mode;
  document.querySelector('#txn-filter-kind').value = accountingState.kind;
  document.querySelector('#txn-filter-category').value = accountingState.category_id;
  document.querySelector('#txn-filter-account').value = accountingState.account_id;
  document.querySelector('#txn-q').value = accountingState.q;
  syncAccountingControls();
  document.querySelector('#txn-period-mode').addEventListener('change', () => { syncAccountingControls(); });
  kind.addEventListener('change', () => { category.innerHTML = categoryOptions(kind.value); });
  document.querySelector('#txn-reset').addEventListener('click', () => { form.reset(); form.id.value = ''; form.txn_date.value = today(); category.innerHTML = categoryOptions('expense'); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = getForm(form);
    const id = data.id;
    delete data.id;
    data.amount = Number(data.amount);
    data.category_id = data.category_id ? Number(data.category_id) : null;
    data.account_id = data.account_id ? Number(data.account_id) : null;
    await api(id ? `/api/transactions/${id}` : '/api/transactions', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    showToast('流水已保存');
    form.reset();
    form.txn_date.value = today();
    await refreshAccountingData();
  });
  document.querySelector('#txn-search').addEventListener('click', async () => {
    readAccountingControls();
    syncAccountingControls();
    await refreshAccountingData();
  });
  list.addEventListener('click', async (event) => {
    const editId = event.target.dataset.editTxn;
    const deleteId = event.target.dataset.deleteTxn;
    if (editId) {
      const row = await api(`/api/transactions/${editId}`);
      form.id.value = row.id;
      form.txn_date.value = row.txn_date;
      form.kind.value = row.kind;
      category.innerHTML = categoryOptions(row.kind, row.category_id || '');
      form.amount.value = row.amount;
      form.account_id.value = row.account_id || '';
      form.counterparty.value = row.counterparty || '';
      form.tags.value = row.tags || '';
      form.notes.value = row.notes || '';
      form.scrollIntoView({ behavior: 'smooth' });
    }
    if (deleteId && confirm('确定删除这条流水吗？')) {
      await api(`/api/transactions/${deleteId}`, { method: 'DELETE' });
      showToast('流水已删除');
      await refreshAccountingData();
    }
  });
}

async function renderSettings() {
  app.innerHTML = '<div class="loading">加载设置...</div>';
  await loadLookups();
  const meta = await api('/api/meta');
  app.innerHTML = `
    ${pageHead('设置', '管理账户、收支分类和查看服务信息。', '<a class="button secondary" href="/auth/logout">退出登录</a>')}
    <section class="grid two">
      <div class="card">
        <h3>账户</h3>
        <form id="account-form" class="form-grid">
          <input type="hidden" name="id">
          <div class="field half"><label>名称</label><input name="name" required placeholder="支付宝/微信/银行卡"></div>
          <div class="field half"><label>类型</label><input name="type" placeholder="cash/bank/alipay"></div>
          <div class="field half"><label>初始余额</label><input name="initial_balance" type="number" step="0.01" value="0"></div>
          <div class="field half"><label>是否启用</label><select name="is_active"><option value="1">启用</option><option value="0">停用</option></select></div>
          <div class="field full"><label>备注</label><input name="notes"></div>
          <div class="actions field full"><button>保存账户</button><button type="button" class="secondary" id="account-reset">清空</button></div>
        </form>
        <div id="account-list" style="margin-top:14px">${accountsTable()}</div>
      </div>
      <div class="card">
        <h3>分类</h3>
        <form id="category-form" class="form-grid">
          <input type="hidden" name="id">
          <div class="field half"><label>名称</label><input name="name" required></div>
          <div class="field half"><label>类型</label><select name="kind"><option value="expense">支出</option><option value="income">收入</option></select></div>
          <div class="field half"><label>排序</label><input name="sort_order" type="number" value="0"></div>
          <div class="field half"><label>是否启用</label><select name="is_active"><option value="1">启用</option><option value="0">停用</option></select></div>
          <div class="actions field full"><button>保存分类</button><button type="button" class="secondary" id="category-reset">清空</button></div>
        </form>
        <div id="category-list" style="margin-top:14px">${categoriesTable()}</div>
      </div>
    </section>
    <section class="card" style="margin-top:16px">
      <h3>服务信息</h3>
      <p class="muted">应用：${escapeHtml(meta.app)}；Public Base：${escapeHtml(meta.public_base)}；今天：${escapeHtml(meta.today)}</p>
      <p class="muted">部署端口默认 8776；如公网访问失败，请确认 CentOS 防火墙和阿里云安全组已放行该端口。</p>
    </section>
  `;
  bindSettings();
}

function accountsTable() {
  if (!state.accounts.length) return '<div class="empty">暂无账户</div>';
  return `<div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>余额</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.accounts.map((row) => `
    <tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.type || '')}</td><td>¥${money(row.initial_balance)}</td><td>${row.is_active ? '启用' : '停用'}</td><td><div class="actions"><button class="secondary" data-edit-account="${row.id}">编辑</button><button class="danger" data-delete-account="${row.id}">停用</button></div></td></tr>
  `).join('')}</tbody></table></div>`;
}

function categoriesTable() {
  if (!state.categories.length) return '<div class="empty">暂无分类</div>';
  return `<div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.categories.map((row) => `
    <tr><td>${escapeHtml(row.name)}</td><td>${row.kind === 'income' ? '收入' : '支出'}</td><td>${row.sort_order}</td><td>${row.is_active ? '启用' : '停用'}</td><td><div class="actions"><button class="secondary" data-edit-category="${row.id}">编辑</button><button class="danger" data-delete-category="${row.id}">停用</button></div></td></tr>
  `).join('')}</tbody></table></div>`;
}

function bindSettings() {
  const accountForm = document.querySelector('#account-form');
  const categoryForm = document.querySelector('#category-form');
  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = getForm(accountForm);
    const id = data.id;
    delete data.id;
    data.initial_balance = Number(data.initial_balance || 0);
    data.is_active = Number(data.is_active || 0);
    await api(id ? `/api/accounts/${id}` : '/api/accounts', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    showToast('账户已保存');
    await renderSettings();
  });
  categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = getForm(categoryForm);
    const id = data.id;
    delete data.id;
    data.sort_order = Number(data.sort_order || 0);
    data.is_active = Number(data.is_active || 0);
    data.parent_id = null;
    await api(id ? `/api/categories/${id}` : '/api/categories', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    showToast('分类已保存');
    await renderSettings();
  });
  document.querySelector('#account-reset').addEventListener('click', () => { accountForm.reset(); accountForm.id.value = ''; });
  document.querySelector('#category-reset').addEventListener('click', () => { categoryForm.reset(); categoryForm.id.value = ''; });
  document.querySelector('#account-list').addEventListener('click', async (event) => {
    const editId = event.target.dataset.editAccount;
    const deleteId = event.target.dataset.deleteAccount;
    if (editId) {
      const row = state.accounts.find((item) => String(item.id) === String(editId));
      accountForm.id.value = row.id;
      accountForm.name.value = row.name || '';
      accountForm.type.value = row.type || '';
      accountForm.initial_balance.value = row.initial_balance || 0;
      accountForm.notes.value = row.notes || '';
      accountForm.is_active.value = String(row.is_active || 0);
    }
    if (deleteId && confirm('确定停用这个账户吗？')) { await api(`/api/accounts/${deleteId}`, { method: 'DELETE' }); showToast('账户已停用'); await renderSettings(); }
  });
  document.querySelector('#category-list').addEventListener('click', async (event) => {
    const editId = event.target.dataset.editCategory;
    const deleteId = event.target.dataset.deleteCategory;
    if (editId) {
      const row = state.categories.find((item) => String(item.id) === String(editId));
      categoryForm.id.value = row.id;
      categoryForm.name.value = row.name || '';
      categoryForm.kind.value = row.kind || 'expense';
      categoryForm.sort_order.value = row.sort_order || 0;
      categoryForm.is_active.value = String(row.is_active || 0);
    }
    if (deleteId && confirm('确定停用这个分类吗？')) { await api(`/api/categories/${deleteId}`, { method: 'DELETE' }); showToast('分类已停用'); await renderSettings(); }
  });
}

async function render() {
  setActiveNav();
  try {
    const route = routeName();
    if (route === 'dashboard') return await renderDashboard();
    if (route === 'journals') return await renderJournals();
    if (route === 'todos') return await renderTodos();
    if (route === 'accounting') return await renderAccounting();
    if (route === 'settings') return await renderSettings();
  } catch (error) {
    setError(error);
  }
}

window.addEventListener('hashchange', render);
if (!location.hash) location.hash = '#dashboard';
render();
