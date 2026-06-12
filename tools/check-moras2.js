// 「はなつけ」の誤読（ワナツケ）対策の候補を検証する
const CANDIDATES = ['ハナツケ', '花つけ', '花着け', 'はな着け', 'はなツケ'];

(async () => {
  for (const text of CANDIDATES) {
    const res = await fetch(`http://127.0.0.1:50021/audio_query?speaker=3&text=${encodeURIComponent(text)}`, { method: 'POST' });
    const q = await res.json();
    const kana = [];
    for (const ap of q.accent_phrases) {
      for (const m of ap.moras) kana.push(m.text);
      if (ap.pause_mora) kana.push('(pau)');
    }
    console.log(`${text} -> ${kana.join(' ')}`);
  }
})();
