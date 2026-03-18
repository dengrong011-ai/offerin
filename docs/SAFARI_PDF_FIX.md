# Safari PDF/导出失败修复

## 问题

用户反馈 Safari 下 PDF 保存一直失败。

## 根因

1. **jsPDF save()**：Safari（尤其 iOS）下 `pdf.save()` 可能触发页面刷新或静默失败
2. **data URL**：`canvas.toDataURL()` + `link.href` 在 Safari 下对大图有 URL 长度/内存限制
3. **html2canvas scale**：scale: 3 产生的 canvas 可能超出 Safari 的 canvas 尺寸上限

## 已做修复

### 1. 简历 PDF 导出（App.tsx）

- 用 `pdf.output('blob')` + `URL.createObjectURL` + `link.download` 替代 `pdf.save()`
- Safari 下 scale 由 3 降为 2，减少 canvas 像素数

### 2. 简历 PNG 导出（App.tsx）

- 用 `canvas.toBlob()` + `createObjectURL` 替代 `toDataURL`

### 3. 面试记录 PNG 导出（InterviewChat.tsx）

- 同上，改用 Blob + createObjectURL

### 4. 面试记录 Markdown 导出（InterviewChat.tsx）

- `document.body.appendChild(link)` 后再 click，并延迟 revokeObjectURL，确保下载完成

## 若仍失败

- 确认用户 Safari 版本（iOS 17.4.x、18.x 部分版本有已知 bug）
- 检查 Vercel/前端是否有报错
- 长简历（多页）可尝试先「智能精简」再导出
