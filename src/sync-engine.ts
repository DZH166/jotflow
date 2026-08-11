import { AccountStore } from './account-store'
import type { RecallRecord } from './domain'
import type { SyncAdapter } from './sync'

function sanitizeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file'
}

function dataUrlToBlob(value: string) {
  const [header, payload] = value.split(',', 2)
  if (!header || payload === undefined) throw new Error('附件数据格式无效。')
  const mimeType = header.match(/^data:([^;,]+)/i)?.[1] ?? 'application/octet-stream'
  const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(blob)
  })
}

function preserveLocalFileData(remote: RecallRecord, local?: RecallRecord): RecallRecord {
  const localAttachment = local?.attachment
  if (remote.attachment && localAttachment && localAttachment.storagePath === remote.attachment.storagePath) {
    remote.attachment = { ...remote.attachment, dataUrl: localAttachment.dataUrl }
  }
  return remote
}

export type SyncReport = {
  records: RecallRecord[]
  pushed: number
  pulled: number
  downloadedFiles: number
}

export class SyncEngine {
  constructor(private readonly store: AccountStore, private readonly adapter: SyncAdapter) {}

  async synchronize(accountId: string): Promise<SyncReport> {
    let localRecords = this.store.loadRecords()
    const pending = localRecords.filter((record) => record.syncState === 'pending')

    for (const record of pending) await this.prepareFiles(accountId, record)
    this.store.saveRecords(localRecords)

    const pushed = await this.adapter.pushRecords(accountId, pending)
    const localById = new Map(localRecords.map((record) => [record.id, record]))
    pushed.forEach((remote) => localById.set(remote.id, preserveLocalFileData(remote, localById.get(remote.id))))
    localRecords = Array.from(localById.values())

    const remoteRecords = await this.adapter.pullRecords(accountId)
    const merged = new Map(localRecords.map((record) => [record.id, record]))
    remoteRecords.forEach((remote) => merged.set(remote.id, preserveLocalFileData(remote, merged.get(remote.id))))
    localRecords = Array.from(merged.values())

    let downloadedFiles = 0
    for (const record of localRecords) {
      if (record.deletedAt) {
        if (record.snapshot) await this.store.removeSnapshot(record.snapshot.id)
        continue
      }
      if (record.attachment?.storagePath && !record.attachment.dataUrl) {
        const file = await this.adapter.downloadFile('attachments', record.attachment.storagePath)
        record.attachment.dataUrl = await blobToDataUrl(file)
        downloadedFiles += 1
      }
      if (record.snapshot?.storagePath && !await this.store.getSnapshot(record.snapshot.id)) {
        const file = await this.adapter.downloadFile('snapshots', record.snapshot.storagePath)
        await this.store.storeSnapshot(record.snapshot.id, file)
        downloadedFiles += 1
      }
    }
    this.store.saveRecords(localRecords)
    return { records: localRecords, pushed: pending.length, pulled: remoteRecords.length, downloadedFiles }
  }

  private async prepareFiles(accountId: string, record: RecallRecord) {
    if (record.deletedAt) {
      if (record.attachment?.storagePath) await this.adapter.removeFile('attachments', record.attachment.storagePath)
      if (record.snapshot?.storagePath) await this.adapter.removeFile('snapshots', record.snapshot.storagePath)
      return
    }
    if (record.attachment?.dataUrl) {
      const path = record.attachment.storagePath ?? `${accountId}/${record.id}/${sanitizeStorageName(record.attachment.name)}`
      await this.adapter.uploadFile('attachments', path, dataUrlToBlob(record.attachment.dataUrl))
      record.attachment.storagePath = path
    }
    if (record.snapshot) {
      const file = await this.store.getSnapshot(record.snapshot.id)
      if (file) {
        const path = record.snapshot.storagePath ?? `${accountId}/${record.id}/${record.snapshot.id}.mhtml`
        await this.adapter.uploadFile('snapshots', path, file)
        record.snapshot.storagePath = path
      }
    }
  }
}
