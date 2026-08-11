import type { RecallRecord, StoredSnapshot } from './domain'

const CURRENT_RECORDS_KEY = 'xiaodong-suixinlu.records.v1'
const LEGACY_RECORDS_KEY = 'recall.records.v1'
const RECORDS_PREFIX = 'xiaodong-suixinlu.records.v2'
const SNAPSHOT_DB_NAME = 'xiaodong-suixinlu.snapshots'
const SNAPSHOT_STORE_NAME = 'archives'

export type DataScope = { kind: 'local' } | { kind: 'account'; accountId: string }

export function scopeName(scope: DataScope) {
  return scope.kind === 'local' ? 'local' : `account:${scope.accountId}`
}

export function recordsStorageKey(scope: DataScope) {
  return `${RECORDS_PREFIX}.${scopeName(scope)}`
}

export function snapshotStorageKey(scope: DataScope, snapshotId: string) {
  return `${scopeName(scope)}:${snapshotId}`
}

function openSnapshotDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB_NAME, 1)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) request.result.createObjectStore(SNAPSHOT_STORE_NAME)
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
}

export class AccountStore {
  private scope: DataScope = { kind: 'local' }

  constructor(private readonly storage: Storage = localStorage) {
    this.migrateLegacyRecords()
  }

  getScope() {
    return this.scope
  }

  setActiveAccount(accountId: string | null) {
    this.scope = accountId ? { kind: 'account', accountId } : { kind: 'local' }
  }

  loadRecords(fallback: RecallRecord[] = []) {
    const stored = this.storage.getItem(recordsStorageKey(this.scope))
    if (!stored) return fallback
    try {
      const records = JSON.parse(stored) as RecallRecord[]
      return records.map((record) => this.normalizeRecord(record))
    } catch {
      return fallback
    }
  }

  saveRecords(records: RecallRecord[]) {
    const normalized = records.map((record) => this.normalizeRecord(record))
    this.storage.setItem(recordsStorageKey(this.scope), JSON.stringify(normalized))
  }

  loadLocalRecords() {
    const currentScope = this.scope
    this.scope = { kind: 'local' }
    const records = this.loadRecords()
    this.scope = currentScope
    return records
  }

  async copyLocalCollectionToAccount(accountId: string) {
    const previousScope = this.scope
    try {
      this.scope = { kind: 'local' }
      const localRecords = this.loadRecords()
      const localSnapshots = await this.listSnapshots()
      this.scope = { kind: 'account', accountId }
      const accountRecords = this.loadRecords()
      const merged = new Map(accountRecords.map((record) => [record.id, record]))
      localRecords.forEach((record) => merged.set(record.id, {
        ...record,
        ownerId: accountId,
        updatedAt: new Date().toISOString(),
        syncState: 'pending',
      }))
      this.saveRecords(Array.from(merged.values()))
      for (const snapshot of localSnapshots) await this.storeSnapshot(snapshot.id, snapshot.file)
      return localRecords.length
    } finally {
      this.scope = previousScope
    }
  }

  async clearLocalCollection() {
    const previousScope = this.scope
    try {
      this.scope = { kind: 'local' }
      this.storage.setItem(recordsStorageKey(this.scope), '[]')
      await this.replaceSnapshots([])
    } finally {
      this.scope = previousScope
    }
  }

  clearAccountRecords(accountId: string) {
    this.storage.removeItem(recordsStorageKey({ kind: 'account', accountId }))
  }

  async storeSnapshot(id: string, file: Blob) {
    const db = await openSnapshotDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      transaction.objectStore(SNAPSHOT_STORE_NAME).put(file, snapshotStorageKey(this.scope, id))
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
    })
    db.close()
  }

  async getSnapshot(id: string) {
    const scoped = await this.getSnapshotByKey(snapshotStorageKey(this.scope, id))
    if (scoped || this.scope.kind !== 'local') return scoped
    return this.getSnapshotByKey(id)
  }

  async removeSnapshot(id: string) {
    const db = await openSnapshotDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      store.delete(snapshotStorageKey(this.scope, id))
      if (this.scope.kind === 'local') store.delete(id)
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
    })
    db.close()
  }

  async listSnapshots(): Promise<StoredSnapshot[]> {
    const db = await openSnapshotDb()
    const result = await new Promise<StoredSnapshot[]>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      const valuesRequest = store.getAll()
      const keysRequest = store.getAllKeys()
      transaction.addEventListener('complete', () => {
        const prefix = `${scopeName(this.scope)}:`
        resolve(keysRequest.result.flatMap((key, index) => {
          const value = valuesRequest.result[index] as Blob
          const stringKey = String(key)
          if (stringKey.startsWith(prefix)) return [{ id: stringKey.slice(prefix.length), file: value }]
          if (this.scope.kind === 'local' && !stringKey.includes(':')) return [{ id: stringKey, file: value }]
          return []
        }))
      })
      transaction.addEventListener('error', () => reject(transaction.error))
    })
    db.close()
    return result
  }

  async replaceSnapshots(snapshots: StoredSnapshot[]) {
    const db = await openSnapshotDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      const keysRequest = store.getAllKeys()
      keysRequest.addEventListener('success', () => {
        const prefix = `${scopeName(this.scope)}:`
        keysRequest.result.forEach((key) => {
          const stringKey = String(key)
          if (stringKey.startsWith(prefix) || (this.scope.kind === 'local' && !stringKey.includes(':'))) store.delete(key)
        })
        snapshots.forEach(({ id, file }) => store.put(file, snapshotStorageKey(this.scope, id)))
      })
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')))
    })
    db.close()
  }

  async clearAccountCache(accountId: string) {
    this.clearAccountRecords(accountId)
    const previous = this.scope
    try {
      this.scope = { kind: 'account', accountId }
      await this.replaceSnapshots([])
    } finally {
      this.scope = previous
    }
  }

  private normalizeRecord(record: RecallRecord): RecallRecord {
    const ownerId = this.scope.kind === 'account' ? this.scope.accountId : undefined
    return { ...record, ownerId, updatedAt: record.updatedAt ?? record.createdAt }
  }

  private migrateLegacyRecords() {
    const localKey = recordsStorageKey({ kind: 'local' })
    if (this.storage.getItem(localKey) !== null) return
    const legacy = this.storage.getItem(CURRENT_RECORDS_KEY) ?? this.storage.getItem(LEGACY_RECORDS_KEY)
    if (legacy !== null) this.storage.setItem(localKey, legacy)
  }

  private async getSnapshotByKey(key: string) {
    const db = await openSnapshotDb()
    const file = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(SNAPSHOT_STORE_NAME, 'readonly').objectStore(SNAPSHOT_STORE_NAME).get(key)
      request.addEventListener('success', () => resolve(request.result as Blob | undefined))
      request.addEventListener('error', () => reject(request.error))
    })
    db.close()
    return file
  }
}
