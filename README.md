# あんずよ — 詩の読みをさがす

室生犀星『抒情小曲集』より「小景異情　その六」を題材にした
インタラクティブ作品。

> 詩には俳句や短歌のような決まったリズムがない。
> 普段 J-POP に慣れたわたしたちは、詩にも韻やリズム——歌を求めてしまう。
> どんなテンポで、どんな高さで読めばいいのか、わからなくなる。
> この作品では、文字そのものを手でうごかして声を調整し、
> 繰り返し聞きながら、自分のしっくりくる「読み」をさがす。
> 詩に正解の読みはない。解釈は人の数だけ存在する。

## 体験の流れ

1. **扉** — 原文（漢字まじり・縦書き）が掲げられている。ふれると始まる。
2. **操作面** — 詩はひらがな（1文字=1モーラ）で組まれる。
   「花」の「は」だけを高くする、といった一音ごとの調整ができる。
3. 「よむ」で声になる。繰り返し、しっくりくる読みをさがす。
4. 「この読みをのこす」— 候補から名前をえらぶ（名前が花のいろを決める）。
   読みはクラウドのライブラリへ。**QRコード**は読みごとの**共有ページ**を指し、
   スマートフォンでその人の読みのかたちを見ながら聞ける。
5. 「みんなの読み」— 全画面の「読みの林」。読みごとに生成された花が並び、
   ふれると聞こえる。それぞれの花から QR で持ち帰ることもできる。

| 操作 | 変わるもの |
| --- | --- |
| 文字を **上下** にドラッグ | こえの**高さ**（文字は背伸びし、低いとずんぐりする） |
| 文字を **左右** にドラッグ | こえの**ながさ・テンポ**（文字そのものが横に伸びる） |
| 文字の上で **二本指をひらく**（マウスはホイール） | こえの**つよさ**（音量・文字の大きさ。小さくしても聞こえる下限あり） |
| **行と行のあいだ** を上下にドラッグ | ことばの**間（ま）**（行間ポーズ秒数） |
| 文字や行間を **ダブルタップ** | その箇所をもとにもどす |

操作中はふれている行だけが浮かび、ほかの行は紙に沈む。
「こえ」は **女性的／中性的／男性的** の3つから選ぶ
（それぞれ VOICEVOX の style 6 / 3 / 13。起動時に実在を確認し、無ければ代替を探す）。

## 必要なもの

- Windows
- [VOICEVOX](https://voicevox.hiroshiba.jp/)（起動しておくだけでよい。`localhost:50021` を使用）
- 開発時のみ Node.js

## 起動

```
npm install
npm start
```

展示用（フルスクリーン・キオスク）:

```
npx electron . --kiosk
```

VOICEVOX が起動していないときは接続待ち画面になり、
起動を検出すると自動的にはじまります。

## ビルド

```
npm run dist     # dist/ にポータブル exe を生成
npm run build    # dist/win-unpacked/ に展開形式で生成
```

ビルドした exe も、実行する PC で VOICEVOX が起動している必要があります。

## ライブラリ（クラウド）と共有ページ

読みは Supabase に保存されます。

- WAV（書き出した声そのもの）→ Storage バケット `readings/<id>.wav`
- メタデータ JSON（名前・ムード・声・全パラメータ・発声タイミング）→ `readings/<id>.json`
- 一覧用の行 → テーブル `readings` の `params`（jsonb）。
  この作品の行は `params->>app = 'anzuyo'` で識別される
- クラウドに届かないときは `%APPDATA%/AnzuYo/library/` に退避し、
  ライブラリには「この端末のみ」と表示される

QRコードは **共有ページ**（`docs/index.html` を GitHub Pages で公開したもの）の
`?id=<読みのID>` を指します。共有ページは公開 Storage の JSON / WAV だけで動くため、
**API キーを一切含みません**。ページではその人の読みのかたち（文字の高さ・伸び・大きさ・行間）
がそのまま描かれ、再生すると読まれている文字が灯ります。

共有ページの URL は `supabase-config.js` の `SHARE_PAGE_URL` で設定します
（未設定の場合、QR は WAV の直リンクになります）。
接続情報は `supabase-config.js` から実行時に読み込みます（ソースに埋め込まない）。
このファイルは `.gitignore` 済みで、ビルド時は `extraResources` として
exe の隣の `resources/` にコピーされます。キーは publishable (anon) キーで、
RLS で許可された操作（insert / select / upload）だけができます。

## 共有ページの公開（GitHub Pages）

1. GitHub で公開リポジトリ `poem3` を作成（Public。Pages を無料で使うため）
2. このフォルダを push（`supabase-config.js` は .gitignore 済みで上がらない）
3. リポジトリの Settings → Pages → Build and deployment で
   Source: **Deploy from a branch** / Branch: **main**・**/docs** を選択
4. 数分後 `https://<ユーザー名>.github.io/poem3/` で公開される。
   この URL を `supabase-config.js` の `SHARE_PAGE_URL` に設定する

## 技術メモ

- **p5.js** … 詩の描画と文字のダイレクトマニピュレーション（Pointer Events でタッチ・マウス両対応、ピンチ対応）。
  文字は声のかたちに変形する（ながさ→横伸び、高さ→背伸び/ずんぐり、つよさ→大きさ）
- **VOICEVOX ENGINE** … `audio_query` で得たモーラ列を 1 行ずつ編集して `synthesis`。
  - 高さ → モーラの `pitch`（logF0）にオフセット
  - ながさ → `consonant_length` / `vowel_length` を倍率変更
  - つよさ → Web Audio の GainNode で文字区間ごとにオートメーション（VOICEVOX はモーラ単位の音量を持たないため）
  - 間 → 行ごとに合成した WAV のスケジューリング間隔
  - 読みはカタカナで固定（ひらがな「はなつけ」は「ワナツケ」と誤読されるため）。操作面はひらがな1文字=1モーラで厳密対応
- **WAV 書き出し** … ライブ再生と同じスケジュールを OfflineAudioContext に流し込み、
  24kHz モノラル PCM16 に符号化してアップロード
- **Electron** … メインプロセスが VOICEVOX / Supabase への HTTP を中継（CORS 回避・キーの秘匿）
- 行のパラメータが変わらない限り合成結果をキャッシュし、繰り返しの試聴を速くしている

## 構成

```
main.js               Electron メイン（VOICEVOX / Supabase プロキシ・ローカル退避）
preload.js            contextBridge
renderer/index.html   画面・モーダル
renderer/style.css    デザイン
renderer/sketch.js    p5.js スケッチ（操作・合成・再生・花の生成のすべて）
renderer/lib/         p5.min.js / qrcode.js（オフライン同梱）
supabase-config.js    接続情報（gitignore 済み）
tools/                検証スクリプト（モーラ数・Supabase 権限など、開発用）
```
