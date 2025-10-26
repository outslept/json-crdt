import {
  assertOpAssignEmptyList,
  assertOpAssignEmptyMap,
  assertOpAssignPrimitive,
  assertOpInsertListPrimitive,
  type JsonPrimitive,
  type OpAssignEmptyList,
  type OpAssignEmptyMap,
  type OpAssignPrimitive,
  type Operation,
  type OpInsertListPrimitive,
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
  entries: Map<string, Node> // namespaced keys: "mapT:K", "regT:K", "listT:K"
  presence: Map<string, Set<string>> // plain key -> set of op ids asserting presence
}

interface RegNode {
  kind: 'reg'
  values: Map<string, JsonPrimitive> // opId -> primitive value
}

interface ListNode {
  kind: 'list'
  next: Map<string, string> // elementId -> next elementId; includes HEAD -> ...
  presence: Map<string, Set<string>> // elementId -> set of op ids asserting presence
  elements: Map<string, Node> // elementId -> element payload node (map/reg/list)
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

  apply(op: Operation): void {
    const idStr = tsToString(op.id)
    if (this.processed.has(idStr)) return

    for (const dep of op.deps) {
      if (!this.processed.has(dep)) {
        throw new Error(`unsatisfied dependency ${dep} for op ${idStr}`)
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
      case 'delete':
        throw new Error('todo')
      default: {
        const _exhaustive: never = op.mut
        throw new Error(`unsupported mutation ${_exhaustive as any}`)
      }
    }

    this.processed.add(idStr)
    this.clock.observe(op.id)
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

  readRegisterValues(cursor: Cursor): Set<JsonPrimitive> | undefined {
    const parent = this.descendMap(cursor.mapPath, /*presenceFor=*/ undefined)
    if (!parent) return undefined
    const reg = parent.entries.get(ns('regT', cursor.key))
    if (!reg || reg.kind !== 'reg') return undefined
    return new Set(reg.values.values())
  }

  keysAt(mapPath: string[]): string[] {
    const map = this.descendMap(mapPath, /*presenceFor=*/ undefined)
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
        const payload = list.elements.get(cur)
        if (payload && payload.kind === 'reg') {
          out.push(new Set(payload.values.values()))
        } else {
          out.push(new Set())
        }
      }
      cur = list.next.get(cur)
    }
    return out
  }

  private applyAssignPrimitive(op: OpAssignPrimitive): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(op.cursor.mapPath, idStr)
    if (!parent) {
      throw new Error('invalid cursor path for assign_primitive')
    }

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
      if ((reg as RegNode).values.has(priorId)) {
        ;(reg as RegNode).values.delete(priorId)
      }
    }

    ;(reg as RegNode).values.set(idStr, op.mut.value)
  }

  private applyAssignEmptyMap(op: OpAssignEmptyMap): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(op.cursor.mapPath, idStr)
    if (!parent) {
      throw new Error('invalid cursor path for assign_empty_map')
    }

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
    const parent = this.descendMap(op.cursor.mapPath, idStr)
    if (!parent) {
      throw new Error('invalid cursor path for assign_empty_list')
    }

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
    const parent = this.descendMap(op.cursor.mapPath, idStr)
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
    let next = list.next.get(at)
    if (!next) {
      next = LIST_TAIL
    }
    while (next !== LIST_TAIL && cmpTimestampStr(idStr, next) < 0) {
      at = next
      next = list.next.get(at) ?? LIST_TAIL
    }

    list.next.set(at, idStr)
    list.next.set(idStr, next)

    const pres = list.presence.get(idStr)
    if (pres) pres.add(idStr)
    else list.presence.set(idStr, new Set([idStr]))

    const payload: RegNode = {
      kind: 'reg',
      values: new Map<string, JsonPrimitive>([[idStr, op.mut.value]]),
    }
    list.elements.set(idStr, payload)
  }

  private descendMap(
    mapPath: string[],
    presenceForOpId: string | undefined,
  ): MapNode | undefined {
    let node: MapNode = this.root

    for (const key of mapPath) {
      if (presenceForOpId) {
        this.addPresence(node, key, presenceForOpId)
      }

      const mapNsKey = ns('mapT', key)
      let next = node.entries.get(mapNsKey)
      if (!next) {
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
    if (existing) {
      existing.add(opIdStr)
    } else {
      mapNode.presence.set(plainKey, new Set([opIdStr]))
    }
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
    if (reg && reg.kind === 'reg') {
      this.clearReg(reg, deps)
    }

    const mapKey = ns('mapT', plainKey)
    const map = parent.entries.get(mapKey)
    if (map && map.kind === 'map') {
      this.clearMap(map, deps)
    }

    const listKey = ns('listT', plainKey)
    const list = parent.entries.get(listKey)
    if (list && list.kind === 'list') {
      this.clearList(list, deps)
    }
  }

  private clearReg(reg: RegNode, deps: Set<string>): void {
    for (const d of deps) {
      if (reg.values.has(d)) reg.values.delete(d)
    }
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
      if (pres) {
        for (const d of deps) pres.delete(d)
      }
      const elemNode = list.elements.get(cur)
      if (elemNode) this.clearNode(elemNode, deps)
      cur = list.next.get(cur)
    }
  }

  private clearNode(node: Node, deps: Set<string>): void {
    switch (node.kind) {
      case 'reg':
        this.clearReg(node, deps)
        break
      case 'map':
        this.clearMap(node, deps)
        break
      case 'list':
        this.clearList(node, deps)
        break
    }
  }

  private getListNode(
    mapPath: string[],
    listKey: string,
  ): ListNode | undefined {
    const parent = this.descendMap(mapPath, /*presenceFor=*/ undefined)
    if (!parent) return undefined
    const list = parent.entries.get(ns('listT', listKey))
    if (!list || list.kind !== 'list') return undefined
    return list
  }
}
