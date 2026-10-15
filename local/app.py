"""快搜搜题复刻版 · 拍照搜题服务

复刻自对「快搜搜题」APK 的逆向结论：
- 拍照 → 本地 OCR（对应原版 PaddleOCR ncnn 端侧推理）→ 题库模糊检索（对应原版「下载题库后本地搜索」）
- 新增可选 LLM 解题（对应原版「AI 导题 / 悬浮窗 AI」的联网 AI 能力）
- 题库导入：JSON 文件（对应原版 AI 导题把文档转成本地题库）

用法：
  pip install flask rapidocr_onnxruntime pillow
  python app.py            # 打开 http://localhost:8010
环境变量（可选，启用 LLM 解题）：
  LLM_API_KEY, LLM_BASE_URL (默认 OpenAI 兼容), LLM_MODEL (默认 gpt-4o-mini)
"""
import base64
import json
import os
import re
import urllib.request

from flask import Flask, render_template, request

import bank

app = Flask(__name__)
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

_ocr = None


def get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


@app.get("/")
def index():
    return render_template("index.html", banks=bank.load_banks())


@app.get("/api/banks")
def api_banks():
    return {"banks": [{"name": b["name"], "count": len(b["items"])} for b in bank.load_banks()]}


@app.post("/api/bank")
def api_import_bank():
    """题库导入：上传 JSON 文件 [{"question","options","answer","explanation"}] 或粘贴文本"""
    name = request.form.get("name", "").strip()
    if request.files.get("file"):
        f = request.files["file"]
        try:
            items = json.load(f)
        except Exception as e:
            return {"ok": False, "error": f"JSON 解析失败: {e}"}, 400
        fn = f"{name or f.filename[:-5]}.json"
    else:
        # 简单文本模式：每道题一块，"题目..." 换行 "答案: ..." 换行 "解析: ..."，用空行分隔
        raw = request.form.get("text", "")
        blocks = re.split(r"\n\s*\n", raw.strip())
        items = []
        for b in blocks:
            lines = [l.strip() for l in b.splitlines() if l.strip()]
            if not lines:
                continue
            it = {"question": lines[0], "options": "", "answer": "", "explanation": ""}
            for l in lines[1:]:
                if l.startswith("答案"):
                    it["answer"] = l.split(":", 1)[-1].split("：", 1)[-1].strip()
                elif l.startswith("解析"):
                    it["explanation"] = l.split(":", 1)[-1].split("：", 1)[-1].strip()
                elif re.match(r"^[A-E][\.、\s]", l):
                    it["options"] += l + " "
            items.append(it)
        fn = f"{name or '手动导入'}.json"
    if not items:
        return {"ok": False, "error": "题库为空，未导入任何题目"}, 400
    path = os.path.join(bank.BANK_DIR, re.sub(r"[^A-Za-z0-9一-鿿_-]", "_", fn))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    return {"ok": True, "name": fn[:-5], "count": len(items)}


@app.post("/api/ocr")
def api_ocr():
    """拍照 → 文字（原版的端侧 OCR 步骤）"""
    f = request.files.get("image")
    if not f:
        return {"ok": False, "error": "未收到图片"}, 400
    img_path = os.path.join(UPLOAD_DIR, f"up_{os.getpid()}_{id(f)}.png")
    f.save(img_path)
    try:
        ocr = get_ocr()
        res, _ = ocr(img_path)
        lines = [r[1] for r in res] if res else []
        return {"ok": True, "text": "\n".join(lines), "lines": lines}
    finally:
        os.path.exists(img_path) and os.remove(img_path)


@app.post("/api/search")
def api_search():
    """文字 → 本地题库检索（原版：搜索题库广场下载的本地题库）"""
    q = (request.json or {}).get("query", "").strip()
    if not q:
        return {"ok": False, "error": "query 为空"}, 400
    return {"ok": True, "results": bank.search(q, top_k=request.json.get("top_k", 3))}


@app.post("/api/ask")
def api_ask():
    """可选 LLM 解题（原版：AI 导题 / 悬浮窗 AI，联网）"""
    q = (request.json or {}).get("query", "").strip()
    key = os.environ.get("LLM_API_KEY")
    base = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    if not key:
        return {"ok": False, "error": "未配置 LLM_API_KEY，跳过 AI 解题；请先查本地题库结果"}
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "你是解题助手。给出答案并附简明解析。若不确定请说明。"},
            {"role": "user", "content": q},
        ],
    }).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return {"ok": True, "answer": data["choices"][0]["message"]["content"], "model": model}


if __name__ == "__main__":
    print("📷 快搜搜题复刻版 → http://localhost:8010")
    app.run(host="127.0.0.1", port=8010, debug=False)
