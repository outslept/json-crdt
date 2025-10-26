/** Path cursor targeting a nested map path and a terminal key. */
export interface Cursor {
  mapPath: string[]
  key: string
}

/** Create a new cursor from a path and key. */
export function cursorAt(mapPath: string[], key: string): Cursor {
  return { mapPath: [...mapPath], key }
}
