const provider = () => process.env.MODEL_PROVIDER || (process.env.OLLAMA_BASE_URL ? 'ollama' : 'deepseek');
export const modelName = () => provider() === 'ollama' ? process.env.OLLAMA_MODEL || 'qwen3:8b' : process.env.DEEPSEEK_MODEL || 'deepseek-flash';
export const modelConfigured = () => provider() === 'ollama' || Boolean(process.env.DEEPSEEK_API_KEY?.trim());

export async function generateText(messages, { json = false, temperature = 0, timeoutMs } = {}) {
  const limit = Number(timeoutMs || process.env.MODEL_TIMEOUT_MS || 60000);
  const signal = AbortSignal.timeout(Number.isFinite(limit) && limit > 0 ? limit : 60000);
  if (provider() === 'ollama') {
    const base = (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/$/, '');
    const response = await fetch(`${base}/api/chat`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName(), messages, stream: false, think: false,
        ...(json ? { format: 'json' } : {}), options: { temperature } }) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const data = await response.json();
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama returned no answer');
    return { content, model: data.model || modelName(), provider: 'ollama' };
  }
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error('No model is configured');
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const response = await fetch(url, { method: 'POST', signal,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelName(), temperature, ...(json ? { response_format: { type: 'json_object' } } : {}), messages }) });
  if (!response.ok) throw new Error(`DeepSeek returned HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek returned no answer');
  return { content, model: modelName(), provider: 'deepseek' };
}

export async function modelReady() {
  if (provider() !== 'ollama') return modelConfigured();
  try {
    const base = (process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/$/, '');
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.models) && data.models.some(item => item.name === modelName() || item.model === modelName());
  } catch { return false; }
}
