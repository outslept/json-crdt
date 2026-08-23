import {
  LIST_HEAD,
  LIST_TAIL,
  namespaceKey,
  type ElemContainer,
  type ElemId,
  type ListNode,
  type MapNode,
  type RegNode,
} from "./model.js";
import type { TimestampStr } from "./timestamp.js";

export function descendMap(
  root: MapNode,
  mapPath: string[],
  presenceForOpId: TimestampStr | undefined,
  createIfMissing: boolean,
): MapNode | undefined {
  let node: MapNode = root;
  for (const key of mapPath) {
    if (presenceForOpId) addPresenceForKey(node, key, presenceForOpId);
    const mapNsKey = namespaceKey("mapT", key);
    let next = node.entries.get(mapNsKey);
    if (!next) {
      if (!createIfMissing) return undefined;
      next = { kind: "map", entries: new Map(), presence: new Map() };
      node.entries.set(mapNsKey, next);
    } else if (next.kind !== "map") {
      throw new Error(`type conflict at ${key}: mapT namespace occupied by ${next.kind}`);
    }
    node = next;
  }
  return node;
}

export function addPresenceForKey(mapNode: MapNode, plainKey: string, opIdStr: TimestampStr): void {
  const existing = mapNode.presence.get(plainKey);
  if (existing) existing.add(opIdStr);
  else mapNode.presence.set(plainKey, new Set([opIdStr]));
}

export function clearKeyCausally(parent: MapNode, plainKey: string, deps: Set<TimestampStr>): void {
  const pres = parent.presence.get(plainKey);
  if (pres) for (const d of deps) pres.delete(d);

  const regKey = namespaceKey("regT", plainKey);
  const reg = parent.entries.get(regKey);
  if (reg && reg.kind === "reg") clearRegisterCausally(reg, deps);

  const mapKey = namespaceKey("mapT", plainKey);
  const map = parent.entries.get(mapKey);
  if (map && map.kind === "map") clearMapCausally(map, deps);

  const listKey = namespaceKey("listT", plainKey);
  const list = parent.entries.get(listKey);
  if (list && list.kind === "list") clearListCausally(list, deps);
}

export function clearRegisterCausally(reg: RegNode, deps: Set<TimestampStr>): void {
  for (const d of deps) reg.values.delete(d);
}

export function clearMapCausally(map: MapNode, deps: Set<TimestampStr>): void {
  for (const [plainKey, pres] of map.presence.entries()) {
    for (const d of deps) pres.delete(d);
    clearKeyCausally(map, plainKey, deps);
  }
}

export function* iterateListIds(list: ListNode): IterableIterator<ElemId> {
  let cur = list.next.get(LIST_HEAD);
  while (cur && cur !== LIST_TAIL) {
    const id = cur;
    yield id;
    cur = list.next.get(id);
  }
}

export function clearListCausally(list: ListNode, deps: Set<TimestampStr>): void {
  for (const id of iterateListIds(list)) {
    const pres = list.presence.get(id);
    if (pres) for (const d of deps) pres.delete(d);
    const container = list.elements.get(id);
    if (container) clearElementContainerCausally(container, deps);
  }
}

export function clearElementContainerCausally(
  container: ElemContainer,
  deps: Set<TimestampStr>,
): void {
  if (container.reg) clearRegisterCausally(container.reg, deps);
  if (container.map) clearMapCausally(container.map, deps);
  if (container.list) clearListCausally(container.list, deps);
}

export function getListNodeAt(
  root: MapNode,
  mapPath: string[],
  listKey: string,
): ListNode | undefined {
  const parent = descendMap(root, mapPath, undefined, false);
  if (!parent) return undefined;
  const list = parent.entries.get(namespaceKey("listT", listKey));
  if (!list || list.kind !== "list") return undefined;
  return list;
}

export { LIST_HEAD, LIST_TAIL, namespaceKey };
