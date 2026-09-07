export interface FuzzyHit {
  score: number
  indices: number[]
}

export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  if (!query) return { score: 0, indices: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], qi === 0 ? 0 : ti)
    if (found === -1) return null
    indices.push(found)
    let bonus = 1
    if (found === prev + 1) bonus += 6
    const before = found === 0 ? " " : t[found - 1]
    if (" /_-.:~".includes(before)) bonus += 5
    if (t[found] === query[qi]) bonus += 1
    score += bonus
    prev = found
    ti = found + 1
  }
  score -= Math.min(9, indices[0] / 2)
  score -= (text.length - t.length) * 0.001
  return { score, indices }
}

export interface FuzzyItem<T> {
  item: T
  score: number
  indices: number[]
}

export function fuzzyFilter<T>(query: string, items: T[], text: (t: T) => string): FuzzyItem<T>[] {
  if (!query) return items.map((item) => ({ item, score: 0, indices: [] }))
  const out: FuzzyItem<T>[] = []
  for (const item of items) {
    const hit = fuzzyMatch(query, text(item))
    if (hit) out.push({ item, score: hit.score, indices: hit.indices })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

export interface Slice {
  text: string
  hit: boolean
}

export function highlight(text: string, indices: number[]): Slice[] {
  if (indices.length === 0) return [{ text, hit: false }]
  const set = new Set(indices)
  const out: Slice[] = []
  let cur = ""
  let curHit = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i)
    if (h === curHit) {
      cur += text[i]
    } else {
      out.push({ text: cur, hit: curHit })
      cur = text[i]
      curHit = h
    }
  }
  out.push({ text: cur, hit: curHit })
  return out
}
