/* ============================================================
   あんずよ — 詩の読みをさがす
   室生犀星『抒情小曲集』「小景異情 その六」

   文字そのものを手でうごかして、声の高さ・ながさ・つよさ・
   間（ま）を調整し、自分の「読み」をさがすための作品。

   - 上下ドラッグ   → 高さ（文字は背伸びし、低いとずんぐりする）
   - 左右ドラッグ   → ながさ（文字そのものが横に伸びる）
   - 二本指でひらく → つよさ（文字の大きさと声の強さ）
   - 行間ドラッグ   → 間（行のあいだのポーズ秒数）
   - ダブルタップ   → その文字／行間をもとにもどす

   原文（漢字まじり）は扉の画面にかかげ、操作面はひらがな。
   「花」の「は」だけを高くする、といった一音ごとの調整ができる。
   読みは Supabase のライブラリに保存され、QR コードで持ち帰れる。
   ============================================================ */

'use strict';

// ---------------- 詩のデータ ----------------
// disp: 操作面に出すひらがな（1文字=1モーラ）。read: VOICEVOX に渡す読み。
// 読みはカタカナで固定する（ひらがなだと「はなつけ」の「は」が
// 助詞ワと誤読されるため。カタカナなら全行で正しいモーラが得られる）
const POEM = [
  { disp: 'あんずよ',             read: 'アンズヨ' },
  { disp: 'はなつけ',             read: 'ハナツケ' },
  { disp: 'ちぞはやにかがやけ',   read: 'チゾハヤニカガヤケ' },
  { disp: 'あんずよはなつけ',     read: 'アンズヨハナツケ' },
  { disp: 'あんずよもえよ',       read: 'アンズヨモエヨ' },
  { disp: 'ああ　あんずよはなつけ', read: 'アア、アンズヨハナツケ' }
];

// ---------------- 調整パラメータの範囲 ----------------
const PITCH_MIN = -1.2, PITCH_MAX = 1.2;   // 正規化ピッチ（×0.5 が logF0 オフセット）
const DUR_MIN = 0.45, DUR_MAX = 2.6;       // モーラ長の倍率
const VOL_MIN = 0.45, VOL_MAX = 2.2;       // つよさ（小さくしても聞こえる下限にする）
const GAP_MIN = 0.12, GAP_MAX = 2.5;       // 行間ポーズ（秒）
const GAP_DEFAULT = 0.8;

// ---------------- 見た目の定数 ----------------
const BASE = 56;                 // 基準文字サイズ(px)
const SLOT = BASE * 1.18;        // dur=1 のときの文字送り幅
const LINE_SPACE = BASE * 1.85;  // 行の基本間隔
const GAP_PX = 64;               // 行間 1秒 あたりのピクセル
const PITCH_PX = 80;             // ピッチ 1.0 あたりのピクセル（行をまたぎにくい振幅に）

const INK = [46, 42, 36];
const INK_SOFT = [122, 113, 100];
const ANZU = [224, 133, 66];
const ANZU_DEEP = [201, 106, 40];

// ---------------- 声（3つの選択肢に絞る） ----------------
const VOICES = [
  { id: 'feminine',  label: '女性的', desc: 'すこし芯のある、女のひとのこえ', styleId: 6,  fallbackNames: ['四国めたん'] },
  { id: 'neutral',   label: '中性的', desc: 'やわらかい、こどものようなこえ', styleId: 3,  fallbackNames: ['ずんだもん'] },
  { id: 'masculine', label: '男性的', desc: 'ひくく、おちついたこえ',         styleId: 13, fallbackNames: ['青山龍星', '玄野武宏'] }
];
let voiceClass = 'feminine';
let resolvedVoices = {};         // id -> styleId（接続時に実在を確認して決める）

function currentSpeakerId() { return resolvedVoices[voiceClass] ?? 3; }
function currentVoiceDef() { return VOICES.find(v => v.id === voiceClass); }

// ---------------- 名前とムード（花のいろ） ----------------
const MOODS = {
  shizuka: { pale: '#eef2f5', main: '#8fa3b8', deep: '#5d7185', adj: ['しずかな', 'ひそやかな', 'ねむたい'] },
  attaka:  { pale: '#fdf0e3', main: '#e8a06b', deep: '#c97a3d', adj: ['あたたかい', 'やわらかな', 'はるめいた'] },
  moeru:   { pale: '#fbe9e2', main: '#d4502e', deep: '#a33518', adj: ['燃えるような', 'まばゆい', 'たぎるような'] },
  hazumu:  { pale: '#f3f5e3', main: '#a8b545', deep: '#76842b', adj: ['はずむ', 'かろやかな', 'おどるような'] },
  tooi:    { pale: '#f0eef7', main: '#9b8fc0', deep: '#6f6395', adj: ['とおくの', 'ゆめみる', 'かすかな'] },
  massugu: { pale: '#e9f2ef', main: '#69997f', deep: '#41705c', adj: ['まっすぐな', 'りんとした', 'すきとおる'] }
};
const NOUNS = ['読み', 'こえ', 'うた', 'いのり', 'ひとりごと', 'あんず'];

// ---------------- 状態 ----------------
let lines = [];                  // {read, chars:[{ch,space,pitch,dur,vol}], gapAfter, cache}
let layout = null;
let connected = false;

let audioCtx = null, masterGain = null;
let playing = false, playSeq = 0, playSources = [];
let highlightPlan = [];          // {li, ci, t0, t1} AudioContext 絶対時刻
let playEndTime = 0;

let pointers = new Map();
let pinch = null;
let dragLabel = null;
let lastTap = { time: 0, x: -99, y: -99 };
let helpShownOnce = false;
let introShownOnce = false;
let playingCardKey = null;
let shareBase = null;            // 共有ページの URL（supabase-config.js の SHARE_PAGE_URL）

function buildShareUrl(id) {
  if (!shareBase) return null;
  return shareBase + (shareBase.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(id);
}

function resetLines() {
  lines = POEM.map(p => ({
    read: p.read,
    chars: [...p.disp].map(ch => {
      const space = (ch === '　' || ch === ' ');
      return { ch, space, pitch: 0, dur: 1, vol: 1 };
    }),
    gapAfter: GAP_DEFAULT,
    cache: null
  }));
}
resetLines();

function invalidateAllCache() { lines.forEach(l => { l.cache = null; }); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ============================================================
// p5.js — 描画とレイアウト
// ============================================================
function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('stage');
  // p5 は空白を含むフォント名全体を引用符で包むため、カンマ区切りの
  // 複数指定は不正な CSS になる。単一名で指定する
  textFont('Yu Mincho');
  textAlign(CENTER, CENTER);

  const el = c.elt;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', e => e.preventDefault());

  initUI();
  window.api.shareConfig().then(r => { shareBase = r.share; }).catch(() => {});
  connectLoop();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

function sizeFactor(vol) { return 0.62 + 0.38 * vol; }

function computeLayout() {
  const linePos = [];
  let y = 0, maxW = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let x = 0;
    const cps = [];
    for (const ch of line.chars) {
      const w = SLOT * (ch.space ? 0.55 : ch.dur);
      cps.push({ cx: x + w / 2, w });
      x += w;
    }
    linePos.push({ y, lineW: x, cps });
    maxW = Math.max(maxW, x);
    if (li < lines.length - 1) y += LINE_SPACE + line.gapAfter * GAP_PX;
  }
  const totalH = y + BASE * 2.2;
  const topPad = 104, bottomPad = 116;
  const availW = width - 110, availH = height - topPad - bottomPad;
  const s = Math.min(1, availW / maxW, availH / totalH);
  const ox = width / 2;
  const oy = topPad + Math.max(0, (availH - totalH * s) / 2) + BASE * s;
  return { linePos, s, ox, oy };
}

function toPoem(px, py) { return { x: (px - layout.ox) / layout.s, y: (py - layout.oy) / layout.s }; }

function charPos(li, ci) {
  const lp = layout.linePos[li];
  const c = lines[li].chars[ci];
  return { x: lp.cps[ci].cx - lp.lineW / 2, y: lp.y - c.pitch * PITCH_PX, w: lp.cps[ci].w };
}

// いまユーザーが手をふれている行（描画のフォーカスに使う）
function focusedLines() {
  const set = new Set();
  if (pinch) { set.add(pinch.li); }
  for (const st of pointers.values()) {
    if (st.hit) set.add(st.hit.li);
    else if (st.gap !== null && st.gap !== undefined) { set.add(st.gap); set.add(st.gap + 1); }
  }
  return set;
}

function draw() {
  clear();
  layout = computeLayout();

  let active = null;
  if (playing && audioCtx) {
    const now = audioCtx.currentTime;
    for (const h of highlightPlan) {
      if (now >= h.t0 && now < h.t1) { active = h; break; }
    }
    if (now > playEndTime) stopPlayback(true);
  }

  const focus = focusedLines();
  const interacting = focus.size > 0;

  push();
  translate(layout.ox, layout.oy);
  scale(layout.s);

  for (let li = 0; li < lines.length; li++) {
    const lp = layout.linePos[li];
    const line = lines[li];
    const x0 = -lp.lineW / 2;
    // 操作中はふれている行だけを浮かび上がらせ、ほかは紙に沈める
    const lineAlpha = !interacting ? 255 : (focus.has(li) ? 255 : 80);

    // 基準線（声の高さ 0 のしるし）— ふれている行だけ少し濃く
    drawingContext.setLineDash([2, 7]);
    stroke(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2], focus.has(li) ? 110 : (interacting ? 26 : 60));
    strokeWeight(1);
    lineSeg(x0 - BASE * 0.3, lp.y, x0 + lp.lineW + BASE * 0.3, lp.y);
    drawingContext.setLineDash([]);

    for (let ci = 0; ci < line.chars.length; ci++) {
      const c = line.chars[ci];
      if (c.space) continue;
      const p = charPos(li, ci);
      const isActive = active && active.li === li && active.ci === ci;

      // 基準線から離れた文字には、細い糸を垂らして高さを見せる
      const dy = lp.y - p.y;
      if (Math.abs(dy) > 7) {
        stroke(ANZU[0], ANZU[1], ANZU[2], Math.min(110, lineAlpha));
        strokeWeight(1.2);
        lineSeg(p.x, lp.y, p.x, p.y + Math.sign(dy) * BASE * 0.42 * sizeFactor(c.vol));
        noStroke();
        fill(ANZU[0], ANZU[1], ANZU[2], Math.min(150, lineAlpha));
        circle(p.x, lp.y, 4);
      }

      // 文字のかたち＝声のかたち
      //   ながさ → 横に伸びる / 高さ → 背伸び・ずんぐり / つよさ → 大きさ
      const sx = 0.62 + 0.38 * c.dur;          // 0.45→0.79, 1→1.0, 2.6→1.61
      const sy = 1 + c.pitch * 0.20;           // 高い声は細く背が高く、低い声はひくくなる
      const size = BASE * sizeFactor(c.vol);

      push();
      translate(p.x, p.y);
      scale(sx, sy);
      noStroke();
      if (isActive) {
        drawingContext.shadowColor = 'rgba(224,133,66,0.75)';
        drawingContext.shadowBlur = 26 * layout.s;
        fill(ANZU_DEEP[0], ANZU_DEEP[1], ANZU_DEEP[2]);
        textSize(size * 1.1);
      } else {
        drawingContext.shadowBlur = 0;
        fill(INK[0], INK[1], INK[2], lineAlpha);
        textSize(size);
      }
      text(c.ch, 0, 0);
      drawingContext.shadowBlur = 0;
      pop();
    }
  }
  pop();

  // ドラッグ中の値ラベル
  if (dragLabel) {
    noStroke();
    textSize(14);
    const tw = textWidth(dragLabel.text) + 26;
    fill(46, 42, 36, 200);
    rect(dragLabel.x - tw / 2, dragLabel.y - 38, tw, 28, 14);
    fill(253, 248, 239);
    text(dragLabel.text, dragLabel.x, dragLabel.y - 24);
  }
}

// p5 の line() をローカル変数 line と衝突させないための別名
function lineSeg(x1, y1, x2, y2) { line(x1, y1, x2, y2); }

// ============================================================
// 操作（ポインタ＝タッチ／マウス共通）
// ============================================================
function hitChar(pp) {
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].chars.length; ci++) {
      const c = lines[li].chars[ci];
      if (c.space) continue;
      const p = charPos(li, ci);
      const hw = Math.max(p.w, BASE * 0.95) / 2;
      const hh = BASE * 0.85;
      if (pp.x > p.x - hw && pp.x < p.x + hw && pp.y > p.y - hh && pp.y < p.y + hh) {
        return { li, ci };
      }
    }
  }
  return null;
}

function hitGap(pp) {
  for (let li = 0; li < lines.length - 1; li++) {
    const y1 = layout.linePos[li].y + BASE * 0.7;
    const y2 = layout.linePos[li + 1].y - BASE * 0.85;
    if (pp.y > y1 && pp.y < Math.max(y2, y1 + 14)) return li;
  }
  return null;
}

function onPointerDown(e) {
  e.preventDefault();
  if (!connected) return;
  if (playing) stopPlayback();
  resumeAudio();

  const pp = toPoem(e.clientX, e.clientY);
  const hit = hitChar(pp);
  const gap = hit ? null : hitGap(pp);

  const now = performance.now();
  const isDouble = (now - lastTap.time < 380) &&
    Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
  lastTap = { time: now, x: e.clientX, y: e.clientY };
  if (isDouble) {
    if (hit) {
      const c = lines[hit.li].chars[hit.ci];
      c.pitch = 0; c.dur = 1; c.vol = 1;
      lines[hit.li].cache = null;
    } else if (gap !== null) {
      lines[gap].gapAfter = GAP_DEFAULT;
    }
    return;
  }

  // 2本目の指：どちらかの指が文字の上ならピンチ（つよさ）に移行
  if (pointers.size === 1) {
    const first = pointers.values().next().value;
    const target = first.hit || hit;
    if (target) {
      const dist = Math.hypot(e.clientX - first.sx, e.clientY - first.sy);
      pinch = { ...target, startDist: Math.max(dist, 40), startVol: lines[target.li].chars[target.ci].vol };
      dragLabel = null;
    }
  }

  pointers.set(e.pointerId, {
    sx: e.clientX, sy: e.clientY,
    hit, gap,
    axis: null,
    startPitch: hit ? lines[hit.li].chars[hit.ci].pitch : 0,
    startDur: hit ? lines[hit.li].chars[hit.ci].dur : 1,
    startGap: gap !== null ? lines[gap].gapAfter : 0
  });
  e.target.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  const st = pointers.get(e.pointerId);
  if (!st) return;
  e.preventDefault();

  if (pinch && pointers.size >= 2) {
    const pts = [...pointers.keys()];
    const a = (e.pointerId === pts[0]) ? { x: e.clientX, y: e.clientY } : lastPointerPos(pts[0]);
    const b = (e.pointerId === pts[1]) ? { x: e.clientX, y: e.clientY } : lastPointerPos(pts[1]);
    st.lx = e.clientX; st.ly = e.clientY;
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const c = lines[pinch.li].chars[pinch.ci];
      c.vol = clamp(pinch.startVol * (dist / pinch.startDist), VOL_MIN, VOL_MAX);
      const p = charPos(pinch.li, pinch.ci);
      dragLabel = {
        text: `つよさ ×${c.vol.toFixed(2)}`,
        x: layout.ox + p.x * layout.s,
        y: layout.oy + (p.y - BASE) * layout.s
      };
    }
    return;
  }
  st.lx = e.clientX; st.ly = e.clientY;

  const dx = (e.clientX - st.sx) / layout.s;
  const dy = (e.clientY - st.sy) / layout.s;

  if (st.hit) {
    if (!st.axis && Math.hypot(dx, dy) * layout.s > 9) {
      st.axis = Math.abs(dy) > Math.abs(dx) ? 'pitch' : 'dur';
    }
    if (!st.axis) return;
    const c = lines[st.hit.li].chars[st.hit.ci];
    if (st.axis === 'pitch') {
      c.pitch = clamp(st.startPitch - dy / PITCH_PX, PITCH_MIN, PITCH_MAX);
    } else {
      c.dur = clamp(st.startDur + dx / (SLOT * 1.1), DUR_MIN, DUR_MAX);
    }
    lines[st.hit.li].cache = null;
    const p = charPos(st.hit.li, st.hit.ci);
    dragLabel = {
      text: st.axis === 'pitch'
        ? `たかさ ${c.pitch >= 0 ? '+' : ''}${c.pitch.toFixed(2)}`
        : `ながさ ×${c.dur.toFixed(2)}`,
      x: layout.ox + p.x * layout.s,
      y: layout.oy + (p.y - BASE) * layout.s
    };
  } else if (st.gap !== null) {
    lines[st.gap].gapAfter = clamp(st.startGap + dy / GAP_PX, GAP_MIN, GAP_MAX);
    const midY = (layout.linePos[st.gap].y + layout.linePos[st.gap + 1].y) / 2;
    dragLabel = {
      text: `ま ${lines[st.gap].gapAfter.toFixed(2)} 秒`,
      x: layout.ox,
      y: layout.oy + midY * layout.s + 16
    };
  }
}

function lastPointerPos(id) {
  const st = pointers.get(id);
  if (!st) return null;
  return { x: st.lx !== undefined ? st.lx : st.sx, y: st.ly !== undefined ? st.ly : st.sy };
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) {
    if (pinch) lines[pinch.li].cache = null;
    pinch = null;
  }
  if (pointers.size === 0) dragLabel = null;
}

function onWheel(e) {
  if (!connected) return;
  e.preventDefault();
  const pp = toPoem(e.clientX, e.clientY);
  const hit = hitChar(pp);
  if (!hit) return;
  const c = lines[hit.li].chars[hit.ci];
  c.vol = clamp(c.vol * Math.exp(-e.deltaY * 0.0014), VOL_MIN, VOL_MAX);
  lines[hit.li].cache = null;
}

// ============================================================
// VOICEVOX — 接続・合成
// ============================================================
async function vvJson(path, method = 'GET', body = null) {
  const r = await window.api.vv(path, method, body);
  return r.data;
}

async function connectLoop() {
  const overlay = document.getElementById('connect-overlay');
  for (;;) {
    try {
      await vvJson('/version');
      connected = true;
      overlay.classList.add('hidden');
      await resolveVoices();
      if (!introShownOnce) showIntro();
      return;
    } catch (_) {
      connected = false;
      overlay.classList.remove('hidden');
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

// 3つの「こえ」を実在するスタイル ID に解決する
async function resolveVoices() {
  try {
    const raw = await vvJson('/speakers');
    const allStyleIds = new Set();
    const byName = new Map();
    for (const sp of raw) {
      byName.set(sp.name, sp);
      for (const st of sp.styles) allStyleIds.add(st.id);
    }
    for (const v of VOICES) {
      if (allStyleIds.has(v.styleId)) {
        resolvedVoices[v.id] = v.styleId;
        continue;
      }
      for (const name of v.fallbackNames) {
        const sp = byName.get(name);
        if (sp) { resolvedVoices[v.id] = sp.styles[0].id; break; }
      }
      if (resolvedVoices[v.id] === undefined) resolvedVoices[v.id] = 3;
    }
    updateVoiceChip();
  } catch (e) { console.error('speakers', e); }
}

// 1行ぶんの音声を合成（変更がなければキャッシュを使う）
async function ensureLineAudio(line) {
  const speakerId = currentSpeakerId();
  const fingerprint = JSON.stringify([
    speakerId, line.read,
    line.chars.map(c => [c.pitch.toFixed(3), c.dur.toFixed(3), c.vol.toFixed(3)])
  ]);
  if (line.cache && line.cache.fingerprint === fingerprint) return line.cache;

  const q = await vvJson(`/audio_query?speaker=${speakerId}&text=${encodeURIComponent(line.read)}`, 'POST');

  const seq = [];
  for (const ap of q.accent_phrases) {
    for (const m of ap.moras) seq.push({ m, pause: false });
    if (ap.pause_mora) seq.push({ m: ap.pause_mora, pause: true });
  }
  const voiced = seq.filter(x => !x.pause);

  // 表示文字（ひらがな1文字=1モーラ）とモーラの対応付け
  const editable = line.chars.map((c, i) => ({ c, i })).filter(x => !x.c.space);
  if (voiced.length === editable.length) {
    voiced.forEach((x, mi) => { x.charIdx = editable[mi].i; });
  } else {
    voiced.forEach((x, mi) => {
      x.charIdx = editable[Math.min(editable.length - 1, Math.floor(mi * editable.length / voiced.length))].i;
    });
  }

  for (const x of voiced) {
    const c = line.chars[x.charIdx];
    if (x.m.pitch > 0) x.m.pitch = clamp(x.m.pitch + c.pitch * 0.5, 4.2, 6.7);
    if (x.m.consonant_length != null) x.m.consonant_length *= c.dur;
    x.m.vowel_length *= c.dur;
  }
  q.speedScale = 1;
  q.pitchScale = 0;
  q.volumeScale = 1;
  q.outputStereo = false;

  let t = q.prePhonemeLength;
  const charSeg = new Map();
  for (const x of seq) {
    const d = (x.m.consonant_length || 0) + x.m.vowel_length;
    if (!x.pause && x.charIdx !== undefined) {
      if (!charSeg.has(x.charIdx)) charSeg.set(x.charIdx, { start: t, end: t + d });
      else charSeg.get(x.charIdx).end = t + d;
    }
    t += d;
  }
  const total = t + q.postPhonemeLength;

  const wavRes = await window.api.vv(`/synthesis?speaker=${speakerId}`, 'POST', q);
  resumeAudio();
  const buf = await audioCtx.decodeAudioData(wavRes.data.slice(0));

  line.cache = { fingerprint, buf, charSeg, total };
  return line.cache;
}

// ============================================================
// 再生（ライブ再生とWAV書き出しで共通のスケジュール）
// ============================================================
function resumeAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    masterGain.connect(comp).connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function buildPlan(caches) {
  let t = 0;
  const items = [];
  lines.forEach((line, li) => {
    const c = caches[li];
    const segs = [...c.charSeg.entries()]
      .sort((a, b) => a[1].start - b[1].start)
      .map(([ci, seg]) => ({
        ci, start: seg.start, end: seg.end,
        // つよさ。下限 VOL_MIN でも聞こえるよう、過度に減衰させない
        vol: Math.pow(line.chars[ci].vol, 1.25)
      }));
    items.push({ li, buf: c.buf, offset: t, segs });
    t += c.total + (li < lines.length - 1 ? line.gapAfter : 0);
  });
  return { items, total: t };
}

function scheduleInto(ctx, dest, plan, t0, highlight = null) {
  const sources = [];
  for (const it of plan.items) {
    const src = ctx.createBufferSource();
    src.buffer = it.buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t0 + it.offset);
    for (const s of it.segs) {
      g.gain.setTargetAtTime(s.vol, t0 + it.offset + Math.max(0, s.start - 0.012), 0.012);
      if (highlight) highlight.push({ li: it.li, ci: s.ci, t0: t0 + it.offset + s.start, t1: t0 + it.offset + s.end });
    }
    src.connect(g).connect(dest);
    src.start(t0 + it.offset);
    sources.push(src);
  }
  return sources;
}

async function synthesizeAll(seqGuard) {
  const caches = [];
  for (const line of lines) {
    caches.push(await ensureLineAudio(line));
    if (seqGuard !== undefined && seqGuard !== playSeq) return null;
  }
  return caches;
}

async function playAll() {
  stopPlayback();
  const seq = ++playSeq;
  resumeAudio();
  setPlayButton('busy');

  let caches;
  try {
    caches = await synthesizeAll(seq);
  } catch (e) {
    console.error(e);
    setPlayButton('idle');
    toast('声がつくれませんでした。VOICEVOX を確認してください');
    connected = false;
    connectLoop();
    return;
  }
  if (!caches || seq !== playSeq) return;

  const plan = buildPlan(caches);
  const t0 = audioCtx.currentTime + 0.18;
  highlightPlan = [];
  playSources = scheduleInto(audioCtx, masterGain, plan, t0, highlightPlan);
  playEndTime = t0 + plan.total + 0.25;
  playing = true;
  setPlayButton('playing');
}

function stopPlayback(natural = false) {
  playSeq++;
  for (const s of playSources) { try { s.stop(); } catch (_) {} }
  playSources = [];
  highlightPlan = [];
  playing = false;
  playingCardKey = null;
  setPlayButton('idle');
  if (natural) onPlaybackFinished();
}

let afterPlayMessage = null;
function onPlaybackFinished() {
  if (afterPlayMessage) { toast(afterPlayMessage); afterPlayMessage = null; }
  document.querySelectorAll('.lib-card.playing').forEach(el => el.classList.remove('playing'));
}

// ---- WAV 書き出し（QR で持ち帰れる音をつくる） ----
async function renderReadingWav(caches) {
  const plan = buildPlan(caches);
  const rate = 24000;
  const lead = 0.05;
  const len = Math.ceil((plan.total + lead + 0.3) * rate);
  const off = new OfflineAudioContext(1, len, rate);
  scheduleInto(off, off.destination, plan, lead);
  const rendered = await off.startRendering();
  return encodeWav(rendered.getChannelData(0), rate);
}

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

// ============================================================
// データの保存形式
// ============================================================
function currentData() {
  return {
    gaps: lines.map(l => l.gapAfter),
    chars: lines.map(l => l.chars.map(c => [
      +c.pitch.toFixed(3), +c.dur.toFixed(3), +c.vol.toFixed(3)
    ]))
  };
}

function applyData(entry) {
  resetLines();
  if (entry.voice && VOICES.some(v => v.id === entry.voice)) {
    voiceClass = entry.voice;
    updateVoiceChip();
  }
  const data = entry.data || {};
  try {
    lines.forEach((l, li) => {
      if (data.gaps && data.gaps[li] !== undefined && li < lines.length - 1) {
        l.gapAfter = clamp(data.gaps[li], GAP_MIN, GAP_MAX);
      }
      l.chars.forEach((c, ci) => {
        const v = data.chars && data.chars[li] && data.chars[li][ci];
        if (!v) return;
        c.pitch = clamp(v[0], PITCH_MIN, PITCH_MAX);
        c.dur = clamp(v[1], DUR_MIN, DUR_MAX);
        c.vol = clamp(v[2], VOL_MIN, VOL_MAX);
      });
    });
  } catch (_) { /* 形式が合わない部分は既定値のまま */ }
}

// ============================================================
// 花 — 読みのパラメータから生成する、その読みのすがた
// ============================================================
function flowerSVG(moodId, data, opts = {}) {
  const mood = MOODS[moodId] || MOODS.attaka;
  const flat = data ? data.chars.flat() : [];
  const pitches = flat.length ? flat.map(v => v[0]) : [0, 0, 0, 0, 0];
  const vols = flat.length ? flat.map(v => v[2]) : [1];
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;

  // 5枚の花びら。長さはピッチの起伏から、幅はつよさから
  const petals = [];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const i0 = Math.floor(k * pitches.length / n);
    const i1 = Math.max(i0 + 1, Math.floor((k + 1) * pitches.length / n));
    const seg = pitches.slice(i0, i1);
    const avg = seg.reduce((a, b) => a + b, 0) / seg.length;
    const lenN = (clamp(avg, -1.2, 1.2) + 1.2) / 2.4;     // 0..1
    const rx = 9 + 4 * clamp(avgVol, 0.45, 2.2) / 2.2 * 2;
    const ry = 15 + 13 * (0.35 + 0.65 * lenN);
    const ang = -90 + k * 72 + (lenN - 0.5) * 14;
    petals.push(`<g transform="rotate(${ang.toFixed(1)})">
      <ellipse cx="0" cy="${(-12 - ry * 0.55).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${mood.main}" opacity="0.92"/>
      <ellipse cx="0" cy="${(-12 - ry * 0.42).toFixed(1)}" rx="${(rx * 0.45).toFixed(1)}" ry="${(ry * 0.55).toFixed(1)}" fill="${mood.pale}" opacity="0.55"/>
    </g>`);
  }
  const play = opts.play
    ? `<polygon points="-3.2,-5 6,0 -3.2,5" fill="#fffaf2"/>`
    : `<circle cx="0" cy="0" r="3.4" fill="${mood.pale}" opacity="0.8"/>`;
  return `<svg viewBox="-50 -50 100 100" xmlns="http://www.w3.org/2000/svg">
    <g>${petals.join('')}</g>
    <circle cx="0" cy="0" r="9.5" fill="${mood.deep}"/>${play}
  </svg>`;
}

// ============================================================
// UI — ボタン・モーダル・ライブラリ
// ============================================================
const $ = (id) => document.getElementById(id);

function setPlayButton(state) {
  const btn = $('btn-play'), label = $('play-label'), icon = btn.querySelector('.play-icon');
  if (state === 'busy') { btn.disabled = true; icon.textContent = '…'; label.textContent = 'こえをつくっています'; }
  else if (state === 'playing') { btn.disabled = false; icon.textContent = '■'; label.textContent = 'とめる'; }
  else { btn.disabled = false; icon.textContent = '▶'; label.textContent = 'よむ'; }
}

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), ms);
}

function updateVoiceChip() { $('btn-voice').textContent = `こえ：${currentVoiceDef().label}`; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay(d, now)) return `きょう ${hm}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return `きのう ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function voiceLabel(id) {
  const v = VOICES.find(x => x.id === id);
  return v ? v.label : '';
}

// ---- 扉（原文） ----
function showIntro() {
  introShownOnce = true;
  $('intro-hint').textContent = helpShownOnce ? '— ふれてとじる —' : '— ふれて、読みをさがしはじめる —';
  $('intro-overlay').classList.remove('hidden');
}

// ---- 名前候補 ----
function makeNameCandidates() {
  const moodIds = Object.keys(MOODS).sort(() => Math.random() - 0.5);
  const used = new Set();
  return moodIds.map(id => {
    const m = MOODS[id];
    let name;
    let guard = 0;
    do {
      name = m.adj[Math.floor(Math.random() * m.adj.length)] + NOUNS[Math.floor(Math.random() * NOUNS.length)];
    } while (used.has(name) && ++guard < 20);
    used.add(name);
    return { mood: id, name };
  });
}

function renderNameCandidates() {
  const wrap = $('name-candidates');
  wrap.innerHTML = '';
  const data = currentData();
  for (const cand of makeNameCandidates()) {
    const m = MOODS[cand.mood];
    const b = document.createElement('button');
    b.className = 'name-card';
    b.style.background = m.pale;
    b.style.borderColor = m.main + '66';
    b.innerHTML = `${flowerSVG(cand.mood, data)}<span class="nm">${escapeHtml(cand.name)}</span>`;
    b.addEventListener('click', () => doSave(cand.name, cand.mood));
    wrap.appendChild(b);
  }
}

// ---- 保存（クラウドへ。とどかなければこの端末に） ----
let saving = false;
async function doSave(name, mood) {
  if (saving) return;
  saving = true;
  $('save-progress').classList.remove('hidden');
  $('save-progress-text').textContent = 'こえをとどけています…';
  $('name-candidates').style.opacity = '0.35';
  $('name-candidates').style.pointerEvents = 'none';

  const entry = {
    app: 'anzuyo', v: 2,
    name, mood,
    voice: voiceClass,
    speakerId: currentSpeakerId(),
    savedAt: Date.now(),
    data: currentData()
  };

  try {
    const caches = await synthesizeAll();
    // 共有ページがカラオケ式に文字を灯せるよう、文字ごとの発声時刻も残す。
    // WAV 書き出し（renderReadingWav）の頭の無音 0.05 秒に合わせる
    const plan = buildPlan(caches);
    const LEAD = 0.05;
    entry.timing = plan.items.flatMap(it => it.segs.map(s => [
      it.li, s.ci,
      +(LEAD + it.offset + s.start).toFixed(3),
      +(LEAD + it.offset + s.end).toFixed(3)
    ]));
    const wav = await renderReadingWav(caches);
    const res = await window.api.cloudSave(entry, wav);
    closeSaveModal();
    if (res.ok) {
      showQR(name, mood, entry.data, res.share || res.url);
    } else {
      await window.api.librarySave(entry);
      toast('とおくまで電波がとどかず、この端末にのこしました');
    }
  } catch (e) {
    console.error(e);
    closeSaveModal();
    try {
      await window.api.librarySave(entry);
      toast('声がつくれなかったので、かたちだけこの端末にのこしました');
    } catch (_) {
      toast('のこせませんでした');
    }
  }
}

function closeSaveModal() {
  saving = false;
  $('save-overlay').classList.add('hidden');
  $('save-progress').classList.add('hidden');
  $('name-candidates').style.opacity = '';
  $('name-candidates').style.pointerEvents = '';
}

// ---- QR ----
function showQR(name, mood, data, url, mode = 'saved') {
  $('qr-title').textContent = mode === 'saved'
    ? `「${name}」をのこしました`
    : `「${name}」をもちかえる`;
  $('qr-flower').innerHTML = flowerSVG(mood, data);
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('qr-box').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  $('qr-overlay').classList.remove('hidden');
}

// ---- みんなの読み ----
async function openLibrary() {
  const listEl = $('library-list');
  listEl.innerHTML = '<div class="lib-empty">よみこんでいます…</div>';
  $('library-overlay').classList.remove('hidden');

  const items = [];
  let cloudOk = false;
  try {
    const res = await window.api.cloudList();
    if (res.ok) {
      cloudOk = true;
      for (const row of res.rows) {
        const p = row.params || {};
        if (p.app !== 'anzuyo' || p.v !== 2 || !p.data) continue;
        items.push({
          key: row.id, name: p.name || 'ななしの読み', mood: p.mood,
          voice: p.voice, data: p.data,
          createdAt: Date.parse(row.created_at), url: row.url,
          // 新しい読みは共有ページへ。古い形式（JSONなし）は音声の直リンクへ
          share: p.share ? buildShareUrl(row.id) : null,
          local: false
        });
      }
    }
  } catch (_) { /* オフライン */ }

  try {
    const locals = await window.api.libraryList();
    for (const en of locals) {
      if (en.app !== 'anzuyo' || en.v !== 2 || !en.data) continue;
      items.push({
        key: 'local-' + en.id, name: en.name || 'ななしの読み', mood: en.mood,
        voice: en.voice, data: en.data,
        createdAt: en.savedAt, url: null, local: true
      });
    }
  } catch (_) {}

  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const sub = $('library-sub');
  if (items.length === 0) {
    sub.textContent = '読みは、人の数だけ。';
    listEl.innerHTML = cloudOk
      ? '<div class="lib-empty">まだ誰の読みもありません。<br>あなたの読みが、この林の最初のひと花になります。</div>'
      : '<div class="lib-empty">とおくのライブラリに、いまは届きません。<br>それでも読みは、この場所でのこせます。</div>';
    return;
  }
  sub.textContent = `いま、${items.length} の花がさいています。花にふれると、その人の読みが聞こえます。`;

  listEl.innerHTML = '';
  for (const it of items) {
    const m = MOODS[it.mood] || MOODS.attaka;
    const card = document.createElement('button');
    card.className = 'lib-card';
    card.style.background = m.pale;
    card.style.borderColor = m.main + '55';
    const meta = [formatWhen(it.createdAt), voiceLabel(it.voice) ? 'こえ：' + voiceLabel(it.voice) : '', it.local ? 'この端末のみ' : '']
      .filter(Boolean).join('　');
    card.innerHTML = `
      <span class="lib-flower">${flowerSVG(it.mood, it.data, { play: true })}</span>
      <span class="lib-body">
        <span class="lib-name">${escapeHtml(it.name)}</span>
        <div class="lib-meta">${meta}</div>
      </span>
      ${(it.share || it.url) ? '<span class="lib-qr" data-qr="1">QR<br>もちかえる</span>' : ''}`;

    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-qr]')) {
        showQR(it.name, it.mood, it.data, it.share || it.url, 'take');
        return;
      }
      applyData(it);
      playingCardKey = it.key;
      // 文字のうごきと声がかさなる瞬間こそが体験の核なので、一覧はとじて詩を見せる
      $('library-overlay').classList.add('hidden');
      afterPlayMessage = 'この読みから、つづきを探してもいい。';
      toast(`「${it.name}」の読みをきいています`);
      playAll();
    });
    listEl.appendChild(card);
  }
}

// ---- 初期化 ----
function initUI() {
  $('btn-play').addEventListener('click', () => {
    if (playing) stopPlayback();
    else playAll();
  });

  $('btn-reset').addEventListener('click', () => {
    stopPlayback();
    resetLines();
    toast('まっさらにもどしました');
  });

  // 扉（原文）
  $('intro-overlay').addEventListener('click', () => {
    $('intro-overlay').classList.add('hidden');
    if (!helpShownOnce) {
      helpShownOnce = true;
      $('help-overlay').classList.remove('hidden');
    }
  });
  $('btn-original').addEventListener('click', showIntro);

  $('btn-help').addEventListener('click', () => $('help-overlay').classList.remove('hidden'));
  $('btn-help-close').addEventListener('click', () => $('help-overlay').classList.add('hidden'));

  // 保存
  $('btn-save').addEventListener('click', () => {
    stopPlayback();
    renderNameCandidates();
    $('save-overlay').classList.remove('hidden');
  });
  $('btn-shuffle').addEventListener('click', renderNameCandidates);
  $('btn-save-cancel').addEventListener('click', closeSaveModal);
  $('btn-qr-close').addEventListener('click', () => $('qr-overlay').classList.add('hidden'));

  // ライブラリ
  $('btn-library').addEventListener('click', openLibrary);
  $('btn-library-close').addEventListener('click', () => $('library-overlay').classList.add('hidden'));

  // こえ
  $('btn-voice').addEventListener('click', () => {
    const listEl = $('voice-list');
    listEl.innerHTML = '';
    for (const v of VOICES) {
      const b = document.createElement('button');
      b.className = 'voice-item' + (v.id === voiceClass ? ' active' : '');
      b.innerHTML = `<div class="vl">${v.label}</div><div class="vd">${v.desc}</div>`;
      b.addEventListener('click', () => {
        voiceClass = v.id;
        updateVoiceChip();
        invalidateAllCache();
        $('voice-overlay').classList.add('hidden');
        toast(`こえが「${v.label}」になりました`);
      });
      listEl.appendChild(b);
    }
    $('voice-overlay').classList.remove('hidden');
  });
  $('btn-voice-close').addEventListener('click', () => $('voice-overlay').classList.add('hidden'));

  // モーダルの背景タップで閉じる（接続待ち・扉・保存中・全画面ページは除く）
  for (const id of ['help-overlay', 'voice-overlay', 'qr-overlay']) {
    $(id).addEventListener('click', (e) => {
      if (e.target === $(id)) $(id).classList.add('hidden');
    });
  }
  $('save-overlay').addEventListener('click', (e) => {
    if (e.target === $('save-overlay') && !saving) closeSaveModal();
  });
}
