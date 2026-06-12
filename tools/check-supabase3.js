// anon キーでの書き込み権限を確認する（プローブ行は最後に削除を試みる）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
const H = { apikey: key, Authorization: 'Bearer ' + key };

(async () => {
  const id = 'probe-' + Date.now().toString(36);

  // 1. ストレージへのアップロード（ダミーWAVヘッダ44byte）
  const dummy = Buffer.alloc(44);
  dummy.write('RIFF', 0); dummy.write('WAVEfmt ', 8);
  let r = await fetch(`${url}/storage/v1/object/readings/${id}.wav`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'audio/wav' }, body: dummy
  });
  console.log('storage upload:', r.status, r.status >= 300 ? (await r.text()).slice(0, 150) : 'OK');

  // 2. 公開URLで読めるか
  r = await fetch(`${url}/storage/v1/object/public/readings/${id}.wav`);
  console.log('public read:', r.status, r.status >= 300 ? (await r.text()).slice(0, 100) : 'OK');

  // 3. テーブル insert（オブジェクト型 params）
  r = await fetch(`${url}/rest/v1/readings`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ id, url: `${url}/storage/v1/object/public/readings/${id}.wav`, params: { app: 'anzuyo', probe: true } })
  });
  console.log('table insert:', r.status, r.status >= 300 ? (await r.text()).slice(0, 150) : 'OK');

  // 4. app=anzuyo でのフィルタ取得
  r = await fetch(`${url}/rest/v1/readings?select=id&params->>app=eq.anzuyo`, { headers: H });
  console.log('filter query:', r.status, JSON.stringify(await r.json()).slice(0, 100));

  // 5. 後片付け（delete 権限の確認も兼ねる）
  r = await fetch(`${url}/rest/v1/readings?id=eq.${id}`, { method: 'DELETE', headers: H });
  console.log('table delete:', r.status, r.status >= 300 ? (await r.text()).slice(0, 100) : 'OK');
  r = await fetch(`${url}/storage/v1/object/readings/${id}.wav`, { method: 'DELETE', headers: H });
  console.log('storage delete:', r.status, r.status >= 300 ? (await r.text()).slice(0, 100) : 'OK');
})();
