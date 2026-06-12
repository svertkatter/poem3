// supabase-config.js を読み、プロジェクトの状態（テーブル・バケット）を調べる。
// キーそのものは絶対に出力しない。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!url || !key) { console.log('config parse: FAILED'); process.exit(1); }
console.log('config parse: OK url=' + url + ' key=(' + key.length + ' chars, hidden)');

const H = { apikey: key, Authorization: 'Bearer ' + key };

(async () => {
  // テーブル readings はあるか
  for (const table of ['readings', 'library', 'yomi']) {
    try {
      const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: H });
      console.log(`table ${table}: HTTP ${r.status} ${r.status !== 200 ? (await r.text()).slice(0, 120) : 'OK rows=' + (await r.json()).length}`);
    } catch (e) { console.log(`table ${table}: ERR ${e.message}`); }
  }
  // ストレージバケット一覧（anonでは403のことが多い）
  try {
    const r = await fetch(`${url}/storage/v1/bucket`, { headers: H });
    console.log(`bucket list: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) { console.log(`bucket list: ERR ${e.message}`); }
  // readings バケットに対する list
  try {
    const r = await fetch(`${url}/storage/v1/object/list/readings`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1 })
    });
    console.log(`bucket readings list: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  } catch (e) { console.log(`bucket readings: ERR ${e.message}`); }
})();
