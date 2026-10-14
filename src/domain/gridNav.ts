/**
 * Moving down a column of inputs, the way a spreadsheet does.
 *
 * Kept out of the component so the rules can be tested without a browser: which row comes
 * next, what happens at the ends, and what happens when the row you are standing on has
 * just been deleted underneath you.
 */

/**
 * The next focusable row in `order`, `delta` steps from `current`.
 *
 * Returns null at either end — the caller keeps focus where it is rather than wrapping,
 * which is what Excel does at the bottom of a selection.
 *
 * If `current` is no longer in `order` (its row was deleted or filtered away), focus falls
 * to the nearest end in the direction of travel instead of vanishing.
 */
export function nextRow(order: readonly string[], current: string, delta: number): string | null {
  if (order.length === 0 || delta === 0) return null

  const from = order.indexOf(current)
  if (from === -1) return delta > 0 ? order[0] : order[order.length - 1]

  const target = from + delta
  if (target < 0 || target >= order.length) return null
  return order[target]
}

/** True when there is somewhere to go — used to decide whether Tab should leave the grid. */
export function hasRow(order: readonly string[], current: string, delta: number): boolean {
  return nextRow(order, current, delta) !== null
}
