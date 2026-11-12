const app = document.querySelector('#app');
const signout = document.querySelector('#signout');
const identity = document.querySelector('#identity');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { token: sessionStorage.getItem('kelvin-demo-token'), account: null, courses: [], courseId: null,
  detail: null, analytics: null, student: null, tab: 'activity', category: 'topic', query: '', selected: null, preview: false };
const demoAnalytics = () => {
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  const requests = [12, 18, 15, 26, 31, 22, 19, 33, 41, 38, 45, 42, 58, 53];
  const reflections = [5, 6, 5, 8, 7, 6, 5, 9, 10, 8, 12, 11, 13, 12];
  return { suppressed: false, sample: true, timeline: requests.map((count, index) => ({
    date: new Date(now.getTime() - (13 - index) * 86400_000).toISOString().slice(0, 10), requests: count, reflections: reflections[index] })),
    topicTrends: [{ id: 'topic:m7-07-entropy', previous: 12, recent: 21 }, { id: 'topic:m5-04-energy-conservation', previous: 18, recent: 16 }, { id: 'topic:m4-03-phase-decision-tree', previous: 9, recent: 14 }],
    questionTrends: [{ id: 'topic:m7-07-entropy', previous: 16, recent: 25 }, { id: 'topic:m5-04-energy-conservation', previous: 14, recent: 18 }],
    cardTrends: [{ id: 'topic:m7-07-entropy', previous: 15, recent: 27 }, { id: 'topic:m4-03-phase-decision-tree', previous: 11, recent: 19 }],
    misconceptionTrends: [{ id: 'misc:m15-adiabatic-implies-isentropic', previous: 6, recent: 13 }, { id: 'misc:m01-heat-energy-temperature-conflated', previous: 9, recent: 8 }],
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
  const professors = await api('/api/professors', { auth: false });
  const options = professors.flatMap(professor => professor.courses.map(course =>
    `<option value="${escapeHtml(course.id)}">${escapeHtml(professor.name)} · ${escapeHtml(course.code)}: ${escapeHtml(course.title)}</option>`)).join('');
  signout.classList.add('hidden'); identity.textContent = '';
  app.innerHTML = `<section class="intro"><p class="eyebrow">ME 300 · Thermodynamics</p><h1>Your course, in one place.</h1><p class="lead">Students can check what Kelvin saved. Professors can review course materials and see how questions change over time.</p></section>
    <div class="entry-grid"><section class="panel entry-card"><span class="entry-icon">↗</span><h2>I'm a student</h2><p>Use your PSU email and pick your professor's course. No password for this demo.</p>
      <form id="student-form"><label>PSU email<input type="email" name="email" placeholder="you@psu.edu" autocomplete="email" required></label>
      <label>Professor and course<select name="courseId" required>${options}</select></label><button class="button full">Open my workspace</button></form></section>
    <section class="panel entry-card"><span class="entry-icon">◫</span><h2>I'm a professor</h2><p>Create an account to browse the stock ME 300 materials, add courses and upload your own files.</p>
      <div class="tab-row"><button class="mini-tab active" data-auth="signin">Sign in</button><button class="mini-tab" data-auth="register">Create account</button></div>
      <form id="professor-form"><div id="name-row" class="hidden"><label>Your name<input name="name" autocomplete="name"></label></div>
      <label>PSU email or account ID<input name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="button full" id="professor-submit">Sign in</button></form><p class="hint">For the sample view, sign in with username / password.</p></section></div>
    <p class="notice">Demo sign-in does not verify student email ownership. Please use test data, not real student records.</p><p id="message" class="error" role="alert"></p>`;
  document.querySelector('#student-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await setSession(await api('/api/student-session', { method: 'POST', body: values, auth: false })); } catch (e) { error(e.message); }
  });
  let mode = 'signin';
  document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.auth; document.querySelectorAll('[data-auth]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('#name-row').classList.toggle('hidden', mode !== 'register');
    document.querySelector('#professor-form [name="password"]').minLength = mode === 'register' ? 12 : 1;
    document.querySelector('#professor-submit').textContent = mode === 'register' ? 'Create professor account' : 'Sign in';
    document.querySelector('#professor-form [name="email"]').placeholder = mode === 'register' ? 'you@psu.edu' : '';
  }));
  document.querySelector('#professor-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (mode === 'signin' && values.email === 'username' && values.password === 'password') {
      state.account = { id: 'sample-professor', role: 'sample', name: 'Demo Professor' }; state.token = null;
      state.courses = [{ id: 'demo-me300', code: 'ME 300', title: 'ME 300 Engineering Thermodynamics' }];
      state.courseId = 'demo-me300'; state.tab = 'activity'; state.preview = true;
      state.detail = { course: state.courses[0], cards: [], skills: [], files: [] };
      await loadSampleContent(); renderWorkspace(); return;
    }
    try { await setSession(await api(mode === 'register' ? '/api/professor-register' : '/api/professor-session',
      { method: 'POST', body: values, auth: false })); } catch (e) { error(e.message); }
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
  state.analytics = state.account.role === 'instructor' ? await api(`/api/courses/${id}/analytics`) : null;
  state.selected = null; renderWorkspace();
}
function renderWorkspace() {
  const professor = state.account.role !== 'student';
  identity.textContent = state.account.email || state.account.name;
  signout.classList.remove('hidden');
  const course = state.detail?.course || state.courses[0];
  app.innerHTML = `<div class="workspace-head"><div><p class="eyebrow">${professor ? 'Professor workspace' : 'Student workspace'}</p>
    <h1>${escapeHtml(course?.title || 'Your courses')}</h1><p class="lead">${professor ? 'Browse what students can see, add your materials, and follow class questions over time.' : 'See your saved learning and the material for your course.'}</p></div>
    ${professor && state.account.role !== 'sample' ? `<label class="course-switch">Course<select id="course-select">${state.courses.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === state.courseId ? 'selected' : ''}>${escapeHtml(c.code)} · ${escapeHtml(c.title)}</option>`).join('')}</select></label>` : ''}</div>
    <nav class="nav-tabs" aria-label="Workspace sections">${(professor ? [['activity', 'Activity over time'], ['content', 'Course content'], ['upload', 'Courses & uploads']] : [['learning', 'My learning'], ['content', 'Course content']])
      .map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <section id="workspace-body"></section>`;
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderWorkspace(); }));
  document.querySelector('#course-select')?.addEventListener('change', event => { state.courseId = event.target.value; loadCourse().catch(e => showError(e.message)); });
  if (state.tab === 'activity') renderActivity();
  if (state.tab === 'learning') renderLearning();
  if (state.tab === 'content') renderContent();
  if (state.tab === 'upload') renderUpload();
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
  return `<section class="panel chart-card"><h2>${title}</h2><p class="muted">Daily counts, last 14 days · hidden when fewer than five students contributed that day</p>
    <svg viewBox="0 0 620 165" role="img" aria-label="${title} over 14 days"><line x1="44" y1="128" x2="566" y2="128" stroke="#cad7dc"/>
    <text x="4" y="22" class="axis">${max}</text><text x="18" y="132" class="axis">0</text>${paths}${dots}
    <text x="44" y="153" class="axis">${escapeHtml(series[0]?.date || '')}</text><text x="490" y="153" class="axis">${escapeHtml(series.at(-1)?.date || '')}</text></svg>
    <details><summary>View daily values</summary><div class="daily-list">${series.map(point => `<span>${escapeHtml(point.date)}</span><span>${point[field] === null ? 'Hidden' : point[field]}</span>`).join('')}</div></details></section>`;
}
function comparison(items, title) {
  if (!items?.length) return `<section class="panel"><h2>${title}</h2><p class="muted">No category meets the five-student threshold yet.</p></section>`;
  const names = new Map((state.detail?.cards || []).map(card => [card.id, card.title]));
  const max = Math.max(1, ...items.map(item => Math.max(item.recent, item.previous)));
  return `<section class="panel"><h2>${title}</h2><p class="muted">Last 7 days compared with the 7 days before</p><div class="compare-list">${items.map(item =>
    `<div class="compare-row"><div class="compare-label"><strong>${escapeHtml(names.get(item.id) || item.id)}</strong><span>${item.previous} → ${item.recent}</span></div>
    <div class="bar-pair"><span style="width:${Math.max(2, item.previous / max * 100)}%"></span><span style="width:${Math.max(2, item.recent / max * 100)}%"></span></div></div>`).join('')}</div>
    <p class="legend"><i></i> Previous week <i></i> Recent week</p></section>`;
}
function renderActivity() {
  const real = state.analytics, data = state.preview || state.account.role === 'sample' ? demoAnalytics() : real;
  const sample = Boolean(data?.sample);
  const body = document.querySelector('#workspace-body');
  body.innerHTML = `<div class="section-title"><div><h2>How the class is using Kelvin</h2><p class="muted">This view groups activity by course. It never shows who asked a question.</p></div>
    ${state.account.role !== 'sample' ? `<button id="preview-toggle" class="button secondary">${state.preview ? 'Back to live data' : 'Preview sample data'}</button>` : ''}</div>
    ${sample ? '<p class="notice">Sample data for a walkthrough. These charts do not represent student activity.</p>' : ''}
    ${!data || data.suppressed ? `<div class="panel empty-state"><h2>Charts appear after five students use this course.</h2><p>Until then, Kelvin hides the activity to avoid showing an individual student's pattern. Use “Preview sample data” for a walkthrough.</p></div>` :
    `<div class="chart-grid">${chart('MCP requests', data.timeline, 'requests', '#247a82')}${chart('Saved learning reflections', data.timeline, 'reflections', '#ba7446')}</div>
    <div class="chart-grid">${comparison(data.questionTrends, 'Questions by topic')}${comparison(data.topicTrends, 'Topics students saved')}</div>
    <div class="chart-grid">${comparison(data.cardTrends, 'Course content opened')}${comparison(data.misconceptionTrends, 'Misconceptions to revisit')}</div>`}`;
  document.querySelector('#preview-toggle')?.addEventListener('click', () => { state.preview = !state.preview; renderActivity(); });
}
function renderLearning() {
  const data = state.student;
  const body = document.querySelector('#workspace-body');
  body.innerHTML = `<div class="section-title"><div><h2>What Kelvin has saved for you</h2><p class="muted">${escapeHtml(data?.account.email || '')} · ${escapeHtml(data?.course?.code || '')}</p></div></div>
    <section class="panel"><h2>Saved learning</h2>${data?.reflections?.length ? `<div class="record-list">${data.reflections.map(item =>
    `<article class="record"><time>${escapeHtml(new Date(item.at).toLocaleDateString())}</time><p>${escapeHtml(item.statement)}</p><small>Topics: ${escapeHtml((item.topics || []).join(', ') || 'Classification pending')}</small></article>`).join('')}</div>` :
    '<p class="muted">Nothing saved yet. In Claude, ask Kelvin to save a short note about what you worked on. It will appear here.</p>'}</section>
    <section class="panel"><h2>Your course connection</h2><p>The course you chose is linked to this email. Your professor sees only grouped activity, not your name or individual questions.</p>
    <p class="muted">This is an email-only demo. Anyone who enters your email can open this view, so please use test data.</p></section>`;
}
async function openItem(kind, id) {
  const course = encodeURIComponent(state.courseId), item = encodeURIComponent(id);
  const path = kind === 'file' ? `files/${item}` : kind === 'skill' ? `skills/${item}` : `cards/${item}`;
  const data = state.account.role === 'sample' ? await api(`/api/public-content/${path}`, { auth: false }) : await api(`/api/courses/${course}/${path}`);
  state.selected = data;
  renderContent();
}
function renderContent() {
  const detail = state.detail || { cards: [], skills: [], files: [] };
  const categories = [['course', 'Course'], ['unit', 'Units'], ['topic', 'Topics'], ['misconception', 'Misconceptions'], ['skill', 'Teaching skills'], ['file', 'Uploaded files']];
  const items = state.category === 'file' ? detail.files.map(f => ({ id: f.id, title: f.name, description: f.excerpt, kind: 'file' }))
    : state.category === 'skill' ? detail.skills.map(s => ({ id: s.id, title: s.name.replaceAll('-', ' '), description: s.description, kind: 'skill' }))
      : detail.cards.filter(c => c.kind === state.category);
  const shown = items.filter(item => `${item.title} ${item.description || ''}`.toLowerCase().includes(state.query.toLowerCase()));
  document.querySelector('#workspace-body').innerHTML = `<div class="section-title"><div><h2>Course content</h2><p class="muted">This is what students can find through the course connector. Uploaded files belong to this course only.</p></div></div>
    <div class="content-layout"><section class="panel content-list"><div class="category-row">${categories.map(([id, label]) =>
      `<button class="mini-tab ${state.category === id ? 'active' : ''}" data-category="${id}">${label}</button>`).join('')}</div>
      <label class="search-label">Find content<input id="content-search" type="search" value="${escapeHtml(state.query)}" placeholder="Search this category"></label>
      <div class="content-items">${shown.length ? shown.map(item => `<button class="content-item" data-item="${escapeHtml(item.id)}" data-kind="${item.kind}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || '')}</span></button>`).join('') : '<p class="muted">No items match this search.</p>'}</div></section>
    <section class="panel content-preview"><h2>${escapeHtml(state.selected?.title || 'Choose an item')}</h2><p class="muted">${escapeHtml(state.selected?.description || 'Open a card or file to read the full content.')}</p>
    ${state.selected ? `<pre id="content-text"></pre>` : ''}</section></div>`;
  if (state.selected) document.querySelector('#content-text').textContent = state.selected.content;
  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    state.category = button.dataset.category; state.query = ''; state.selected = null; renderContent();
  }));
  document.querySelector('#content-search').addEventListener('input', event => { state.query = event.target.value; renderContent(); document.querySelector('#content-search').focus(); });
  document.querySelectorAll('[data-item]').forEach(button => button.addEventListener('click', () => openItem(button.dataset.kind, button.dataset.item).catch(e => showError(e.message))));
}
function renderUpload() {
  const body = document.querySelector('#workspace-body');
  if (state.account.role === 'sample') { body.innerHTML = '<section class="panel"><h2>Sample view</h2><p>Create a professor account to add courses and files.</p></section>'; return; }
  body.innerHTML = `<div class="upload-grid"><section class="panel"><h2>Add a course</h2><p class="muted">Each course starts with the stock ME 300 collection. Files you add stay with that course.</p>
    <form id="course-form"><label>Course code<input name="code" placeholder="ME 300" maxlength="30" required></label>
    <label>Course title<input name="title" placeholder="Engineering Thermodynamics" maxlength="120" required></label><button class="button">Create course</button></form></section>
    <section class="panel"><h2>Upload to ${escapeHtml(state.detail.course.code)}</h2><p class="muted">PDF, TXT, MD, or CSV · up to 2 MB. Kelvin reads the text so students can find it through the MCP.</p>
    <form id="upload-form"><label>Choose a file<input name="file" type="file" accept=".pdf,.txt,.md,.csv" required></label><button class="button">Upload file</button></form>
    <p id="upload-message" class="error" role="status"></p></section></div>
    <section class="panel"><h2>Files in this course</h2>${state.detail.files.length ? `<ul class="simple-list">${state.detail.files.map(file => `<li>${escapeHtml(file.name)} <small>${escapeHtml(new Date(file.createdAt).toLocaleDateString())}</small></li>`).join('')}</ul>` : '<p class="muted">No files uploaded yet.</p>'}</section>`;
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
