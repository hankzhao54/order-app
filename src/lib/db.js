import { supabase } from './supabase'

// Shared data-access helpers so every page doesn't reimplement its own
// fetch/patch/insert + error-handling boilerplate. `onError` defaults to
// console.error so a failed write is never silently swallowed; pass a
// setMsg/alert callback to surface it to the user.
function reportError(error, onError) {
  if (!error) return
  ;(onError || console.error)(error)
}

// Fetch a list of rows from `table`. `build` customizes the query (joins via
// `select`, filters, order, limit) before it runs. Always resolves to an
// array — callers never need to null-check the result.
export async function fetchList(table, { select = '*', build, onError } = {}) {
  let q = supabase.from(table).select(select)
  if (build) q = build(q)
  const { data, error } = await q
  reportError(error, onError)
  return data || []
}

// Update a single row by id.
export async function patchRow(table, id, fields, { idColumn = 'id', onError } = {}) {
  const { error } = await supabase.from(table).update(fields).eq(idColumn, id)
  reportError(error, onError)
  return { error }
}

// Insert one row. Pass `select` to get the inserted row back.
export async function insertRow(table, fields, { select, onError } = {}) {
  let q = supabase.from(table).insert(fields)
  const { data, error } = select ? await q.select(select).single() : await q
  reportError(error, onError)
  return { data, error }
}
