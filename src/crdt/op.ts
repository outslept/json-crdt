import type { Cursor } from './cursor.js'
import type { ElemId, ListHead } from './model.js'
import type { LamportTimestamp, TimestampStr } from './timestamp.js'

export type JsonPrimitive = string | number | boolean | null

export const WIRE_VERSION = 1

interface BaseOp {
  id: LamportTimestamp
  deps: Set<TimestampStr>
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
  mut: {
    kind: 'insert_list_primitive'
    after: ListHead | ElemId
    value: JsonPrimitive
  }
}

export interface OpDeleteKey extends BaseOp {
  mut: { kind: 'delete_key' }
}

export interface OpDeleteListElement extends BaseOp {
  mut: { kind: 'delete_list_element'; elementId: ElemId }
}

export interface OpAssignElemPrimitive extends BaseOp {
  mut: {
    kind: 'assign_elem_primitive'
    elementId: ElemId
    value: JsonPrimitive
  }
}

export interface OpAssignElemEmptyMap extends BaseOp {
  mut: { kind: 'assign_elem_empty_map'; elementId: ElemId }
}

export interface OpAssignElemEmptyList extends BaseOp {
  mut: { kind: 'assign_elem_empty_list'; elementId: ElemId }
}

export interface OpAssignElemMapPrimitive extends BaseOp {
  mut: {
    kind: 'assign_elem_map_primitive'
    elementId: ElemId
    path: string[]
    key: string
    value: JsonPrimitive
  }
}

export interface OpInsertElemListPrimitive extends BaseOp {
  mut: {
    kind: 'insert_elem_list_primitive'
    elementId: ElemId
    after: ListHead | ElemId
    value: JsonPrimitive
  }
}

export interface OpDeleteElemListElement extends BaseOp {
  mut: {
    kind: 'delete_elem_list_element'
    elementId: ElemId
    childElementId: ElemId
  }
}

export interface OpDeleteElemMapKey extends BaseOp {
  mut: {
    kind: 'delete_elem_map_key'
    elementId: ElemId
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

export type Kind = Operation['mut']['kind']
export type OpOf<K extends Kind> = Extract<Operation, { mut: { kind: K } }>

export type WireOperation = {
  version: number
  id: LamportTimestamp
  deps: TimestampStr[]
  cursor: Cursor
  mut: Operation['mut']
}

export function toWire(op: Operation): WireOperation {
  return {
    version: WIRE_VERSION,
    id: op.id,
    deps: [...op.deps],
    cursor: { mapPath: [...op.cursor.mapPath], key: op.cursor.key },
    mut: op.mut,
  }
}

export function fromWire(w: WireOperation): Operation {
  const base = {
    id: w.id,
    deps: new Set<TimestampStr>(w.deps),
    cursor: { mapPath: [...w.cursor.mapPath], key: w.cursor.key },
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
  }
}

export function isOp<K extends Kind>(op: Operation, kind: K): op is OpOf<K> {
  return op.mut.kind === kind
}
