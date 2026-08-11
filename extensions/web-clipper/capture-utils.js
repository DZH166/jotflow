export function buildArchiveFilename(title, capturedAt = new Date()) {
  const date = capturedAt.toISOString().slice(0, 10)
  const safeTitle = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'untitled-page'

  return `小董随心录/${date}-${safeTitle}.mhtml`
}

export function formatFailure(error) {
  return error?.message || '保存失败，请确认当前页面允许浏览器归档后重试。'
}
