import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attachment, RecallRecord, WebSnapshot } from './domain'

type RemoteRecordRow = {
  id: string
  owner_id: string
  type: RecallRecord['type']
  content: string
  title: string | null
  source: string | null
  attachment: Omit<Attachment, 'dataUrl'> | null
  snapshot: WebSnapshot | null
  pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncAdapter {
  pullRecords(accountId: string): Promise<RecallRecord[]>
  pushRecords(accountId: string, records: RecallRecord[]): Promise<RecallRecord[]>
  uploadFile(bucket: 'attachments' | 'snapshots', path: string, file: Blob): Promise<void>
  downloadFile(bucket: 'attachments' | 'snapshots', path: string): Promise<Blob>
  removeFile(bucket: 'attachments' | 'snapshots', path: string): Promise<void>
}

function toRemoteRow(accountId: string, record: RecallRecord) {
  const attachment = record.attachment ? {
    name: record.attachment.name,
    mimeType: record.attachment.mimeType,
    size: record.attachment.size,
    storagePath: record.attachment.storagePath,
  } : null
  return {
    id: record.id,
    owner_id: accountId,
    type: record.type,
    content: record.content,
    title: record.title ?? null,
    source: record.source ?? null,
    attachment,
    snapshot: record.snapshot ?? null,
    pinned: record.pinned,
    created_at: record.createdAt,
    deleted_at: record.deletedAt ?? null,
  }
}

function fromRemoteRow(row: RemoteRecordRow): RecallRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    content: row.content,
    title: row.title ?? undefined,
    source: row.source ?? undefined,
    attachment: row.attachment ?? undefined,
    snapshot: row.snapshot ?? undefined,
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    serverUpdatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    syncState: 'synced',
  }
}

export class SupabaseSyncAdapter implements SyncAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async pullRecords(accountId: string) {
    const { data, error } = await this.client.from('records').select('*').eq('owner_id', accountId).order('updated_at', { ascending: true })
    if (error) throw error
    return (data as RemoteRecordRow[]).map(fromRemoteRow)
  }

  async pushRecords(accountId: string, records: RecallRecord[]) {
    if (!records.length) return []
    const { data, error } = await this.client.from('records').upsert(records.map((record) => toRemoteRow(accountId, record)), { onConflict: 'id' }).select('*')
    if (error) throw error
    return (data as RemoteRecordRow[]).map(fromRemoteRow)
  }

  async uploadFile(bucket: 'attachments' | 'snapshots', path: string, file: Blob) {
    const { error } = await this.client.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' })
    if (error) throw error
  }

  async downloadFile(bucket: 'attachments' | 'snapshots', path: string) {
    const { data, error } = await this.client.storage.from(bucket).download(path)
    if (error) throw error
    return data
  }

  async removeFile(bucket: 'attachments' | 'snapshots', path: string) {
    const { error } = await this.client.storage.from(bucket).remove([path])
    if (error) throw error
  }
}

export function createSyncAdapter(client: SupabaseClient | null) {
  return client ? new SupabaseSyncAdapter(client) : null
}
