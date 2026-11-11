import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const root = join(import.meta.dirname, 'agent');
const kinds = ['course', 'units', 'topics', 'misconceptions'];
const skillNames = ['answer-requests', 'what-next', 'misconception-repair', 'property-tables', 'control-volume-energy-balance', 'response-pacing'];
function parse(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`Bad card: ${path}`);
  return { ...YAML.parse(match[1]), body: match[2].trim() };
}
const cards = [];
for (const kind of kinds) {
  for (const file of readdirSync(join(root, 'knowledge-brain', kind)).filter(name => name.endsWith('.md'))) {
    const card = parse(join(root, 'knowledge-brain', kind, file));
    if (!['both', 'student', undefined, null].includes(card.audience)) continue;
    if (cards.some(([id]) => id === card.id)) throw new Error(`Duplicate card ${card.id}`);
    cards.push([card.id, card]);
  }
}
const skills = skillNames.map(name => [name, parse(join(root, 'skills', name, 'SKILL.md'))]);
writeFileSync(join(import.meta.dirname, 'bundled-content.mjs'), `export default ${JSON.stringify({ cards, skills })};\n`);
console.log(`Bundled ${cards.length} cards and ${skills.length} skills`);
