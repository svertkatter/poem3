// 最新の読みについて: 行の share フラグ、ストレージ JSON、共有URLを確認する
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
const share = (src.match(/SHARE_PAGE_URL\s*=\s*"([^"]+)"/) || [])[1];
const H = { apikey: key, Authorization: 'Bearer ' + key };

(async () => {
  const r = await fetch(`${url}/rest/v1/readings?select=id,url,params,created_at&params->>app=eq.anzuyo&order=created_at.desc&limit=1`, { headers: H });
  const [row] = await r.json();
  console.log('latest:', row.id, 'name=' + row.params.name, 'mood=' + row.params.mood, 'share-flag=' + row.params.share);
  console.log('timing entries:', (row.params.timing || []).length, 'first:', JSON.stringify((row.params.timing || [])[0]));

  // 共有ページが読む公開 JSON（キーなしで取得）
  const j = await fetch(`${url}/storage/v1/object/public/readings/${row.id}.json`);
  const meta = await j.json();
  console.log('public json: HTTP', j.status, 'keys=' + Object.keys(meta).join(','));
  console.log('wav url ok:', (await fetch(meta.wav, { method: 'HEAD' })).status);
  console.log('QR target:', share + '?id=' + row.id);
})();
