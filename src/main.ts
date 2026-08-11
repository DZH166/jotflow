import './style.css'
import PostalMime, { decodeWords } from 'postal-mime'
import { findMhtmlResource, parseMhtmlResources, resourceDataUrl, resourceText, type MhtmlResource } from './mhtml-reader'
import { AccountStore } from './account-store'
import { createAuthConfiguration, type AuthSession } from './auth'
import type { Attachment, RecallBackup, RecallBackupSnapshot, RecallRecord, RecordType } from './domain'
import { createSyncAdapter } from './sync'
import { SyncEngine } from './sync-engine'

const MAX_SNAPSHOT_BYTES = 20_000_000

const starterRecords: RecallRecord[] = [
  {
    id: 'starter-1',
    type: 'thought',
    content: '把所有想法先放进一个安静的入口，整理应该发生在需要的时候。',
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    pinned: true,
  },
  {
    id: 'starter-2',
    type: 'link',
    title: 'The shape of a deep module',
    content: '值得重新读一遍：真正有用的工具应该隐藏复杂度，而不是把选择交给用户。',
    source: 'https://www.cs.unc.edu/~stotts/145/CRC/Modules.pdf',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    pinned: false,
  },
  {
    id: 'starter-3',
    type: 'image',
    content: '周末看到的展览海报，配色可以留作以后做产品状态页的参考。',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    pinned: false,
  },
]

const accountStore = new AccountStore()
const authConfiguration = createAuthConfiguration()
const syncAdapter = createSyncAdapter(authConfiguration.client)
const syncEngine = syncAdapter ? new SyncEngine(accountStore, syncAdapter) : null
let authSession: AuthSession | null = null
let records = accountStore.loadRecords(starterRecords)
let activeFilter: 'all' | RecordType = 'all'
let searchQuery = ''
let selectedType: RecordType = 'thought'
let captureNotice = ''
let appNotice = ''
let editingRecordId: string | undefined
let newestFirst = true
let authMode: 'sign-in' | 'sign-up' = 'sign-in'
let accountNotice = ''
let unsubscribeAuth: (() => void) | undefined
let syncState: 'local' | 'offline' | 'syncing' | 'synced' | 'error' = 'local'
let syncTimer: number | undefined
const snapshotUrls = new Map<string, string>()

function persist() {
  try {
    accountStore.saveRecords(records)
    scheduleSync()
    return true
  } catch {
    return false
  }
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

function base64ToBlob(value: string, mimeType: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function isRecordType(value: unknown): value is RecordType {
  return value === 'thought' || value === 'link' || value === 'image' || value === 'file'
}

function validateBackup(value: unknown): RecallBackup {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式不正确。')
  const candidate = value as Partial<RecallBackup>
  if (candidate.format !== 'xiaodong-suixinlu-backup' || candidate.version !== 1 || !Array.isArray(candidate.records) || !Array.isArray(candidate.snapshots)) {
    throw new Error('这不是可识别的小董随心录备份。')
  }
  if (candidate.accountId !== undefined && (typeof candidate.accountId !== 'string' || !candidate.accountId)) {
    throw new Error('备份中的账号归属无效。')
  }

  const records = candidate.records.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('备份中存在无效记录。')
    const record = raw as RecallRecord
    if (typeof record.id !== 'string' || !record.id || !isRecordType(record.type) || typeof record.content !== 'string' || typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt)) || typeof record.pinned !== 'boolean') {
      throw new Error('备份中存在无效记录。')
    }
    if ((record.title !== undefined && typeof record.title !== 'string') || (record.source !== undefined && typeof record.source !== 'string')) {
      throw new Error('备份中存在无效记录字段。')
    }
    if (record.attachment) {
      const attachment = record.attachment
      if (typeof attachment.name !== 'string' || typeof attachment.mimeType !== 'string' || !Number.isFinite(attachment.size) || attachment.size < 0 || typeof attachment.dataUrl !== 'string' || !attachment.dataUrl.startsWith('data:')) {
        throw new Error('备份中存在无效附件。')
      }
    }
    if (record.snapshot && (typeof record.snapshot.id !== 'string' || !record.snapshot.id || typeof record.snapshot.title !== 'string' || typeof record.snapshot.capturedAt !== 'string' || Number.isNaN(Date.parse(record.snapshot.capturedAt)) || typeof record.snapshot.archiveFileName !== 'string' || record.snapshot.archiveFormat !== 'mhtml' || (record.snapshot.originalUrl !== undefined && typeof record.snapshot.originalUrl !== 'string'))) {
      throw new Error('备份中存在无效网页快照记录。')
    }
    return record
  })

  const ids = new Set<string>()
  records.forEach((record) => {
    if (ids.has(record.id)) throw new Error('备份中存在重复记录。')
    ids.add(record.id)
  })
  const snapshots = candidate.snapshots.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('备份中存在无效网页快照。')
    const snapshot = raw as RecallBackupSnapshot
    if (typeof snapshot.id !== 'string' || !snapshot.id || typeof snapshot.fileName !== 'string' || typeof snapshot.mimeType !== 'string' || typeof snapshot.base64 !== 'string' || !snapshot.base64) {
      throw new Error('备份中存在无效网页快照。')
    }
    try {
      const decodedSize = Math.floor(snapshot.base64.length * 3 / 4)
      if (decodedSize > MAX_SNAPSHOT_BYTES) throw new Error('网页快照超过大小限制。')
      base64ToBlob(snapshot.base64, snapshot.mimeType)
    } catch {
      throw new Error('备份中存在损坏的网页快照。')
    }
    return snapshot
  })
  const snapshotIds = new Set<string>()
  snapshots.forEach((snapshot) => {
    if (snapshotIds.has(snapshot.id)) throw new Error('备份中存在重复网页快照。')
    snapshotIds.add(snapshot.id)
  })
  records.forEach((record) => {
    if (record.snapshot && !snapshotIds.has(record.snapshot.id)) throw new Error(`网页快照“${record.snapshot.title}”的文件缺失。`)
  })
  const referencedSnapshotIds = new Set<string>()
  records.forEach((record) => {
    if (!record.snapshot) return
    if (referencedSnapshotIds.has(record.snapshot.id)) throw new Error('备份中存在重复的网页快照引用。')
    referencedSnapshotIds.add(record.snapshot.id)
  })

  return {
    format: 'xiaodong-suixinlu-backup',
    version: 1,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date().toISOString(),
    accountId: candidate.accountId,
    records,
    snapshots,
  }
}

async function exportBackup() {
  setAppNotice('正在生成备份…')
  try {
    const storedSnapshots = await accountStore.listSnapshots()
    const backupRecords = records.filter((record) => !record.deletedAt)
    const recordSnapshots = new Map(backupRecords.filter((record) => record.snapshot).map((record) => [record.snapshot!.id, record.snapshot!]))
    const snapshots = await Promise.all(storedSnapshots.map(async ({ id, file }) => {
      const metadata = recordSnapshots.get(id)
      return {
        id,
        fileName: metadata?.archiveFileName ?? `snapshot-${id}.mhtml`,
        mimeType: file.type || 'application/x-mimearchive',
        base64: await blobToBase64(file),
      }
    }))
    const backup: RecallBackup = { format: 'xiaodong-suixinlu-backup', version: 1, exportedAt: new Date().toISOString(), accountId: authSession?.userId, records: backupRecords, snapshots }
    const payload = JSON.stringify(backup)
    downloadBlob(new Blob([payload], { type: 'application/json' }), `xiaodong-suixinlu-backup-${new Date().toISOString().slice(0, 10)}.json`)
    setAppNotice(`备份已导出：${backupRecords.length} 条记录，${snapshots.length} 个网页快照。`)
  } catch (error) {
    setAppNotice(error instanceof Error ? `备份失败：${error.message}` : '备份失败，请稍后重试。')
  }
}

async function importBackupFile(file: File) {
  setAppNotice('正在校验备份…')
  try {
    const backup = validateBackup(JSON.parse(await file.text()))
    if (backup.accountId && backup.accountId !== authSession?.userId) throw new Error('这份备份不属于当前账号。')
    if (!window.confirm(`导入备份将替换当前 ${records.length} 条记录，是否继续？`)) {
      setAppNotice('已取消导入。')
      return
    }
    const previousRecords = records
    const previousSnapshots = await accountStore.listSnapshots()
    const nextSnapshots = backup.snapshots.map((snapshot) => ({ id: snapshot.id, file: base64ToBlob(snapshot.base64, snapshot.mimeType) }))
    await accountStore.replaceSnapshots(nextSnapshots)
    try {
      accountStore.saveRecords(backup.records)
    } catch (error) {
      await accountStore.replaceSnapshots(previousSnapshots)
      accountStore.saveRecords(previousRecords)
      throw error
    }
    records = backup.records
    if (authSession) records.forEach(markRecordChanged)
    accountStore.saveRecords(records)
    editingRecordId = undefined
    captureNotice = ''
    setAppNotice(`备份已恢复：${records.length} 条记录，${backup.snapshots.length} 个网页快照。`)
    render()
  } catch (error) {
    setAppNotice(error instanceof Error ? `导入失败：${error.message}` : '导入失败，当前数据未改变。')
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;',
  })[character] ?? character)
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function findExternalUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s]+/i)
  return match ? safeExternalUrl(match[0]) : undefined
}

function formatFileSize(bytes: number) {
  return bytes < 1_000_000 ? `${Math.ceil(bytes / 1_000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

function resolveCssResources(css: string, resources: MhtmlResource[], baseLocation?: string) {
  return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote, reference) => {
    if (/^(data:|#)/i.test(reference)) return match
    const resource = findMhtmlResource(resources, reference, baseLocation)
    return resource ? `url("${resourceDataUrl(resource)}")` : match
  })
}

function restoreSnapshotResources(html: string, resources: MhtmlResource[]) {
  const snapshot = new DOMParser().parseFromString(html, 'text/html')

  snapshot.querySelectorAll('script, iframe, object, embed, form, base, template, meta[http-equiv="refresh"]').forEach((element) => element.remove())
  snapshot.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    element.style.cssText = resolveCssResources(element.style.cssText, resources)
  })
  snapshot.querySelectorAll<HTMLElement>('img[src], source[src], video[poster], audio[src], link[rel~="icon"][href]').forEach((element) => {
    const attribute = element.hasAttribute('poster') ? 'poster' : element.hasAttribute('href') ? 'href' : 'src'
    const reference = element.getAttribute(attribute)
    if (!reference) return
    const resource = findMhtmlResource(resources, reference)
    if (resource) element.setAttribute(attribute, resourceDataUrl(resource))
  })

  const styles: string[] = []
  snapshot.querySelectorAll('link').forEach((link) => {
    if (!link.rel.split(/\s+/).includes('stylesheet')) {
      link.remove()
      return
    }
    const reference = link.getAttribute('href')
    const resource = reference ? findMhtmlResource(resources, reference) : undefined
    if (resource?.mimeType === 'text/css') styles.push(resolveCssResources(resourceText(resource), resources, resource.location))
    link.remove()
  })
  snapshot.querySelectorAll('style').forEach((style) => {
    styles.push(resolveCssResources(style.textContent ?? '', resources))
    style.remove()
  })

  return { body: snapshot.body.innerHTML, styles }
}

function buildReaderDocument(html: string, resources: MhtmlResource[]) {
  const { body, styles } = restoreSnapshotResources(html, resources)
  const safeStyles = styles.join('\n').replace(/<\/style/gi, '<\\/style')

  return `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;" />
        <style>
          html { color-scheme: light; }
          body { max-width: 900px; margin: 0 auto; padding: 32px; color: #1f211f; background: #fffdf8; font: 16px/1.75 Arial, 'Microsoft YaHei', sans-serif; }
          img, video { max-width: 100%; height: auto; }
          pre { overflow: auto; padding: 14px; background: #f1eee6; }
          a { color: #8f3d2c; }
          ${safeStyles}
        </style>
      </head>
      <body>${body}</body>
    </html>`
}

async function openSnapshotReader(id: string, fallbackTitle: string) {
  const dialog = document.querySelector<HTMLDialogElement>('#snapshot-reader')
  const frame = document.querySelector<HTMLIFrameElement>('#snapshot-frame')
  const title = document.querySelector<HTMLElement>('#snapshot-reader-title')
  const status = document.querySelector<HTMLElement>('#snapshot-reader-status')
  if (!dialog || !frame || !title || !status) return

  title.textContent = fallbackTitle
  status.textContent = '正在读取离线快照…'
  frame.srcdoc = ''
  dialog.showModal()

  try {
    const archive = await accountStore.getSnapshot(id)
    if (!archive) throw new Error('快照文件不可用。')
    const [parsed, resources] = await Promise.all([
      PostalMime.parse(archive, { attachmentEncoding: 'base64', maxNestingDepth: 16, maxHeadersSize: 256_000 }),
      parseMhtmlResources(archive),
    ])
    const content = parsed.html || `<pre>${escapeHtml(parsed.text || '此归档没有可显示的正文。')}</pre>`
    title.textContent = parsed.subject || fallbackTitle
    frame.srcdoc = buildReaderDocument(content, resources)
    status.textContent = ''
  } catch {
    status.textContent = '无法解析这份离线快照。它仍保留在本地，但需要使用浏览器打开。'
  }
}

async function readMhtmlMetadata(file: File) {
  const headerText = await file.slice(0, 64_000).text()
  const topLevelHeaders = headerText.split(/\r?\n\r?\n/, 1)[0]
  const rawSubject = topLevelHeaders.match(/^Subject:\s*(.+)$/im)?.[1]?.trim()
  const subject = rawSubject ? decodeWords(rawSubject) : undefined
  const originalUrl = headerText.match(/^Content-Location:\s*(https?:\/\/\S+)$/im)?.[1]

  return {
    title: subject || file.name.replace(/\.(mhtml|mht)$/i, ''),
    originalUrl: originalUrl ? safeExternalUrl(originalUrl) : undefined,
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function recordLabel(type: RecordType) {
  return { thought: '随想', link: '链接', image: '图片', file: '资料' }[type]
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('zh-CN').replace(/[\u200b\uFEFF]/g, '').replace(/[，。！？、；：、“”‘’（）【】《》〈〉,.!?;:'"()[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim()
}

function searchableText(record: RecallRecord) {
  const fields = [record.content, record.title, record.source, record.attachment?.name, recordLabel(record.type)]
  if (record.snapshot) fields.push(record.snapshot.title, record.snapshot.originalUrl, record.snapshot.archiveFileName)
  return normalizeSearch(fields.filter(Boolean).join(' '))
}

function searchScore(record: RecallRecord) {
  const query = normalizeSearch(searchQuery)
  if (!query) return 0
  const searchable = searchableText(record)
  const compactQuery = query.replace(/\s/g, '')
  const compactSearchable = searchable.replace(/\s/g, '')
  const terms = query.split(' ').filter(Boolean)
  let score = 0
  if (compactQuery && compactSearchable.includes(compactQuery)) score += 100
  terms.forEach((term) => {
    if (searchable.includes(term)) score += Math.min(24, term.length * 3)
  })
  return score
}

function matches(record: RecallRecord) {
  if (activeFilter !== 'all' && record.type !== activeFilter) return false
  if (!normalizeSearch(searchQuery)) return true
  const query = normalizeSearch(searchQuery)
  const searchable = searchableText(record)
  const terms = query.split(' ').filter(Boolean)
  const allTermsMatch = terms.every((term) => searchable.includes(term))
  const compactQuery = query.replace(/\s/g, '')
  return allTermsMatch || (compactQuery.length > 1 && searchable.replace(/\s/g, '').includes(compactQuery))
}

function visibleRecords() {
  return records.filter((record) => !record.deletedAt).filter(matches).sort((a, b) => {
    const pinnedOrder = Number(b.pinned) - Number(a.pinned)
    if (pinnedOrder) return pinnedOrder
    if (normalizeSearch(searchQuery)) {
      const relevanceOrder = searchScore(b) - searchScore(a)
      if (relevanceOrder) return relevanceOrder
    }
    const dateOrder = +new Date(b.createdAt) - +new Date(a.createdAt)
    return newestFirst ? dateOrder : -dateOrder
  })
}

function setAppNotice(message: string) {
  appNotice = message
  const target = document.querySelector<HTMLElement>('#app-status')
  if (target) target.textContent = message
}

function setAccountNotice(message: string) {
  accountNotice = message
  const target = document.querySelector<HTMLElement>('#account-notice')
  if (target) target.textContent = message
}

function authStateLabel() {
  if (!authSession) return '本地暂存'
  if (!authSession.emailVerified) return '等待邮箱验证'
  return { local: '账号已登录', offline: '离线保存', syncing: '正在同步', synced: '已同步', error: '同步待重试' }[syncState]
}

function markRecordChanged(record: RecallRecord) {
  record.updatedAt = new Date().toISOString()
  if (authSession) {
    record.ownerId = authSession.userId
    record.syncState = 'pending'
  }
}

function scheduleSync(delay = 350) {
  if (!authSession?.emailVerified || !syncEngine) return
  if (syncTimer !== undefined) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => void runSync(), delay)
}

async function runSync() {
  const session = authSession
  if (!session?.emailVerified || !syncEngine) return
  if (!navigator.onLine) {
    syncState = 'offline'
    render()
    return
  }
  syncState = 'syncing'
  render()
  try {
    const report = await syncEngine.synchronize(session.userId)
    if (authSession?.userId !== session.userId) return
    records = report.records
    syncState = 'synced'
    appNotice = report.pushed || report.downloadedFiles ? `同步完成：上传 ${report.pushed} 条变更，下载 ${report.downloadedFiles} 个文件。` : ''
    render()
  } catch (error) {
    if (authSession?.userId !== session.userId) return
    syncState = navigator.onLine ? 'error' : 'offline'
    appNotice = error instanceof Error ? `同步失败：${error.message}` : '同步失败，稍后会自动重试。'
    render()
  }
}

function renderAccountDialog() {
  const configured = authConfiguration.configured
  const localRecordCount = authSession ? accountStore.loadLocalRecords().filter((record) => !record.deletedAt).length : 0
  const content = authSession ? `
    <div class="account-profile">
      <div class="account-profile-mark">${escapeHtml(authSession.email.slice(0, 1).toUpperCase())}</div>
      <div><strong>${escapeHtml(authSession.email)}</strong><span>${authSession.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}</span></div>
    </div>
    ${localRecordCount ? `<div class="local-migration"><div><strong>${localRecordCount} 条本地暂存</strong><span>迁移成功后会从本机暂存中清理。</span></div><button class="topbar-action" id="migrate-local-records" type="button" ${!authSession.emailVerified || !syncEngine ? 'disabled' : ''}>迁移到账号</button></div>` : ''}
    <div class="account-actions">
      <button class="topbar-action" id="sign-out-current" type="button">退出当前设备</button>
      <button class="topbar-action danger-action" id="sign-out-all" type="button">退出所有设备</button>
    </div>
  ` : configured ? `
    <div class="auth-mode" role="tablist" aria-label="账号操作">
      <button type="button" role="tab" aria-selected="${authMode === 'sign-in'}" data-auth-mode="sign-in">登录</button>
      <button type="button" role="tab" aria-selected="${authMode === 'sign-up'}" data-auth-mode="sign-up">注册</button>
    </div>
    <form class="auth-form" id="auth-form">
      <label class="editor-field">邮箱<input id="auth-email" type="email" autocomplete="email" required /></label>
      <label class="editor-field">密码<input id="auth-password" type="password" autocomplete="${authMode === 'sign-in' ? 'current-password' : 'new-password'}" minlength="8" required /></label>
      <button class="save-button" type="submit">${authMode === 'sign-in' ? '登录账号' : '创建账号'}</button>
      ${authMode === 'sign-in' ? '<button class="text-action" id="reset-password" type="button">忘记密码</button>' : ''}
    </form>
  ` : `
    <div class="account-unavailable">
      <strong>账号服务尚未连接</strong>
      <span>当前内容继续保存在本机。</span>
    </div>
  `

  return `<dialog class="account-dialog" id="account-dialog" aria-labelledby="account-dialog-title">
    <header class="record-editor-header">
      <div><p class="eyebrow">ACCOUNT</p><h2 id="account-dialog-title">${authSession ? '账号管理' : '登录小董随心录'}</h2></div>
      <button class="reader-close" id="close-account-dialog" type="button" aria-label="关闭账号窗口">x</button>
    </header>
    <div class="account-dialog-content">${content}<p class="editor-notice" id="account-notice" role="status">${escapeHtml(accountNotice)}</p></div>
  </dialog>`
}

function render() {
  snapshotUrls.forEach((url) => URL.revokeObjectURL(url))
  snapshotUrls.clear()
  const liveRecords = records.filter((record) => !record.deletedAt)
  const visible = visibleRecords()
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark">R</div>
          <div>
            <div class="brand-name">小董随心录</div>
            <div class="brand-subtitle">个人记忆收件箱</div>
          </div>
        </div>
        <div class="sync-state"><span class="sync-dot"></span>${authStateLabel()}</div>
        <div class="data-actions">
          <span class="app-status" id="app-status" role="status">${escapeHtml(appNotice)}</span>
          <button class="topbar-action" id="export-backup" type="button">导出备份</button>
          <button class="topbar-action" id="import-backup" type="button">导入备份</button>
          <input class="attachment-input" id="backup-input" type="file" accept="application/json,.json" />
        </div>
        <button class="avatar" id="open-account-dialog" aria-label="账号设置">${authSession ? escapeHtml(authSession.email.slice(0, 1).toUpperCase()) : '登'}</button>
      </header>

      <main class="workspace">
        <aside class="sidebar">
          <button class="capture-button" id="focus-capture"><span class="capture-plus">+</span>快速记录</button>
          <nav class="nav-list" aria-label="记录筛选">
            ${filterButton('all', '全部记录', liveRecords.length)}
            ${filterButton('thought', '随想', liveRecords.filter((record) => record.type === 'thought').length)}
            ${filterButton('link', '链接', liveRecords.filter((record) => record.type === 'link').length)}
            ${filterButton('image', '图片', liveRecords.filter((record) => record.type === 'image').length)}
            ${filterButton('file', '资料', liveRecords.filter((record) => record.type === 'file').length)}
          </nav>
          <div class="sidebar-footnote">
            <span class="footnote-symbol">⌘</span>
            <span>你的内容只属于你</span>
          </div>
        </aside>

        <section class="content-column">
          <div class="content-heading">
            <div>
              <p class="eyebrow">INBOX</p>
              <h1>先记下来，之后再想。</h1>
        <p class="heading-copy">不需要标题、分类或完美的表达。留下它，就已经完成了最重要的一步。</p>
            </div>
            <div class="record-count"><strong>${visible.length}</strong><span>${searchQuery.trim() ? '条匹配' : '条记录'}</span></div>
          </div>

          <form class="composer" id="composer">
            <textarea id="capture-input" aria-label="记录内容" placeholder="现在脑中有什么？粘贴链接、写下一句话，或留个线索……"></textarea>
            <input class="attachment-input" id="attachment-input" type="file" />
            <div class="composer-footer">
              <div class="composer-tools">
                <button type="button" class="tool-button" data-type="link" title="保存一个链接">链接</button>
                <button type="button" class="tool-button" data-type="image" title="添加一张图片">图片</button>
                <button type="button" class="tool-button" data-type="file" title="添加一份资料">资料</button>
                <button type="button" class="tool-button" id="import-snapshot" title="导入离线网页快照">导入快照</button>
              </div>
              <button class="save-button" type="submit">保存记录 <span>Ctrl ↵</span></button>
            </div>
            ${captureNotice ? `<p class="capture-notice" role="status">${escapeHtml(captureNotice)}</p>` : ''}
            <input class="attachment-input" id="snapshot-input" type="file" accept=".mhtml,.mht,.txt,application/x-mimearchive" />
          </form>

          <div class="search-row">
            <label class="search-box"><span class="search-icon">/</span><input id="search-input" value="${escapeHtml(searchQuery)}" placeholder="搜索你记得的线索……" autocomplete="off" /><kbd>⌘ K</kbd></label>
            <button class="sort-button" id="sort-button" title="切换记录排序">${newestFirst ? '最近保存' : '最早保存'} <span>⌄</span></button>
          </div>

          <div class="timeline" id="timeline">
            ${visible.length ? visible.map(renderRecord).join('') : emptyState()}
          </div>
        </section>
      </main>
      <dialog class="snapshot-reader" id="snapshot-reader" aria-labelledby="snapshot-reader-title">
        <header class="snapshot-reader-header">
          <div><p class="eyebrow">OFFLINE SNAPSHOT</p><h2 id="snapshot-reader-title">离线快照</h2></div>
          <button class="reader-close" id="close-snapshot-reader" type="button" aria-label="关闭阅读器">x</button>
        </header>
        <p class="reader-status" id="snapshot-reader-status" role="status"></p>
        <iframe id="snapshot-frame" title="离线网页快照" sandbox="" referrerpolicy="no-referrer"></iframe>
      </dialog>
      <dialog class="record-editor" id="record-editor" aria-labelledby="record-editor-title">
        <form id="record-editor-form">
          <header class="record-editor-header">
            <div><p class="eyebrow">EDIT RECORD</p><h2 id="record-editor-title">编辑记录</h2></div>
            <button class="reader-close" id="close-record-editor" type="button" aria-label="关闭编辑器">x</button>
          </header>
          <div class="record-editor-content">
            <p class="editor-kind" id="edit-record-kind"></p>
            <label class="editor-field">标题<input id="edit-title" type="text" maxlength="160" autocomplete="off" /></label>
            <label class="editor-field">内容<textarea id="edit-content" required></textarea></label>
            <label class="editor-field">来源网址<input id="edit-source" type="url" placeholder="https://" autocomplete="url" /></label>
            <div class="editor-attachment" id="edit-attachment-area">
              <span id="edit-attachment-name"></span>
              <div class="editor-attachment-actions">
                <button type="button" class="topbar-action" id="choose-edit-attachment">替换附件</button>
                <label class="remove-attachment-label"><input id="edit-remove-attachment" type="checkbox" />移除附件</label>
              </div>
              <input class="attachment-input" id="edit-attachment-input" type="file" />
            </div>
            <p class="editor-notice" id="editor-notice" role="status"></p>
          </div>
          <footer class="record-editor-footer">
            <button type="button" class="topbar-action" id="cancel-record-editor">取消</button>
            <button class="save-button" type="submit">保存修改</button>
          </footer>
        </form>
      </dialog>
      ${renderAccountDialog()}
    </div>
  `
  bindEvents()
  void hydrateSnapshotButtons()
}

function filterButton(filter: 'all' | RecordType, label: string, count: number) {
  return `<button class="nav-item ${activeFilter === filter ? 'active' : ''}" data-filter="${filter}"><span>${label}</span><strong>${count}</strong></button>`
}

function renderRecord(record: RecallRecord) {
  const safeSource = record.source ? safeExternalUrl(record.source) : undefined
  const source = safeSource ? `<a class="record-source" href="${escapeHtml(safeSource)}" target="_blank" rel="noreferrer">${escapeHtml(safeSource)}</a>` : ''
  const attachment = record.attachment ? renderAttachment(record.attachment, record.type, record.id) : ''
  const snapshot = record.snapshot ? `<button class="record-attachment snapshot-link" data-snapshot-id="${record.snapshot.id}" type="button"><span>阅读快照</span><strong>${escapeHtml(record.snapshot.title)}</strong><em>${escapeHtml(record.snapshot.archiveFileName)}</em></button>` : ''
  const snapshotSource = record.snapshot?.originalUrl ? `<span class="snapshot-source">${escapeHtml(record.snapshot.originalUrl)}</span>` : ''
  return `<article class="record ${record.pinned ? 'pinned' : ''}">
      <div class="record-rail"><span class="record-dot type-${record.type}"></span><span class="record-line"></span></div>
      <div class="record-body">
        <div class="record-meta"><span class="record-type">${recordLabel(record.type)}</span><time>${formatDate(record.createdAt)}</time><button class="record-action" data-edit="${record.id}" aria-label="编辑记录">编辑</button><button class="record-action ${record.pinned ? 'is-pinned' : ''}" data-pin="${record.id}" aria-label="${record.pinned ? '取消置顶' : '置顶'}">${record.pinned ? '已置顶' : '置顶'}</button><button class="record-action delete" data-delete="${record.id}" aria-label="删除记录">删除</button></div>
        ${record.title ? `<h2>${escapeHtml(record.title)}</h2>` : ''}
        <p>${escapeHtml(record.content)}</p>
        ${source}
        ${attachment}
        ${snapshot}
        ${snapshotSource}
      </div>
    </article>`
}

function renderAttachment(attachment: Attachment, type: RecordType, recordId: string) {
  const name = escapeHtml(attachment.name)
  if (!attachment.dataUrl) return `<div class="record-attachment attachment-card attachment-pending"><span>附件</span><strong>${name}</strong><em>正在下载</em></div>`
  const url = escapeHtml(attachment.dataUrl)
  if (type === 'image' && attachment.mimeType.startsWith('image/') && attachment.dataUrl.startsWith('data:image/')) {
    return `<div class="attachment-preview"><img class="record-image" src="${url}" alt="${name}" /><div class="attachment-actions"><a href="${url}" download="${name}">下载原图</a><button type="button" data-remove-attachment="${recordId}">移除附件</button></div></div>`
  }
  return `<div class="record-attachment attachment-card"><a href="${url}" download="${name}"><span>附件</span><strong>${name}</strong><em>${formatFileSize(attachment.size)}</em></a><button type="button" data-remove-attachment="${recordId}">移除</button></div>`
}

function emptyState() {
  const search = searchQuery.trim()
  return `<div class="empty-state"><div class="empty-glyph">+</div><h2>${search ? '没有找到匹配的记录' : '这里还没有记录'}</h2><p>${search ? '换一个记得的词，或者清除搜索后再看看。' : '把现在的想法、链接或资料先留下来。'}</p>${search ? '<button class="topbar-action" id="clear-search" type="button">清除搜索</button>' : ''}</div>`
}

function bindEvents() {
  document.querySelector<HTMLTextAreaElement>('#capture-input')?.focus()
  document.querySelector<HTMLButtonElement>('#open-account-dialog')?.addEventListener('click', openAccountDialog)
  document.querySelector<HTMLButtonElement>('#close-account-dialog')?.addEventListener('click', closeAccountDialog)
  document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => {
    authMode = button.dataset.authMode as 'sign-in' | 'sign-up'
    accountNotice = ''
    render()
    openAccountDialog()
  }))
  document.querySelector<HTMLFormElement>('#auth-form')?.addEventListener('submit', (event) => void submitAuthForm(event))
  document.querySelector<HTMLButtonElement>('#reset-password')?.addEventListener('click', () => void resetPassword())
  document.querySelector<HTMLButtonElement>('#sign-out-current')?.addEventListener('click', () => void signOut('current-device'))
  document.querySelector<HTMLButtonElement>('#sign-out-all')?.addEventListener('click', () => void signOut('all-devices'))
  document.querySelector<HTMLButtonElement>('#migrate-local-records')?.addEventListener('click', () => void migrateLocalRecords())
  document.querySelector<HTMLButtonElement>('#export-backup')?.addEventListener('click', () => void exportBackup())
  document.querySelector<HTMLButtonElement>('#import-backup')?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#backup-input')?.click())
  document.querySelector<HTMLInputElement>('#backup-input')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void importBackupFile(file)
  })
  document.querySelector<HTMLFormElement>('#composer')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = document.querySelector<HTMLTextAreaElement>('#capture-input')!
    const content = input.value.trim()
    if (!content) return input.focus()
    const source = findExternalUrl(content)
    const type = selectedType === 'thought' && source ? 'link' : selectedType
    if (type === 'link' && !source) {
      captureNotice = '链接记录需要包含以 http:// 或 https:// 开头的网址。'
      render()
      return
    }
    addRecord({
      id: crypto.randomUUID(),
      type,
      content: type === 'link' && content === source ? '已保存网页链接。' : content,
      title: source ? new URL(source).hostname : undefined,
      source,
      createdAt: new Date().toISOString(),
      pinned: false,
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-type]').forEach((item) => item.classList.remove('selected'))
    selectedType = button.dataset.type as RecordType
    button.classList.add('selected')
    if (selectedType === 'image' || selectedType === 'file') {
      const input = document.querySelector<HTMLInputElement>('#attachment-input')
      if (input) {
        input.accept = selectedType === 'image' ? 'image/*' : ''
        input.click()
      }
      return
    }
    document.querySelector<HTMLTextAreaElement>('#capture-input')?.focus()
  }))
  document.querySelector<HTMLInputElement>('#attachment-input')?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''
    try {
      const dataUrl = await readFile(file)
      const note = document.querySelector<HTMLTextAreaElement>('#capture-input')?.value.trim()
      addRecord({
        id: crypto.randomUUID(),
        type: selectedType,
        content: note || `已保存 ${selectedType === 'image' ? '图片' : '资料'}：${file.name}`,
        attachment: { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl },
        createdAt: new Date().toISOString(),
        pinned: false,
      })
    } catch {
      captureNotice = '附件读取失败，请重试或检查浏览器权限。'
      render()
    }
  })
  document.querySelector<HTMLButtonElement>('#import-snapshot')?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#snapshot-input')?.click())
  document.querySelector<HTMLInputElement>('#snapshot-input')?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > MAX_SNAPSHOT_BYTES) {
      captureNotice = `当前版本最多导入 ${formatFileSize(MAX_SNAPSHOT_BYTES)} 的网页快照。`
      render()
      return
    }
    const id = crypto.randomUUID()
    try {
      const metadata = await readMhtmlMetadata(file)
      await accountStore.storeSnapshot(id, file)
      const saved = addRecord({
        id: crypto.randomUUID(),
        type: 'file',
        content: `已导入离线网页快照：${file.name}`,
        snapshot: { id, title: metadata.title, originalUrl: metadata.originalUrl, capturedAt: new Date().toISOString(), archiveFileName: file.name, archiveFormat: 'mhtml' },
        createdAt: new Date().toISOString(),
        pinned: false,
      })
      if (!saved) await accountStore.removeSnapshot(id)
    } catch {
      captureNotice = '网页快照未能保存，请检查浏览器是否允许本地存储。'
      render()
    }
  })
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter as 'all' | RecordType
    render()
  }))
  document.querySelector<HTMLInputElement>('#search-input')?.addEventListener('input', (event) => {
    searchQuery = (event.target as HTMLInputElement).value
    const timeline = document.querySelector<HTMLDivElement>('#timeline')
    if (timeline) timeline.innerHTML = visibleRecords().map(renderRecord).join('') || emptyState()
    bindRecordActions()
  })
  document.querySelector<HTMLDivElement>('#timeline')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('#clear-search')) {
      searchQuery = ''
      render()
    }
  })
  document.querySelector<HTMLButtonElement>('#focus-capture')?.addEventListener('click', () => document.querySelector<HTMLTextAreaElement>('#capture-input')?.focus())
  document.querySelector<HTMLButtonElement>('#sort-button')?.addEventListener('click', () => {
    newestFirst = !newestFirst
    render()
  })
  document.querySelectorAll<HTMLButtonElement>('[data-snapshot-id]').forEach((button) => button.addEventListener('click', () => openSnapshotReader(button.dataset.snapshotId!, button.querySelector('strong')?.textContent ?? '离线快照')))
  const reader = document.querySelector<HTMLDialogElement>('#snapshot-reader')
  document.querySelector<HTMLButtonElement>('#close-snapshot-reader')?.addEventListener('click', () => reader?.close())
  reader?.addEventListener('close', () => {
    const frame = document.querySelector<HTMLIFrameElement>('#snapshot-frame')
    if (frame) frame.srcdoc = ''
  })
  document.querySelector<HTMLButtonElement>('#close-record-editor')?.addEventListener('click', closeEditor)
  document.querySelector<HTMLButtonElement>('#cancel-record-editor')?.addEventListener('click', closeEditor)
  document.querySelector<HTMLFormElement>('#record-editor-form')?.addEventListener('submit', (event) => void saveEditedRecord(event))
  document.querySelector<HTMLButtonElement>('#choose-edit-attachment')?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#edit-attachment-input')?.click())
  bindRecordActions()
}

function openAccountDialog() {
  document.querySelector<HTMLDialogElement>('#account-dialog')?.showModal()
}

function closeAccountDialog() {
  document.querySelector<HTMLDialogElement>('#account-dialog')?.close()
}

async function submitAuthForm(event: SubmitEvent) {
  event.preventDefault()
  const adapter = authConfiguration.adapter
  const emailInput = document.querySelector<HTMLInputElement>('#auth-email')
  const passwordInput = document.querySelector<HTMLInputElement>('#auth-password')
  if (!adapter || !emailInput || !passwordInput) return
  const email = emailInput.value.trim().toLowerCase()
  const password = passwordInput.value
  setAccountNotice(authMode === 'sign-in' ? '正在登录…' : '正在创建账号…')
  try {
    if (authMode === 'sign-up') {
      const result = await adapter.signUp(email, password)
      if (result === 'verification-required') {
        setAccountNotice('验证邮件已发送，请完成邮箱验证后登录。')
        return
      }
    } else {
      await adapter.signIn(email, password)
    }
    closeAccountDialog()
  } catch (error) {
    setAccountNotice(error instanceof Error ? error.message : '账号操作失败，请稍后重试。')
  }
}

async function resetPassword() {
  const adapter = authConfiguration.adapter
  const emailInput = document.querySelector<HTMLInputElement>('#auth-email')
  const email = emailInput?.value.trim().toLowerCase()
  if (!adapter || !email) {
    setAccountNotice('请先输入邮箱地址。')
    emailInput?.focus()
    return
  }
  setAccountNotice('正在发送重置邮件…')
  try {
    await adapter.requestPasswordReset(email)
    setAccountNotice('密码重置邮件已发送。')
  } catch (error) {
    setAccountNotice(error instanceof Error ? error.message : '重置邮件发送失败。')
  }
}

async function signOut(scope: 'current-device' | 'all-devices') {
  const adapter = authConfiguration.adapter
  if (!adapter || !authSession) return
  if (!window.confirm(scope === 'all-devices' ? '确定退出所有设备？' : '确定退出当前设备？')) return
  setAccountNotice('正在退出…')
  try {
    await adapter.signOut(scope)
  } catch (error) {
    setAccountNotice(error instanceof Error ? error.message : '退出失败，请稍后重试。')
  }
}

async function migrateLocalRecords() {
  const session = authSession
  if (!session?.emailVerified || !syncEngine) return
  const localCount = accountStore.loadLocalRecords().filter((record) => !record.deletedAt).length
  if (!localCount || !window.confirm(`确定把 ${localCount} 条本地暂存迁移到 ${session.email}？`)) return
  setAccountNotice('正在迁移本地暂存…')
  try {
    await accountStore.copyLocalCollectionToAccount(session.userId)
    records = accountStore.loadRecords()
    syncState = 'syncing'
    const report = await syncEngine.synchronize(session.userId)
    if (authSession?.userId !== session.userId) return
    records = report.records
    await accountStore.clearLocalCollection()
    syncState = 'synced'
    accountNotice = `已迁移 ${localCount} 条本地记录。`
    render()
    openAccountDialog()
  } catch (error) {
    syncState = 'error'
    setAccountNotice(error instanceof Error ? `迁移失败：${error.message}。本地原数据仍保留。` : '迁移失败，本地原数据仍保留。')
  }
}

async function activateSession(session: AuthSession | null) {
  const previousAccountId = authSession?.userId
  if (previousAccountId === session?.userId) {
    authSession = session
    render()
    return
  }
  if (previousAccountId && !session) await accountStore.clearAccountCache(previousAccountId)
  authSession = session
  accountStore.setActiveAccount(session?.userId ?? null)
  records = accountStore.loadRecords(session ? [] : starterRecords)
  syncState = session ? (navigator.onLine ? 'syncing' : 'offline') : 'local'
  activeFilter = 'all'
  searchQuery = ''
  accountNotice = ''
  render()
  if (session?.emailVerified) scheduleSync(0)
}

async function initializeAuth() {
  const adapter = authConfiguration.adapter
  if (!adapter) return
  try {
    await activateSession(await adapter.getSession())
    unsubscribeAuth?.()
    unsubscribeAuth = adapter.onSessionChanged((session) => void activateSession(session))
  } catch (error) {
    appNotice = error instanceof Error ? `账号状态读取失败：${error.message}` : '账号状态读取失败。'
    render()
  }
}

function openEditor(id: string) {
  const record = records.find((item) => item.id === id)
  const dialog = document.querySelector<HTMLDialogElement>('#record-editor')
  const title = document.querySelector<HTMLInputElement>('#edit-title')
  const content = document.querySelector<HTMLTextAreaElement>('#edit-content')
  const source = document.querySelector<HTMLInputElement>('#edit-source')
  const kind = document.querySelector<HTMLElement>('#edit-record-kind')
  const attachmentArea = document.querySelector<HTMLElement>('#edit-attachment-area')
  const attachmentName = document.querySelector<HTMLElement>('#edit-attachment-name')
  const removeAttachment = document.querySelector<HTMLInputElement>('#edit-remove-attachment')
  const attachmentInput = document.querySelector<HTMLInputElement>('#edit-attachment-input')
  const notice = document.querySelector<HTMLElement>('#editor-notice')
  if (!record || !dialog || !title || !content || !source || !kind || !attachmentArea || !attachmentName || !removeAttachment || !attachmentInput || !notice) return

  editingRecordId = id
  title.value = record.title ?? record.snapshot?.title ?? ''
  content.value = record.content
  source.value = record.source ?? record.snapshot?.originalUrl ?? ''
  kind.textContent = `${recordLabel(record.type)} · ${formatDate(record.createdAt)}`
  attachmentArea.hidden = Boolean(record.snapshot) || (record.type !== 'image' && record.type !== 'file' && !record.attachment)
  attachmentName.textContent = record.attachment ? `当前附件：${record.attachment.name}` : '当前没有附件'
  removeAttachment.checked = false
  attachmentInput.value = ''
  attachmentInput.accept = record.type === 'image' ? 'image/*' : ''
  notice.textContent = ''
  dialog.showModal()
  content.focus()
}

function closeEditor() {
  const dialog = document.querySelector<HTMLDialogElement>('#record-editor')
  if (dialog?.open) dialog.close()
  editingRecordId = undefined
}

async function saveEditedRecord(event: SubmitEvent) {
  event.preventDefault()
  const record = records.find((item) => item.id === editingRecordId)
  const contentInput = document.querySelector<HTMLTextAreaElement>('#edit-content')
  const titleInput = document.querySelector<HTMLInputElement>('#edit-title')
  const sourceInput = document.querySelector<HTMLInputElement>('#edit-source')
  const attachmentInput = document.querySelector<HTMLInputElement>('#edit-attachment-input')
  const removeAttachment = document.querySelector<HTMLInputElement>('#edit-remove-attachment')
  const notice = document.querySelector<HTMLElement>('#editor-notice')
  if (!record || !contentInput || !titleInput || !sourceInput || !attachmentInput || !removeAttachment || !notice) return

  const content = contentInput.value.trim()
  const title = titleInput.value.trim()
  const sourceValue = sourceInput.value.trim()
  const source = sourceValue ? safeExternalUrl(sourceValue) : undefined
  if (!content) {
    notice.textContent = '内容不能为空。'
    contentInput.focus()
    return
  }
  if (sourceValue && !source) {
    notice.textContent = '来源网址需要以 http:// 或 https:// 开头。'
    sourceInput.focus()
    return
  }
  if (record.type === 'link' && !source && !findExternalUrl(content)) {
    notice.textContent = '链接记录需要保留一个有效网址。'
    sourceInput.focus()
    return
  }

  const previous = JSON.parse(JSON.stringify(record)) as RecallRecord
  const file = attachmentInput.files?.[0]
  try {
    record.content = content
    if (record.snapshot) {
      record.snapshot.title = title || record.snapshot.archiveFileName
      record.snapshot.originalUrl = source
    } else {
      record.title = title || undefined
      record.source = source
    }
    if (removeAttachment.checked) record.attachment = undefined
    if (file) {
      record.attachment = { name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl: await readFile(file) }
    }
    markRecordChanged(record)
    if (!persist()) throw new Error('本地存储空间不足，未能保存修改。')
    closeEditor()
    captureNotice = ''
    render()
  } catch (error) {
    Object.assign(record, previous)
    notice.textContent = error instanceof Error ? error.message : '保存修改失败。'
  }
}

function addRecord(record: RecallRecord) {
  markRecordChanged(record)
  records.unshift(record)
  if (!persist()) {
    records = records.filter((item) => item.id !== record.id)
    captureNotice = '本地存储空间不足，未能保存这条记录。'
    render()
    return false
  } else {
    captureNotice = ''
  }
  selectedType = 'thought'
  render()
  return true
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function bindRecordActions() {
  document.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => openEditor(button.dataset.edit!)))
  document.querySelectorAll<HTMLButtonElement>('[data-pin]').forEach((button) => button.addEventListener('click', () => {
    const record = records.find((item) => item.id === button.dataset.pin)
    if (!record) return
    const previous = record.pinned
    record.pinned = !record.pinned
    markRecordChanged(record)
    if (!persist()) {
      record.pinned = previous
      captureNotice = '本地存储空间不足，未能更新置顶状态。'
    } else {
      captureNotice = ''
    }
    render()
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-remove-attachment]').forEach((button) => button.addEventListener('click', () => {
    const record = records.find((item) => item.id === button.dataset.removeAttachment)
    if (!record?.attachment || !window.confirm(`确定移除附件“${record.attachment.name}”？`)) return
    const previous = record.attachment
    record.attachment = undefined
    markRecordChanged(record)
    if (!persist()) {
      record.attachment = previous
      captureNotice = '本地存储空间不足，未能移除附件。'
    } else {
      captureNotice = ''
    }
    render()
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
    const deleted = records.find((item) => item.id === button.dataset.delete)
    if (!deleted || !window.confirm(`确定删除这条${recordLabel(deleted.type)}记录？此操作不可撤销。`)) return
    if (authSession) {
      const previousDeletedAt = deleted.deletedAt
      deleted.deletedAt = new Date().toISOString()
      markRecordChanged(deleted)
      if (!persist()) {
        deleted.deletedAt = previousDeletedAt
        captureNotice = '本地存储空间不足，未能删除这条记录。'
      }
      render()
      return
    }
    const previous = records
    records = records.filter((item) => item.id !== button.dataset.delete)
    if (!persist()) {
      records = previous
      captureNotice = '本地存储空间不足，未能删除这条记录。'
      render()
      return
    }
    if (deleted.snapshot) {
      try {
        await accountStore.removeSnapshot(deleted.snapshot.id)
      } catch {
        appNotice = '记录已删除，但网页快照文件清理失败；导出备份仍会保留它。'
      }
    }
    render()
  }))
}

async function hydrateSnapshotButtons() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-snapshot-id]'))
  await Promise.all(buttons.map(async (button) => {
    const id = button.dataset.snapshotId
    if (!id) return
    const file = await accountStore.getSnapshot(id)
    if (!file) {
      button.disabled = true
      button.textContent = '离线快照文件不可用'
    }
  }))
}

function handleShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('#search-input')?.focus()
  }
}

render()
document.addEventListener('keydown', handleShortcut)
window.addEventListener('online', () => scheduleSync(0))
window.addEventListener('offline', () => {
  if (!authSession) return
  syncState = 'offline'
  render()
})
void initializeAuth()
