const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const VOICEVOX_URL = 'http://127.0.0.1:50021';

// タッチパネル展示用
app.commandLine.appendSwitch('touch-events', 'enabled');

function createWindow() {
  const kiosk = process.argv.includes('--kiosk');
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    fullscreen: kiosk,
    backgroundColor: '#f7f2e8',
    title: 'ecoar — あんずよ',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (kiosk) win.setMenuBarVisibility(false);

  // 左上の「ファイル」メニューからフルスクリーンを切り替えられるようにする
  // （--kiosk での起動に頼らず、展示中もあとから調整できるように）
  const fullscreenItem = {
    label: 'フルスクリーン',
    type: 'checkbox',
    checked: kiosk,
    accelerator: 'F11',
    click: (item) => { win.setFullScreen(item.checked); }
  };
  const menu = Menu.buildFromTemplate([
    {
      label: 'ファイル',
      submenu: [
        fullscreenItem,
        { type: 'separator' },
        { role: 'quit', label: '終了' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  // F11 などウィンドウ操作で直接フルスクリーンが切り替わったときも、
  // メニューのチェック状態を合わせておく。フルスクリーン中は展示の見た目を
  // 保つため、メニューバー自体も隠す（ウィンドウ表示にもどすと再表示される）
  win.on('enter-full-screen', () => {
    fullscreenItem.checked = true;
    win.setMenuBarVisibility(false);
  });
  win.on('leave-full-screen', () => {
    fullscreenItem.checked = false;
    win.setMenuBarVisibility(true);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ---- VOICEVOX プロキシ（CORS 回避のためメインプロセス経由で通信する） ----
ipcMain.handle('vv', async (_e, { path: p, method = 'GET', body = null }) => {
  const res = await fetch(VOICEVOX_URL + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`VOICEVOX ${res.status} ${p} ${detail.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { kind: 'json', data: await res.json() };
  }
  return { kind: 'bin', data: await res.arrayBuffer() };
});

// ============================================================
// Supabase クラウドライブラリ
// 設定は supabase-config.js から実行時に読む（ソースに埋め込まない）。
// キーは publishable(anon) キーで、RLS の範囲でのみ使われる。
// ============================================================
let sbConfig = null;
function loadSupabaseConfig() {
  if (sbConfig) return sbConfig;
  const candidates = [
    path.join(__dirname, 'supabase-config.js'),
    process.resourcesPath ? path.join(process.resourcesPath, 'supabase-config.js') : null
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const url = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
      const key = (src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
      const share = (src.match(/SHARE_PAGE_URL\s*=\s*"([^"]+)"/) || [])[1] || null;
      if (url && key) { sbConfig = { url, key, share }; return sbConfig; }
    } catch (_) { /* 次の候補へ */ }
  }
  return null;
}

function sbHeaders(extra = {}) {
  const c = loadSupabaseConfig();
  return { apikey: c.key, Authorization: 'Bearer ' + c.key, ...extra };
}

// 共有ページの URL を組み立てる（未設定なら null）
function shareUrlFor(id) {
  const c = loadSupabaseConfig();
  if (!c || !c.share) return null;
  return c.share + (c.share.includes('?') ? '&' : '?') + 'id=' + id;
}

ipcMain.handle('share:config', () => {
  const c = loadSupabaseConfig();
  return { share: c ? c.share : null };
});

// 読みを保存:
//   WAV（声そのもの）とメタデータ JSON をストレージへ、行をテーブルへ。
//   JSON は共有ページが「キーなしで」読めるように公開バケットに置く
ipcMain.handle('cloud:save', async (_e, { entry, wav }) => {
  const c = loadSupabaseConfig();
  if (!c) return { ok: false, error: 'no-config' };
  const id = 'anzuyo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const up = await fetch(`${c.url}/storage/v1/object/readings/${id}.wav`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'audio/wav' }),
      body: Buffer.from(wav)
    });
    if (!up.ok) throw new Error('storage ' + up.status);
    const publicUrl = `${c.url}/storage/v1/object/public/readings/${id}.wav`;

    const meta = { id, wav: publicUrl, ...entry };
    const upJson = await fetch(`${c.url}/storage/v1/object/readings/${id}.json`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(meta)
    });
    if (!upJson.ok) throw new Error('storage-json ' + upJson.status);

    const ins = await fetch(`${c.url}/rest/v1/readings`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, url: publicUrl, params: { ...entry, share: true } })
    });
    if (!ins.ok) throw new Error('insert ' + ins.status);
    return { ok: true, id, url: publicUrl, share: shareUrlFor(id) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// クラウドの読み一覧（この作品の分だけ）
ipcMain.handle('cloud:list', async () => {
  const c = loadSupabaseConfig();
  if (!c) return { ok: false, error: 'no-config' };
  try {
    // 'ecoar' が現在のアプリ識別子。'anzuyo' は改名前（あんずよ）の旧データとの後方互換
    const res = await fetch(
      `${c.url}/rest/v1/readings?select=id,url,params,created_at&or=(params->>app.eq.ecoar,params->>app.eq.anzuyo)&order=created_at.desc&limit=100`,
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error('list ' + res.status);
    return { ok: true, rows: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// ---- ローカルバックアップ（クラウドが届かないときの逃げ場） ----
function libraryDir() {
  const dir = path.join(app.getPath('userData'), 'library');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('library:save', (_e, entry) => {
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = { id, ...entry };
  fs.writeFileSync(path.join(libraryDir(), id + '.json'), JSON.stringify(record), 'utf8');
  return id;
});

ipcMain.handle('library:list', () => {
  const dir = libraryDir();
  const entries = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (_) { /* 壊れたファイルは無視 */ }
  }
  entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return entries;
});
