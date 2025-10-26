export interface Cursor {
  mapPath: string[]
  key: string
}

export function cursorAt(mapPath: string[], key: string): Cursor {
  return { mapPath: [...mapPath], key }
}
