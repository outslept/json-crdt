export type ReplicaID = string

export interface LamportTimestamp {
  c: number
  p: ReplicaID
}

export type TimestampStr = `${number}:${ReplicaID}`

export function cmpTimestamp(a: LamportTimestamp, b: LamportTimestamp): number {
  if (a.c < b.c) return -1
  if (a.c > b.c) return 1
  if (a.p < b.p) return -1
  if (a.p > b.p) return 1
  return 0
}

export function tsToString(ts: LamportTimestamp): TimestampStr {
  return `${ts.c}:${ts.p}`
}

export function tsFromString(s: string): LamportTimestamp {
  const i = s.indexOf(':')
  if (i === -1) throw new Error(`invalid Lamport timestamp string: "${s}"`)
  const cPart = s.slice(0, i)
  const pPart = s.slice(i + 1)
  const c = Number(cPart)
  if (!Number.isFinite(c))
    throw new Error(`invalid Lamport counter: "${cPart}"`)
  return { c, p: pPart }
}

export function cmpTimestampStr(a: TimestampStr, b: TimestampStr): number {
  return cmpTimestamp(tsFromString(a), tsFromString(b))
}

export class LamportClock {
  private counter: number
  readonly replicaId: ReplicaID

  constructor(replicaId: ReplicaID, startAt = 0) {
    this.replicaId = replicaId
    this.counter = startAt
  }

  observe(ts: LamportTimestamp): void {
    if (ts.c > this.counter) this.counter = ts.c
  }

  tick(seenExternalCounter?: number): LamportTimestamp {
    if (typeof seenExternalCounter === 'number') {
      this.counter = Math.max(this.counter, seenExternalCounter)
    }
    this.counter += 1
    return { c: this.counter, p: this.replicaId }
  }

  current(): number {
    return this.counter
  }
}
