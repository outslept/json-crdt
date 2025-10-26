import {
  assertOpAssignElemEmptyList,
  assertOpAssignElemEmptyMap,
  assertOpAssignElemMapPrimitive,
  assertOpAssignElemPrimitive,
  assertOpAssignEmptyList,
  assertOpAssignEmptyMap,
  assertOpAssignPrimitive,
  assertOpDeleteKey,
  assertOpDeleteListElement,
  assertOpInsertListPrimitive,
  fromWire,
  type JsonPrimitive,
  type OpAssignElemEmptyList,
  type OpAssignElemEmptyMap,
  type OpAssignElemMapPrimitive,
  type OpAssignElemPrimitive,
  type OpAssignEmptyList,
  type OpAssignEmptyMap,
  type OpAssignPrimitive,
  type OpDeleteKey,
  type OpDeleteListElement,
  type Operation,
  type OpInsertListPrimitive,
  type WireOperation,
} from './op.js'
import {
  cmpTimestampStr,
  LamportClock,
  tsToString,
  type ReplicaID,
} from './timestamp.js'
import type { Cursor } from './cursor.js'

type Node = MapNode | RegNode | ListNode

interface MapNode {
  kind: 'map'
  entries: Map<string, Node>
  presence: Map<string, Set<string>>
}

interface RegNode {
  kind: 'reg'
  values: Map<string, JsonPrimitive>
}

interface ElemContainer {
  reg?: RegNode
  map?: MapNode
  list?: ListNode
}

interface ListNode {
  kind: 'list'
  next: Map<string, string>
  presence: Map<string, Set<string>>
  elements: Map<string, ElemContainer> // elementId -> typed payload container
}

const LIST_HEAD = '__head__'
const LIST_TAIL = '__tail__'

function ns(tag: 'mapT' | 'listT' | 'regT', key: string): string {
  return `${tag}:${key}`
}

export class JsonCrdtDocument {
  private readonly replicaId: ReplicaID
  private readonly clock: LamportClock
  private readonly processed: Set<string>
  private readonly root: MapNode

  private readonly pendingById: Map<string, Operation> = new Map()
  private draining = false

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

  receiveWire(wire: WireOperation): void {
    const op = fromWire(wire)
    this.apply(op)
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
        this.applyAssignPrimitive(op)
        break
      case 'assign_empty_map':
        assertOpAssignEmptyMap(op)
        this.applyAssignEmptyMap(op)
        break
      case 'assign_empty_list':
        assertOpAssignEmptyList(op)
        this.applyAssignEmptyList(op)
        break
      case 'insert_list_primitive':
        assertOpInsertListPrimitive(op)
        this.applyInsertListPrimitive(op)
        break
      case 'delete_key':
        assertOpDeleteKey(op)
        this.applyDeleteKey(op)
        break
      case 'delete_list_element':
        assertOpDeleteListElement(op)
        this.applyDeleteListElement(op)
        break
      case 'assign_elem_primitive':
        assertOpAssignElemPrimitive(op)
        this.applyAssignElemPrimitive(op)
        break
      case 'assign_elem_empty_map':
        assertOpAssignElemEmptyMap(op)
        this.applyAssignElemEmptyMap(op)
        break
      case 'assign_elem_empty_list':
        assertOpAssignElemEmptyList(op)
        this.applyAssignElemEmptyList(op)
        break
      case 'assign_elem_map_primitive':
        assertOpAssignElemMapPrimitive(op)
        this.applyAssignElemMapPrimitive(op)
        break
      default: {
        const _exhaustive: never = op.mut
        throw new Error(`unsupported mutation ${_exhaustive as any}`)
      }
    }

    this.processed.add(idStr)
    this.clock.observe(op.id)

    // Attempt to drain any now-ready pending ops
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
    if (afterElementId !== LIST_HEAD) {
      deps.add(afterElementId)
    }
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
    deps.add(elementId) // depend on the insert of this element
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

  readRegisterValues(cursor: Cursor): Set<JsonPrimitive> | undefined {
    const parent = this.descendMap(this.root, cursor.mapPath, undefined, false)
    if (!parent) return undefined
    const reg = parent.entries.get(ns('regT', cursor.key))
    if (!reg || reg.kind !== 'reg') return undefined
    return new Set(reg.values.values())
  }

  keysAt(mapPath: string[]): string[] {
    const map = this.descendMap(this.root, mapPath, undefined, false)
    if (!map) return []
    const out: string[] = []
    for (const [plainKey, pres] of map.presence.entries()) {
      if (pres.size > 0) out.push(plainKey)
    }
    return out.toSorted()
  }

  listElementIds(mapPath: string[], listKey: string): string[] {
    const list = this.getListNode(mapPath, listKey)
    if (!list) return []
    const ids: string[] = []
    let cur = list.next.get(LIST_HEAD)
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres && pres.size > 0) {
        ids.push(cur)
      }
      cur = list.next.get(cur)
    }
    return ids
  }

  readListPrimitiveSets(
    mapPath: string[],
    listKey: string,
  ): Array<Set<JsonPrimitive>> {
    const list = this.getListNode(mapPath, listKey)
    if (!list) return []
    const out: Array<Set<JsonPrimitive>> = []
    let cur = list.next.get(LIST_HEAD)
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres && pres.size > 0) {
        const container = list.elements.get(cur)
        if (container && container.reg)
          out.push(new Set(container.reg.values.values()))
        else out.push(new Set())
      }
      cur = list.next.get(cur)
    }
    return out
  }

  private applyAssignPrimitive(op: OpAssignPrimitive): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(this.root, op.cursor.mapPath, idStr, true)
    if (!parent) throw new Error('invalid cursor path for assign_primitive')

    this.clearAtKey(parent, op.cursor.key, op.deps)
    this.addPresence(parent, op.cursor.key, idStr)

    const regKey = ns('regT', op.cursor.key)
    let reg = parent.entries.get(regKey)
    if (!reg) {
      reg = { kind: 'reg', values: new Map<string, JsonPrimitive>() }
      parent.entries.set(regKey, reg)
    } else if (reg.kind !== 'reg') {
      throw new Error(
        `type conflict at key ${op.cursor.key}: regT namespace occupied by ${reg.kind}`,
      )
    }

    for (const priorId of op.deps) {
      if ((reg as RegNode).values.has(priorId))
        (reg as RegNode).values.delete(priorId)
    }
    ;(reg as RegNode).values.set(idStr, op.mut.value)
  }

  private applyAssignEmptyMap(op: OpAssignEmptyMap): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(this.root, op.cursor.mapPath, idStr, true)
    if (!parent) throw new Error('invalid cursor path for assign_empty_map')

    this.clearAtKey(parent, op.cursor.key, op.deps)
    this.addPresence(parent, op.cursor.key, idStr)

    const mapKey = ns('mapT', op.cursor.key)
    let child = parent.entries.get(mapKey)
    if (!child) {
      child = { kind: 'map', entries: new Map(), presence: new Map() }
      parent.entries.set(mapKey, child)
    } else if (child.kind !== 'map') {
      throw new Error(
        `type conflict at key ${op.cursor.key}: mapT namespace occupied by ${child.kind}`,
      )
    }
  }

  private applyAssignEmptyList(op: OpAssignEmptyList): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(this.root, op.cursor.mapPath, idStr, true)
    if (!parent) throw new Error('invalid cursor path for assign_empty_list')

    this.clearAtKey(parent, op.cursor.key, op.deps)
    this.addPresence(parent, op.cursor.key, idStr)

    const listKey = ns('listT', op.cursor.key)
    let child = parent.entries.get(listKey)
    if (!child) {
      const next = new Map<string, string>()
      next.set(LIST_HEAD, LIST_TAIL)
      child = { kind: 'list', next, presence: new Map(), elements: new Map() }
      parent.entries.set(listKey, child)
    } else if (child.kind !== 'list') {
      throw new Error(
        `type conflict at key ${op.cursor.key}: listT namespace occupied by ${child.kind}`,
      )
    }
  }

  private applyInsertListPrimitive(op: OpInsertListPrimitive): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(this.root, op.cursor.mapPath, idStr, true)
    if (!parent)
      throw new Error('invalid cursor path for insert_list_primitive')

    const listKey = ns('listT', op.cursor.key)
    const list = parent.entries.get(listKey)
    if (!list || list.kind !== 'list') {
      throw new Error(
        `list does not exist at key ${op.cursor.key}; assign_empty_list before inserting`,
      )
    }

    const prev = op.mut.after === LIST_HEAD ? LIST_HEAD : op.mut.after
    if (prev !== LIST_HEAD && !list.next.has(prev)) {
      throw new Error(
        `unknown predecessor element ${prev} for list ${op.cursor.key}`,
      )
    }

    let at = prev
    let next = list.next.get(at) ?? LIST_TAIL
    while (next !== LIST_TAIL && cmpTimestampStr(idStr, next) < 0) {
      at = next
      next = list.next.get(at) ?? LIST_TAIL
    }

    list.next.set(at, idStr)
    list.next.set(idStr, next)

    const pres = list.presence.get(idStr)
    if (pres) pres.add(idStr)
    else list.presence.set(idStr, new Set([idStr]))

    const container: ElemContainer = list.elements.get(idStr) ?? {}
    container.reg = {
      kind: 'reg',
      values: new Map<string, JsonPrimitive>([[idStr, op.mut.value]]),
    }
    list.elements.set(idStr, container)
  }

  private applyDeleteKey(op: OpDeleteKey): void {
    const parent = this.descendMap(
      this.root,
      op.cursor.mapPath,
      undefined,
      false,
    )
    if (!parent) return
    this.clearAtKey(parent, op.cursor.key, op.deps)
  }

  private applyDeleteListElement(op: OpDeleteListElement): void {
    const parent = this.descendMap(
      this.root,
      op.cursor.mapPath,
      undefined,
      false,
    )
    if (!parent) return
    const list = parent.entries.get(ns('listT', op.cursor.key))
    if (!list || list.kind !== 'list') return

    const elemId = op.mut.elementId
    const pres = list.presence.get(elemId)
    if (pres) {
      for (const d of op.deps) pres.delete(d)
    }
    const container = list.elements.get(elemId)
    if (container) this.clearElemContainer(container, op.deps)
    if (!list.presence.has(elemId)) list.presence.set(elemId, new Set())
  }

  private applyAssignElemPrimitive(op: OpAssignElemPrimitive): void {
    const idStr = tsToString(op.id)
    const list = this.getListNode(op.cursor.mapPath, op.cursor.key)
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

  private applyAssignElemEmptyMap(op: OpAssignElemEmptyMap): void {
    const idStr = tsToString(op.id)
    const list = this.getListNode(op.cursor.mapPath, op.cursor.key)
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
    this.clearElemContainer(container, op.deps)
    if (!container.map)
      container.map = { kind: 'map', entries: new Map(), presence: new Map() }
    list.elements.set(op.mut.elementId, container)
  }

  private applyAssignElemEmptyList(op: OpAssignElemEmptyList): void {
    const idStr = tsToString(op.id)
    const list = this.getListNode(op.cursor.mapPath, op.cursor.key)
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
      const next = new Map<string, string>()
      next.set(LIST_HEAD, LIST_TAIL)
      container.list = {
        kind: 'list',
        next,
        presence: new Map(),
        elements: new Map(),
      }
    }
    this.clearElemContainer(container, op.deps)
    if (!container.list) {
      const next = new Map<string, string>()
      next.set(LIST_HEAD, LIST_TAIL)
      container.list = {
        kind: 'list',
        next,
        presence: new Map(),
        elements: new Map(),
      }
    }
    list.elements.set(op.mut.elementId, container)
  }

  private applyAssignElemMapPrimitive(op: OpAssignElemMapPrimitive): void {
    const idStr = tsToString(op.id)
    const list = this.getListNode(op.cursor.mapPath, op.cursor.key)
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

    const parent = this.descendMap(container.map, op.mut.path, idStr, true)
    if (!parent) throw new Error('invalid element map path')

    this.clearAtKey(parent, op.mut.key, op.deps)
    this.addPresence(parent, op.mut.key, idStr)

    const regKey = ns('regT', op.mut.key)
    let reg = parent.entries.get(regKey)
    if (!reg) {
      reg = { kind: 'reg', values: new Map<string, JsonPrimitive>() }
      parent.entries.set(regKey, reg)
    } else if (reg.kind !== 'reg') {
      throw new Error(
        `type conflict at element payload key ${op.mut.key}: regT occupied by ${reg.kind}`,
      )
    }
    for (const d of op.deps) (reg as RegNode).values.delete(d)
    ;(reg as RegNode).values.set(idStr, op.mut.value)

    list.elements.set(op.mut.elementId, container)
  }

  /**
   * Descend through or create nested map nodes from a given root.
   * Optionally marks presence per traversed key and can avoid creation.
   */
  private descendMap(
    root: MapNode,
    mapPath: string[],
    presenceForOpId: string | undefined,
    createIfMissing: boolean,
  ): MapNode | undefined {
    let node: MapNode = root
    for (const key of mapPath) {
      if (presenceForOpId) this.addPresence(node, key, presenceForOpId)
      const mapNsKey = ns('mapT', key)
      let next = node.entries.get(mapNsKey)
      if (!next) {
        if (!createIfMissing) return undefined
        next = { kind: 'map', entries: new Map(), presence: new Map() }
        node.entries.set(mapNsKey, next)
      } else if (next.kind !== 'map') {
        throw new Error(
          `type conflict at ${key}: mapT namespace occupied by ${next.kind}`,
        )
      }
      node = next as MapNode
    }
    return node
  }

  private addPresence(
    mapNode: MapNode,
    plainKey: string,
    opIdStr: string,
  ): void {
    const existing = mapNode.presence.get(plainKey)
    if (existing) existing.add(opIdStr)
    else mapNode.presence.set(plainKey, new Set([opIdStr]))
  }

  private clearAtKey(
    parent: MapNode,
    plainKey: string,
    deps: Set<string>,
  ): void {
    const pres = parent.presence.get(plainKey)
    if (pres) {
      for (const d of deps) pres.delete(d)
    }

    const regKey = ns('regT', plainKey)
    const reg = parent.entries.get(regKey)
    if (reg && reg.kind === 'reg') this.clearReg(reg, deps)

    const mapKey = ns('mapT', plainKey)
    const map = parent.entries.get(mapKey)
    if (map && map.kind === 'map') this.clearMap(map, deps)

    const listKey = ns('listT', plainKey)
    const list = parent.entries.get(listKey)
    if (list && list.kind === 'list') this.clearList(list, deps)
  }

  private clearReg(reg: RegNode, deps: Set<string>): void {
    for (const d of deps) reg.values.delete(d)
  }

  private clearMap(map: MapNode, deps: Set<string>): void {
    for (const [plainKey, pres] of map.presence.entries()) {
      for (const d of deps) pres.delete(d)
      this.clearAtKey(map, plainKey, deps)
    }
  }

  private clearList(list: ListNode, deps: Set<string>): void {
    let cur = list.next.get(LIST_HEAD)
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur)
      if (pres) for (const d of deps) pres.delete(d)
      const container = list.elements.get(cur)
      if (container) this.clearElemContainer(container, deps)
      cur = list.next.get(cur)
    }
  }

  private clearElemContainer(
    container: ElemContainer,
    deps: Set<string>,
  ): void {
    if (container.reg) this.clearReg(container.reg, deps)
    if (container.map) this.clearMap(container.map, deps)
    if (container.list) this.clearList(container.list, deps)
  }

  private getListNode(
    mapPath: string[],
    listKey: string,
  ): ListNode | undefined {
    const parent = this.descendMap(this.root, mapPath, undefined, false)
    if (!parent) return undefined
    const list = parent.entries.get(ns('listT', listKey))
    if (!list || list.kind !== 'list') return undefined
    return list
  }

  debugView(): unknown {
    return this.debugMap(this.root)
  }

  getPendingCount(): number {
    return this.pendingById.size
  }

  getPendingIds(): string[] {
    return Array.from(this.pendingById.keys()).toSorted()
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

      // reg projection
      const regNode = node.entries.get(ns('regT', plainKey))
      if (regNode && regNode.kind === 'reg') {
        const vals = Array.from(regNode.values.entries())
        // sort by op id for stable output
        vals.sort(([a], [b]) => cmpTimestampStr(a, b))
        composite.reg = vals.map(([, v]) => v)
      }

      // map projection
      const mapNode = node.entries.get(ns('mapT', plainKey))
      if (mapNode && mapNode.kind === 'map') {
        composite.map = this.debugMap(mapNode)
      }

      // list projection
      const listNode = node.entries.get(ns('listT', plainKey))
      if (listNode && listNode.kind === 'list') {
        composite.list = this.debugList(listNode)
      }

      // Only assign keys that actually have visible content
      if (Object.keys(composite).length > 0) {
        out[plainKey] = composite
      }
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
          const entries = Array.from(container.reg.values.entries())
          const byId = Array.from(container.reg.values.entries()) as Array<
            [string, JsonPrimitive]
          >
          byId.sort(([a], [b]) => cmpTimestampStr(a, b))
          composite.reg = byId.map(([, v]) => v)
        }

        if (container?.map) {
          composite.map = this.debugMap(container.map)
        }

        if (container?.list) {
          composite.list = this.debugList(container.list)
        }

        result.push({ id: cur, value: composite })
      }
      cur = list.next.get(cur)
    }
    return result
  }
}
