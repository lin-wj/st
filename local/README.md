# 本地版（Flask + RapidOCR）

对应逆向结论的本地复刻：拍照 → RapidOCR 本地识别 → 本地题库模糊检索，可选 LLM 解题（需自行配置 OpenAI 兼容 API）。

```bash
pip install flask rapidocr_onnxruntime pillow
python app.py   # 打开 http://localhost:8010
```

题库放 `data/`（JSON：`[{"question","options","answer","explanation"}]`），自带一个示例。

云端版本（推荐）见 `../cloudflare/`。
