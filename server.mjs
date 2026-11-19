import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { z } from 'zod';
import { loadContent, metadata, provenance, searchCards } from './content.mjs';
import { addEvent, allEvents } from './store.mjs';
import { classify } from './classify.mjs';
import { writeRequestLog } from './request-log.mjs';
import { persistenceReady } from './persistence.mjs';
import { modelReady, modelName } from './model-client.mjs';
import { contentForCourse, courseRevisions, courseSchedule, saveCourseSchedule,
  coursePosition, canEditCourse, sourceInventory } from './course-system.mjs';
import { recordMcpCall, dreamCourse, courseInsights, studentInsights, importChatExport, studentImports, mcpCallEvents } from './learning-data.mjs';
import { askKelvin } from './ask-kelvin.mjs';
import { studioState, saveStudioDraft, publishStudio, adoptTemplate, restoreStudioItem } from './studio.mjs';
import { adminOverview, adminAccounts, adminAccount, adminActivity, adminUpdateAccount, adminNoteEvidence, adminAudit, adminTraffic } from './admin-data.mjs';
import { scenarios, runScenario, scenarioRuns, reviewScenario } from './pedagogy-lab.mjs';
import { accountById, completeLogin, createOAuthProvider, loginPage } from './oauth.mjs';
import { professors, studentForEmail, switchStudentProfessor, registerProfessor, signInProfessor, makeSession, sessionAccount, revokeSession,
  courses, courseById, createCourse, courseFiles, courseFileVersions, fileMetadata, addCourseFile, recordUsage,
  studentSummary, courseAnalytics } from './demo.mjs';

const { cards, skills } = loadContent();
const port = Number(process.env.PORT || 3337);
const origin = process.env.KELVIN_PUBLIC_ORIGIN || 'https://kelvin.me.psu.edu';
const resourceUrl = new URL('/mcp', origin);
const accountResourceUrl = new URL('/mcp/account', origin);
const dashboardResourceUrl = new URL('/dashboard-data', origin);
const dashboardOrigin = process.env.KELVIN_DASHBOARD_ORIGIN || origin;
const landingHtml = readFileSync(new URL('./landing/index.html', import.meta.url));
const landingCss = readFileSync(new URL('./landing/style.css', import.meta.url));
const dashboardHtml = readFileSync(new URL('./dashboard/index.html', import.meta.url));
const dashboardJs = readFileSync(new URL('./dashboard/app.js', import.meta.url));
const dashboardCss = readFileSync(new URL('./dashboard/style.css', import.meta.url));
const oauth = createOAuthProvider(resourceUrl, origin, [accountResourceUrl, dashboardResourceUrl]);
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const error = message => ({ content: [{ type: 'text', text: message }], isError: true });

async function makeMcp(user) {
  const course = user.courseId ? await courseById(user.courseId) : null;
  const files = course ? await courseFiles(course.id) : [];
  const { cards, skills, version, templateVersion, studioVersion } = await contentForCourse(course?.id || 'demo-me300');
  const schedule = course ? await courseSchedule(course.id) : null;
  const position = schedule ? coursePosition(schedule) : null;
  const semesterMatches = matches => {
    const current = Number(position?.module?.slice(1));
    if (!current) return matches;
    return matches.map(match => {
      const module = Number(/(?:topic|unit):m(\d)/.exec(match.id)?.[1] || 0);
      return { ...match, semesterRelevance: module === current ? 'current' : module > current ? 'upcoming' : module ? 'review' : 'general' };
    }).sort((a,b) => ({ current: 0, review: 1, general: 2, upcoming: 3 })[a.semesterRelevance] -
      ({ current: 0, review: 1, general: 2, upcoming: 3 })[b.semesterRelevance]);
  };
  const pedagogyInstructions = ['what-next', 'answer-requests', 'response-pacing', 'misconception-repair']
    .filter(id => skills.has(id)).map(id => `\n## ${id}\n${skills.get(id).body.slice(0, 2200)}`).join('').slice(0, 8500);
  const mcp = new McpServer({ name: 'kelvin-thermodynamics-me300', title: 'Kelvin: Penn State ME 300 Engineering Thermodynamics', version: '0.1.0' }, {
    capabilities: { tools: {} },
    instructions: `Kelvin provides Penn State ME 300 Engineering Thermodynamics course content. Use the selected course as the reference for substantive thermodynamics questions: call course_map once per conversation, then search_course and get_card before answering. For a request to be taught or quizzed, load the socratic-tutor skill with get_teaching_skill. For dates, grading, and policies, check the student’s current Canvas section. Do not save a learning reflection unless the student explicitly asks. Course version ${version || 0}; template version ${templateVersion || 0}; pedagogy version ${studioVersion || 0}. Current teaching procedures:${pedagogyInstructions}`
  });
  const publicSecurity = user.role === 'anonymous' ? { _meta: { securitySchemes: [{ type: 'noauth' }] } } : {};
  if (user.role !== 'anonymous') mcp.registerTool('my_account', { description: 'Show the Kelvin email, course, and role attached to this connector.' },
    async () => {
      const account = await accountById(user.id);
      const active = account?.courseId ? await courseById(account.courseId) : null;
      const professor = active ? (await professors()).find(item => item.id === active.professorId) : null;
      return result({ id: user.id, name: user.name || null, email: account?.email || null, role: user.role,
        course: active ? { id: active.id, code: active.code, title: active.title } : null,
        professor: professor ? { id: professor.id, name: professor.name } : null,
        courseId: account?.courseId || null });
    });
  mcp.registerTool('course_map', { title: 'ME 300 thermodynamics course map', description: 'For thermodynamics questions, start here once per conversation. This is real Penn State ME 300 Engineering Thermodynamics course content: systems, properties, phase change, first and second laws, entropy, control volumes, and cycles. Returns the course map so you can choose the right topic card. Course logistics are from Summer 2023; current dates and policies come from the student’s Canvas.', ...publicSecurity }, () =>
    result({ subject: course?.title || 'Penn State ME 300 Engineering Thermodynamics', courseId: course?.id,
      courseVersion: version || 0, templateVersion, schedule, semesterPosition: position,
      sourceMaterial: 'actual Penn State course files', use: 'For a thermodynamics topic, search_course for matching cards, then get_card before explaining or tutoring. Check current Canvas for dates and policies.', provenance, course: metadata(cards.get('course:me300')),
      units: [...cards.values()].filter(c => c.kind === 'unit').map(metadata),
      uploadedFiles: files.map(fileMetadata) }));
  mcp.registerTool('search_course', { title: 'Search thermodynamics topics and misconceptions', description: 'Use this for each substantive thermodynamics or ME 300 question to find the relevant course topic, concept, equation context, or common misconception. Search terms such as entropy, vapor tables, first law, turbines, refrigeration, or Carnot. Returns brief metadata; call get_card on the matching ID for the actual content before answering.', ...publicSecurity,
    inputSchema: { query: z.string().max(160), kind: z.enum(['course', 'unit', 'topic', 'misconception']).optional() } },
  ({ query, kind }) => result({ provenance, courseVersion: version || 0, semesterPosition: position, matches: [
    ...semesterMatches(searchCards(cards, query, kind)),
    ...(!kind ? files.filter(f => `${f.name} ${f.text}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5).map(f => ({ id: f.id, kind: 'file', title: f.name, description: f.text.slice(0, 180) })) : [])] }));
  mcp.registerTool('get_card', { title: 'Read a thermodynamics course card', description: 'After search_course, read the exact Penn State ME 300 Engineering Thermodynamics topic or misconception card before explaining the concept or guiding a problem. Topic cards draw on real course files; misconception cards draw on cited research. The card status describes how the study note was prepared, not whether the course is real. Summer 2023 dates and policies may differ from the student’s current section.', ...publicSecurity,
    inputSchema: { id: z.string().max(120) } }, ({ id }) => {
      const card = cards.get(id);
      if (!card) return error('Card not found or not available to students');
      return result({ provenance, courseVersion: version || 0, ...metadata(card), objectives: card.objectives || [],
        related: { misconceptions: card.misconceptions || [], topics: card.topics || [], equations: card.equations || [] },
        sources: card.sources || [], content: card.body.slice(0, 16000) });
    });
  mcp.registerTool('list_teaching_skills', { title: 'Thermodynamics tutoring approaches', description: 'List ME 300 teaching approaches, including property tables, energy balances, next-step hints, misconception repair, and Jane Street’s socratic-tutor for explicit teach-me or quiz-me requests. Then load the useful one with get_teaching_skill.', ...publicSecurity }, () =>
    result([...skills].map(([name, s]) => ({ name, description: s.description }))));
  mcp.registerTool('get_teaching_skill', { title: 'Read a thermodynamics tutoring approach', description: 'Read a named ME 300 teaching procedure. For a student who explicitly asks to be taught, tutored, quizzed, or drilled to mastery, load socratic-tutor; it runs a multi-turn diagnostic and asks one question at a time. Do not use it for a one-off explanation. Call list_teaching_skills to see valid names.', ...publicSecurity,
    inputSchema: { name: z.string().max(80) } }, ({ name }) => {
      const skill = skills.get(name);
      return skill ? result({ name, description: skill.description, content: skill.body }) : error('Skill not found');
    });
  mcp.registerTool('ask_kelvin', { title: 'Ask Kelvin about ME 300 thermodynamics',
    description: 'Send a substantive student thermodynamics question to Kelvin. Kelvin records the question for the student learning record, retrieves course evidence, and uses a small model to draft a grounded tutoring answer when available. This is the question-first interaction style; course_map/search_course/get_card provide direct navigation instead.',
    inputSchema: { question: z.string().min(8).max(2000) } }, async ({ question }) =>
    result(await askKelvin(question, cards, position, skills)));
  if (course) {
    mcp.registerTool('list_course_files', { description: 'List files uploaded by this course’s professor. Use when the student asks about a syllabus, assignment, or other course-specific document.' },
      () => result({ course: { id: course.id, title: course.title }, files: files.map(fileMetadata) }));
    mcp.registerTool('get_course_file', { description: 'Read the text of a file uploaded by this course’s professor. Call list_course_files or search_course to find its ID first.',
      inputSchema: { id: z.string().max(100) } }, ({ id }) => {
        const file = files.find(f => f.id === id);
        return file ? result({ ...fileMetadata(file), content: file.text }) : error('File is not in this course');
      });
  }
  if (user.role === 'student') {
    if (user.demoEmailOnly) {
      mcp.registerTool('list_professors', { description: 'List available professors and their courses. Use this when the student asks to change which professor or course Kelvin follows.' },
        async () => result(await professors()));
      mcp.registerTool('switch_professor', { description: 'Change this student’s active professor and course. Only call when the student explicitly asks to switch. Use list_professors first; provide course_id when the professor has multiple courses. The choice is remembered for future MCP and dashboard sessions.',
        inputSchema: { professor_id: z.string().max(100), course_id: z.string().max(100).optional() } },
      async ({ professor_id, course_id }) => {
        try { return result(await switchStudentProfessor(user.id, professor_id, course_id)); }
        catch (e) { return error(e.message); }
      });
    }
    mcp.registerTool('record_learning', { description: 'Save a short learning reflection and classify its topics with the configured Kelvin model. Only call after the student explicitly asks to save what they worked on. Misconception labels are tentative, not diagnoses.',
      inputSchema: { statement: z.string().min(10).max(1000), consent: z.literal(true) } }, async ({ statement }) => {
        try {
          const labels = await classify(statement, cards);
          await addEvent({ studentId: user.id, courseId: user.courseId || null, courseVersion: version || 0,
            statement, ...labels, classificationStatus: 'classified' });
          return result({ saved: true, classificationStatus: 'classified', ...labels, note: 'Misconception labels are hypotheses. You can correct them or ask the operator to delete this record.' });
        } catch (e) {
          console.error('Learning classification unavailable:', e.message);
          await addEvent({ studentId: user.id, courseId: user.courseId || null, courseVersion: version || 0,
            statement, topics: [], misconceptions: [], summary: '', classificationStatus: 'pending' });
          return result({ saved: true, classificationStatus: 'pending', note: 'Your reflection was saved. Topic classification is pending; no misconception was inferred.' });
        }
      });
    mcp.registerTool('my_learning', { description: 'Show the authenticated student their saved learning reflections. Only records explicitly saved through this MCP are available.' }, async () => {
      const own = (await allEvents()).filter(e => e.studentId === user.id);
      return result({ total: own.length, recent: own.slice(-20).reverse().map(({ studentId, ...e }) => e) });
    });
  }
  if (['instructor','operator','researcher'].includes(user.role)) {
    mcp.registerTool('list_my_courses', { description: 'List courses owned by this professor, including the stock ME 300 course and courses created in the dashboard.' },
      async () => result((await courses()).filter(item => user.role === 'instructor' ? item.professorId === user.id : true)));
    mcp.registerTool('course_trends', { description: 'Instructor-only aggregate activity for one of your courses. At least five distinct students are required; no identities, email addresses, or raw statements are returned.',
      inputSchema: { course_id: z.string().max(100).optional() } },
    async ({ course_id }) => {
      const selected = course_id || user.courseId;
      const allowed = (await courses()).some(item => item.id === selected &&
        (user.role === 'instructor' ? item.professorId === user.id : true));
      return allowed ? result(await courseAnalytics(selected)) : error('Course unavailable');
    });
  }
  mcp.kelvinVersions = { courseVersion: version || 0, templateVersion, pedagogyVersion: studioVersion };
  return mcp;
}

async function handleMcp(req, res, user) {
  if (Number(req.headers['content-length'] || 0) > 32768) {
    res.writeHead(413); res.end('Request too large'); return;
  }
  const started = Date.now();
  const mcp = await makeMcp(user);
  const queryTool = ['search_course','ask_kelvin'].includes(req.body?.params?.name);
  const query = String(req.body?.params?.arguments?.query || req.body?.params?.arguments?.question || '');
  const queryCardId = queryTool && query ? searchCards(user.courseId ? (await contentForCourse(user.courseId)).cards : cards,
    query, undefined, 1)[0]?.id : null;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
    await recordMcpCall({ requestId: res.getHeader('X-Kelvin-Request-Id'), user, body: req.body,
      userAgent: req.headers['user-agent'], status: res.statusCode, durationMs: Date.now() - started,
      ...mcp.kelvinVersions, cardId: queryCardId });
  } catch (e) {
    console.error('MCP request failed:', e.message);
    try { await recordMcpCall({ requestId: res.getHeader('X-Kelvin-Request-Id'), user, body: req.body,
      userAgent: req.headers['user-agent'], status: 500, durationMs: Date.now() - started,
      ...mcp.kelvinVersions, cardId: queryCardId }); } catch (logError) { console.error('MCP event logging failed:', logError.message); }
    if (!res.headersSent) { res.writeHead(500); res.end('MCP request failed'); }
  } finally {
    await transport.close();
    await mcp.close();
  }
}

const app = express();
app.set('trust proxy', process.env.KELVIN_TRUST_PROXY_HOPS ? Number(process.env.KELVIN_TRUST_PROXY_HOPS) : 'loopback');
app.use((req, res, next) => {
  const started = Date.now();
  const requestId = /^[a-f0-9-]{36}$/.test(String(req.headers['x-kelvin-request-id'] || ''))
    ? String(req.headers['x-kelvin-request-id']) : randomUUID();
  res.set('X-Kelvin-Request-Id', requestId);
  let logged = false;
  const log = outcome => {
    if (logged) return;
    logged = true;
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    writeRequestLog({ event: 'request', at: new Date().toISOString(), requestId,
      method: req.method, path: req.path, status: res.statusCode, outcome, durationMs: Date.now() - started,
      remoteIp: req.socket.remoteAddress, gatewayClientIp: req.headers['x-kelvin-client-ip'] || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300), contentLength: Number(req.headers['content-length'] || 0),
      accountId: req.auth?.extra?.accountId || null,
      rpcMethod: typeof body?.method === 'string' ? body.method : null,
      tool: body?.method === 'tools/call' && typeof body.params?.name === 'string' ? body.params.name : null,
      loginAction: req.path === '/login' && ['create', 'sign-in', 'lookup-email', 'email'].includes(body?.action) ? body.action : null });
  };
  res.once('finish', () => log('finished'));
  res.once('close', () => log('closed'));
  next();
});
app.use(['/mcp', '/mcp/account'], express.json({ limit: '32kb', type: 'application/json' }));
app.use('/api', express.json({ limit: '3mb' }));
app.get('/', (_req, res) => res.type('html').send(landingHtml));
app.get('/landing/style.css', (_req, res) => res.type('css').send(landingCss));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'kelvin-mcp', cards: cards.size }));
app.get('/ready', async (_req, res) => {
  const [database, model] = await Promise.all([persistenceReady(), modelReady()]);
  return res.status(database && model ? 200 : 503).json({ ready: database && model, database, model, modelName: modelName() });
});
app.get('/dashboard', (_req, res) => res.type('html').send(dashboardHtml));
app.get('/dashboard/app.js', (_req, res) => res.type('js').send(dashboardJs));
app.get('/dashboard/style.css', (_req, res) => res.type('css').send(dashboardCss));
app.get('/api/professors', async (_req, res) => res.json(await professors()));
app.get('/api/public-content', async (_req, res) => {
  const content = await contentForCourse('demo-me300');
  return res.json({ cards: [...content.cards.values()].map(metadata),
    skills: [...content.skills].map(([name, skill]) => ({ id: name, name, description: skill.description })), files: [] });
});
app.get('/api/public-content/cards/:id', async (req, res) => {
  const card = (await contentForCourse('demo-me300')).cards.get(req.params.id);
  return card ? res.json({ ...metadata(card), content: card.body }) : res.status(404).json({ error: 'Card unavailable' });
});
app.get('/api/public-content/skills/:id', async (req, res) => {
  const skill = (await contentForCourse('demo-me300')).skills.get(req.params.id);
  return skill ? res.json({ id: req.params.id, title: req.params.id.replaceAll('-', ' '), kind: 'skill',
    description: skill.description, content: skill.body }) : res.status(404).json({ error: 'Skill unavailable' });
});
const demoRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
app.post('/api/student-session', demoRateLimit, async (req, res) => {
  const account = await studentForEmail(req.body?.email);
  return account ? res.json(await makeSession(account))
    : res.status(404).json({ error: 'Connect Kelvin in Claude first to choose your professor and course.' });
});
app.post('/api/professor-register', demoRateLimit, async (req, res) => {
  try { return res.json(await makeSession(await registerProfessor(req.body || {}))); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/professor-session', demoRateLimit, async (req, res) => {
  const account = await signInProfessor(req.body?.email, req.body?.password);
  return account ? res.json(await makeSession(account)) : res.status(401).json({ error: 'Email or password not recognized' });
});
async function demoAccount(req, res, next) {
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
  const account = await sessionAccount(token);
  if (!account) return res.status(401).json({ error: 'Sign in again' });
  req.demoAccount = account;
  req.demoToken = token;
  return next();
}
function operatorOnly(req, res, next) {
  return req.demoAccount.role === 'operator' ? next() : res.status(403).json({ error: 'Operator account required' });
}
const pageNumber = value => Math.max(0, Math.min(100000, Number.parseInt(value, 10) || 0));
app.get('/api/admin/overview', demoAccount, operatorOnly, async (_req, res) => res.json(await adminOverview()));
app.get('/api/admin/traffic', demoAccount, operatorOnly, (_req, res) => res.json(adminTraffic()));
app.get('/api/admin/accounts', demoAccount, operatorOnly, async (req, res) =>
  res.json(await adminAccounts(req.query.q, req.query.role, pageNumber(req.query.offset))));
app.get('/api/admin/accounts/:id', demoAccount, operatorOnly, async (req, res) => {
  const data = await adminAccount(req.params.id);
  return data ? res.json(data) : res.status(404).json({ error: 'Account unavailable' });
});
app.get('/api/admin/accounts/:id/activity', demoAccount, operatorOnly, async (req, res) => {
  const data = await adminActivity(req.params.id, pageNumber(req.query.offset));
  return data ? res.json(data) : res.status(404).json({ error: 'Account unavailable' });
});
app.put('/api/admin/accounts/:id', demoAccount, operatorOnly, async (req, res) => {
  try { return res.json(await adminUpdateAccount(req.params.id, req.body || {}, req.demoAccount.id)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/evidence/:id/note', demoAccount, operatorOnly, async (req, res) => {
  try { return res.json(await adminNoteEvidence(req.params.id, req.body?.text, req.demoAccount.id)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/audit', demoAccount, operatorOnly, async (req, res) => res.json(await adminAudit(pageNumber(req.query.offset))));
app.get('/api/studio/template', demoAccount, async (req, res) => {
  if (!['instructor','operator','researcher'].includes(req.demoAccount.role)) return res.sendStatus(403);
  const content = await contentForCourse('demo-me300', req.demoAccount.role === 'operator' && req.query.draft === '1');
  return res.json({ state: await studioState('demo-me300'), cards: [...content.cards.values()],
    skills: [...content.skills].map(([id, skill]) => ({ ...skill, id })) });
});
app.post('/api/studio/template/draft', demoAccount, operatorOnly, async (req, res) => {
  try { return res.status(201).json(await saveStudioDraft('template', 'demo-me300', req.demoAccount, null, req.body || {})); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/studio/template/publish', demoAccount, operatorOnly, async (req, res) => {
  try { return res.json(await publishStudio('template', 'demo-me300', req.demoAccount, null, req.body?.reason)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/studio/template/restore', demoAccount, operatorOnly, async (req, res) => {
  try { return res.status(201).json(await restoreStudioItem('template', 'demo-me300', req.demoAccount, null,
    req.body?.version, req.body?.kind, req.body?.itemId, req.body?.expectedRevision)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/logout', demoAccount, async (req, res) => { await revokeSession(req.demoToken); res.sendStatus(204); });
app.get('/api/me', demoAccount, async (req, res) => res.json(req.demoAccount));
app.get('/api/student', demoAccount, async (req, res) => req.demoAccount.role === 'student'
  ? res.json({ ...await studentSummary(req.demoAccount), insights: await studentInsights(req.demoAccount.id),
      imports: await studentImports(req.demoAccount.id), calls: (await mcpCallEvents(null, req.demoAccount.id)).slice(-30).reverse()
        .map(({ id, at, tool, arguments: args, client, courseVersion }) => ({ id, at, tool, arguments: args, client, courseVersion })) })
    : res.status(403).json({ error: 'Student account required' }));
app.post('/api/student/import', demoAccount, async (req, res) => {
  if (req.demoAccount.role !== 'student') return res.status(403).json({ error: 'Student account required' });
  try { return res.status(201).json(await importChatExport(req.demoAccount.id, req.demoAccount.courseId,
    req.body?.platform, req.body?.data)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/courses', demoAccount, async (req, res) => res.json((await courses()).filter(course =>
  req.demoAccount.role === 'operator' ? true : req.demoAccount.role === 'instructor' ?
    (course.professorId === req.demoAccount.id || course.id === 'demo-me300' || course.sourceCourse) :
    req.demoAccount.role === 'researcher' ? true : course.id === req.demoAccount.courseId)));
app.post('/api/courses', demoAccount, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.status(403).json({ error: 'Instructor or operator account required' });
  if (req.demoAccount.demoProfessor) return res.status(403).json({ error: 'This sample professor account is read-only' });
  try { const course = await createCourse(req.demoAccount.id, req.body || {});
    await adoptTemplate(course.id, req.demoAccount, course);
    return res.status(201).json(course); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
async function requireCourse(req, res, next) {
  const course = await courseById(req.params.courseId);
  if (!course || (['operator','researcher'].includes(req.demoAccount.role) ? false : req.demoAccount.role === 'instructor' ?
    (course.professorId !== req.demoAccount.id && course.id !== 'demo-me300' && !course.sourceCourse) : course.id !== req.demoAccount.courseId))
    return res.status(404).json({ error: 'Course unavailable' });
  req.course = course;
  return next();
}
app.get('/api/courses/:courseId', demoAccount, requireCourse, async (req, res) => {
  const content = await contentForCourse(req.course.id);
  return res.json({ course: req.course, version: content.version, studio: await studioState(req.course.id), schedule: await courseSchedule(req.course.id),
    position: coursePosition(await courseSchedule(req.course.id)), cards: [...content.cards.values()].map(metadata),
    skills: [...content.skills].map(([name, skill]) => ({ id: name, name, description: skill.description })),
    files: (await courseFiles(req.course.id)).map(fileMetadata) });
});
app.get('/api/courses/:courseId/studio', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.sendStatus(403);
  const content = await contentForCourse(req.course.id, req.query.draft === '1');
  return res.json({ state: await studioState(req.course.id), cards: [...content.cards.values()],
    skills: [...content.skills].map(([id, skill]) => ({ ...skill, id })) });
});
app.post('/api/courses/:courseId/studio/draft', demoAccount, requireCourse, async (req, res) => {
  try { return res.status(201).json(await saveStudioDraft('course', req.course.id, req.demoAccount, req.course, req.body || {})); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/courses/:courseId/studio/publish', demoAccount, requireCourse, async (req, res) => {
  try { return res.json(await publishStudio('course', req.course.id, req.demoAccount, req.course, req.body?.reason)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/courses/:courseId/studio/adopt-template', demoAccount, requireCourse, async (req, res) => {
  try { return res.json(await adoptTemplate(req.course.id, req.demoAccount, req.course)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/courses/:courseId/studio/restore', demoAccount, requireCourse, async (req, res) => {
  try { return res.status(201).json(await restoreStudioItem('course', req.course.id, req.demoAccount, req.course,
    req.body?.version, req.body?.kind, req.body?.itemId, req.body?.expectedRevision)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/courses/:courseId/pedagogy/scenarios', demoAccount, requireCourse, async (req, res) =>
  ['instructor','operator','researcher'].includes(req.demoAccount.role) ? res.json(scenarios) : res.sendStatus(403));
app.get('/api/courses/:courseId/pedagogy/runs', demoAccount, requireCourse, async (req, res) =>
  ['instructor','operator','researcher'].includes(req.demoAccount.role) ?
    res.json(await scenarioRuns(req.course.id, pageNumber(req.query.offset))) : res.sendStatus(403));
app.post('/api/courses/:courseId/pedagogy/runs', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.sendStatus(403);
  try { return res.status(201).json(await runScenario(req.course.id, req.body?.scenarioId, req.body?.mode, req.demoAccount.id)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.put('/api/courses/:courseId/pedagogy/runs/:runId/review', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.sendStatus(403);
  try { return res.json(await reviewScenario(req.course.id, req.params.runId, req.demoAccount.id, req.body || {})); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/courses/:courseId/cards/:cardId', demoAccount, requireCourse, async (req, res) => {
  const card = (await contentForCourse(req.course.id)).cards.get(req.params.cardId);
  return card ? res.json({ ...metadata(card), content: card.body, description: card.description }) : res.status(404).json({ error: 'Card unavailable' });
});
app.get('/api/courses/:courseId/skills/:skillId', demoAccount, requireCourse, async (req, res) => {
  const skill = (await contentForCourse(req.course.id)).skills.get(req.params.skillId);
  return skill ? res.json({ id: req.params.skillId, title: req.params.skillId.replaceAll('-', ' '), kind: 'skill',
    description: skill.description, content: skill.body }) : res.status(404).json({ error: 'Skill unavailable' });
});
app.get('/api/courses/:courseId/files/:fileId', demoAccount, requireCourse, async (req, res) => {
  const file = (await courseFiles(req.course.id)).find(f => f.id === req.params.fileId);
  return file ? res.json({ ...fileMetadata(file), content: file.text }) : res.status(404).json({ error: 'File unavailable' });
});
app.get('/api/courses/:courseId/files/:fileId/versions', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.status(403).json({ error: 'Instructor account required' });
  const current = (await courseFiles(req.course.id)).find(f => f.id === req.params.fileId);
  return current ? res.json((await courseFileVersions(req.course.id, current.name)).map(fileMetadata)) :
    res.status(404).json({ error: 'File unavailable' });
});
app.post('/api/courses/:courseId/files', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.status(403).json({ error: 'Instructor or operator account required' });
  if (req.demoAccount.demoProfessor) return res.status(403).json({ error: 'This sample professor account is read-only' });
  try { return res.status(201).json(await addCourseFile(req.demoAccount.id, req.course.id, req.body?.name, req.body?.mimeType, req.body?.base64)); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/courses/:courseId/analytics', demoAccount, requireCourse, async (req, res) =>
  ['instructor','operator','researcher'].includes(req.demoAccount.role) ? res.json({ ...await courseAnalytics(req.course.id),
    insight: await courseInsights(req.course.id) }) : res.status(403).json({ error: 'Professor account required' }));
app.get('/api/courses/:courseId/revisions', demoAccount, requireCourse, async (req, res) =>
  ['instructor','operator'].includes(req.demoAccount.role) ? res.json(await courseRevisions(req.course.id)) : res.status(403).json({ error: 'Instructor account required' }));
app.post('/api/courses/:courseId/revisions', demoAccount, requireCourse, async (req, res) => {
  try { return res.status(201).json(await saveStudioDraft('course', req.course.id, req.demoAccount, req.course, req.body || {})); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.post('/api/courses/:courseId/revisions/restore', demoAccount, requireCourse, async (req, res) => {
  try {
    const prior = (await courseRevisions(req.course.id)).find(item => item.id === req.body?.revisionId && item.itemId === req.body?.itemId);
    if (!prior || !['card','skill'].includes(prior.kind)) return res.status(404).json({ error: 'Revision unavailable' });
    return res.status(201).json(await saveStudioDraft('course', req.course.id, req.demoAccount, req.course,
      { kind: prior.kind, itemId: prior.itemId, value: prior.value, reason: `Restored earlier revision ${prior.version}`,
        expectedRevision: req.body?.expectedRevision }));
  }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.put('/api/courses/:courseId/schedule', demoAccount, requireCourse, async (req, res) => {
  try { return res.json(await saveCourseSchedule(req.course.id, req.demoAccount, req.course, req.body || {})); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.get('/api/courses/:courseId/source-inventory', demoAccount, requireCourse, (req, res) =>
  ['instructor','operator'].includes(req.demoAccount.role) && req.course.sourceCourse ? res.json(sourceInventory()) :
    res.status(404).json({ error: 'Source inventory unavailable' }));
app.post('/api/courses/:courseId/dream', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.status(403).json({ error: 'Instructor account required' });
  return res.json(await dreamCourse(req.course.id, (await contentForCourse(req.course.id)).cards));
});
app.get('/api/courses/:courseId/evidence', demoAccount, requireCourse, async (req, res) => {
  if (!['instructor','operator'].includes(req.demoAccount.role)) return res.status(403).json({ error: 'Instructor account required' });
  const events = await mcpCallEvents(req.course.id);
  return res.json({ count: events.length, methods: [...new Set(events.map(e => e.tool).filter(Boolean))],
    sample: events.slice(-10).map(({ id, at, tool, courseVersion, client, status }) => ({ id, at, tool, courseVersion, client, status })) });
});
app.use(mcpAuthRouter({ provider: oauth, issuerUrl: new URL(origin), resourceServerUrl: resourceUrl,
  scopesSupported: ['mcp:tools'], resourceName: 'Kelvin: Penn State ME 300 Engineering Thermodynamics learning account' }));
app.get('/.well-known/oauth-protected-resource/mcp/account', (_req, res) => res.json({
  resource: accountResourceUrl.href, authorization_servers: [origin], scopes_supported: ['mcp:tools'],
  resource_name: 'Kelvin: Penn State ME 300 Engineering Thermodynamics learning account' }));
app.get('/login', async (req, res) => {
  const page = await loginPage(req.query.request);
  res.set('Cache-Control', 'no-store');
  return page ? res.type('html').send(page) : res.status(400).send('This sign-in request expired. Start again in Claude.');
});
app.post('/login', express.urlencoded({ extended: false, limit: '8kb' }), rateLimit({ windowMs: 15 * 60_000, limit: 10 }), async (req, res) => {
  if (req.body.action === 'lookup-email') {
    const page = await loginPage(req.body.request, '', req.body.email);
    res.set('Cache-Control', 'no-store');
    return page ? res.type('html').send(page) : res.status(400).send('This sign-in request expired. Start again in Claude.');
  }
  const outcome = await completeLogin(req.body);
  res.set('Cache-Control', 'no-store');
  if (outcome.redirect) return res.redirect(302, outcome.redirect);
  const page = await loginPage(req.body.request, outcome.error, req.body.email);
  return page ? res.type('html').send(page) : res.status(400).send(outcome.error);
});
app.use('/dashboard-data', (req, res, next) => {
  res.set('Vary', 'Origin');
  if (req.headers.origin === dashboardOrigin) res.set('Access-Control-Allow-Origin', dashboardOrigin);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.get('/dashboard-data', requireBearerAuth({ verifier: oauth, requiredScopes: ['mcp:tools'], expectedResource: dashboardResourceUrl }), async (req, res) => {
  const account = await accountById(req.auth?.extra?.accountId);
  if (account?.role !== 'instructor') return res.status(403).json({ error: 'Instructor account required' });
  return res.json({ instructor: { id: account.id, name: account.name },
    trends: await courseAnalytics(`course-${account.id}`) });
});
app.all('/mcp/account', requireBearerAuth({ verifier: oauth, requiredScopes: ['mcp:tools'],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(accountResourceUrl), expectedResource: accountResourceUrl }),
  async (req, res) => {
    const account = await accountById(req.auth?.extra?.accountId);
    if (!account) return res.status(401).json({ error: 'Account is unavailable' });
    return handleMcp(req, res, { id: account.id, name: account.name, role: account.role, account: true,
      courseId: account.role === 'instructor' ? `course-${account.id}` : account.courseId || null,
      demoEmailOnly: Boolean(account.demoEmailOnly) });
  });
app.all('/mcp', requireBearerAuth({ verifier: oauth, requiredScopes: ['mcp:tools'],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl), expectedResource: resourceUrl }), async (req, res) => {
  if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).json({ error: 'Use MCP Streamable HTTP POST' });
  const account = await accountById(req.auth?.extra?.accountId);
  if (!account) return res.status(401).json({ error: 'Account is unavailable' });
  return handleMcp(req, res, { id: account.id, name: account.name, role: account.role, account: true,
    courseId: ['instructor', 'operator'].includes(account.role) ? `course-${account.id}` : account.courseId || null,
    demoEmailOnly: Boolean(account.demoEmailOnly) });
});
export default app;
if (process.env.VERCEL !== '1') {
  const server = createServer(app);
  const host = process.env.KELVIN_BIND_HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Kelvin MCP listening on ${host}:${port}`));
}
