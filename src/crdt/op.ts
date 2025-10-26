import type { Cursor } from './cursor.js'
import type { LamportTimestamp } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

interface BaseOp {
  id: LamportTimestamp
  deps: Set<string>
  cursor: Cursor
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

export interface OpDeleteKey extends BaseOp {
  mut: { kind: 'delete_key' }
}

export interface OpDeleteListElement extends BaseOp {
  mut: { kind: 'delete_list_element'; elementId: string }
}

export type Operation =
  | OpAssignPrimitive
  | OpAssignEmptyMap
  | OpAssignEmptyList
  | OpInsertListPrimitive
  | OpDeleteKey
  | OpDeleteListElement

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

export function assertOpDeleteKey(op: Operation): asserts op is OpDeleteKey {
  if (op.mut.kind !== 'delete_key') {
    throw new Error(`expected delete_key, got ${op.mut.kind}`)
  }
}

export function assertOpDeleteListElement(
  op: Operation,
): asserts op is OpDeleteListElement {
  if (op.mut.kind !== 'delete_list_element') {
    throw new Error(`expected delete_list_element, got ${op.mut.kind}`)
  }
}
