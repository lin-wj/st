"""本地题库：JSON 格式，结构 [{"question","options","answer","explanation"}]"""
import json
import difflib
import re
import os

BANK_DIR = os.path.join(os.path.dirname(__file__), "data")


def load_banks():
    banks = []
    if not os.path.isdir(BANK_DIR):
        return banks
    for fn in sorted(os.listdir(BANK_DIR)):
        if fn.endswith(".json"):
            path = os.path.join(BANK_DIR, fn)
            with open(path, encoding="utf-8") as f:
                items = json.load(f)
            banks.append({"name": fn[:-5], "items": items})
    return banks


def normalize(s):
    s = re.sub(r"[\s　·•\-\*_\[\]\(\)（）【】「」，。！？,.!?;；:：'\"`]", "", s or "")
    return s.lower()


def score_match(q_text, item):
    """题目文本与题库条目的相似度（归一化 + 序列相似度 + 关键词加权）"""
    qn = normalize(q_text)
    item_q = normalize(item.get("question", ""))
    if not qn or not item_q:
        return 0.0
    ratio = difflib.SequenceMatcher(None, qn, item_q).ratio()
    # 关键词：数字、选项字母、运算符号占比提高权重
    q_tokens = set(re.findall(r"\d+(?:\.\d+)?|[A-D]\b", q_text.upper()))
    i_tokens = set(re.findall(r"\d+(?:\.\d+)?|[A-D]\b", item.get("question", "").upper()))
    union = q_tokens | i_tokens
    kw = len(q_tokens & i_tokens) / len(union) if union else 0.0
    return 0.7 * ratio + 0.3 * kw


def search(query, top_k=3, threshold=0.45):
    results = []
    for bank in load_banks():
        for item in bank["items"]:
            s = score_match(query, item)
            if s >= threshold:
                results.append({"score": round(s, 3), "bank": bank["name"], **item})
    results.sort(key=lambda x: -x["score"])
    return results[:top_k]
