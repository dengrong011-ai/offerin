# 上传与文件限制说明

## 一、支持的最大大小

| 场景 | 限制 | 说明 |
|------|------|------|
| **简历 / JD 文件**（PDF、Word、图片） | **单文件 ≤ 3MB** | 超过会直接拒绝并提示「PDF/Word 文件过大，请上传小于 3MB 的文件」 |
| **简历照片**（头像/证件照） | **≤ 2MB** | 超过会提示「文件大小不能超过 2MB」 |
| **请求体总附件**（发往 Gemini 的 base64） | **合计约 3MB** | 超限时服务端会静默降级：优先丢弃 JD 附件，仅保留简历；若仍超限则改为纯文本分析，**当前不会在 UI 明确提示用户** |

## 二、过大会不会失败？

- **会。**  
  - 简历/JD 单文件 > 3MB：前端 `compressImage` 内会 `reject`，用户看到错误文案。  
  - 简历照片 > 2MB：`uploadResumePhoto` 返回错误，用户看到「文件大小不能超过 2MB」。  
  - 若请求体总大小超 Vercel/API 限制（约 4.5MB），会返回 413，前端会提示「上传文件过大，请压缩文件后重试（建议 PDF 小于 3MB），或直接粘贴文本内容。」  
- **总附件超 3MB 的降级**：`geminiService.buildAnalysisContext` 会丢弃部分或全部附件、改为纯文本分析，**不会弹错，但用户不知道附件被忽略**，后续可考虑在 UI 增加「附件过大已仅用文本分析」的提示。

## 三、是否有压缩？

| 类型 | 是否有压缩 | 说明 |
|------|------------|------|
| **简历/JD 图片**（JPG/PNG/WebP/HEIC） | ✅ 有 | 最长边缩到 1024px，转 JPEG 质量 0.7 |
| **简历/JD 的 PDF、Word** | ❌ 无 | 只做 3MB 大小校验，不压缩 |
| **简历照片** | ✅ 有 | 最长边 800px，转 JPEG 质量 0.85；先校验 2MB 再压缩后上传 |

## 四、是否支持 .doc？

- **支持。** 前端 `accept` 与类型校验均包含 `.doc`（`application/msword`），会随 base64 传给 Gemini。  
- **建议**：优先使用 **PDF 或 .docx** 以获得更稳定的解析效果。已在简历/JD 上传区域增加文案：「支持 PDF、Word（.doc/.docx）、图片，单文件 ≤3MB；建议优先使用 PDF 或 .docx。」

## 五、相关代码位置

- 简历/JD 大小与压缩：`App.tsx`、`InterviewChat.tsx` 中的 `compressImage`、`handleFileChange`
- 简历照片大小与压缩：`services/storageService.ts`（`MAX_FILE_SIZE`、`compressImage`）、`components/PhotoUploadPanel.tsx`
- 请求体 3MB 降级逻辑：`services/geminiService.ts` 中 `MAX_PAYLOAD_BASE64_BYTES`、`buildAnalysisContext`
