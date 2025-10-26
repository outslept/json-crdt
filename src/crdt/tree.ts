import {
  LIST_HEAD,
  LIST_TAIL,
  namespaceKey,
  type ElemContainer,
  type ListNode,
  type MapNode,
  type RegNode,
} from './model.js'

/**
 * Descend through (and optionally create) nested map branches from a root.
 * Optionally marks presence for each traversed key under the provided op id.
 */
export function descendMap(
  root: MapNode,
  mapPath: string[],
  presenceForOpId: string | undefined,
  createIfMissing: boolean,
): MapNode | undefined {
  let node: MapNode = root
  for (const key of mapPath) {
    if (presenceForOpId) addPresenceForKey(node, key, presenceForOpId)
    const mapNsKey = namespaceKey('mapT', key)
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

/** Add presence at a map node for a specific logical key under the given op id. */
export function addPresenceForKey(
  mapNode: MapNode,
  plainKey: string,
  opIdStr: string,
): void {
  const existing = mapNode.presence.get(plainKey)
  if (existing) existing.add(opIdStr)
  else mapNode.presence.set(plainKey, new Set([opIdStr]))
}

/**
 * Causally clear everything at a key (register/map/list) inside a map node,
 * subtracting only deps. Preserves concurrent updates.
 */
export function clearKeyCausally(
  parent: MapNode,
  plainKey: string,
  deps: Set<string>,
): void {
  const pres = parent.presence.get(plainKey)
  if (pres) for (const d of deps) pres.delete(d)

  const regKey = namespaceKey('regT', plainKey)
  const reg = parent.entries.get(regKey)
  if (reg && reg.kind === 'reg') clearRegisterCausally(reg, deps)

  const mapKey = namespaceKey('mapT', plainKey)
  const map = parent.entries.get(mapKey)
  if (map && map.kind === 'map') clearMapCausally(map, deps)

  const listKey = namespaceKey('listT', plainKey)
  const list = parent.entries.get(listKey)
  if (list && list.kind === 'list') clearListCausally(list, deps)
}

export function clearRegisterCausally(reg: RegNode, deps: Set<string>): void {
  for (const d of deps) reg.values.delete(d)
}

export function clearMapCausally(map: MapNode, deps: Set<string>): void {
  for (const [plainKey, pres] of map.presence.entries()) {
    for (const d of deps) pres.delete(d)
    clearKeyCausally(map, plainKey, deps)
  }
}

export function clearListCausally(list: ListNode, deps: Set<string>): void {
  let cur = list.next.get(LIST_HEAD)
  while (cur && cur !== LIST_TAIL) {
    const pres = list.presence.get(cur)
    if (pres) for (const d of deps) pres.delete(d)
    const container = list.elements.get(cur)
    if (container) clearElementContainerCausally(container, deps)
    cur = list.next.get(cur)
  }
}

/** Clear element payloads (reg/map/list) by subtracting deps. */
export function clearElementContainerCausally(
  container: ElemContainer,
  deps: Set<string>,
): void {
  if (container.reg) clearRegisterCausally(container.reg, deps)
  if (container.map) clearMapCausally(container.map, deps)
  if (container.list) clearListCausally(container.list, deps)
}

/** Fetch a list node by path+key without creating it. */
export function getListNodeAt(
  root: MapNode,
  mapPath: string[],
  listKey: string,
): ListNode | undefined {
  const parent = descendMap(root, mapPath, undefined, false)
  if (!parent) return undefined
  const list = parent.entries.get(namespaceKey('listT', listKey))
  if (!list || list.kind !== 'list') return undefined
  return list
}

export { LIST_HEAD, LIST_TAIL, namespaceKey }
