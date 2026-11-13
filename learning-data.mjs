import { randomUUID, createHash } from 'node:crypto';
import { readState, mutateState, addStoredUsage, storedUsage, storedEvents, addRpcEvent, storedRpcEvents } from './persistence.mjs';
import { classify } from './classify.mjs';

const insightKey = 'learning-insights.json';
const importKey = 'chat-imports.json';
const hash = text => createHash('sha256').update(text).digest('hex');
export function clientFamily(agent = '') {
  const value = String(agent).toLowerCase();
  return value.includes('claude') || value.includes('anthropic') ? 'claude' : value.includes('chatgpt') || value.includes('openai') ? 'chatgpt' :
    value.includes('gemini') || value.includes('google') ? 'gemini' : 'unknown';
}
export async function recordMcpCall({ requestId, user, body, userAgent, status, courseVersion, durationMs, cardId }) {
  const event = { id: randomUUID(), schemaVersion: 1, at: new Date().toISOString(), requestId, studentId: user.role === 'student' ? user.id : null,
    accountId: user.id, role: user.role, courseId: user.courseId || null, courseVersion,
    client: clientFamily(userAgent), clientUserAgent: String(userAgent || '').slice(0, 300),
    method: String(body?.method || 'unknown'), tool: body?.method === 'tools/call' ? String(body.params?.name || '') : null,
    cardId: cardId || null,
    arguments: body?.method === 'tools/call' ? body.params?.arguments || {} : null, status, durationMs };
  await addRpcEvent(event);
  if (event.studentId && event.tool) await addStoredUsage({ studentId: event.studentId, courseId: event.courseId,
    tool: event.tool, cardId: cardId || (['get_card','get_course_file'].includes(event.tool) ? event.arguments?.id || null : null),
    query: ['search_course','ask_kelvin'].includes(event.tool) ? String(event.arguments?.query || event.arguments?.question || '').slice(0, 2000) : null,
    eventId: event.id, courseVersion, client: event.client });
  return event;
}
export async function mcpCallEvents(courseId, studentId) {
  return storedRpcEvents(courseId, studentId);
}
export async function studentInsights(studentId) { return (await readState(insightKey, {})).students?.[studentId] || null; }
export async function courseInsights(courseId) { return (await readState(insightKey, {})).courses?.[courseId] || null; }
export async function dreamCourse(courseId, cards) {
  const calls = (await mcpCallEvents(courseId)).filter(e => e.studentId && e.tool);
  const reflections = (await storedEvents()).filter(e => e.courseId === courseId);
  const imports = (await readState(importKey, [])).filter(e => e.courseId === courseId);
  const usage = await storedUsage(courseId);
  const students = [...new Set([...calls, ...reflections, ...imports].map(e => e.studentId))];
  const studentResults = {};
  for (const id of students) {
    const own = [...calls.filter(e => e.studentId === id), ...reflections.filter(e => e.studentId === id)].sort((a,b) => a.at.localeCompare(b.at));
    const imported = imports.filter(e => e.studentId === id).flatMap(e => e.records.map(r => r.text));
    const text = [...own.filter(e => e.tool === 'ask_kelvin' || e.tool === 'search_course').map(e => e.arguments?.question || e.arguments?.query),
      ...imported].filter(Boolean).slice(-12).join('\n');
    let labels = { topics: [], misconceptions: [], summary: '' }, modelStatus = 'no-questions';
    if (text) try { labels = await classify(text.slice(0, 3000), cards); modelStatus = 'deepseek'; } catch { modelStatus = 'unavailable'; }
    studentResults[id] = { id: randomUUID(), generatedAt: new Date().toISOString(), modelStatus, ...labels,
      evidenceEventIds: own.slice(-20).map(e => e.id), importIds: imports.filter(e => e.studentId === id).map(e => e.id), sourceCount: own.length + imported.length,
      statement: modelStatus === 'deepseek' ? labels.summary : 'No model summary available.' };
  }
  const counts = new Map();
  for (const event of usage) if (event.cardId) {
    const entry = counts.get(event.cardId) || { id: event.cardId, count: 0, students: new Set(), evidenceEventIds: [] };
    entry.count++; entry.students.add(event.studentId); if (event.eventId) entry.evidenceEventIds.push(event.eventId); counts.set(event.cardId, entry);
  }
  const trends = [...counts.values()].filter(x => x.students.size >= 5).map(x => ({ id: x.id, count: x.count,
    studentCount: x.students.size, evidenceEventIds: x.evidenceEventIds.slice(-30) })).sort((a,b) => b.count-a.count);
  const topicCounts = new Map();
  for (const profile of Object.values(studentResults)) for (const id of profile.topics) {
    const entry = topicCounts.get(id) || { id, studentCount: 0, evidenceEventIds: [], importIds: [] };
    entry.studentCount++; entry.evidenceEventIds.push(...profile.evidenceEventIds);
    entry.importIds.push(...profile.importIds); topicCounts.set(id, entry);
  }
  const questionTopics = [...topicCounts.values()].filter(x => x.studentCount >= 5)
    .map(x => ({ ...x, evidenceEventIds: x.evidenceEventIds.slice(-30), importIds: x.importIds.slice(-30) }))
    .sort((a,b) => b.studentCount-a.studentCount);
  const result = { id: randomUUID(), generatedAt: new Date().toISOString(), courseId, sourceCount: calls.length,
    studentCount: students.length, trends, questionTopics, conclusion: questionTopics.length ?
      `${questionTopics[0].studentCount} students asked questions classified under ${questionTopics[0].id}.` : trends.length ?
      `The most opened course item is ${trends[0].id}, across ${trends[0].studentCount} students.` :
      'There is not enough distinct-student evidence yet for a class trend.', conclusionType: 'deterministic',
    evidenceEventIds: [...trends.flatMap(t => t.evidenceEventIds), ...questionTopics.flatMap(t => t.evidenceEventIds)].slice(-60),
    evidenceImportIds: questionTopics.flatMap(t => t.importIds).slice(-60) };
  if ((trends.length || questionTopics.length) && process.env.DEEPSEEK_API_KEY) try {
    const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(12000), body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', temperature: 0,
        messages: [{ role: 'system', content: 'Given only aggregate course usage counts, suggest one concrete teaching action in one sentence. Do not infer student ability or identity. Do not claim a misconception unless evidence explicitly shows one.' },
          { role: 'user', content: JSON.stringify({ trends: trends.slice(0, 8).map(({ evidenceEventIds, ...item }) => item),
            questionTopics: questionTopics.slice(0, 8).map(({ evidenceEventIds, importIds, ...item }) => item) }) }] }) });
    if (response.ok) {
      const json = await response.json();
      result.suggestion = String(json.choices?.[0]?.message?.content || '').slice(0, 500);
      result.suggestionType = 'model-generated';
    }
  } catch (error) { console.error('Course synthesis model unavailable:', error.message); }
  await mutateState(insightKey, {}, data => { data.students ||= {}; data.courses ||= {}; Object.assign(data.students, studentResults); data.courses[courseId] = result; });
  return { course: result, studentsProcessed: students.length };
}
export function parseChatExport(platform, data) {
  const records = [];
  if (Array.isArray(data?.prompts)) return data.prompts.slice(0, 500).filter(x => typeof x.text === 'string' && x.text.trim().length >= 10)
    .map(x => ({ conversation: String(x.conversation || '').slice(0, 150), at: x.at || null, text: x.text.slice(0, 4000) }));
  if (platform === 'chatgpt') {
    const chats = Array.isArray(data) ? data : data.conversations;
    if (!Array.isArray(chats)) throw new Error('Choose a ChatGPT conversations.json file');
    for (const chat of chats) for (const node of Object.values(chat.mapping || {})) {
      const m = node.message, role = m?.author?.role;
      if (role === 'user') {
        const text = (m.content?.parts || []).filter(x => typeof x === 'string').join('\n');
        if (text.trim()) records.push({ conversation: chat.title || '', at: m.create_time ? new Date(m.create_time * 1000).toISOString() : null, text });
      }
    }
  } else if (platform === 'claude') {
    const chats = Array.isArray(data) ? data : data.conversations;
    if (!Array.isArray(chats)) throw new Error('Choose a Claude conversations.json file');
    for (const chat of chats) for (const m of chat.chat_messages || chat.messages || []) if (['human','user'].includes(m.sender || m.role)) {
      const text = Array.isArray(m.content) ? m.content.map(x => x.text || '').join('\n') : String(m.text || m.content || '');
      if (text.trim()) records.push({ conversation: chat.name || chat.title || '', at: m.created_at || null, text });
    }
  } else if (platform === 'gemini') {
    const entries = Array.isArray(data) ? data : data.activities || data.events || [];
    if (!Array.isArray(entries)) throw new Error('Choose a Gemini My Activity JSON export');
    for (const item of entries) {
      const text = String(item.title || item.prompt || item.text || '');
      if (text.trim()) records.push({ conversation: item.header || 'Gemini activity', at: item.time || item.timestamp || null, text });
    }
  } else throw new Error('Choose ChatGPT, Claude, or Gemini');
  return records.filter(x => x.text.length >= 10).slice(0, 500).map(x => ({ ...x, text: x.text.slice(0, 4000) }));
}
export async function importChatExport(studentId, courseId, platform, data) {
  const records = parseChatExport(platform, data);
  if (!records.length) throw new Error('No prompts were found in this export');
  const importId = randomUUID();
  const result = { id: importId, at: new Date().toISOString(), studentId, courseId, platform, count: records.length,
    records: records.map(r => ({ ...r, hash: hash(`${platform}:${r.conversation}:${r.text}`) })) };
  await mutateState(importKey, [], entries => entries.push(result));
  return { id: importId, count: records.length, platform };
}
export async function studentImports(studentId) { return (await readState(importKey, [])).filter(x => x.studentId === studentId).map(({ records, ...x }) => x); }
