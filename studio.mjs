import { readState, mutateState } from './persistence.mjs';

const key = 'faculty-studio.json';
const empty = () => ({ template: { releases: [], draft: {}, revision: 0 }, courses: {} });
const itemKey = (kind, id) => `${kind}:${id}`;
const latest = state => state.template.releases.at(-1)?.version || 0;
const courseState = (state, id) => state.courses[id] ||= { baseVersion: 0, releases: [], draft: {}, revision: 0 };

const history = releases => releases.map(({ changes, ...release }) => ({ ...release, count: changes.length,
  items: changes.map(({ kind, itemId, value, action }) => ({ kind, itemId, title: value?.title || itemId, action: action || 'upsert' })) }));
export async function studioState(courseId) {
  const state = await readState(key, empty());
  const course = state.courses?.[courseId] || { baseVersion: 0, releases: [], draft: {}, revision: 0 };
  return { templateVersion: latest(state), baseVersion: courseId === 'demo-me300' ? latest(state) : course.baseVersion || 0,
    publishedVersion: course.releases.at(-1)?.version || 0, draftRevision: course.revision || 0,
    draftCount: Object.keys(course.draft || {}).length, templateDraftCount: Object.keys(state.template.draft || {}).length,
    templateDraftRevision: state.template.revision || 0,
    templateHistory: history(state.template.releases), courseHistory: history(course.releases) };
}

function applyPatch(cards, skills, patch, origin, baseline) {
  const map = patch.kind === 'skill' ? skills : cards;
  if (patch.action === 'reset') {
    const original = (patch.kind === 'skill' ? baseline.skills : baseline.cards).get(patch.itemId);
    if (original) map.set(patch.itemId, { ...original }); else map.delete(patch.itemId);
    return;
  }
  const previous = map.get(patch.itemId) || {};
  map.set(patch.itemId, { ...previous, ...patch.value, id: patch.kind === 'card' ? patch.itemId : undefined,
    name: patch.kind === 'skill' ? patch.itemId : undefined, origin });
}

export async function applyStudio(courseId, cards, skills, includeDraft = false, legacyRevisions = []) {
  const state = await readState(key, empty());
  const course = state.courses?.[courseId] || { baseVersion: 0, releases: [], draft: {} };
  const baseVersion = courseId === 'demo-me300' ? latest(state) : course.baseVersion || 0;
  const bundled = { cards: new Map(cards), skills: new Map(skills) };
  for (const release of state.template.releases) if (release.version <= baseVersion)
    for (const patch of release.changes) applyPatch(cards, skills, patch, 'global template', bundled);
  if (includeDraft && courseId === 'demo-me300') for (const patch of Object.values(state.template.draft || {}))
    applyPatch(cards, skills, patch, 'template draft', bundled);
  for (const revision of legacyRevisions) {
    if (!['card','skill'].includes(revision.kind)) continue;
    const map = revision.kind === 'skill' ? skills : cards;
    if (revision.action === 'delete') map.delete(revision.itemId);
    else map.set(revision.itemId, { ...map.get(revision.itemId), ...revision.value, origin: 'earlier course edit' });
  }
  const courseBaseline = { cards: new Map(cards), skills: new Map(skills) };
  for (const release of course.releases || []) for (const patch of release.changes)
    applyPatch(cards, skills, patch, 'course override', courseBaseline);
  if (includeDraft) for (const patch of Object.values(course.draft || {})) applyPatch(cards, skills, patch, 'course draft', courseBaseline);
  return { cards, skills, templateVersion: baseVersion, studioVersion: course.releases.at(-1)?.version || 0,
    draftCount: Object.keys(course.draft || {}).length };
}

export async function saveStudioDraft(scope, courseId, account, course, input) {
  if (scope === 'template' ? account.role !== 'operator' :
    !['operator','instructor'].includes(account.role) || (account.role !== 'operator' && (course?.professorId !== account.id || account.demoProfessor)))
    throw new Error('Editing is unavailable');
  const kind = input.kind, itemId = String(input.itemId || '');
  if (!['card', 'skill'].includes(kind) || !/^[\w:-]{2,120}$/.test(itemId)) throw new Error('Invalid item');
  const reset = input.action === 'reset';
  const title = String(input.value?.title || input.value?.name || '').trim();
  const description = String(input.value?.description || '').trim();
  const body = String(input.value?.body || '').trim();
  if (!reset && (title.length < 3 || title.length > 160 || description.length > 1000 || body.length < 10 || body.length > 40000))
    throw new Error('Enter a title and content');
  const value = { title, description, body, kind: kind === 'card' ? String(input.value?.kind || 'topic') : undefined,
    status: scope === 'template' ? 'template-edited' : 'instructor-edited' };
  return mutateState(key, empty(), state => {
    const target = scope === 'template' ? state.template : courseState(state, courseId);
    if (Number(input.expectedRevision) !== target.revision) throw new Error('Draft changed. Refresh before saving.');
    target.revision++;
    const patch = { kind, itemId, action: reset ? 'reset' : 'upsert', value: reset ? undefined : value,
      reason: String(input.reason || '').slice(0, 500),
      at: new Date().toISOString(), actorId: account.id };
    target.draft[itemKey(kind, itemId)] = patch;
    return { revision: target.revision, patch };
  });
}

export async function restoreStudioItem(scope, courseId, account, course, version, kind, itemId, expectedRevision) {
  const state = await readState(key, empty());
  const releases = scope === 'template' ? state.template.releases : (state.courses?.[courseId]?.releases || []);
  const release = releases.find(item => item.version === Number(version));
  const patch = release?.changes.find(item => item.kind === kind && item.itemId === itemId);
  if (!patch) throw new Error('Published item unavailable');
  return saveStudioDraft(scope, courseId, account, course, { ...patch,
    reason: `Restored ${scope} v${version} to draft`, expectedRevision });
}

export async function publishStudio(scope, courseId, account, course, reason = '') {
  if (scope === 'template' ? account.role !== 'operator' :
    !['operator','instructor'].includes(account.role) || (account.role !== 'operator' && (course?.professorId !== account.id || account.demoProfessor)))
    throw new Error('Publishing is unavailable');
  return mutateState(key, empty(), state => {
    const target = scope === 'template' ? state.template : courseState(state, courseId);
    const changes = Object.values(target.draft || {});
    if (!changes.length) throw new Error('There are no draft changes to publish');
    const release = { version: (target.releases.at(-1)?.version || 0) + 1,
      at: new Date().toISOString(), actorId: account.id, reason: String(reason || '').slice(0, 500), changes };
    target.releases.push(release); target.draft = {}; target.revision++;
    return { ...release, count: changes.length, changes: undefined };
  });
}

export async function adoptTemplate(courseId, account, course) {
  if (!['operator','instructor'].includes(account.role) || (account.role !== 'operator' && course.professorId !== account.id))
    throw new Error('Course unavailable');
  return mutateState(key, empty(), state => {
    const target = courseState(state, courseId), version = latest(state);
    if (Object.keys(target.draft).length) throw new Error('Publish or clear course drafts before updating the template');
    target.baseVersion = version; target.revision++;
    return { baseVersion: version };
  });
}
