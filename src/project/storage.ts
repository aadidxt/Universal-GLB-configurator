import Dexie, { type Table } from 'dexie'
import { parseProject, type Project } from './schema'

export interface StoredProject {
  /** Content hash of the GLB — one saved configuration per model. */
  hash: string
  fileName: string
  savedAt: number
  project: Project
}

class ProjectDatabase extends Dexie {
  projects!: Table<StoredProject, string>

  constructor() {
    super('universal-glb-configurator')
    this.version(1).stores({ projects: '&hash, fileName, savedAt' })
  }
}

let database: ProjectDatabase | null = null

function db(): ProjectDatabase {
  if (!database) database = new ProjectDatabase()
  return database
}

/** IndexedDB is unavailable in SSR and in some private modes. */
export function isStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function saveProject(project: Project): Promise<StoredProject | null> {
  if (!isStorageAvailable()) return null

  const record: StoredProject = {
    hash: project.model.hash,
    fileName: project.model.fileName,
    savedAt: project.savedAt,
    project,
  }
  await db().projects.put(record)
  return record
}

/** Loads the configuration saved for a given GLB, validating it on the way out. */
export async function loadProject(hash: string): Promise<Project | null> {
  if (!isStorageAvailable()) return null

  const record = await db().projects.get(hash)
  if (!record) return null

  const result = parseProject(record.project)
  if (!result.ok) {
    // A stale or corrupt record must never block the editor.
    console.warn('Stored project failed validation and was ignored:', result.errors)
    return null
  }
  return result.project
}

export async function listProjects(): Promise<StoredProject[]> {
  if (!isStorageAvailable()) return []
  return db().projects.orderBy('savedAt').reverse().toArray()
}

export async function deleteProject(hash: string): Promise<void> {
  if (!isStorageAvailable()) return
  await db().projects.delete(hash)
}
