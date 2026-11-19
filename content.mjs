import bundled from './bundled-content.mjs';

export const provenance = "Course and topic cards draw on real Penn State ME 300 Engineering Thermodynamics materials from Dr. Jacqueline O'Connor's Summer 2023 Canvas section. Misconception cards draw on cited thermodynamics education research. Dates, grading, and policies are specific to that course term; check your current Canvas section for current logistics.";

export function loadContent() { return { cards: new Map(bundled.cards), skills: new Map(bundled.skills) }; }

export function metadata(card) {
  const origin = card.origin || 'bundled template';
  const original = origin === 'bundled template';
  return { id: card.id, kind: card.kind, title: card.title, description: card.description,
    origin,
    sourceCourse: 'Penn State ME 300 Engineering Thermodynamics',
    sourceTerm: original && card.kind !== 'misconception' ? 'Summer 2023' : undefined,
    sourceMaterial: original ? (card.kind === 'misconception' ? 'cited thermodynamics education research' : 'actual Penn State course files')
      : origin === 'global template' || origin === 'template draft' ? 'Kelvin shared template' : 'faculty-edited course content',
    studyCardStatus: card.status, unit: card.unit, parent: card.parent };
}

export function searchCards(cards, query, kind, limit = 8) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return [...cards.values()].filter(c => !kind || c.kind === kind).map(c => {
    const haystack = `${c.title} ${c.description} ${c.body}`.toLowerCase();
    const score = terms.reduce((n, term) => n + (c.title.toLowerCase().includes(term) ? 5 : 0)
      + (c.description.toLowerCase().includes(term) ? 3 : 0) + (haystack.includes(term) ? 1 : 0), 0);
    return { card: c, score };
  }).filter(x => terms.length === 0 || x.score > 0).sort((a,b) => b.score - a.score || (b.card.priority || 0) - (a.card.priority || 0))
    .slice(0, limit).map(x => metadata(x.card));
}
