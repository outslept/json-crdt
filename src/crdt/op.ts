import type { Cursor } from './cursor.js'
import type { LamportTimestamp } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

export const WIRE_VERSION = 1

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

export interface OpAssignElemPrimitive extends BaseOp {
  mut: {
    kind: 'assign_elem_primitive'
    elementId: string
    value: JsonPrimitive
  }
}

export interface OpAssignElemEmptyMap extends BaseOp {
  mut: { kind: 'assign_elem_empty_map'; elementId: string }
}

export interface OpAssignElemEmptyList extends BaseOp {
  mut: { kind: 'assign_elem_empty_list'; elementId: string }
}

export interface OpAssignElemMapPrimitive extends BaseOp {
  mut: {
    kind: 'assign_elem_map_primitive'
    elementId: string
    path: string[]
    key: string
    value: JsonPrimitive
  }
}

export interface OpInsertElemListPrimitive extends BaseOp {
  mut: {
    kind: 'insert_elem_list_primitive'
    elementId: string
    after: string
    value: JsonPrimitive
  }
}

export interface OpDeleteElemListElement extends BaseOp {
  mut: {
    kind: 'delete_elem_list_element'
    elementId: string
    childElementId: string
  }
}

export interface OpDeleteElemMapKey extends BaseOp {
  mut: {
    kind: 'delete_elem_map_key'
    elementId: string
    path: string[]
    key: string
  }
}

export type Operation =
  | OpAssignPrimitive
  | OpAssignEmptyMap
  | OpAssignEmptyList
  | OpInsertListPrimitive
  | OpDeleteKey
  | OpDeleteListElement
  | OpAssignElemPrimitive
  | OpAssignElemEmptyMap
  | OpAssignElemEmptyList
  | OpAssignElemMapPrimitive
  | OpInsertElemListPrimitive
  | OpDeleteElemListElement
  | OpDeleteElemMapKey

export function assertOpAssignPrimitive(
  op: Operation,
): asserts op is OpAssignPrimitive {
  if (op.mut.kind !== 'assign_primitive')
    throw new Error(`expected assign_primitive, got ${op.mut.kind}`)
}
export function assertOpAssignEmptyMap(
  op: Operation,
): asserts op is OpAssignEmptyMap {
  if (op.mut.kind !== 'assign_empty_map')
    throw new Error(`expected assign_empty_map, got ${op.mut.kind}`)
}
export function assertOpAssignEmptyList(
  op: Operation,
): asserts op is OpAssignEmptyList {
  if (op.mut.kind !== 'assign_empty_list')
    throw new Error(`expected assign_empty_list, got ${op.mut.kind}`)
}
export function assertOpInsertListPrimitive(
  op: Operation,
): asserts op is OpInsertListPrimitive {
  if (op.mut.kind !== 'insert_list_primitive')
    throw new Error(`expected insert_list_primitive, got ${op.mut.kind}`)
}
export function assertOpDeleteKey(op: Operation): asserts op is OpDeleteKey {
  if (op.mut.kind !== 'delete_key')
    throw new Error(`expected delete_key, got ${op.mut.kind}`)
}
export function assertOpDeleteListElement(
  op: Operation,
): asserts op is OpDeleteListElement {
  if (op.mut.kind !== 'delete_list_element')
    throw new Error(`expected delete_list_element, got ${op.mut.kind}`)
}
export function assertOpAssignElemPrimitive(
  op: Operation,
): asserts op is OpAssignElemPrimitive {
  if (op.mut.kind !== 'assign_elem_primitive')
    throw new Error(`expected assign_elem_primitive, got ${op.mut.kind}`)
}
export function assertOpAssignElemEmptyMap(
  op: Operation,
): asserts op is OpAssignElemEmptyMap {
  if (op.mut.kind !== 'assign_elem_empty_map')
    throw new Error(`expected assign_elem_empty_map, got ${op.mut.kind}`)
}
export function assertOpAssignElemEmptyList(
  op: Operation,
): asserts op is OpAssignElemEmptyList {
  if (op.mut.kind !== 'assign_elem_empty_list')
    throw new Error(`expected assign_elem_empty_list, got ${op.mut.kind}`)
}
export function assertOpAssignElemMapPrimitive(
  op: Operation,
): asserts op is OpAssignElemMapPrimitive {
  if (op.mut.kind !== 'assign_elem_map_primitive')
    throw new Error(`expected assign_elem_map_primitive, got ${op.mut.kind}`)
}
export function assertOpInsertElemListPrimitive(
  op: Operation,
): asserts op is OpInsertElemListPrimitive {
  if (op.mut.kind !== 'insert_elem_list_primitive')
    throw new Error(`expected insert_elem_list_primitive, got ${op.mut.kind}`)
}
export function assertOpDeleteElemListElement(
  op: Operation,
): asserts op is OpDeleteElemListElement {
  if (op.mut.kind !== 'delete_elem_list_element')
    throw new Error(`expected delete_elem_list_element, got ${op.mut.kind}`)
}
export function assertOpDeleteElemMapKey(
  op: Operation,
): asserts op is OpDeleteElemMapKey {
  if (op.mut.kind !== 'delete_elem_map_key')
    throw new Error(`expected delete_elem_map_key, got ${op.mut.kind}`)
}

export type WireOperation = {
  version: number
  id: LamportTimestamp
  deps: string[]
  cursor: Cursor
  mut:
    | OpAssignPrimitive['mut']
    | OpAssignEmptyMap['mut']
    | OpAssignEmptyList['mut']
    | OpInsertListPrimitive['mut']
    | OpDeleteKey['mut']
    | OpDeleteListElement['mut']
    | OpAssignElemPrimitive['mut']
    | OpAssignElemEmptyMap['mut']
    | OpAssignElemEmptyList['mut']
    | OpAssignElemMapPrimitive['mut']
    | OpInsertElemListPrimitive['mut']
    | OpDeleteElemListElement['mut']
    | OpDeleteElemMapKey['mut']
}

export function toWire(op: Operation): WireOperation {
  return {
    version: WIRE_VERSION,
    id: op.id,
    deps: [...op.deps],
    cursor: { mapPath: [...op.cursor.mapPath], key: op.cursor.key },
    mut: op.mut as WireOperation['mut'],
  }
}

export function fromWire(w: WireOperation): Operation {
  const base = {
    id: w.id,
    deps: new Set(w.deps),
    cursor: { mapPath: [...w.cursor.mapPath], key: w.cursor.key } as Cursor,
  }
  switch (w.mut.kind) {
    case 'assign_primitive':
      return { ...base, mut: { kind: 'assign_primitive', value: w.mut.value } }
    case 'assign_empty_map':
      return { ...base, mut: { kind: 'assign_empty_map' } }
    case 'assign_empty_list':
      return { ...base, mut: { kind: 'assign_empty_list' } }
    case 'insert_list_primitive':
      return {
        ...base,
        mut: {
          kind: 'insert_list_primitive',
          after: w.mut.after,
          value: w.mut.value,
        },
      }
    case 'delete_key':
      return { ...base, mut: { kind: 'delete_key' } }
    case 'delete_list_element':
      return {
        ...base,
        mut: { kind: 'delete_list_element', elementId: w.mut.elementId },
      }
    case 'assign_elem_primitive':
      return {
        ...base,
        mut: {
          kind: 'assign_elem_primitive',
          elementId: w.mut.elementId,
          value: w.mut.value,
        },
      }
    case 'assign_elem_empty_map':
      return {
        ...base,
        mut: { kind: 'assign_elem_empty_map', elementId: w.mut.elementId },
      }
    case 'assign_elem_empty_list':
      return {
        ...base,
        mut: { kind: 'assign_elem_empty_list', elementId: w.mut.elementId },
      }
    case 'assign_elem_map_primitive':
      return {
        ...base,
        mut: {
          kind: 'assign_elem_map_primitive',
          elementId: w.mut.elementId,
          path: [...w.mut.path],
          key: w.mut.key,
          value: w.mut.value,
        },
      }
    case 'insert_elem_list_primitive':
      return {
        ...base,
        mut: {
          kind: 'insert_elem_list_primitive',
          elementId: w.mut.elementId,
          after: w.mut.after,
          value: w.mut.value,
        },
      }
    case 'delete_elem_list_element':
      return {
        ...base,
        mut: {
          kind: 'delete_elem_list_element',
          elementId: w.mut.elementId,
          childElementId: w.mut.childElementId,
        },
      }
    case 'delete_elem_map_key':
      return {
        ...base,
        mut: {
          kind: 'delete_elem_map_key',
          elementId: w.mut.elementId,
          path: [...w.mut.path],
          key: w.mut.key,
        },
      }
    default: {
      const _exhaustive: never = w.mut
      return { ...base, mut: _exhaustive }
    }
  }
}
