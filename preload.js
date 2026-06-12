const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // VOICEVOX API プロキシ。JSON は {kind:'json', data}, 音声は {kind:'bin', data:ArrayBuffer}
  vv: (path, method = 'GET', body = null) => ipcRenderer.invoke('vv', { path, method, body }),
  // クラウドライブラリ（Supabase）
  cloudSave: (entry, wav) => ipcRenderer.invoke('cloud:save', { entry, wav }),
  cloudList: () => ipcRenderer.invoke('cloud:list'),
  shareConfig: () => ipcRenderer.invoke('share:config'),
  // ローカルバックアップ
  librarySave: (entry) => ipcRenderer.invoke('library:save', entry),
  libraryList: () => ipcRenderer.invoke('library:list')
});
