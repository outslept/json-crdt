import type { Cursor } from './cursor.js'
import type { LamportTimestamp } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

export type Mutation =
  | { kind: 'assign_primitive'; value: JsonPrimitive }
  | { kind: 'assign_empty_map' }
  | { kind: 'assign_empty_list' }
  | { kind: 'delete' }
  | { kind: 'insert'; value: never }

export interface Operation {
  id: LamportTimestamp
  deps: Set<string> // string-encoded LamportTimestamp ids
  cursor: Cursor
  mut: Mutation
}
