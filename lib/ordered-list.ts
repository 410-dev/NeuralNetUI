export function moveItemById<T extends { id: string }>(items: readonly T[], sourceId: string, targetId: string): T[] {
  if (!sourceId || sourceId === targetId) return [...items];
  const next = [...items];
  const from = next.findIndex((item) => item.id === sourceId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function nudgeItemById<T extends { id: string }>(items: readonly T[], id: string, offset: -1 | 1): T[] {
  const from = items.findIndex((item) => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function applyPreferredOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftRank = rank.get(left.item.id);
    const rightRank = rank.get(right.item.id);
    if (leftRank === undefined && rightRank === undefined) return left.index - right.index;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  }).map(({ item }) => item);
}
