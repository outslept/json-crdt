import type { Cursor } from './cursor.js'
import type { LamportTimestamp } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

interface BaseOp {
  id: LamportTimestamp
  deps: Set<string> // string-encoded LamportTimestamp ids
  cursor: Cursor // path/key where the mutation applies
}

export interface OpAssignPrimitive extends BaseOp {
  mut: { kind: 'assign_primitive'; value: JsonPrimitive }
}

export interface OpAssignEmptyMap extends BaseOp {
  mut: { kind: 'assign_empty_map' }
}

export interface OpAssignEmptyList extends BaseOp {
  mut: { kind: 'assign_empty_list' }
}

export interface OpInsertListPrimitive extends BaseOp {
  mut: { kind: 'insert_list_primitive'; after: string; value: JsonPrimitive }
}

export interface OpDelete extends BaseOp {
  mut: { kind: 'delete' }
}

export type Operation =
  | OpAssignPrimitive
  | OpAssignEmptyMap
  | OpAssignEmptyList
  | OpInsertListPrimitive
  | OpDelete

export function assertOpAssignPrimitive(
  op: Operation,
): asserts op is OpAssignPrimitive {
  if (op.mut.kind !== 'assign_primitive') {
    throw new Error(`expected assign_primitive, got ${op.mut.kind}`)
  }
}

export function assertOpAssignEmptyMap(
  op: Operation,
): asserts op is OpAssignEmptyMap {
  if (op.mut.kind !== 'assign_empty_map') {
    throw new Error(`expected assign_empty_map, got ${op.mut.kind}`)
  }
}

export function assertOpAssignEmptyList(
  op: Operation,
): asserts op is OpAssignEmptyList {
  if (op.mut.kind !== 'assign_empty_list') {
    throw new Error(`expected assign_empty_list, got ${op.mut.kind}`)
  }
}

export function assertOpInsertListPrimitive(
  op: Operation,
): asserts op is OpInsertListPrimitive {
  if (op.mut.kind !== 'insert_list_primitive') {
    throw new Error(`expected insert_list_primitive, got ${op.mut.kind}`)
  }
}

export function assertOpDelete(op: Operation): asserts op is OpDelete {
  if (op.mut.kind !== 'delete') {
    throw new Error(`expected delete, got ${op.mut.kind}`)
  }
}
