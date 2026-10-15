# 快搜搜题 · Cloudflare 版（拍照搜题）

一个部署在 Cloudflare 的拍照搜题工具：拍照/传图 → **Workers AI OCR**（`@cf/vm-ocr/hanzi`）→ 本地题库模糊检索；搜不到或想直接要答案时用 **Workers AI 免费 LLM**（`@cf/meta/llama-3.1-8b-instruct`）解题。题库存 KV（不建 KV 则用内存 + 内置示例题库，重启丢失）。

全程只消耗 Cloudflare AI 的免费推理额度（Free 计划每月 10,000 次推理，OCR 和 LLM 都算在内）。

## 目录结构

```
worker.mjs       Worker 主逻辑（API + 静态资源）
public/index.html 网页端（拍照 / OCR / 搜题 / 导入 / AI 解题）
wrangler.jsonc   部署配置
```

## 部署步骤

```bash
npm i -g wrangler
wrangler login
cd cloudflare-kssou

# 1) 创建题库 KV 并拿到 namespace id
wrangler kv namespaces create QUESTION_BANK
#    输出形如 "kv namespace 'QUESTION_BANK' created (id: abc123...)"

# 2) 把上一步的 id 填进 wrangler.jsonc 的 kv_namespaces[0].id

# 3) 部署
wrangler deploy
```

然后在 Cloudflare Dashboard 的 **AI** 里确认 Workers AI 已启用（Free 账号默认就有，每月 10k 免费推理）。

## API

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `GET /` | - | 网页端 |
| `GET /api/banks` | GET | 当前题库列表 |
| `POST /api/bank` | `{name, items:[...]}` 或 `{name, text}` | 导入题库（text 模式：空行分题，"答案:"/"解析:"行） |
| `POST /api/ocr` | 图片字节（image/png）或 `{b64}`；`?model=hanzi\|latin` | OCR |
| `POST /api/search` | `{query, top_k?}` | 题库检索 |
| `POST /api/ask` | `{query}` | LLM 解题 |

## 本地自测（不部署）

`node test.mjs`（worker.mjs 可直接 import，AI 用假实现 mock，不联网）：

```bash
node --check worker.mjs && node test.mjs
```

## 已知限制

- `@cf/vm-ocr/hanzi` 对手写体和数学公式（×、÷）识别弱于 PaddleOCR；数学题建议"AI 解题"兜底
- 题库检索基于文本相似度（LCS + 数字/选项关键词加权），单本题库上限 500 题、总量建议 <5000 题（纯 JS 计算在 Worker 里跑）
- 免费版 Llama 3.1 8B 对复杂数学/证明类题目能力有限，可把 `LLM_MODEL` 换成 `@cf/qwen/qwen-2.5-72b-instruct` 等更大模型（同样走免费额度池，占用更多推理次数）
