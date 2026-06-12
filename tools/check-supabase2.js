// readings テーブルの行構造（カラム名と値の型だけ）を確認する
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
const H = { apikey: key, Authorization: 'Bearer ' + key };

(async () => {
  const r = await fetch(`${url}/rest/v1/readings?select=*&limit=3&order=created_at.desc`, { headers: H });
  const rows = await r.json();
  console.log('rows:', rows.length);
  for (const row of rows) {
    const shape = {};
    for (const [k, v] of Object.entries(row)) {
      shape[k] = Array.isArray(v) ? `array(${v.length})` : typeof v === 'object' && v ? 'object:' + Object.keys(v).slice(0, 6).join('|') : typeof v + ':' + String(v).slice(0, 60);
    }
    console.log(JSON.stringify(shape, null, 1));
  }
})();
