import {
  handleAssignElemEmptyList,
  handleAssignElemEmptyMap,
  handleAssignElemMapPrimitive,
  handleAssignElemPrimitive,
  handleAssignEmptyList,
  handleAssignEmptyMap,
  handleAssignPrimitive,
  handleDeleteElemListElement,
  handleDeleteElemMapKey,
  handleDeleteKey,
  handleDeleteListElement,
  handleInsertElemListPrimitive,
  handleInsertListPrimitive,
} from './handlers.js'
import {
  LIST_HEAD,
  LIST_TAIL,
  namespaceKey,
  type ListNode,
  type MapNode,
} from './model.js'
import {
  assertOpAssignElemEmptyList,
  assertOpAssignElemEmptyMap,
  assertOpAssignElemMapPrimitive,
  assertOpAssignElemPrimitive,
  assertOpAssignEmptyList,
  assertOpAssignEmptyMap,
  assertOpAssignPrimitive,
  assertOpDeleteElemListElement,
  assertOpDeleteElemMapKey,
  assertOpDeleteKey,
  assertOpDeleteListElement,
  assertOpInsertElemListPrimitive,
  assertOpInsertListPrimitive,
  fromWire,
  toWire,
  type JsonPrimitive,
  type Operation,
  type WireOperation,
} from './op.js'
import {
  cmpTimestampStr,
  LamportClock,
  tsFromString,
  tsToString,
  type ReplicaID,
} from './timestamp.js'
import { clearElementContainerCausally, getListNodeAt } from './tree.js'
import type { Cursor } from './cursor.js'

export type StateVector = Record<ReplicaID, number>

export type Snapshot = {
  version: number
  replicaId: ReplicaID
  clock: number
  processedIds: string[]
  stateVector: StateVector
  ops: WireOperation[]
}

export class JsonCrdtDocument {
  private readonly replicaId: ReplicaID
  private readonly clock: LamportClock
  private readonly processed: Set<string>
  private readonly root: MapNode

  private readonly pendingById: Map<string, Operation> = new Map()
  private draining = false

  private readonly opLog: WireOperation[] = []

  constructor(replicaId: ReplicaID, counterStart = 0) {
    this.replicaId = replicaId
    this.clock = new LamportClock(replicaId, counterStart)
    this.processed = new Set<string>()
    this.root = { kind: 'map', entries: new Map(), presence: new Map() }
  }

  getReplicaId(): ReplicaID {
    return this.replicaId
  }

  getClock(): LamportClock {
    return this.clock
  }

  getProcessedIds(): ReadonlySet<string> {
    return this.processed
  }

  getStateVector(): StateVector {
    const sv: StateVector = {}
    for (const id of this.processed) {
      const { c, p } = tsFromString(id)
      sv[p] = Math.max(sv[p] ?? 0, c)
    }
    return sv
  }

  getPendingCount(): number {
    return this.pendingById.size
  }

  getPendingIds(): string[] {
    return Array.from(this.pendingById.keys()).toSorted()
  }

  receiveWire(wire: WireOperation): void {
    const op = fromWire(wire)
    this.apply(op)
  }

  receiveWireBatch(wires: WireOperation[]): void {
    for (const w of wires) this.receiveWire(w)
  }

  exportDeltaSince(peer: StateVector): WireOperation[] {
    const out: WireOperation[] = []
    for (const w of this.opLog) {
      const max = peer[w.id.p] ?? 0
      if (w.id.c > max) out.push(w)
    }
    return out
  }

  toSnapshot(): Snapshot {
    return {
      version: 1,
      replicaId: this.replicaId,
      clock: this.clock.current(),
      processedIds: Array.from(this.processed),
      stateVector: this.getStateVector(),
      ops: this.opLog.slice(),
    }
  }
  static fromSnapshot(
    snap: Snapshot,
    myReplicaId?: ReplicaID,
  ): JsonCrdtDocument {
    const doc = new JsonCrdtDocument(myReplicaId ?? snap.replicaId, snap.clock)
    doc.receiveWireBatch(snap.ops)
    return doc
  }

  apply(op: Operation): void {
    const idStr = tsToString(op.id)
    if (this.processed.has(idStr)) return
    if (this.pendingById.has(idStr)) return

    for (const dep of op.deps) {
      if (!this.processed.has(dep)) {
        this.pendingById.set(idStr, op)
        return
      }
    }

    switch (op.mut.kind) {
      case 'assign_primitive':
        assertOpAssignPrimitive(op)
        handleAssignPrimitive(this.root, op)
        break
      case 'assign_empty_map':
        assertOpAssignEmptyMap(op)
        handleAssignEmptyMap(this.root, op)
        break
      case 'assign_empty_list':
        assertOpAssignEmptyList(op)
        handleAssignEmptyList(this.root, op)
        break
      case 'insert_list_primitive':
        assertOpInsertListPrimitive(op)
        handleInsertListPrimitive(this.root, op)
        break
      case 'delete_key':
        assertOpDeleteKey(op)
        handleDeleteKey(this.root, op)
        break
      case 'delete_list_element':
        assertOpDeleteListElement(op)
        handleDeleteListElement(this.root, op)
        break
      case 'assign_elem_primitive':
        assertOpAssignElemPrimitive(op)
        handleAssignElemPrimitive(this.root, op)
        break
      case 'assign_elem_empty_map':
        assertOpAssignElemEmptyMap(op)
        handleAssignElemEmptyMap(this.root, op)
        break
      case 'assign_elem_empty_list':
        assertOpAssignElemEmptyList(op)
        handleAssignElemEmptyList(this.root, op)
        break
      case 'assign_elem_map_primitive':
        assertOpAssignElemMapPrimitive(op)
        handleAssignElemMapPrimitive(this.root, op)
        break
      case 'insert_elem_list_primitive':
        assertOpInsertElemListPrimitive(op)
        handleInsertElemListPrimitive(this.root, op)
        break
      case 'delete_elem_list_element':
        assertOpDeleteElemListElement(op)
        handleDeleteElemListElement(this.root, op)
        break
      case 'delete_elem_map_key':
        assertOpDeleteElemMapKey(op)
        handleDeleteElemMapKey(this.root, op)
        break
      default: {
        const _exhaustive: never = op.mut
        throw new Error(`unsupported mutation ${_exhaustive as any}`)
      }
    }

    this.processed.add(idStr)
    this.clock.observe(op.id)
    this.opLog.push(toWire(op))

    if (!this.draining) this.drainPending()
  }

  private drainPending(): void {
    this.draining = true
    try {
      let progressed = true
      while (progressed) {
        progressed = false
        const readyIds: string[] = []
        for (const [pid, pop] of this.pendingById) {
          let ready = true
          for (const dep of pop.deps) {
            if (!this.processed.has(dep)) {
              ready = false
              break
            }
          }
          if (ready) readyIds.push(pid)
        }
        if (readyIds.length === 0) break
        progressed = true
        for (const pid of readyIds) {
          const pop = this.pendingById.get(pid)
          if (!pop) continue
          this.pendingById.delete(pid)
          this.apply(pop)
        }
      }
    } finally {
      this.draining = false
    }
  }

  applyLocalAssign(cursor: Cursor, value: JsonPrimitive): Operation {
    return this.applyLocalAssignPrimitive(cursor, value)
  }

  applyLocalAssignPrimitive(cursor: Cursor, value: JsonPrimitive): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: 'assign_primitive', value },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignEmptyMap(cursor: Cursor): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: 'assign_empty_map' },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignEmptyList(cursor: Cursor): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: 'assign_empty_list' },
    }
    this.apply(op)
    return op
  }

  applyLocalInsertListPrimitiveAtHead(
    cursorToList: Cursor,
    value: JsonPrimitive,
  ): Operation {
    return this.applyLocalInsertListPrimitiveAfter(
      cursorToList,
      LIST_HEAD,
      value,
    )
  }

  applyLocalInsertListPrimitiveAfter(
    cursorToList: Cursor,
    afterElementId: string,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    if (afterElementId !== LIST_HEAD) deps.add(afterElementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'insert_list_primitive', after: afterElementId, value },
    }
    this.apply(op)
    return op
  }

  applyLocalDeleteKey(cursor: Cursor): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    const op: Operation = { id, deps, cursor, mut: { kind: 'delete_key' } }
    this.apply(op)
    return op
  }

  applyLocalDeleteListElement(
    cursorToList: Cursor,
    elementId: string,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'delete_list_element', elementId },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignElemPrimitive(
    cursorToList: Cursor,
    elementId: string,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'assign_elem_primitive', elementId, value },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignElemEmptyMap(
    cursorToList: Cursor,
    elementId: string,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'assign_elem_empty_map', elementId },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignElemEmptyList(
    cursorToList: Cursor,
    elementId: string,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'assign_elem_empty_list', elementId },
    }
    this.apply(op)
    return op
  }

  applyLocalAssignElemMapPrimitive(
    cursorToList: Cursor,
    elementId: string,
    path: string[],
    key: string,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: {
        kind: 'assign_elem_map_primitive',
        elementId,
        path: [...path],
        key,
        value,
      },
    }
    this.apply(op)
    return op
  }

  applyLocalInsertElemListPrimitiveAtHead(
    cursorToList: Cursor,
    elementId: string,
    value: JsonPrimitive,
  ): Operation {
    return this.applyLocalInsertElemListPrimitiveAfter(
      cursorToList,
      elementId,
      LIST_HEAD,
      value,
    )
  }

  applyLocalInsertElemListPrimitiveAfter(
    cursorToList: Cursor,
    elementId: string,
    afterChildId: string,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    if (afterChildId !== LIST_HEAD) deps.add(afterChildId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: {
        kind: 'insert_elem_list_primitive',
        elementId,
        after: afterChildId,
        value,
      },
    }
    this.apply(op)
    return op
  }

  applyLocalDeleteElemListElement(
    cursorToList: Cursor,
    elementId: string,
    childElementId: string,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    deps.add(childElementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'delete_elem_list_element', elementId, childElementId },
    }
    this.apply(op)
    return op
  }

  applyLocalDeleteElemMapKey(
    cursorToList: Cursor,
    elementId: string,
    path: string[],
    key: string,
  ): Operation {
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    deps.add(elementId)
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: 'delete_elem_map_key', elementId, path: [...path], key },
    }
    this.apply(op)
    return op
  }

  listElementIdAt(
    mapPath: string[],
    listKey: string,
    index: number,
  ): string | undefined {
    const list = getListNodeAt(this.root, mapPath, listKey)
    if (!list || index < 0) return undefined
    let cur = list.next.get(LIST_HEAD)
    let i = 0
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres && pres.size > 0) {
        if (i === index) return cur
        i++
      }
      cur = list.next.get(cur)
    }
    return undefined
  }

  listIndexOfElement(
    mapPath: string[],
    listKey: string,
    elementId: string,
  ): number | undefined {
    const list = getListNodeAt(this.root, mapPath, listKey)
    if (!list) return undefined
    let cur = list.next.get(LIST_HEAD)
    let i = 0
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres && pres.size > 0) {
        if (cur === elementId) return i
        i++
      }
      cur = list.next.get(cur)
    }
    return undefined
  }

  compact(gcVector: StateVector): void {
    this.compactMap(this.root, gcVector)
  }

  pruneOpLog(gcVector: StateVector): void {
    let w = 0
    for (let r = 0; r < this.opLog.length; r++) {
      const op = this.opLog[r]
      const cap = gcVector[op.id.p] ?? 0
      if (op.id.c <= cap) continue
      this.opLog[w++] = op
    }
    this.opLog.length = w
  }

  private compactMap(node: MapNode, gc: StateVector): void {
    for (const [k, pres] of node.presence.entries()) {
      for (const id of Array.from(pres)) {
        const ts = tsFromString(id)
        if ((gc[ts.p] ?? 0) >= ts.c) pres.delete(id)
      }
      this.compactAtKey(node, k, gc)
      const compositeEmpty =
        !node.entries.get(namespaceKey('regT', k)) &&
        !node.entries.get(namespaceKey('mapT', k)) &&
        !node.entries.get(namespaceKey('listT', k))
      if (pres.size === 0 && compositeEmpty) node.presence.delete(k)
    }
  }

  private compactAtKey(parent: MapNode, key: string, gc: StateVector): void {
    const r = parent.entries.get(namespaceKey('regT', key))
    if (r && r.kind === 'reg') {
      for (const id of Array.from(r.values.keys())) {
        const ts = tsFromString(id)
        if ((gc[ts.p] ?? 0) >= ts.c) r.values.delete(id)
      }
      if (r.values.size === 0) parent.entries.delete(namespaceKey('regT', key))
    }
    const m = parent.entries.get(namespaceKey('mapT', key))
    if (m && m.kind === 'map') {
      this.compactMap(m, gc)
      if (m.presence.size === 0 && m.entries.size === 0)
        parent.entries.delete(namespaceKey('mapT', key))
    }
    const l = parent.entries.get(namespaceKey('listT', key))
    if (l && l.kind === 'list') this.compactList(l, gc)
  }

  private compactList(list: ListNode, gc: StateVector): void {
    let cur = list.next.get(LIST_HEAD)
    const alive: string[] = []
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur) ?? new Set<string>()
      for (const id of Array.from(pres)) {
        const ts = tsFromString(id)
        if ((gc[ts.p] ?? 0) >= ts.c) pres.delete(id)
      }
      if (pres.size === 0) list.presence.set(cur, pres)

      const container = list.elements.get(cur)
      if (container) clearElementContainerCausally(container, new Set())

      const containerEmpty =
        !container ||
        ((container.reg?.values.size ?? 0) === 0 &&
          (container.map?.entries.size ?? 0) === 0 &&
          (container.map?.presence.size ?? 0) === 0 &&
          (container.list?.elements.size ?? 0) === 0)

      if (pres.size > 0 || !containerEmpty) alive.push(cur)
      else list.elements.delete(cur)

      cur = list.next.get(cur)
    }

    const newNext = new Map<string, string>()
    newNext.set(LIST_HEAD, LIST_TAIL)
    let prev = LIST_HEAD
    for (const id of alive) {
      newNext.set(prev, id)
      prev = id
    }
    newNext.set(prev, LIST_TAIL)
    list.next = newNext

    for (const key of Array.from(list.presence.keys())) {
      if (key !== LIST_HEAD && key !== LIST_TAIL && !alive.includes(key)) {
        const pres = list.presence.get(key)
        if (pres && pres.size === 0) list.presence.delete(key)
      }
    }
  }

  debugView(): unknown {
    return this.debugMap(this.root)
  }

  private debugMap(node: MapNode): unknown {
    const out: Record<string, unknown> = {}
    const keys = Array.from(node.presence.keys())
      .filter((k) => {
        const pres = node.presence.get(k)
        return pres !== undefined && pres.size > 0
      })
      .toSorted()

    for (const plainKey of keys) {
      const composite: Record<string, unknown> = {}

      const regNode = node.entries.get(namespaceKey('regT', plainKey))
      if (regNode && regNode.kind === 'reg') {
        const pairs = Array.from(regNode.values.entries())
        pairs.sort(([a], [b]) => cmpTimestampStr(a, b))
        composite.reg = pairs.map(([, v]) => v)
      }

      const mapNode = node.entries.get(namespaceKey('mapT', plainKey))
      if (mapNode && mapNode.kind === 'map')
        composite.map = this.debugMap(mapNode)

      const listNode = node.entries.get(namespaceKey('listT', plainKey))
      if (listNode && listNode.kind === 'list')
        composite.list = this.debugList(listNode)

      if (Object.keys(composite).length > 0) out[plainKey] = composite
    }
    return out
  }

  private debugList(list: ListNode): unknown {
    const result: Array<{ id: string; value: Record<string, unknown> }> = []
    let cur = list.next.get(LIST_HEAD)
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres && pres.size > 0) {
        const container = list.elements.get(cur)
        const composite: Record<string, unknown> = {}
        if (container?.reg) {
          const byId = Array.from(container.reg.values.entries())
          byId.sort(([a], [b]) => cmpTimestampStr(a, b))
          composite.reg = byId.map(([, v]) => v)
        }
        if (container?.map) composite.map = this.debugMap(container.map)
        if (container?.list) composite.list = this.debugList(container.list)
        result.push({ id: cur, value: composite })
      }
      cur = list.next.get(cur)
    }
    return result
  }
}
