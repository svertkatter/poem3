// 直近に保存された読みの行とWAVを検証する
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
const H = { apikey: key, Authorization: 'Bearer ' + key };

(async () => {
  const r = await fetch(`${url}/rest/v1/readings?select=id,url,params,created_at&params->>app=eq.anzuyo&order=created_at.desc&limit=3`, { headers: H });
  const rows = await r.json();
  console.log('anzuyo rows:', rows.length);
  for (const row of rows) {
    const p = row.params;
    console.log(`- ${row.id} name=${p.name} mood=${p.mood} voice=${p.voice} v=${p.v} lines=${p.data ? p.data.chars.length : '(no data)'}`);
  }
  if (rows[0]) {
    const a = await fetch(rows[0].url);
    const buf = Buffer.from(await a.arrayBuffer());
    console.log(`wav: HTTP ${a.status} size=${(buf.length / 1024).toFixed(0)}KB header=${buf.slice(0, 4)} fmt=${buf.slice(8, 12)} rate=${buf.readUInt32LE(24)}Hz dur=${(buf.readUInt32LE(40) / 2 / buf.readUInt32LE(24)).toFixed(1)}s`);
  }
})();
