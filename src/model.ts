import type { JsonPrimitive } from './op.js'
import type { TimestampStr } from './timestamp.js'

export type Node = MapNode | RegNode | ListNode

export type NsTag = 'mapT' | 'listT' | 'regT'
export type NsKey<T extends NsTag> = `${T}:${string}`
export type NamespacedKey = NsKey<'mapT'> | NsKey<'listT'> | NsKey<'regT'>

export interface MapNode {
  kind: 'map'
  entries: Map<NamespacedKey, Node>
  presence: Map<string, Set<TimestampStr>>
}

export interface RegNode {
  kind: 'reg'
  values: Map<TimestampStr, JsonPrimitive>
}

export interface ElemContainer {
  reg?: RegNode
  map?: MapNode
  list?: ListNode
}

export type ElemId = TimestampStr

export const LIST_HEAD = '__head__'
export const LIST_TAIL = '__tail__'
export type ListHead = typeof LIST_HEAD
export type ListTail = typeof LIST_TAIL

export type ListNextKey = ListHead | ElemId
export type ListNextVal = ListTail | ElemId

export interface ListNode {
  kind: 'list'
  next: Map<ListNextKey, ListNextVal>
  presence: Map<ElemId, Set<TimestampStr>>
  elements: Map<ElemId, ElemContainer>
}

export function namespaceKey<T extends NsTag>(tag: T, key: string): NsKey<T> {
  return `${tag}:${key}`
}
