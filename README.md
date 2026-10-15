# 快搜搜题 · 复刻版（拍照搜题）

逆向「快搜搜题 3.9.7」APK 后复刻的拍照搜题工具。原版流程：拍照 → 端侧 PaddleOCR(ncnn) → 匹配本地题库，另有联网 AI 能力。本仓库包含两个实现：

- `cloudflare/` — 部署在 Cloudflare：Workers AI OCR + 免费 LLM 解题 + KV 题库（推荐，README 内有部署步骤）
- `local/` — 本地 Flask + RapidOCR，离线可用

## 逆向要点（fast-search 3.9.7）

- 包名 `com.questions.liteai`，仅 18KB 壳 dex（`com.hardening.shell` 动态加壳 + 签名证书派生密钥解密 `d0~d5.bin` 业务载荷），静态看不到业务代码
- OCR 模型直接打在 APK assets：PP_OCRv5/v6 ncnn det+rec；搜题在本地题库上匹配（题库广场下载/导入）
- "AI 导题 / 悬浮窗 AI" 为联网 LLM；广告 SDK：Pangle 穿山甲
