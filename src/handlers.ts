import {
  LIST_HEAD,
  LIST_TAIL,
  namespaceKey,
  type ElemContainer,
  type ElemId,
  type ListNextKey,
  type ListNextVal,
  type MapNode,
  type RegNode,
} from './model.js'
import { cmpTimestampStr, tsToString } from './timestamp.js'
import {
  addPresenceForKey,
  clearElementContainerCausally,
  clearKeyCausally,
  descendMap,
  getListNodeAt,
} from './tree.js'
import type {
  OpAssignElemEmptyList,
  OpAssignElemEmptyMap,
  OpAssignElemMapPrimitive,
  OpAssignElemPrimitive,
  OpAssignEmptyList,
  OpAssignEmptyMap,
  OpAssignPrimitive,
  OpDeleteElemListElement,
  OpDeleteElemMapKey,
  OpDeleteKey,
  OpDeleteListElement,
  OpInsertElemListPrimitive,
  OpInsertListPrimitive,
} from './op.js'

function isElemId(x: ListNextVal): x is ElemId {
  return x !== LIST_TAIL
}

export function handleAssignPrimitive(
  root: MapNode,
  op: OpAssignPrimitive,
): void {
  const idStr = tsToString(op.id)
  const parent = descendMap(root, op.cursor.mapPath, idStr, true)
  if (!parent) throw new Error('invalid cursor path for assign_primitive')

  clearKeyCausally(parent, op.cursor.key, op.deps)
  addPresenceForKey(parent, op.cursor.key, idStr)

  const regKey = namespaceKey('regT', op.cursor.key)
  const existing = parent.entries.get(regKey)
  let regNode: RegNode
  if (existing) {
    if (existing.kind !== 'reg') {
      throw new Error(
        `type conflict at key ${op.cursor.key}: regT namespace occupied by ${existing.kind}`,
      )
    }
    regNode = existing
  } else {
    regNode = { kind: 'reg', values: new Map() }
    parent.entries.set(regKey, regNode)
  }

  for (const d of op.deps) regNode.values.delete(d)
  regNode.values.set(idStr, op.mut.value)
}

export function handleAssignEmptyMap(
  root: MapNode,
  op: OpAssignEmptyMap,
): void {
  const idStr = tsToString(op.id)
  const parent = descendMap(root, op.cursor.mapPath, idStr, true)
  if (!parent) throw new Error('invalid cursor path for assign_empty_map')

  clearKeyCausally(parent, op.cursor.key, op.deps)
  addPresenceForKey(parent, op.cursor.key, idStr)

  const mapKey = namespaceKey('mapT', op.cursor.key)
  const existing = parent.entries.get(mapKey)
  if (!existing) {
    parent.entries.set(mapKey, {
      kind: 'map',
      entries: new Map(),
      presence: new Map(),
    })
  } else if (existing.kind !== 'map') {
    throw new Error(
      `type conflict at key ${op.cursor.key}: mapT namespace occupied by ${existing.kind}`,
    )
  }
}

export function handleAssignEmptyList(
  root: MapNode,
  op: OpAssignEmptyList,
): void {
  const idStr = tsToString(op.id)
  const parent = descendMap(root, op.cursor.mapPath, idStr, true)
  if (!parent) throw new Error('invalid cursor path for assign_empty_list')

  clearKeyCausally(parent, op.cursor.key, op.deps)
  addPresenceForKey(parent, op.cursor.key, idStr)

  const listKey = namespaceKey('listT', op.cursor.key)
  const existing = parent.entries.get(listKey)
  if (!existing) {
    const next = new Map<ListNextKey, ListNextVal>()
    next.set(LIST_HEAD, LIST_TAIL)
    parent.entries.set(listKey, {
      kind: 'list',
      next,
      presence: new Map(),
      elements: new Map(),
    })
  } else if (existing.kind !== 'list') {
    throw new Error(
      `type conflict at key ${op.cursor.key}: listT namespace occupied by ${existing.kind}`,
    )
  }
}

export function handleInsertListPrimitive(
  root: MapNode,
  op: OpInsertListPrimitive,
): void {
  const idStr = tsToString(op.id)
  const parent = descendMap(root, op.cursor.mapPath, idStr, true)
  if (!parent) throw new Error('invalid cursor path for insert_list_primitive')

  const listKey = namespaceKey('listT', op.cursor.key)
  const list = parent.entries.get(listKey)
  if (!list || list.kind !== 'list') {
    throw new Error(
      `list does not exist at key ${op.cursor.key}; assign_empty_list before inserting`,
    )
  }

  const prev: ListNextKey = op.mut.after
  if (prev !== LIST_HEAD && !list.next.has(prev)) {
    throw new Error(
      `unknown predecessor element ${prev} for list ${op.cursor.key}`,
    )
  }

  let at: ListNextKey = prev
  let next: ListNextVal = list.next.get(at) ?? LIST_TAIL
  while (isElemId(next) && cmpTimestampStr(idStr, next) < 0) {
    at = next
    next = list.next.get(at) ?? LIST_TAIL
  }

  list.next.set(at, idStr)
  list.next.set(idStr, next)

  const pres = list.presence.get(idStr)
  if (pres) pres.add(idStr)
  else list.presence.set(idStr, new Set([idStr]))

  const container: ElemContainer = list.elements.get(idStr) ?? {}
  container.reg = { kind: 'reg', values: new Map([[idStr, op.mut.value]]) }
  list.elements.set(idStr, container)
}

export function handleDeleteKey(root: MapNode, op: OpDeleteKey): void {
  const parent = descendMap(root, op.cursor.mapPath, undefined, false)
  if (!parent) return
  clearKeyCausally(parent, op.cursor.key, op.deps)
}

export function handleDeleteListElement(
  root: MapNode,
  op: OpDeleteListElement,
): void {
  const parent = descendMap(root, op.cursor.mapPath, undefined, false)
  if (!parent) return
  const list = parent.entries.get(namespaceKey('listT', op.cursor.key))
  if (!list || list.kind !== 'list') return

  const pres = list.presence.get(op.mut.elementId)
  if (pres) for (const d of op.deps) pres.delete(d)
  const container = list.elements.get(op.mut.elementId)
  if (container) clearElementContainerCausally(container, op.deps)
  if (!list.presence.has(op.mut.elementId))
    list.presence.set(op.mut.elementId, new Set())
}

export function handleAssignElemPrimitive(
  root: MapNode,
  op: OpAssignElemPrimitive,
): void {
  const idStr = tsToString(op.id)
  const list = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!list) throw new Error('list does not exist for assign_elem_primitive')
  if (!list.next.has(op.mut.elementId)) {
    throw new Error(
      `unknown element ${op.mut.elementId} at list ${op.cursor.key}`,
    )
  }

  const elPres = list.presence.get(op.mut.elementId)
  if (elPres) elPres.add(idStr)
  else list.presence.set(op.mut.elementId, new Set([idStr]))

  const container: ElemContainer = list.elements.get(op.mut.elementId) ?? {}
  if (!container.reg) container.reg = { kind: 'reg', values: new Map() }
  for (const d of op.deps) container.reg.values.delete(d)
  container.reg.values.set(idStr, op.mut.value)
  list.elements.set(op.mut.elementId, container)
}

export function handleAssignElemEmptyMap(
  root: MapNode,
  op: OpAssignElemEmptyMap,
): void {
  const idStr = tsToString(op.id)
  const list = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!list) throw new Error('list does not exist for assign_elem_empty_map')
  if (!list.next.has(op.mut.elementId)) {
    throw new Error(
      `unknown element ${op.mut.elementId} at list ${op.cursor.key}`,
    )
  }

  const elPres = list.presence.get(op.mut.elementId)
  if (elPres) elPres.add(idStr)
  else list.presence.set(op.mut.elementId, new Set([idStr]))

  const container: ElemContainer = list.elements.get(op.mut.elementId) ?? {}
  if (!container.map)
    container.map = { kind: 'map', entries: new Map(), presence: new Map() }
  clearElementContainerCausally(container, op.deps)
  list.elements.set(op.mut.elementId, container)
}

export function handleAssignElemEmptyList(
  root: MapNode,
  op: OpAssignElemEmptyList,
): void {
  const idStr = tsToString(op.id)
  const list = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!list) throw new Error('list does not exist for assign_elem_empty_list')
  if (!list.next.has(op.mut.elementId)) {
    throw new Error(
      `unknown element ${op.mut.elementId} at list ${op.cursor.key}`,
    )
  }

  const elPres = list.presence.get(op.mut.elementId)
  if (elPres) elPres.add(idStr)
  else list.presence.set(op.mut.elementId, new Set([idStr]))

  const container: ElemContainer = list.elements.get(op.mut.elementId) ?? {}
  if (!container.list) {
    const next = new Map<ListNextKey, ListNextVal>()
    next.set(LIST_HEAD, LIST_TAIL)
    container.list = {
      kind: 'list',
      next,
      presence: new Map(),
      elements: new Map(),
    }
  }
  clearElementContainerCausally(container, op.deps)
  list.elements.set(op.mut.elementId, container)
}

export function handleAssignElemMapPrimitive(
  root: MapNode,
  op: OpAssignElemMapPrimitive,
): void {
  const idStr = tsToString(op.id)
  const list = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!list)
    throw new Error('list does not exist for assign_elem_map_primitive')
  if (!list.next.has(op.mut.elementId)) {
    throw new Error(
      `unknown element ${op.mut.elementId} at list ${op.cursor.key}`,
    )
  }

  const elPres = list.presence.get(op.mut.elementId)
  if (elPres) elPres.add(idStr)
  else list.presence.set(op.mut.elementId, new Set([idStr]))

  const container: ElemContainer = list.elements.get(op.mut.elementId) ?? {}
  if (!container.map)
    container.map = { kind: 'map', entries: new Map(), presence: new Map() }
  const parent = descendMap(container.map, op.mut.path, idStr, true)
  if (!parent) throw new Error('invalid element map path')

  clearKeyCausally(parent, op.mut.key, op.deps)
  addPresenceForKey(parent, op.mut.key, idStr)

  const regKey = namespaceKey('regT', op.mut.key)
  const existing = parent.entries.get(regKey)
  let regNode: RegNode
  if (existing) {
    if (existing.kind !== 'reg') {
      throw new Error(
        `type conflict at element payload key ${op.mut.key}: regT occupied by ${existing.kind}`,
      )
    }
    regNode = existing
  } else {
    regNode = { kind: 'reg', values: new Map() }
    parent.entries.set(regKey, regNode)
  }
  for (const d of op.deps) regNode.values.delete(d)
  regNode.values.set(idStr, op.mut.value)

  list.elements.set(op.mut.elementId, container)
}

export function handleInsertElemListPrimitive(
  root: MapNode,
  op: OpInsertElemListPrimitive,
): void {
  const idStr = tsToString(op.id)
  const outerList = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!outerList)
    throw new Error('list does not exist for insert_elem_list_primitive')
  if (!outerList.next.has(op.mut.elementId)) {
    throw new Error(
      `unknown element ${op.mut.elementId} at list ${op.cursor.key}`,
    )
  }

  const elPres = outerList.presence.get(op.mut.elementId)
  if (elPres) elPres.add(idStr)
  else outerList.presence.set(op.mut.elementId, new Set([idStr]))

  const container: ElemContainer =
    outerList.elements.get(op.mut.elementId) ?? {}
  if (!container.list) {
    const next = new Map<ListNextKey, ListNextVal>()
    next.set(LIST_HEAD, LIST_TAIL)
    container.list = {
      kind: 'list',
      next,
      presence: new Map(),
      elements: new Map(),
    }
  }
  const inner = container.list

  const prev: ListNextKey = op.mut.after
  if (prev !== LIST_HEAD && !inner.next.has(prev))
    throw new Error(`unknown inner predecessor ${prev}`)
  let at: ListNextKey = prev
  let next: ListNextVal = inner.next.get(at) ?? LIST_TAIL
  while (isElemId(next) && cmpTimestampStr(idStr, next) < 0) {
    at = next
    next = inner.next.get(at) ?? LIST_TAIL
  }
  inner.next.set(at, idStr)
  inner.next.set(idStr, next)

  const pres = inner.presence.get(idStr)
  if (pres) pres.add(idStr)
  else inner.presence.set(idStr, new Set([idStr]))

  inner.elements.set(idStr, {
    reg: { kind: 'reg', values: new Map([[idStr, op.mut.value]]) },
  })
  outerList.elements.set(op.mut.elementId, container)
}

export function handleDeleteElemListElement(
  root: MapNode,
  op: OpDeleteElemListElement,
): void {
  const outer = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!outer) return
  if (!outer.next.has(op.mut.elementId)) return
  const container = outer.elements.get(op.mut.elementId)
  if (!container?.list) return

  const inner = container.list
  const pres = inner.presence.get(op.mut.childElementId)
  if (pres) for (const d of op.deps) pres.delete(d)
  const payload = inner.elements.get(op.mut.childElementId)
  if (payload) clearElementContainerCausally(payload, op.deps)
  if (!inner.presence.has(op.mut.childElementId))
    inner.presence.set(op.mut.childElementId, new Set())
}

export function handleDeleteElemMapKey(
  root: MapNode,
  op: OpDeleteElemMapKey,
): void {
  const outerList = getListNodeAt(root, op.cursor.mapPath, op.cursor.key)
  if (!outerList) return
  if (!outerList.next.has(op.mut.elementId)) return
  const container = outerList.elements.get(op.mut.elementId)
  if (!container?.map) return
  const parent = descendMap(container.map, op.mut.path, undefined, false)
  if (!parent) return
  clearKeyCausally(parent, op.mut.key, op.deps)
  outerList.elements.set(op.mut.elementId, container)
}
