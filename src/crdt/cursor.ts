export interface Cursor {
  mapPath: string[] // path of nested map keys from root
  key: string // final key at which the mutation applies
}

export function cursorAt(mapPath: string[], key: string): Cursor {
  return { mapPath: [...mapPath], key }
}
