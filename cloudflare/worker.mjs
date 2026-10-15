/* 快搜搜题复刻版 · Cloudflare Worker
   - OCR:   Cloudflare Workers AI (@cf/vm-ocr/hanzi 中文 / latin-simplified 西文)
   - 导题/解题: Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct, 免费额度内)
   - 题库: KV(可选); 无 KV 时用内存 + 内置示例题库
   部署: wrangler login && wrangler deploy (详见 README.md)
*/

const LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const OCR_MODELS = { hanzi: "@cf/vm-ocr/hanzi", latin: "@cf/vm-ocr/latin-simplified" };

const SEED_BANK = [
  { question: "计算：25×4 - 100÷5 = ?", options: "A. 80  B. 60  C. 100  D. 90", answer: "A", explanation: "先算乘除：25×4=100，100÷5=20；再算减法：100-20=80。" },
  { question: "一个等腰三角形的顶角是 40°，它的底角是多少度？", options: "A. 40°  B. 70°  C. 80°  D. 100°", answer: "B", explanation: "三角形内角和 180°，两个底角相等：(180°-40°)÷2=70°。" },
  { question: "解方程：2x + 5 = 17", options: "", answer: "x = 6", explanation: "两边减 5 得 2x=12，两边除以 2 得 x=6。" },
  { question: "我国的首都是哪里？", options: "A. 上海  B. 北京  C. 广州  D. 深圳", answer: "B", explanation: "中华人民共和国首都是北京。" },
];

/* ---------- 题库存储（KV 优先，无则内存） ---------- */
const memBanks = new Map([["示例题库", SEED_BANK]]);
async function getBanks(env) {
  if (env.QUESTION_BANK) {
    const banks = {};
    const index = JSON.parse((await env.QUESTION_BANK.get("index", "json")) || "[]");
    for (const name of index) {
      const v = await env.QUESTION_BANK.get(`bank:${name}`, "json");
      if (v) banks[name] = v;
    }
    return Object.entries(banks).map(([name, items]) => ({ name, items }));
  }
  return [...memBanks.entries()].map(([name, items]) => ({ name, items }));
}
async function importBank(env, name, items) {
  if (items.length > 500) throw new Error("单本题库最多 500 题");
  if (env.QUESTION_BANK) {
    await env.QUESTION_BANK.put(`bank:${name}`, JSON.stringify(items));
    const index = JSON.parse((await env.QUESTION_BANK.get("index", "json")) || "[]");
    if (!index.includes(name)) { index.push(name); await env.QUESTION_BANK.put("index", JSON.stringify(index)); }
  } else {
    memBanks.set(name, items);
  }
  return items.length;
}

/* ---------- 文本工具（对齐本地版 bank.py 的归一化 + LCS 相似度） ---------- */
const norm = s => (s || "").replace(/[\s　·•\-\*_\[\]\(\)（）【】「」，。！？,.!?;；:：'"`]/g, "").toLowerCase();

function lcsRatio(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[n]) / (m + n);
}
function kwOverlap(a, b) {
  const ka = new Set(a.toUpperCase().match(/\d+(?:\.\d+)?|[A-D]\b/g) || []);
  const kb = new Set(b.toUpperCase().match(/\d+(?:\.\d+)?|[A-D]\b/g) || []);
  const union = new Set([...ka, ...kb]);
  if (!union.size) return 0;
  let inter = 0; for (const x of ka) if (kb.has(x)) inter++;
  return inter / union.size;
}
function searchBank(query, items, topK = 3, threshold = 0.45) {
  const qn = norm(query);
  if (!qn) return [];
  const out = [];
  for (const it of items) {
    const ino = norm(it.question);
    if (!ino) continue;
    const s = 0.7 * lcsRatio(qn, ino) + 0.3 * kwOverlap(query, it.question);
    if (s >= threshold) out.push({ score: Math.round(s * 1000) / 1000, ...it });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, topK);
}

/* ---------- Llama 3.1 instruct 提示模板（CF 文档约定） ---------- */
function llamaPrompt(system, user) {
  return `<|system|>\n${system}<|eot|>\n<|user|>\n${user}<|eot|>\n<|assistant|>\n`;
}
async function llmAnswer(env, question) {
  const res = await env.AI.run(LLM_MODEL, llamaPrompt("你是解题助手。给出答案并附简明解析。若不确定请说明。", question));
  return res.response || "(模型未返回内容)";
}

/* ---------- 路由 ---------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const json = body => new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
    });
    if (req.method === "OPTIONS") return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

    if (url.pathname === "/api/banks" && req.method === "GET") {
      const banks = await getBanks(env);
      return json({ banks: banks.map(b => ({ name: b.name, count: b.items.length })) });
    }

    if (url.pathname === "/api/bank" && req.method === "POST") {
      // JSON: {name, items:[{question,options,answer,explanation}]} 或 {name, text: 纯文本题库}
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: "需要 JSON 请求体" }); }
      const name = String(body.name || "导入题库").slice(0, 40);
      let items;
      if (Array.isArray(body.items)) items = body.items;
      else {
        items = String(body.text || "").split(/\n\s*\n/).map(bl => {
          const lines = bl.trim().split("\n").filter(Boolean);
          const it = { question: lines[0] || "", options: "", answer: "", explanation: "" };
          for (const l of lines.slice(1)) {
            if (l.startsWith("答案")) it.answer = l.replace(/^答案[：:]/, "").trim();
            else if (l.startsWith("解析")) it.explanation = l.replace(/^解析[：:]/, "").trim();
            else if (/^[A-E][.、\s]/.test(l)) it.options += l + " ";
          }
          return it;
        }).filter(x => x.question);
      }
      items = (items || []).filter(x => x.question);
      if (!items.length) return json({ ok: false, error: "题库为空" });
      const count = await importBank(env, name, items);
      return json({ ok: true, name, count });
    }

    if (url.pathname === "/api/ocr" && req.method === "POST") {
      const model = OCR_MODELS[url.searchParams.get("model") || "hanzi"] || OCR_MODELS.hanzi;
      if (req.headers.get("content-type")?.includes("json")) {
        const { image, b64 } = await req.json();
        const bytes = b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : Uint8Array.from(await (await fetch(image)).arrayBuffer());
        return json(await ocrBytes(env, model, bytes));
      }
      return json(await ocrBytes(env, model, new Uint8Array(await req.arrayBuffer())));
    }

    if (url.pathname === "/api/search" && req.method === "POST") {
      const { query, top_k } = await req.json();
      if (!query?.trim()) return json({ ok: false, error: "query 为空" });
      const results = [];
      for (const b of await getBanks(env)) {
        for (const r of searchBank(query.trim(), b.items, top_k || 3)) results.push({ bank: b.name, ...r });
      }
      results.sort((a, b) => b.score - a.score);
      return json({ ok: true, results: results.slice(0, top_k || 3) });
    }

    if (url.pathname === "/api/ask" && req.method === "POST") {
      const { query } = await req.json();
      if (!query?.trim()) return json({ ok: false, error: "query 为空" });
      try {
        const answer = await llmAnswer(env, query.trim());
        return json({ ok: true, answer, model: LLM_MODEL });
      } catch (e) {
        return json({ ok: false, error: "AI 调用失败: " + e.message + "（请确认账号已开通 Workers AI 且在免费额度内）" });
      }
    }

    // 其余交给静态资源（Pages/Assets）
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("not found", { status: 404 });
  },
};

async function ocrBytes(env, model, bytes) {
  if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: "图片超过 8MB" };
  try {
    const result = await env.AI.run(model, { image: bytes });
    const text = Array.isArray(result.data) ? result.data.map(d => d.text).join("\n") : (result.text || "");
    return { ok: true, text, model };
  } catch (e) {
    return { ok: false, error: "OCR 失败: " + e.message };
  }
}
