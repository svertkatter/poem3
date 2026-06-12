// 各行の読みをVOICEVOXに問い合わせ、有声モーラ数が文字対応表と一致するか確認する
const POEM = [
  { read: 'あんずよ', expected: 4 },
  { read: 'はなつけ', expected: 4 },
  { read: 'ちぞはやにかがやけ', expected: 9 },
  { read: 'あんずよはなつけ', expected: 8 },
  { read: 'あんずよもえよ', expected: 7 },
  { read: 'ああ、あんずよはなつけ', expected: 10 }
];

(async () => {
  for (const p of POEM) {
    const res = await fetch(`http://127.0.0.1:50021/audio_query?speaker=3&text=${encodeURIComponent(p.read)}`, { method: 'POST' });
    const q = await res.json();
    let voiced = 0, kana = [];
    for (const ap of q.accent_phrases) {
      for (const m of ap.moras) { voiced++; kana.push(m.text); }
      if (ap.pause_mora) kana.push('(pau)');
    }
    const ok = voiced === p.expected ? 'OK ' : 'NG!';
    console.log(`${ok} ${p.read} -> ${voiced} moras (expected ${p.expected}): ${kana.join(' ')}`);
  }
})();
