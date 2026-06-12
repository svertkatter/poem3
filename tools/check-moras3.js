// 最終的に採用するカタカナ読みの検証
const POEM = [
  { read: 'アンズヨ', expected: 4 },
  { read: 'ハナツケ', expected: 4 },
  { read: 'チゾハヤニカガヤケ', expected: 9 },
  { read: 'アンズヨハナツケ', expected: 8 },
  { read: 'アンズヨモエヨ', expected: 7 },
  { read: 'アア、アンズヨハナツケ', expected: 10 }
];

(async () => {
  for (const p of POEM) {
    const res = await fetch(`http://127.0.0.1:50021/audio_query?speaker=3&text=${encodeURIComponent(p.read)}`, { method: 'POST' });
    const q = await res.json();
    let voiced = 0; const kana = [];
    for (const ap of q.accent_phrases) {
      for (const m of ap.moras) { voiced++; kana.push(m.text); }
      if (ap.pause_mora) kana.push('(pau)');
    }
    const ok = voiced === p.expected ? 'OK ' : 'NG!';
    console.log(`${ok} ${p.read} -> ${voiced} moras (expected ${p.expected}): ${kana.join(' ')}`);
  }
})();
