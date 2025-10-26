import type { Cursor } from './cursor.js'
import type { LamportTimestamp } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

export type Mutation =
  | { kind: 'assign_primitive'; value: JsonPrimitive }
  | { kind: 'assign_empty_map' }
  | { kind: 'assign_empty_list' }
  // list operations (payloads start with primitives)
  | { kind: 'insert_list_primitive'; after: string; value: JsonPrimitive }
  | { kind: 'delete' }

export interface Operation {
  id: LamportTimestamp
  deps: Set<string> // string-encoded LamportTimestamp ids
  cursor: Cursor
  mut: Mutation
}
