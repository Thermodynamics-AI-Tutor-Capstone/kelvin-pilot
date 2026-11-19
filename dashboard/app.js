const app = document.querySelector('#app');
const signout = document.querySelector('#signout');
const identity = document.querySelector('#identity');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { token: sessionStorage.getItem('kelvin-demo-token'), account: null, courses: [], courseId: null,
  detail: null, analytics: null, student: null, tab: 'activity', category: 'topic', query: '', selected: null, preview: false };
const demoAnalytics = () => {
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  const requests = [18, 24, 21, 34, 38, 29, 26, 43, 51, 47, 58, 54, 67, 63];
  const reflections = [6, 7, 6, 9, 10, 8, 7, 11, 14, 12, 16, 15, 19, 17];
  return { suppressed: false, sample: true, timeline: requests.map((count, index) => ({
    date: new Date(now.getTime() - (13 - index) * 86400_000).toISOString().slice(0, 10), requests: count, reflections: reflections[index] })),
    topicTrends: [{ id: 'topic:m7-07-entropy', previous: 12, recent: 23 }, { id: 'topic:m5-04-energy-conservation', previous: 18, recent: 21 }, { id: 'topic:m4-03-phase-decision-tree', previous: 9, recent: 17 }, { id: 'topic:m6-03-example-steady-flow-energy-conservation', previous: 8, recent: 14 }, { id: 'topic:m8-03-heat-pump-refrigerator', previous: 6, recent: 12 }],
    questionTrends: [{ id: 'topic:m7-07-entropy', previous: 16, recent: 29 }, { id: 'topic:m5-04-energy-conservation', previous: 14, recent: 24 }, { id: 'topic:m4-03-phase-decision-tree', previous: 11, recent: 19 }, { id: 'topic:m6-03-example-steady-flow-energy-conservation', previous: 9, recent: 15 }, { id: 'topic:m8-03-heat-pump-refrigerator', previous: 7, recent: 13 }],
    cardTrends: [{ id: 'topic:m7-07-entropy', previous: 15, recent: 30 }, { id: 'topic:m4-03-phase-decision-tree', previous: 11, recent: 21 }, { id: 'topic:m5-04-energy-conservation', previous: 13, recent: 19 }, { id: 'topic:m6-03-example-steady-flow-energy-conservation', previous: 7, recent: 14 }],
    misconceptionTrends: [{ id: 'misc:m15-adiabatic-implies-isentropic', previous: 6, recent: 14 }, { id: 'misc:m01-heat-energy-temperature-conflated', previous: 9, recent: 11 }, { id: 'misc:m05-adiabatic-and-isothermal-conflated', previous: 8, recent: 10 }, { id: 'misc:m07-work-is-not-energy-transfer', previous: 7, recent: 9 }],
    misconceptions: [{ id: 'misc:m15-adiabatic-implies-isentropic', count: 13 }, { id: 'misc:m01-heat-energy-temperature-conflated', count: 9 }] };
};
function error(message) { const node = document.querySelector('#message'); if (node) node.textContent = message; }
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const response = await fetch(path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}),
    ...(auth && state.token ? { authorization: `Bearer ${state.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}
function setSession(session) {
  state.token = session.token; state.account = session.account;
  sessionStorage.setItem('kelvin-demo-token', state.token);
  state.courseId = null; state.tab = state.account.role === 'student' ? 'learning' : 'activity';
  return loadWorkspace();
}
signout.addEventListener('click', async () => {
  try { if (state.token) await api('/api/logout', { method: 'POST' }); } catch {}
  sessionStorage.removeItem('kelvin-demo-token'); state.token = null; state.account = null;
  state.preview = false; identity.textContent = ''; signout.classList.add('hidden');
  await welcome();
});
async function welcome() {
  signout.classList.add('hidden'); identity.textContent = '';
  app.innerHTML = `<div class="welcome-screen"><section class="intro"><p class="eyebrow">Your course workspace</p><h1>Welcome to Kelvin</h1><p class="lead">Choose how you use Kelvin to open your dashboard.</p></section>
    <div class="entry-grid"><section class="panel entry-card"><span class="entry-icon" aria-hidden="true">S</span><h2>Student</h2><p>Use the PSU email you connected to Kelvin in your chat app.</p>
      <form id="student-form"><label>PSU email<input type="email" name="email" placeholder="you@psu.edu" autocomplete="email" required></label>
      <button class="button full">Open dashboard</button></form></section>
    <section class="panel entry-card"><span class="entry-icon" aria-hidden="true">P</span><h2>Professor</h2>
      <div class="tab-row"><button class="mini-tab active" data-auth="signin">Sign in</button><button class="mini-tab" data-auth="register">Create account</button></div>
      <form id="professor-form"><div id="name-row" class="hidden"><label>Your name<input name="name" autocomplete="name"></label></div>
      <label>PSU email<input name="email" type="email" placeholder="you@psu.edu" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="button full" id="professor-submit">Sign in</button></form><p class="hint">Want to explore first? <button class="quiet" id="sample-view" type="button">Open sample view</button></p></section></div>
    <p id="message" class="error" role="alert"></p><p class="welcome-help">New to Kelvin? <a href="/#connect">See connection steps</a></p></div>`;
  document.querySelector('#student-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await setSession(await api('/api/student-session', { method: 'POST', body: values, auth: false })); } catch (e) { error(e.message); }
  });
  let mode = 'signin';
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.auth; document.querySelectorAll('[data-auth]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('#name-row').classList.toggle('hidden', mode !== 'register');
    document.querySelector('#professor-form [name="password"]').minLength = mode === 'register' ? 8 : 1;
    document.querySelector('#professor-submit').textContent = mode === 'register' ? 'Create professor account' : 'Sign in';
    document.querySelector('#professor-form [name="email"]').placeholder = mode === 'register' ? 'you@psu.edu' : '';
  }));
  document.querySelector('#professor-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await setSession(await api(mode === 'register' ? '/api/professor-register' : '/api/professor-session',
      { method: 'POST', body: values, auth: false })); } catch (e) { error(e.message); }
  });
  document.querySelector('#sample-view').addEventListener('click', async () => {
    state.account = { id: 'sample-professor', role: 'sample', name: 'Demo Professor' }; state.token = null;
    state.courses = [{ id: 'demo-me300', code: 'ME 300', title: 'ME 300 Engineering Thermodynamics' }];
    state.courseId = 'demo-me300'; state.tab = 'activity'; state.preview = true;
    state.detail = { course: state.courses[0], cards: [], skills: [], files: [] };
    await loadSampleContent(); renderWorkspace();
  });
}
async function loadSampleContent() {
  const professors = await api('/api/professors', { auth: false });
  const stock = professors.find(p => p.id === 'demo-professor')?.courses[0];
  if (!stock) return;
  const content = await fetch('/api/public-content').then(r => r.json());
  state.detail = { course: stock, ...content };
}
async function loadWorkspace() {
  state.courses = await api('/api/courses');
  if (!state.courses.some(c => c.id === state.courseId)) state.courseId = state.courses[0]?.id;
  if (state.account.role === 'student') state.student = await api('/api/student');
  await loadCourse();
}
async function loadCourse() {
  if (!state.courseId) return renderWorkspace();
  const id = encodeURIComponent(state.courseId);
  state.detail = await api(`/api/courses/${id}`);
  state.analytics = ['instructor','operator'].includes(state.account.role) ? await api(`/api/courses/${id}/analytics`) : null;
  state.preview = Boolean(state.analytics?.suppressed);
  state.selected = null; renderWorkspace();
}
function renderWorkspace() {
  const professor = state.account.role !== 'student';
  identity.textContent = state.account.email || state.account.name;
  signout.classList.remove('hidden');
  const course = state.detail?.course || state.courses[0];
  app.innerHTML = `<div class="workspace-head">${professor && state.account.role !== 'sample' ?
    `<label class="course-switch">Course<select id="course-select">${state.courses.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === state.courseId ? 'selected' : ''}>${escapeHtml(c.code)} · ${escapeHtml(c.title)}</option>`).join('')}</select></label>` :
    `<h1>${escapeHtml(professor ? course?.code || course?.title : course?.title || 'Your course')}</h1>`}</div>
    <nav class="nav-tabs" aria-label="Workspace sections">${(professor ? state.account.role === 'researcher' ? [['activity', 'Activity over time'], ['content', 'Course content']] :
      [['activity', 'Activity over time'], ['content', 'Course content'], ['manage', 'Schedule & versions'], ['upload', 'Courses & uploads']] : [['learning', 'My learning'], ['content', 'Course content']])
      .map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <section id="workspace-body"></section>`;
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderWorkspace(); }));
  document.querySelector('#course-select')?.addEventListener('change', event => { state.courseId = event.target.value; loadCourse().catch(e => showError(e.message)); });
  if (state.tab === 'activity') renderActivity();
  if (state.tab === 'learning') renderLearning();
  if (state.tab === 'content') renderContent();
  if (state.tab === 'upload') renderUpload();
  if (state.tab === 'manage') renderManage();
}
function showError(message) { const body = document.querySelector('#workspace-body'); if (body) body.innerHTML = `<p class="error">${escapeHtml(message)}</p>`; }
function chart(title, series, field, color) {
  const visible = series.map((point, index) => ({ x: index, y: point[field], date: point.date })).filter(point => point.y !== null);
  const max = Math.max(1, ...visible.map(point => point.y));
  const x = index => 44 + index * 40, y = value => 128 - (value / max) * 100;
  let segments = [], current = [];
  for (let i = 0; i < series.length; i++) {
    const value = series[i][field];
    if (value === null) { if (current.length) segments.push(current); current = []; }
    else current.push(`${current.length ? 'L' : 'M'}${x(i)},${y(value).toFixed(1)}`);
  }
  if (current.length) segments.push(current);
  const paths = segments.map(segment => `<path d="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const dots = visible.map(point => `<circle cx="${x(point.x)}" cy="${y(point.y).toFixed(1)}" r="3.5" fill="${color}"><title>${escapeHtml(point.date)}: ${point.y}</title></circle>`).join('');
  return `<section class="panel chart-card"><h2>${title}</h2>
    <svg viewBox="0 0 620 165" role="img" aria-label="${title} over 14 days"><line x1="44" y1="128" x2="566" y2="128" stroke="#cad7dc"/>
    <text x="4" y="22" class="axis">${max}</text><text x="18" y="132" class="axis">0</text>${paths}${dots}
    <text x="44" y="153" class="axis">${escapeHtml(series[0]?.date || '')}</text><text x="490" y="153" class="axis">${escapeHtml(series.at(-1)?.date || '')}</text></svg>
    <details><summary>View daily values</summary><div class="daily-list">${series.map(point => `<span>${escapeHtml(point.date)}</span><span>${point[field] === null ? 'Hidden' : point[field]}</span>`).join('')}</div></details></section>`;
}
function comparison(items, title) {
  if (!items?.length) return `<section class="panel"><h2>${title}</h2><p class="muted">No visible data yet.</p></section>`;
  const names = new Map((state.detail?.cards || []).map(card => [card.id, card.title]));
  const max = Math.max(1, ...items.map(item => Math.max(item.recent, item.previous)));
  return `<section class="panel"><h2>${title}</h2><div class="compare-list">${items.map(item =>
    `<div class="compare-row"><div class="compare-label"><strong>${escapeHtml(names.get(item.id) || item.id)}</strong><span>${item.previous} → ${item.recent}</span></div>
    <div class="bar-pair"><span style="width:${Math.max(2, item.previous / max * 100)}%"></span><span style="width:${Math.max(2, item.recent / max * 100)}%"></span></div></div>`).join('')}</div>
    <p class="legend"><i></i> Previous 7 days <i></i> Recent 7 days</p></section>`;
}
function renderActivity() {
  const real = state.analytics, data = state.preview || state.account.role === 'sample' ? demoAnalytics() : real;
  const sample = Boolean(data?.sample);
  const body = document.querySelector('#workspace-body');
  body.innerHTML = `<div class="section-title"><div><h2>Activity <span class="period-label">Last 14 days</span>${sample ? '<span class="sample-badge">Sample data</span>' : ''}</h2></div>
    ${state.account.role !== 'sample' ? `<button id="preview-toggle" class="button secondary">${state.preview ? 'Live data' : 'Sample data'}</button>` : ''}</div>
    ${!data || data.suppressed ? `<div class="panel empty-state"><h2>No class activity to show yet</h2><p>Charts appear after five students use this course.</p></div>` :
    `<div class="chart-grid">${chart('MCP requests', data.timeline, 'requests', '#247a82')}${chart('Saved learning reflections', data.timeline, 'reflections', '#ba7446')}</div>
    <div class="chart-grid">${comparison(data.questionTrends, 'Questions by topic')}${comparison(data.misconceptionTrends, 'Misconceptions to revisit')}</div>
    <details class="more-detail"><summary>More breakdowns</summary><div class="chart-grid">${comparison(data.topicTrends, 'Topics students saved')}${comparison(data.cardTrends, 'Course content opened')}</div></details>
    ${sample ? '' : `<section class="panel"><h2>Class takeaway</h2><p>${escapeHtml(real?.insight?.conclusion || 'No takeaway yet.')}</p>
    ${real?.insight?.suggestion ? `<p><strong>Suggested teaching move:</strong> ${escapeHtml(real.insight.suggestion)} <small>Model-generated from aggregate counts</small></p>` : ''}
    <p class="muted">${real?.insight ? `${real.insight.sourceCount} source calls · ${real.insight.studentCount} students · generated ${escapeHtml(new Date(real.insight.generatedAt).toLocaleString())}` : ''}</p>
    ${real?.insight?.trends?.length ? `<details><summary>Evidence behind this conclusion</summary><ul class="simple-list">${real.insight.trends.slice(0,8).map(item =>
      `<li>${escapeHtml((state.detail?.cards || []).find(card => card.id === item.id)?.title || item.id)} · ${item.count} opens by ${item.studentCount} students</li>`).join('')}</ul>
      <p class="muted">Evidence event IDs: ${escapeHtml(real.insight.evidenceEventIds.slice(0,12).join(', '))}</p></details>` : ''}
    ${real?.insight?.questionTopics?.length ? `<details><summary>Question topics from student activity</summary><ul class="simple-list">${real.insight.questionTopics.slice(0,8).map(item =>
      `<li>${escapeHtml((state.detail?.cards || []).find(card => card.id === item.id)?.title || item.id)} · ${item.studentCount} students</li>`).join('')}</ul>
      <p class="muted">Topic labels are model-generated. Evidence includes MCP calls and student-imported prompts.</p></details>` : ''}
    ${['instructor','operator'].includes(state.account.role) ? '<button class="button secondary" id="run-dream">Refresh synthesis</button>' : ''}</section>`}`}`;
  document.querySelector('#preview-toggle')?.addEventListener('click', () => { state.preview = !state.preview; renderActivity(); });
  document.querySelector('#run-dream')?.addEventListener('click', async () => {
    try { await api(`/api/courses/${encodeURIComponent(state.courseId)}/dream`, { method: 'POST' }); await loadCourse(); }
    catch (e) { showError(e.message); }
  });
}
function renderLearning() {
  const data = state.student;
  const body = document.querySelector('#workspace-body');
  body.innerHTML = `<div class="section-title"><div><h2>My learning</h2><p class="muted">${escapeHtml(data?.professor || '')}</p></div><button id="refresh-student" class="button secondary">Refresh</button></div>
    <section class="panel"><h2>Saved learning</h2>${data?.reflections?.length ? `<div class="record-list">${data.reflections.map(item =>
    `<article class="record"><time>${escapeHtml(new Date(item.at).toLocaleDateString())} · ${escapeHtml(item.courseTitle || '')}</time><p>${escapeHtml(item.statement)}</p><small>Topics: ${escapeHtml((item.topics || []).join(', ') || 'Classification pending')}</small></article>`).join('')}</div>` :
    '<p class="muted">No saved notes yet.</p>'}</section>
    <section class="panel"><h2>Recent Kelvin activity</h2>${data?.calls?.length ? `<div class="record-list">${data.calls.slice(0,12).map(item =>
      `<div class="record"><time>${escapeHtml(new Date(item.at).toLocaleString())} · ${escapeHtml(item.client)}</time>
      <strong>${escapeHtml(item.tool || 'MCP request')}</strong><p>${escapeHtml(item.arguments?.question || item.arguments?.query || '')}</p>
      <small>Course version ${escapeHtml(item.courseVersion)}</small></div>`).join('')}</div>` : '<p class="muted">No MCP calls recorded yet.</p>'}</section>
    <section class="panel"><h2>Learning summary</h2><p>${escapeHtml(data?.insights?.statement || 'No summary yet.')}</p>
    <p class="muted">${data?.insights?.sourceCount || 0} events used · ${escapeHtml(data?.insights?.modelStatus || 'pending')}</p></section>
    <section class="panel"><h2>Import chat questions</h2><p class="muted">ChatGPT, Claude, or Gemini export. Kelvin imports your prompts.</p>
    <form id="chat-import"><label>Platform<select name="platform"><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="gemini">Gemini</option></select></label>
    <label>Export file<input type="file" name="file" accept=".json,.html,application/json,text/html" required></label><button class="button">Import</button></form>
    <p class="muted">${(data?.imports || []).map(item => `${escapeHtml(item.platform)}: ${item.count} prompts`).join(' · ')}</p><p id="import-result" role="status"></p></section>`;
  document.querySelector('#refresh-student').addEventListener('click', async () => {
    try { state.account = await api('/api/me'); await loadWorkspace(); } catch (e) { showError(e.message); }
  });
  document.querySelector('#chat-import').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget), file = form.get('file');
    if (!file || file.size > 50_000_000) { document.querySelector('#import-result').textContent = 'Choose a JSON file under 50 MB.'; return; }
    try { const platform = form.get('platform'), raw = await file.text();
      const isHtml = /\.html?$/i.test(file.name);
      if (isHtml && platform !== 'gemini') throw new Error('Use a JSON export for ChatGPT or Claude.');
      const source = isHtml ? null : JSON.parse(raw), prompts = [];
      if (isHtml) { const doc = new DOMParser().parseFromString(raw, 'text/html');
        for (const cell of doc.querySelectorAll('.outer-cell, .activity-entry')) {
          const text = cell.querySelector('.content-cell, .activity-description')?.textContent?.trim() || '';
          if (text) prompts.push({ conversation: 'Gemini activity', at: null, text });
        }
      }
      if (platform === 'chatgpt') for (const chat of (Array.isArray(source) ? source : source.conversations || []))
        for (const node of Object.values(chat.mapping || {})) { const m = node.message;
          if (m?.author?.role === 'user') prompts.push({ conversation: chat.title, at: m.create_time ? new Date(m.create_time * 1000).toISOString() : null,
            text: (m.content?.parts || []).filter(x => typeof x === 'string').join('\n') }); }
      if (platform === 'claude') for (const chat of (Array.isArray(source) ? source : source.conversations || []))
        for (const m of chat.chat_messages || chat.messages || []) if (['human','user'].includes(m.sender || m.role))
          prompts.push({ conversation: chat.name || chat.title, at: m.created_at,
            text: Array.isArray(m.content) ? m.content.map(x => x.text || '').join('\n') : String(m.text || m.content || '') });
      if (platform === 'gemini') for (const item of (Array.isArray(source) ? source : source.activities || source.events || []))
        prompts.push({ conversation: item.header, at: item.time || item.timestamp, text: item.title || item.prompt || item.text || '' });
      const data = { prompts: prompts.filter(x => x.text?.length >= 10).slice(-500).map(x => ({ ...x, text: x.text.slice(0, 1500) })) };
      const result = await api('/api/student/import', { method: 'POST', body: { platform, data } });
      document.querySelector('#import-result').textContent = `Imported ${result.count} prompts.`; }
    catch (e) { document.querySelector('#import-result').textContent = e.message; }
  });
}
async function openItem(kind, id) {
  const course = encodeURIComponent(state.courseId), item = encodeURIComponent(id);
  const path = kind === 'file' ? `files/${item}` : kind === 'skill' ? `skills/${item}` : `cards/${item}`;
  const data = state.account.role === 'sample' ? await api(`/api/public-content/${path}`, { auth: false }) : await api(`/api/courses/${course}/${path}`);
  if (kind === 'file' && ['instructor','operator'].includes(state.account.role))
    data.versions = await api(`/api/courses/${course}/files/${item}/versions`).catch(() => []);
  state.selected = data;
  renderContent();
}
function renderContent() {
  const detail = state.detail || { cards: [], skills: [], files: [] };
  const categories = [['course', 'Course'], ['unit', 'Units'], ['topic', 'Topics'], ['misconception', 'Misconceptions'], ['skill', 'Teaching skills'], ['file', 'Files']];
  const items = state.category === 'file' ? detail.files.map(f => ({ id: f.id, title: f.name, description: f.excerpt, kind: 'file' }))
    : state.category === 'skill' ? detail.skills.map(s => ({ id: s.id, title: s.name.replaceAll('-', ' '), description: s.description, kind: 'skill' }))
      : detail.cards.filter(c => c.kind === state.category);
  const shown = items.filter(item => `${item.title} ${item.description || ''}`.toLowerCase().includes(state.query.toLowerCase()));
  document.querySelector('#workspace-body').innerHTML = `<div class="section-title"><h2>Course content</h2></div>
    <div class="content-layout ${state.selected ? '' : 'no-selection'}"><section class="panel content-list"><div class="category-row">${categories.map(([id, label]) =>
      `<button class="mini-tab ${state.category === id ? 'active' : ''}" data-category="${id}">${label}</button>`).join('')}</div>
      <label class="search-label"><span class="visually-hidden">Find content</span><input id="content-search" type="search" value="${escapeHtml(state.query)}" placeholder="Search ${escapeHtml(state.category)}"></label>
      <div class="content-items">${shown.length ? shown.map(item => `<button class="content-item" data-item="${escapeHtml(item.id)}" data-kind="${item.kind}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || '')}</span></button>`).join('') : '<p class="muted">No items match this search.</p>'}</div></section>
    <section class="panel content-preview"><h2>${escapeHtml(state.selected?.title || 'Select an item')}</h2>${state.selected?.description ? `<p class="muted">${escapeHtml(state.selected.description)}</p>` : ''}
    ${state.selected ? `<pre id="content-text"></pre>${state.selected.versions?.length > 1 ? `<details><summary>File versions</summary><ul class="simple-list">${state.selected.versions.map(v =>
      `<li>v${v.version} · ${escapeHtml(new Date(v.createdAt).toLocaleDateString())}</li>`).join('')}</ul></details>` : ''}${['instructor','operator'].includes(state.account.role) && !state.account.demoProfessor &&
      (state.account.role === 'operator' || state.detail?.course?.professorId === state.account.id) ? '<button id="edit-item" class="button secondary">Edit this item</button>' : ''}` : ''}</section></div>`;
  if (state.selected) document.querySelector('#content-text').textContent = state.selected.content;
  document.querySelector('#edit-item')?.addEventListener('click', () => editSelected());
  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    state.category = button.dataset.category; state.query = ''; state.selected = null; renderContent();
  }));
  document.querySelector('#content-search').addEventListener('input', event => { state.query = event.target.value; renderContent(); document.querySelector('#content-search').focus(); });
  document.querySelectorAll('[data-item]').forEach(button => button.addEventListener('click', () => openItem(button.dataset.kind, button.dataset.item).catch(e => showError(e.message))));
}
function editSelected() {
  const item = state.selected;
  if (!item) return;
  const kind = item.kind === 'skill' ? 'skill' : 'card';
  const pane = document.querySelector('.content-preview');
  pane.innerHTML = `<h2>Edit ${escapeHtml(item.title)}</h2>
    <form id="item-editor"><label>Title<input name="title" maxlength="160" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label>
    <label>Content<textarea name="body" rows="18" required></textarea></label><label>Reason for change<input name="reason" maxlength="500"></label>
    <button class="button">Save version</button></form><p id="edit-result" role="status"></p>`;
  pane.querySelector('[name="title"]').value = item.title;
  pane.querySelector('[name="description"]').value = item.description || '';
  pane.querySelector('[name="body"]').value = item.content || '';
  pane.querySelector('#item-editor').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await api(`/api/courses/${encodeURIComponent(state.courseId)}/revisions`, { method: 'POST',
      body: { kind, itemId: item.id, value: { ...values, kind: item.kind }, reason: values.reason, expectedVersion: state.detail.version } });
      await loadCourse(); }
    catch (e) { pane.querySelector('#edit-result').textContent = e.message; }
  });
}
async function renderManage() {
  const body = document.querySelector('#workspace-body'), course = state.detail?.course;
  const readOnly = state.account.role === 'sample' || state.account.demoProfessor ||
    (state.account.role !== 'operator' && course?.professorId !== state.account.id);
  body.innerHTML = `<div class="upload-grid"><section class="panel"><h2>Semester position</h2><p class="muted">${escapeHtml(state.detail?.position?.guidance || '')}</p>
    <p>Current week: ${escapeHtml(state.detail?.position?.week ?? 'not set')} · Module: ${escapeHtml(state.detail?.position?.module || 'full map')}</p>
    ${readOnly ? '' : `<form id="schedule-form"><label>Term<input name="term" required></label><label>First day of term<input name="startDate" type="date" required></label><button class="button">Save schedule</button></form>`}</section>
    <section class="panel"><h2>Course versions</h2><p>Current version ${escapeHtml(state.detail?.version || 0)}</p><div id="revision-list">Loading…</div></section></div>
    ${course?.sourceCourse ? '<section class="panel"><h2>Canvas source inventory</h2><div id="source-list">Loading…</div></section>' : ''}`;
  const schedule = state.detail?.schedule || {};
  if (!readOnly) {
    body.querySelector('[name="term"]').value = schedule.term || '';
    body.querySelector('[name="startDate"]').value = schedule.startDate || '';
    body.querySelector('#schedule-form').addEventListener('submit', async event => {
      event.preventDefault(); try { await api(`/api/courses/${encodeURIComponent(state.courseId)}/schedule`, { method: 'PUT', body: Object.fromEntries(new FormData(event.currentTarget)) }); await loadCourse(); }
      catch (e) { showError(e.message); }
    });
  }
  if (state.account.role === 'sample') { body.querySelector('#revision-list').textContent = 'Sample view'; return; }
  try {
    const revisions = await api(`/api/courses/${encodeURIComponent(state.courseId)}/revisions`);
    body.querySelector('#revision-list').innerHTML = revisions.length ? revisions.slice(-20).reverse().map(r =>
      `<div class="record"><strong>v${r.version} · ${escapeHtml(r.itemId)}</strong><p>${escapeHtml(r.reason || 'Edited')}</p><small>${escapeHtml(new Date(r.at).toLocaleString())}</small>
      ${readOnly || !['card','skill'].includes(r.kind) ? '' : `<button class="button secondary" data-restore="${escapeHtml(r.id)}" data-item="${escapeHtml(r.itemId)}">Restore this version</button>`}</div>`).join('') : '<p>No course edits yet.</p>';
    body.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', async () => {
      try { await api(`/api/courses/${encodeURIComponent(state.courseId)}/revisions/restore`, { method: 'POST',
        body: { itemId: button.dataset.item, revisionId: button.dataset.restore, expectedVersion: state.detail.version } }); await loadCourse(); }
      catch (e) { showError(e.message); }
    }));
    if (course?.sourceCourse) {
      const inventory = await api(`/api/courses/${encodeURIComponent(state.courseId)}/source-inventory`);
      body.querySelector('#source-list').innerHTML = `<p>${inventory.items.length} source files in ${escapeHtml(inventory.repository)}</p>
        <details><summary>Browse files</summary><ul class="simple-list">${inventory.items.map(f => `<li>${escapeHtml(f.path)}</li>`).join('')}</ul></details>`;
    }
  } catch (e) { showError(e.message); }
}
function renderUpload() {
  const body = document.querySelector('#workspace-body');
  if (state.account.role === 'sample' || state.account.demoProfessor ||
      (state.account.role !== 'operator' && state.detail?.course?.professorId !== state.account.id)) {
    body.innerHTML = '<section class="panel"><h2>Reference course</h2><p>This course is read-only for your account. Select your own course to add materials.</p></section>'; return; }
  body.innerHTML = `<div class="upload-grid"><section class="panel"><h2>Add a course</h2>
    <form id="course-form"><label>Course code<input name="code" placeholder="ME 300" maxlength="30" required></label>
    <label>Course title<input name="title" placeholder="Engineering Thermodynamics" maxlength="120" required></label><button class="button">Create course</button></form></section>
    <section class="panel"><h2>Upload to ${escapeHtml(state.detail.course.code)}</h2><p class="muted">PDF, TXT, MD, CSV · 2 MB max</p>
    <form id="upload-form"><label>Choose a file<input name="file" type="file" accept=".pdf,.txt,.md,.csv" required></label><button class="button">Upload file</button></form>
    <p id="upload-message" class="error" role="status"></p></section></div>
    <section class="panel"><h2>Files in this course</h2>${state.detail.files.length ? `<ul class="simple-list">${state.detail.files.map(file => `<li>${escapeHtml(file.name)} <small>v${escapeHtml(file.version)} · ${escapeHtml(new Date(file.createdAt).toLocaleDateString())}</small></li>`).join('')}</ul>` : '<p class="muted">No files uploaded yet.</p>'}</section>`;
  document.querySelector('#course-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const course = await api('/api/courses', { method: 'POST', body: values }); state.courseId = course.id; await loadWorkspace(); }
    catch (e) { document.querySelector('#upload-message').textContent = e.message; }
  });
  document.querySelector('#upload-form').addEventListener('submit', async event => {
    event.preventDefault(); const file = new FormData(event.currentTarget).get('file');
    if (!file || file.size > 2_200_000) { document.querySelector('#upload-message').textContent = 'Choose a file under 2 MB.'; return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    try { await api(`/api/courses/${encodeURIComponent(state.courseId)}/files`, { method: 'POST', body: { name: file.name, mimeType: file.type, base64: btoa(binary) } }); await loadCourse(); }
    catch (e) { document.querySelector('#upload-message').textContent = e.message; }
  });
}
(async () => {
  try {
    if (state.token) { state.account = await api('/api/me'); state.tab = state.account.role === 'student' ? 'learning' : 'activity'; await loadWorkspace(); }
    else await welcome();
  } catch { sessionStorage.removeItem('kelvin-demo-token'); state.token = null; await welcome(); }
})();
