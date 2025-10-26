import type { JsonPrimitive } from './op.js'

export type Node = MapNode | RegNode | ListNode

/** Map node holds children in namespaced entries and presence metadata. */
export interface MapNode {
  kind: 'map'
  entries: Map<string, Node>
  presence: Map<string, Set<string>>
}

/** Register node stores a multi-value register: opId -> primitive. */
export interface RegNode {
  kind: 'reg'
  values: Map<string, JsonPrimitive>
}

/**
 * List element payload container: an element may concurrently host
 * register, map and list payloads under the same logical element.
 */
export interface ElemContainer {
  reg?: RegNode
  map?: MapNode
  list?: ListNode
}

/**
 * List node represented as a linked list with head/tail sentinels
 * plus per-element presence and element payloads.
 */
export interface ListNode {
  kind: 'list'
  next: Map<string, string>
  presence: Map<string, Set<string>>
  elements: Map<string, ElemContainer>
}

export const LIST_HEAD = '__head__'
export const LIST_TAIL = '__tail__'

/**
 * Build a namespaced entry key for a logical key and type namespace.
 * Example: namespaceKey('mapT', 'users') -> "mapT:users"
 */
export function namespaceKey(
  tag: 'mapT' | 'listT' | 'regT',
  key: string,
): string {
  return `${tag}:${key}`
}
