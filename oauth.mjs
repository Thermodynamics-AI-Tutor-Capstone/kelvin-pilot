import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mutateState, readState } from './persistence.mjs';
import { enrollStudent, professors } from './demo.mjs';

const accountsKey = 'accounts.json';
const oauthKey = 'oauth-state.json';
const emptyState = () => ({ clients: {}, pending: {}, codes: {}, tokens: {} });
const hex = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const now = () => Date.now();
const accounts = () => readState(accountsKey, []);
const state = () => readState(oauthKey, emptyState());
function clean(data) {
  for (const [id, pending] of Object.entries(data.pending)) if (pending.expiresAt < now()) delete data.pending[id];
  for (const [id, code] of Object.entries(data.codes)) if (code.expiresAt < now()) delete data.codes[id];
  for (const [id, token] of Object.entries(data.tokens)) if (token.refreshExpiresAt && token.refreshExpiresAt < now()) delete data.tokens[id];
}
const passwordDigest = (password, salt) => scryptSync(password, salt, 64).toString('hex');
function constantEqual(a, b) {
  const left = Buffer.from(a || '', 'hex'), right = Buffer.from(b || '', 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function addInstructorHash(id, name, salt, passwordHash) {
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) throw new Error('Invalid account ID');
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw new Error('Invalid name');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(passwordHash)) throw new Error('Invalid password hash');
  await mutateState(accountsKey, [], data => {
    if (data.some(account => account.id === id)) throw new Error('Account ID already exists');
    data.push({ id, name: name.trim(), role: 'instructor', salt, passwordHash,
      createdAt: new Date().toISOString(), disabled: false });
  });
  return { id, name: name.trim(), role: 'instructor' };
}
export async function accountById(id) { return (await accounts()).find(a => a.id === id && !a.disabled && (a.passwordHash || a.demoEmailOnly)) || null; }
export async function sharedStudents() { return (await accounts()).filter(a => a.role === 'student' && !a.disabled && a.passwordHash && a.shareWithInstructor)
  .map(({ id, name }) => ({ id, name })); }
export async function setSharing(id, enabled) {
  return mutateState(accountsKey, [], data => {
    const account = data.find(a => a.id === id && a.role === 'student' && !a.disabled && a.passwordHash);
    if (!account) throw new Error('Student account unavailable');
    account.shareWithInstructor = Boolean(enabled);
    account.sharingUpdatedAt = new Date().toISOString();
    return account.shareWithInstructor;
  });
}
async function createStudent(name, password, shareWithInstructor) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120 ||
      typeof password !== 'string' || password.length < 12 || password.length > 200) return null;
  const salt = randomBytes(16).toString('hex');
  return mutateState(accountsKey, [], data => {
    let id;
    do { id = `student-${randomBytes(12).toString('hex')}`; } while (data.some(account => account.id === id));
    const account = { id, name: name.trim(), role: 'student',
      passwordHash: passwordDigest(password, salt), salt, createdAt: new Date().toISOString(),
      disabled: false, shareWithInstructor: Boolean(shareWithInstructor), sharingUpdatedAt: new Date().toISOString() };
    data.push(account);
    return account;
  });
}
async function signIn(id, password) {
  const account = (await accounts()).find(a => a.id === id && !a.disabled && a.passwordHash);
  if (!account) return null;
  return constantEqual(account.passwordHash, passwordDigest(password, account.salt)) ? account : null;
}
export async function disableAccount(id) {
  return mutateState(accountsKey, [], data => {
    const account = data.find(a => a.id === id);
    if (!account) throw new Error('Account not found');
    account.disabled = true;
  });
}
function tokenPair(data, clientId, accountId, scopes, resource) {
  const access = secret(), refresh = secret();
  data.tokens[hex(access)] = { clientId, accountId, scopes, resource, expiresAt: now() + 3600_000,
    refreshHash: hex(refresh) };
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') };
}
export function createOAuthProvider(resourceUrl, origin, otherResources = []) {
  const resource = resourceUrl.href;
  const allowedResources = new Set([resource, ...otherResources.map(url => url.href)]);
  return {
    clientsStore: {
      async getClient(clientId) { return (await state()).clients[clientId]; },
      async registerClient(client) {
        await mutateState(oauthKey, emptyState(), data => { clean(data); data.clients[client.client_id] = client; });
        return client;
      }
    },
    async authorize(client, params, res) {
      if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidGrantError('Unregistered redirect URI');
      if (params.resource && !allowedResources.has(params.resource.href)) throw new InvalidGrantError('Wrong resource');
      const id = secret();
      await mutateState(oauthKey, emptyState(), data => {
        clean(data);
        data.pending[hex(id)] = { clientId: client.client_id, redirectUri: params.redirectUri,
          state: params.state, codeChallenge: params.codeChallenge, scopes: params.scopes || ['mcp:tools'],
          resource: params.resource?.href || resource, expiresAt: now() + 10 * 60_000 };
      });
      res.redirect(302, `${origin}/login?request=${encodeURIComponent(id)}`);
    },
    async challengeForAuthorizationCode(client, code) {
      const found = (await state()).codes[hex(code)];
      if (!found || found.clientId !== client.client_id || found.expiresAt < now()) throw new InvalidGrantError('Invalid code');
      return found.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      return mutateState(oauthKey, emptyState(), data => {
        clean(data);
        const key = hex(code), found = data.codes[key];
        if (!found || found.clientId !== client.client_id || found.expiresAt < now() ||
            (redirectUri && redirectUri !== found.redirectUri) ||
            (requestedResource && requestedResource.href !== found.resource)) throw new InvalidGrantError('Invalid code');
        delete data.codes[key];
        return tokenPair(data, client.client_id, found.accountId, found.scopes, found.resource);
      });
    },
    async exchangeRefreshToken(client, refreshToken, scopes, requestedResource) {
      const accountIds = new Set((await accounts()).filter(a => !a.disabled).map(a => a.id));
      return mutateState(oauthKey, emptyState(), data => {
        clean(data);
        const [key, found] = Object.entries(data.tokens).find(([, t]) => t.refreshHash === hex(refreshToken)) || [];
        if (!found || found.clientId !== client.client_id || (found.refreshExpiresAt && found.refreshExpiresAt < now()) ||
            (requestedResource && requestedResource.href !== found.resource) || !accountIds.has(found.accountId)) throw new InvalidGrantError('Invalid refresh token');
        if (scopes && scopes.some(scope => !found.scopes.includes(scope))) throw new InvalidGrantError('Invalid scope');
        delete data.tokens[key];
        return tokenPair(data, client.client_id, found.accountId, scopes || found.scopes, found.resource);
      });
    },
    async verifyAccessToken(token) {
      const found = (await state()).tokens[hex(token)];
      if (!found || found.expiresAt < now() || !await accountById(found.accountId)) throw new InvalidGrantError('Invalid access token');
      return { token, clientId: found.clientId, scopes: found.scopes,
        expiresAt: Math.floor(found.expiresAt / 1000), resource: new URL(found.resource),
        extra: { accountId: found.accountId } };
    },
    async revokeToken(client, request) {
      await mutateState(oauthKey, emptyState(), data => {
        clean(data);
        for (const [key, found] of Object.entries(data.tokens)) {
          if (found.clientId === client.client_id && (key === hex(request.token) || found.refreshHash === hex(request.token))) delete data.tokens[key];
        }
      });
    }
  };
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
export async function loginPage(requestId, message = '') {
  const request = typeof requestId === 'string' ? requestId : '';
  const pending = (await state()).pending[hex(request)];
  if (!pending || pending.expiresAt < now()) return null;
  const dashboard = pending.resource.endsWith('/dashboard-data');
  const title = dashboard ? 'Sign in to the Kelvin instructor dashboard' : 'Connect Kelvin to Claude';
  const intro = dashboard ? 'Use your instructor account to see aggregate course activity.' : 'Enter your PSU email and choose your professor’s course. Kelvin will remember this pairing when you reconnect.';
  const options = (await professors()).flatMap(professor => professor.courses.map(course =>
    `<option value="${escape(course.id)}">${escape(professor.name)} · ${escape(course.code)}: ${escape(course.title)}</option>`)).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Kelvin</title><style>body{font:16px system-ui;max-width:540px;margin:7vh auto;padding:24px;color:#1d2730}h1{font-size:1.7em}form{border:1px solid #ccd5dc;border-radius:12px;padding:20px;margin:18px 0}label{display:block;margin:12px 0}input,select{display:block;box-sizing:border-box;width:100%;padding:10px;margin-top:5px}button{background:#164a71;color:white;border:0;border-radius:7px;padding:11px 18px;cursor:pointer}.error{color:#a12626}.note{color:#59636b;font-size:.9em}</style><h1>${title}</h1><p>${intro}</p>${message ? `<p class="error">${escape(message)}</p>` : ''}${dashboard ? '' : `<form method="post" action="/login"><input type="hidden" name="request" value="${escape(request)}"><label>PSU email<input name="email" type="email" autocomplete="email" placeholder="you@psu.edu" required></label><label>Professor and course<select name="course" required>${options}</select></label><button name="action" value="email">Connect to Kelvin</button></form><p class="note">Demo sign-in: email ownership is not verified. Use only test data. Reflections are saved only when you explicitly ask Claude to save them.</p>`}<form method="post" action="/login"><h2>${dashboard ? 'Instructor sign-in' : 'Existing password account'}</h2><input type="hidden" name="request" value="${escape(request)}"><label>Account ID<input name="account" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button name="action" value="sign-in">Sign in and connect</button></form></html>`;
}
export async function completeLogin(input) {
  const requestId = String(input.request || ''), pending = (await state()).pending[hex(requestId)];
  if (!pending || pending.expiresAt < now()) return { error: 'This sign-in request expired. Start again in Claude.' };
  const password = String(input.password || '');
  const dashboard = pending.resource.endsWith('/dashboard-data');
  let account;
  if (input.action === 'email' && !dashboard) {
    try { account = await enrollStudent(input.email, input.course); } catch { return { error: 'Enter a PSU email and choose a valid course.' }; }
  } else if (input.action === 'create' && !dashboard) account = await createStudent(String(input.name || ''), password, input.share === 'yes');
  else if (input.action === 'sign-in') account = await signIn(String(input.account || ''), password);
  if (!account) return { error: 'The name, account, or password was not accepted.' };
  if (dashboard && account.role !== 'instructor') return { error: 'An instructor account is required.' };
  const code = secret();
  await mutateState(oauthKey, emptyState(), data => {
    const current = data.pending[hex(requestId)];
    if (!current || current.expiresAt < now()) throw new InvalidGrantError('Sign-in request expired');
    data.codes[hex(code)] = { ...current, accountId: account.id, expiresAt: now() + 5 * 60_000 };
    delete data.pending[hex(requestId)];
  });
  const url = new URL(pending.redirectUri);
  url.searchParams.set('code', code);
  if (pending.state !== undefined) url.searchParams.set('state', pending.state);
  return { redirect: url.href };
}
