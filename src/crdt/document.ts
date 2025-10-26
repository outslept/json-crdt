import { LamportClock, tsToString, type ReplicaID } from './timestamp.js'
import type { Cursor } from './cursor.js'
import type { JsonPrimitive, Mutation, Operation } from './op.js'

type Node = MapNode | RegNode // todo(outslept): ListNode

interface MapNode {
  kind: 'map'
  entries: Map<string, Node> // namespaced keys: "mapT:K", "regT:K", "listT:K"
  presence: Map<string, Set<string>> // plain key -> set of op ids asserting presence
}

interface RegNode {
  kind: 'reg'
  values: Map<string, JsonPrimitive> // opId -> primitive value
}

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

    switch (op.mut.kind) {
      case 'assign':
        this.applyAssign(op)
        break
      case 'delete':
        throw new Error('todo')
      case 'insert':
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
    const id = this.clock.tick()
    const deps = new Set(this.processed)
    const mut: Mutation = { kind: 'assign', value }
    const op: Operation = { id, deps, cursor, mut }
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
    return out.sort()
  }

  private applyAssign(op: Operation): void {
    const idStr = tsToString(op.id)
    const parent = this.descendMap(op.cursor.mapPath, idStr)
    if (!parent) {
      throw new Error('invalid cursor path for assign')
    }

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
      if (reg.values.has(priorId)) {
        reg.values.delete(priorId)
      }
    }

    reg.values.set(idStr, op.mut.value) // this will be fixed later
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
}
