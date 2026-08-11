export type RecordType = 'thought' | 'link' | 'image' | 'file'

export type Attachment = {
  name: string
  mimeType: string
  size: number
  dataUrl?: string
  storagePath?: string
}

export type WebSnapshot = {
  id: string
  title: string
  originalUrl?: string
  capturedAt: string
  archiveFileName: string
  archiveFormat: 'mhtml'
  storagePath?: string
}

export type RecallRecord = {
  id: string
  ownerId?: string
  type: RecordType
  content: string
  title?: string
  source?: string
  attachment?: Attachment
  snapshot?: WebSnapshot
  createdAt: string
  updatedAt?: string
  serverUpdatedAt?: string
  syncState?: 'pending' | 'synced'
  deletedAt?: string
  pinned: boolean
}

export type RecallBackupSnapshot = {
  id: string
  fileName: string
  mimeType: string
  base64: string
}

export type RecallBackup = {
  format: 'xiaodong-suixinlu-backup'
  version: 1
  exportedAt: string
  accountId?: string
  records: RecallRecord[]
  snapshots: RecallBackupSnapshot[]
}

export type StoredSnapshot = {
  id: string
  file: Blob
}
