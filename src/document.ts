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
} from "./handlers.js";
import {
  LIST_HEAD,
  LIST_TAIL,
  namespaceKey,
  type ElemId,
  type ListNode,
  type MapNode,
} from "./model.js";
import {
  fromWire,
  isOp,
  toWire,
  type JsonPrimitive,
  type Operation,
  type WireOperation,
} from "./op.js";
import {
  cmpTimestampStr,
  LamportClock,
  tsToString,
  type ReplicaID,
  type TimestampStr,
} from "./timestamp.js";
import { descendMap, getListNodeAt } from "./tree.js";
import type { Cursor } from "./cursor.js";

export type StateVector = Record<ReplicaID, number>;

export type Snapshot = {
  version: number;
  replicaId: ReplicaID;
  clock: number;
  processedIds: TimestampStr[];
  stateVector: StateVector;
  ops: WireOperation[];
};

type DebugComposite = {
  reg?: JsonPrimitive[];
  map?: DebugMap;
  list?: DebugList;
};
type DebugMap = Record<string, DebugComposite>;
type DebugList = Array<{ id: ElemId; value: DebugComposite }>;

export class JsonCrdtDocument {
  private readonly replicaId: ReplicaID;
  private readonly clock: LamportClock;
  private readonly processed: Set<TimestampStr>;
  private readonly root: MapNode;

  private readonly pendingById: Map<TimestampStr, Operation> = new Map();
  private draining = false;

  private readonly opLog: WireOperation[] = [];

  constructor(replicaId: ReplicaID, counterStart = 0) {
    this.replicaId = replicaId;
    this.clock = new LamportClock(replicaId, counterStart);
    this.processed = new Set<TimestampStr>();
    this.root = { kind: "map", entries: new Map(), presence: new Map() };
  }

  getReplicaId(): ReplicaID {
    return this.replicaId;
  }

  getClock(): LamportClock {
    return this.clock;
  }

  getProcessedIds(): ReadonlySet<TimestampStr> {
    return this.processed;
  }

  getStateVector(): StateVector {
    const sv: StateVector = {};
    for (const id of this.processed) {
      const { c, p } = (() => {
        const i = id.indexOf(":");
        return { c: Number(id.slice(0, i)), p: id.slice(i + 1) };
      })();
      sv[p] = Math.max(sv[p] ?? 0, c);
    }
    return sv;
  }

  getPendingCount(): number {
    return this.pendingById.size;
  }

  getPendingIds(): TimestampStr[] {
    return Array.from(this.pendingById.keys()).toSorted();
  }

  receiveWire(wire: WireOperation): void {
    const op = fromWire(wire);
    this.apply(op);
  }

  receiveWireBatch(wires: WireOperation[]): void {
    for (const w of wires) this.receiveWire(w);
  }

  exportDeltaSince(peer: StateVector): WireOperation[] {
    const out: WireOperation[] = [];
    for (const w of this.opLog) {
      const max = peer[w.id.p] ?? 0;
      if (w.id.c > max) out.push(w);
    }
    return out;
  }

  toSnapshot(): Snapshot {
    return {
      version: 1,
      replicaId: this.replicaId,
      clock: this.clock.current(),
      processedIds: Array.from(this.processed),
      stateVector: this.getStateVector(),
      ops: this.opLog.slice(),
    };
  }

  static fromSnapshot(snap: Snapshot, myReplicaId?: ReplicaID): JsonCrdtDocument {
    const reuseClock = !myReplicaId || myReplicaId === snap.replicaId;
    const start = reuseClock ? snap.clock : 0;
    const doc = new JsonCrdtDocument(myReplicaId ?? snap.replicaId, start);

    for (const id of snap.processedIds) doc.processed.add(id);
    for (const [p, c] of Object.entries(snap.stateVector)) {
      doc.clock.observe({ c, p });
    }

    doc.receiveWireBatch(snap.ops);
    return doc;
  }

  apply(op: Operation): void {
    const idStr = tsToString(op.id);
    if (this.processed.has(idStr)) return;
    if (this.pendingById.has(idStr)) return;

    for (const dep of op.deps) {
      if (!this.processed.has(dep)) {
        this.pendingById.set(idStr, op);
        return;
      }
    }

    switch (op.mut.kind) {
      case "assign_primitive":
        if (isOp(op, "assign_primitive")) handleAssignPrimitive(this.root, op);
        break;
      case "assign_empty_map":
        if (isOp(op, "assign_empty_map")) handleAssignEmptyMap(this.root, op);
        break;
      case "assign_empty_list":
        if (isOp(op, "assign_empty_list")) handleAssignEmptyList(this.root, op);
        break;
      case "insert_list_primitive":
        if (isOp(op, "insert_list_primitive")) handleInsertListPrimitive(this.root, op);
        break;
      case "delete_key":
        if (isOp(op, "delete_key")) handleDeleteKey(this.root, op);
        break;
      case "delete_list_element":
        if (isOp(op, "delete_list_element")) handleDeleteListElement(this.root, op);
        break;
      case "assign_elem_primitive":
        if (isOp(op, "assign_elem_primitive")) handleAssignElemPrimitive(this.root, op);
        break;
      case "assign_elem_empty_map":
        if (isOp(op, "assign_elem_empty_map")) handleAssignElemEmptyMap(this.root, op);
        break;
      case "assign_elem_empty_list":
        if (isOp(op, "assign_elem_empty_list")) handleAssignElemEmptyList(this.root, op);
        break;
      case "assign_elem_map_primitive":
        if (isOp(op, "assign_elem_map_primitive")) handleAssignElemMapPrimitive(this.root, op);
        break;
      case "insert_elem_list_primitive":
        if (isOp(op, "insert_elem_list_primitive")) handleInsertElemListPrimitive(this.root, op);
        break;
      case "delete_elem_list_element":
        if (isOp(op, "delete_elem_list_element")) handleDeleteElemListElement(this.root, op);
        break;
      case "delete_elem_map_key":
        if (isOp(op, "delete_elem_map_key")) handleDeleteElemMapKey(this.root, op);
        break;
    }

    this.processed.add(idStr);
    this.clock.observe(op.id);
    this.opLog.push(toWire(op));

    if (!this.draining) this.drainPending();
  }

  private drainPending(): void {
    this.draining = true;
    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        const readyIds: TimestampStr[] = [];
        for (const [pid, pop] of this.pendingById) {
          let ready = true;
          for (const dep of pop.deps) {
            if (!this.processed.has(dep)) {
              ready = false;
              break;
            }
          }
          if (ready) readyIds.push(pid);
        }
        if (readyIds.length === 0) break;
        progressed = true;
        for (const pid of readyIds) {
          const pop = this.pendingById.get(pid);
          if (!pop) continue;
          try {
            this.apply(pop);
          } catch (err) {
            console.error("Failed to apply pending op", pid, err);
            this.processed.add(pid);
          } finally {
            this.pendingById.delete(pid);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  applyLocalAssign(cursor: Cursor, value: JsonPrimitive): Operation {
    return this.applyLocalAssignPrimitive(cursor, value);
  }

  applyLocalAssignPrimitive(cursor: Cursor, value: JsonPrimitive): Operation {
    const id = this.clock.tick();
    const deps = this.getMapKeyDeps(cursor.mapPath, cursor.key);
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: "assign_primitive", value },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignEmptyMap(cursor: Cursor): Operation {
    const id = this.clock.tick();
    const deps = this.getMapKeyDeps(cursor.mapPath, cursor.key);
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: "assign_empty_map" },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignEmptyList(cursor: Cursor): Operation {
    const id = this.clock.tick();
    const deps = this.getMapKeyDeps(cursor.mapPath, cursor.key);
    const op: Operation = {
      id,
      deps,
      cursor,
      mut: { kind: "assign_empty_list" },
    };
    this.apply(op);
    return op;
  }

  applyLocalInsertListPrimitiveAtHead(cursorToList: Cursor, value: JsonPrimitive): Operation {
    return this.applyLocalInsertListPrimitiveAfter(cursorToList, LIST_HEAD, value);
  }

  applyLocalInsertListPrimitiveAfter(
    cursorToList: Cursor,
    afterElementId: typeof LIST_HEAD | ElemId,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick();
    const deps = new Set<TimestampStr>();
    if (afterElementId !== LIST_HEAD) deps.add(afterElementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "insert_list_primitive", after: afterElementId, value },
    };
    this.apply(op);
    return op;
  }

  applyLocalDeleteKey(cursor: Cursor): Operation {
    const id = this.clock.tick();
    const deps = this.getMapKeyDeps(cursor.mapPath, cursor.key);
    const op: Operation = { id, deps, cursor, mut: { kind: "delete_key" } };
    this.apply(op);
    return op;
  }

  applyLocalDeleteListElement(cursorToList: Cursor, elementId: ElemId): Operation {
    const id = this.clock.tick();
    const deps = this.getOuterListElemDeps(cursorToList, elementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "delete_list_element", elementId },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignElemPrimitive(
    cursorToList: Cursor,
    elementId: ElemId,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick();
    const deps = this.getOuterListElemDeps(cursorToList, elementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "assign_elem_primitive", elementId, value },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignElemEmptyMap(cursorToList: Cursor, elementId: ElemId): Operation {
    const id = this.clock.tick();
    const deps = this.getOuterListElemDeps(cursorToList, elementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "assign_elem_empty_map", elementId },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignElemEmptyList(cursorToList: Cursor, elementId: ElemId): Operation {
    const id = this.clock.tick();
    const deps = this.getOuterListElemDeps(cursorToList, elementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "assign_elem_empty_list", elementId },
    };
    this.apply(op);
    return op;
  }

  applyLocalAssignElemMapPrimitive(
    cursorToList: Cursor,
    elementId: ElemId,
    path: string[],
    key: string,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick();
    const deps = this.getElemMapKeyDeps(cursorToList, elementId, path, key);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: {
        kind: "assign_elem_map_primitive",
        elementId,
        path: [...path],
        key,
        value,
      },
    };
    this.apply(op);
    return op;
  }

  applyLocalInsertElemListPrimitiveAtHead(
    cursorToList: Cursor,
    elementId: ElemId,
    value: JsonPrimitive,
  ): Operation {
    return this.applyLocalInsertElemListPrimitiveAfter(cursorToList, elementId, LIST_HEAD, value);
  }

  applyLocalInsertElemListPrimitiveAfter(
    cursorToList: Cursor,
    elementId: ElemId,
    afterChildId: typeof LIST_HEAD | ElemId,
    value: JsonPrimitive,
  ): Operation {
    const id = this.clock.tick();
    const deps = new Set<TimestampStr>();
    deps.add(elementId);
    if (afterChildId !== LIST_HEAD) deps.add(afterChildId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: {
        kind: "insert_elem_list_primitive",
        elementId,
        after: afterChildId,
        value,
      },
    };
    this.apply(op);
    return op;
  }

  applyLocalDeleteElemListElement(
    cursorToList: Cursor,
    elementId: ElemId,
    childElementId: ElemId,
  ): Operation {
    const id = this.clock.tick();
    const deps = this.getInnerListElemDeps(cursorToList, elementId, childElementId);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "delete_elem_list_element", elementId, childElementId },
    };
    this.apply(op);
    return op;
  }

  applyLocalDeleteElemMapKey(
    cursorToList: Cursor,
    elementId: ElemId,
    path: string[],
    key: string,
  ): Operation {
    const id = this.clock.tick();
    const deps = this.getElemMapKeyDeps(cursorToList, elementId, path, key);
    const op: Operation = {
      id,
      deps,
      cursor: cursorToList,
      mut: { kind: "delete_elem_map_key", elementId, path: [...path], key },
    };
    this.apply(op);
    return op;
  }

  private getMapKeyDeps(mapPath: string[], key: string): Set<TimestampStr> {
    const parent = descendMap(this.root, mapPath, undefined, false);
    return parent ? new Set(parent.presence.get(key) ?? []) : new Set();
  }

  private getOuterListElemDeps(cursor: Cursor, elementId: ElemId): Set<TimestampStr> {
    const list = getListNodeAt(this.root, cursor.mapPath, cursor.key);
    return list ? new Set(list.presence.get(elementId) ?? []) : new Set();
  }

  private getInnerListElemDeps(
    cursor: Cursor,
    elementId: ElemId,
    childElementId: ElemId,
  ): Set<TimestampStr> {
    const outerList = getListNodeAt(this.root, cursor.mapPath, cursor.key);
    const innerList = outerList?.elements.get(elementId)?.list;
    return innerList ? new Set(innerList.presence.get(childElementId) ?? []) : new Set();
  }

  private getElemMapKeyDeps(
    cursor: Cursor,
    elementId: ElemId,
    path: string[],
    key: string,
  ): Set<TimestampStr> {
    const outerList = getListNodeAt(this.root, cursor.mapPath, cursor.key);
    const mapNode = outerList?.elements.get(elementId)?.map;
    if (!mapNode) return new Set();
    const parent = descendMap(mapNode, path, undefined, false);
    return parent ? new Set(parent.presence.get(key) ?? []) : new Set();
  }

  listElementIdAt(mapPath: string[], listKey: string, index: number): ElemId | undefined {
    const list = getListNodeAt(this.root, mapPath, listKey);
    if (!list || index < 0) return undefined;
    let cur = list.next.get(LIST_HEAD);
    let i = 0;
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur);
      if (pres && pres.size > 0) {
        if (i === index) return cur;
        i++;
      }
      cur = list.next.get(cur);
    }
    return undefined;
  }

  listIndexOfElement(mapPath: string[], listKey: string, elementId: ElemId): number | undefined {
    const list = getListNodeAt(this.root, mapPath, listKey);
    if (!list) return undefined;
    let cur = list.next.get(LIST_HEAD);
    let i = 0;
    while (cur && cur !== LIST_TAIL) {
      const pres = list.presence.get(cur);
      if (pres && pres.size > 0) {
        if (cur === elementId) return i;
        i++;
      }
      cur = list.next.get(cur);
    }
    return undefined;
  }

  compact(gcVector: StateVector): void {
    this.compactMap(this.root, gcVector);
  }

  pruneOpLog(gcVector: StateVector): void {
    let w = 0;
    for (let r = 0; r < this.opLog.length; r++) {
      const op = this.opLog[r];
      if (!op) continue;
      const cap = gcVector[op.id.p] ?? 0;
      if (op.id.c <= cap) continue;
      this.opLog[w++] = op;
    }
    this.opLog.length = w;
  }

  private compactMap(node: MapNode, gc: StateVector): void {
    for (const [k, pres] of node.presence.entries()) {
      for (const id of Array.from(pres)) {
        const ts = (() => {
          const i = id.indexOf(":");
          return { c: Number(id.slice(0, i)), p: id.slice(i + 1) };
        })();
        if ((gc[ts.p] ?? 0) >= ts.c) pres.delete(id);
      }
      this.compactAtKey(node, k, gc);
      const compositeEmpty =
        !node.entries.get(namespaceKey("regT", k)) &&
        !node.entries.get(namespaceKey("mapT", k)) &&
        !node.entries.get(namespaceKey("listT", k));
      if (pres.size === 0 && compositeEmpty) node.presence.delete(k);
    }
  }

  private compactAtKey(parent: MapNode, key: string, gc: StateVector): void {
    const r = parent.entries.get(namespaceKey("regT", key));
    if (r && r.kind === "reg") {
      for (const id of Array.from(r.values.keys())) {
        const ts = (() => {
          const i = id.indexOf(":");
          return { c: Number(id.slice(0, i)), p: id.slice(i + 1) };
        })();
        if ((gc[ts.p] ?? 0) >= ts.c) r.values.delete(id);
      }
      if (r.values.size === 0) parent.entries.delete(namespaceKey("regT", key));
    }
    const m = parent.entries.get(namespaceKey("mapT", key));
    if (m && m.kind === "map") {
      this.compactMap(m, gc);
      if (m.presence.size === 0 && m.entries.size === 0)
        parent.entries.delete(namespaceKey("mapT", key));
    }
    const l = parent.entries.get(namespaceKey("listT", key));
    if (l && l.kind === "list") {
      this.compactList(l, gc);
      if (l.presence.size === 0 && l.elements.size === 0) {
        parent.entries.delete(namespaceKey("listT", key));
      }
    }
  }

  private compactList(list: ListNode, gc: StateVector): void {
    const alive: ElemId[] = [];
    let cur = list.next.get(LIST_HEAD);
    while (cur && cur !== LIST_TAIL) {
      const id = cur;
      const pres = list.presence.get(id) ?? new Set<TimestampStr>();
      for (const pid of Array.from(pres)) {
        const ts = (() => {
          const i = pid.indexOf(":");
          return { c: Number(pid.slice(0, i)), p: pid.slice(i + 1) };
        })();
        if ((gc[ts.p] ?? 0) >= ts.c) pres.delete(pid);
      }
      if (pres.size === 0) list.presence.set(id, pres);

      const container = list.elements.get(id);
      const containerEmpty =
        !container ||
        ((container.reg?.values.size ?? 0) === 0 &&
          (container.map?.entries.size ?? 0) === 0 &&
          (container.map?.presence.size ?? 0) === 0 &&
          (container.list?.elements.size ?? 0) === 0);

      if (pres.size > 0 || !containerEmpty) alive.push(id);
      else list.elements.delete(id);

      cur = list.next.get(id);
    }

    const newNext = new Map<typeof LIST_HEAD | ElemId, typeof LIST_TAIL | ElemId>();
    newNext.set(LIST_HEAD, LIST_TAIL);
    let prev: typeof LIST_HEAD | ElemId = LIST_HEAD;
    for (const id of alive) {
      newNext.set(prev, id);
      prev = id;
    }
    newNext.set(prev, LIST_TAIL);
    list.next = newNext;

    const aliveSet = new Set(alive);
    for (const key of Array.from(list.presence.keys())) {
      if (!aliveSet.has(key)) {
        const pres = list.presence.get(key);
        if (pres && pres.size === 0) list.presence.delete(key);
      }
    }
  }

  debugView(): DebugMap {
    return this.debugMap(this.root);
  }

  private debugMap(node: MapNode): DebugMap {
    const out: Record<string, DebugComposite> = {};
    const keys = Array.from(node.presence.keys())
      .filter((k) => {
        const pres = node.presence.get(k);
        return pres !== undefined && pres.size > 0;
      })
      .toSorted();

    for (const plainKey of keys) {
      const composite: DebugComposite = {};

      const regNode = node.entries.get(namespaceKey("regT", plainKey));
      if (regNode && regNode.kind === "reg") {
        const pairs = Array.from(regNode.values.entries());
        pairs.sort(([a], [b]) => cmpTimestampStr(a, b));
        composite.reg = pairs.map(([, v]) => v);
      }

      const mapNode = node.entries.get(namespaceKey("mapT", plainKey));
      if (mapNode && mapNode.kind === "map") composite.map = this.debugMap(mapNode);

      const listNode = node.entries.get(namespaceKey("listT", plainKey));
      if (listNode && listNode.kind === "list") composite.list = this.debugList(listNode);

      if (Object.keys(composite).length > 0) out[plainKey] = composite;
    }
    return out;
  }

  private debugList(list: ListNode): DebugList {
    const result: Array<{ id: ElemId; value: DebugComposite }> = [];
    let cur = list.next.get(LIST_HEAD);
    while (cur && cur !== LIST_TAIL) {
      const id = cur;
      const pres = list.presence.get(id);
      if (pres && pres.size > 0) {
        const container = list.elements.get(id);
        const composite: DebugComposite = {};
        if (container?.reg) {
          const byId = Array.from(container.reg.values.entries());
          byId.sort(([a], [b]) => cmpTimestampStr(a, b));
          composite.reg = byId.map(([, v]) => v);
        }
        if (container?.map) composite.map = this.debugMap(container.map);
        if (container?.list) composite.list = this.debugList(container.list);
        result.push({ id, value: composite });
      }
      cur = list.next.get(id);
    }
    return result;
  }
}
