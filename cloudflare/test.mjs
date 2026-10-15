import worker from './worker.mjs';

const fakeEnv = { AI: { run: async (m, input) => m.includes('llama') ? { response: '答案是 80。解析：先乘除后加减。' } : (input === 'ocr' ? { data: [{text:'计算：25×4-100÷5=?'}] } : {}) } };

const post = async (path, body) => worker.fetch(new Request('https://x'+path, { method:'POST', body, headers: {'Content-Type':'application/json'} }), fakeEnv).then(r => r.json());
const get = async (path) => worker.fetch(new Request('https://x'+path), fakeEnv).then(r => r.json());

console.log('banks:', JSON.stringify(await get('/api/banks')));
console.log('import:', JSON.stringify(await post('/api/bank', JSON.stringify({name:'测试', items:[{question:'x+1=3', answer:'x=2'}]}))));
console.log('search:', JSON.stringify(await post('/api/search', JSON.stringify({query:'计算 25×4 - 100÷5 = ?', top_k:2}))));
console.log('ask:', JSON.stringify(await post('/api/ask', JSON.stringify({query:'解方程 2x+5=17'}))));
console.log('ocr-json:', JSON.stringify(await post('/api/ocr', JSON.stringify({b64: Buffer.from('x').toString('base64')}))));
console.log('ocr-mime:', JSON.stringify(await worker.fetch(new Request('https://x/api/ocr', { method:'POST', body: Buffer.from('fakepngbytes'), headers: {'Content-Type':'image/png'} }), fakeEnv).then(r => r.json())));
console.log('import-text:', JSON.stringify(await post('/api/bank', JSON.stringify({name:'文本题库', text:'解方程 3y-2=7\n答案: y=3\n解析: 3y=9\n\n选择题: 1+1=?\nA.2 B.3\n答案: A'}))));
