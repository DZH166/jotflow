import { buildArchiveFilename, formatFailure } from './capture-utils.js'

const button = document.querySelector('#capture-button')
const status = document.querySelector('#status')

button.addEventListener('click', captureCurrentPage)

async function captureCurrentPage() {
  button.disabled = true
  setStatus('正在生成离线归档…')

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error('请在普通网页标签页中使用此扩展。')
    }

    const archive = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id })
    const filename = buildArchiveFilename(tab.title || 'untitled-page')
    const archiveFile = new File([archive], filename.split('/').at(-1), { type: 'application/x-mimearchive' })
    const archiveUrl = URL.createObjectURL(archiveFile)
    const downloadId = await chrome.downloads.download({
      url: archiveUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    })

    window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 30_000)
    setStatus(`已保存离线快照（下载任务 #${downloadId}）。`)
  } catch (error) {
    setStatus(formatFailure(error), true)
  } finally {
    button.disabled = false
  }
}

function setStatus(message, isError = false) {
  status.textContent = message
  status.classList.toggle('error', isError)
}
