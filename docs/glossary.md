# 用語集

コード内で知らない言葉を見つけたときの入口です。単なる日本語訳ではなく、「何を表すか」
「なぜ必要か」「My Plannerではどう現れるか」を短くまとめています。JavaScriptの動作を詳しく
知りたい場合は[`javascript-basics.md`](javascript-basics.md)、ブラウザー機能は
[`javascript-browser-apis.md`](javascript-browser-apis.md)を参照してください。

## ブラウザーと画面

### DOM（Document Object Model）

HTMLをJavaScriptから探したり変更したりできる、要素の木構造です。画面に見えるボタンや入力欄は
DOM上ではそれぞれ一つのオブジェクトです。My Plannerの描画関数は、保存データを基にこのDOMを
組み立て直します。

### element

`button`、`div`、`input`、`img`など、一つのHTML要素です。文字だけでなく、class、属性、子要素、
クリック処理を持ちます。`querySelector()`が返す値もelementです。

### event / event listener

eventはクリック、文字入力、キー操作など、ブラウザー内で起きた出来事です。event listenerは、
特定のeventが起きた時に呼ばれる関数です。再描画で対象elementが作り直されると、古いelementへ
登録したlistenerは新しいelementへ引き継がれません。

### event bubbling / event delegation

bubblingは、子要素で発生したeventが親要素へ伝わる仕組みです。カード内の削除ボタンから、カードの
「詳細を開く」処理まで動くことがあります。delegationはこの仕組みを利用し、動的に増減する子要素
ではなく、消えない親へ一つのlistenerを置く設計です。一覧の再描画に強くなります。

### render

データをHTML要素へ変換し、画面に表示することです。保存とは別の処理です。データが正しくても
renderが古ければ画面に出ず、画面に出ていても保存しなければ再読込後に消えます。

### state

現在選ばれている日、開いているトグル、編集中の下書きなど、その時点のアプリ状態です。永続データ
とは限りません。開閉のような一時stateを同期対象にすると、別端末からの更新で閲覧中のUIまで
勝手に変わる原因になります。

### SPA（Single Page Application） / route

SPAはページ全体を毎回読み直さず、JavaScriptが必要な部分を入れ替えるアプリです。routeは
`#calendar`や`#memo`のように現在の画面を表します。My Plannerは一つの`index.html`からrouteに応じて
各画面を描画します。

### modal / overlay

modalは元画面の上に重ねる確認・編集画面、overlayはその背景を覆う層です。画像拡大表示も同じ構造を
使います。重なり順はCSS、閉じる操作はevent、表示状態はclassなど、複数の仕組みが協力します。

## JavaScript

### expressionとstatement

expression（式）は`price * count`のように一つの値を作るコードです。statement（文）は`if`や
`const total = ...`のように処理を進める単位です。長い行は、どの部分が値を作り、どの文がその値を
保存・表示しているかに分けると読めます。

### function

入力を受け取り、まとまった処理を行い、必要なら結果を返す再利用可能な単位です。関数名は
「何をするか」、parameterは「何が必要か」、return valueは「何を受け取れるか」を示します。

### argument / parameter / return value

parameterは関数定義側の受取口、argumentは呼び出す側が実際に渡す値です。return valueは関数が
呼び出し元へ返す結果です。`return`した時点で関数の残りは実行されないため、異常条件を早く除外する
early returnにも使います。

### scope / closure

scopeは変数を参照できる範囲です。closureは、関数が作られた時点の外側scopeを後からも参照できる
仕組みです。クリック用関数が描画時の`memoId`を覚えられる一方、古いstateまで保持すると更新後に
古い値で保存する原因にもなります。

### reference / mutation / shallow copy

配列やオブジェクトの変数には、中身ではなく同じデータを指すreferenceが入ります。中身を直接変える
ことがmutationです。`{ ...memo }`によるshallow copyは一段目だけを複製し、内側の配列は元と同じ
referenceのままです。同期や編集下書きでは特に注意します。

### module

`import`と`export`で責務ごとに分けたJavaScriptファイルです。`media.js`は画像、`storage.js`は保存と
いうように境界を作り、変更の影響範囲を狭めます。

### callback

今すぐ実行するのではなく、後で呼んでもらうため別の処理へ渡す関数です。クリック処理、配列の
`map()`、タイマーなどで使います。いつ、誰が、どのargumentで呼ぶかを確認することが要点です。

### Promise / async / await

Promiseは、通信や画像読込など、将来成功または失敗が確定する処理を表す値です。`await`は結果が
決まるまでその関数の続きだけを待ちます。アプリ全体は止まらないため、待っている間に別操作が起き、
競合する可能性があります。

### side effect / pure function

side effectは画面変更、保存、通信など、戻り値以外の外部状態へ影響する処理です。pure functionは
同じ入力から常に同じ出力を返し、外部状態を変えません。データ整形をpure functionへ分けると、
ブラウザーを使わず自動テストしやすくなります。

## データ

### JSON

オブジェクトや配列を、通信・保存しやすい文字列として表す形式です。AIが文章を返していても、期待する
JSONとして解析できなければ保存処理は失敗します。関数や`undefined`は通常そのまま表せません。

### schema

データが持つ項目、型、必須条件を定めた設計図です。厳しすぎると有用なAI回答まで拒否し、緩すぎると
表示側で扱えないデータが保存されます。保存前の修復と検証のバランスが重要です。

### normalize / validation

normalizeは`Verb`と`動詞`のような表記揺れや欠損を共通形式へそろえること、validationは必要な形式を
満たすか確認することです。通常は正規化してから検証します。補える不足まで即座に捨てない設計も
AI応答を安定して保存するうえで重要です。

### migration

既存データやDB構造を新しい形式でも読めるよう変換する処理です。新規データだけ形式を変えると過去の
メモが表示できません。再実行されても二重変換しないことと、元データを失わないことが重要です。

### cache / fallback

cacheは再取得や再計算を減らすため一時的に保持する値です。fallbackは第一候補が失敗した場合の代替
処理です。cacheは唯一の原本にせず、fallbackは失敗を隠すのでなくデータを守りながら利用可能な範囲を
保つために使います。

## 保存と同期

### localStorage / IndexedDB

どちらもブラウザー内の保存です。localStorageは小さな文字列向けで同期的、IndexedDBはより大きな
構造データやBlobを非同期に扱えます。どちらも、それだけでは端末間同期になりません。

### Supabase

認証、PostgreSQLデータベース、画像Storage、Realtimeなどを提供する外部サービスです。ログイン中の
ユーザーIDとRLSを組み合わせ、他人のデータを読み書きしないようサーバー側でも制御します。

### upsert

同じ一意IDの行があれば更新し、なければ追加するDB操作です。便利ですが、古い端末の値を無条件で
upsertすると新しい内容を上書きするため、更新版や更新日時の比較が必要です。

### merge / conflict

mergeは複数のデータから残す内容を決めて統合することです。conflictは複数端末が同じデータを変更し、
どちらを残すか明らかでない状態です。件数が多い側を採用するだけでは削除や最新編集を扱えません。

### tombstone

削除した事実を別端末へ伝えるため残す削除記録です。即座に完全削除すると、古い項目を持つ端末が
次回同期で復活させることがあります。安全な期間を置いてから完全削除します。

### RLS（Row Level Security）

ログインユーザーごとに、DBのどの行を読み書きできるかを制限する仕組みです。画面で他人の項目を
隠すだけではセキュリティにならないため、DB側でも所有者を検証します。

## Web配信

### PWA / Service Worker

PWAはホーム画面へのインストールやオフライン動作が可能なWebアプリ形態です。Service Workerは通常の
画面とは別に動き、通信とcacheを扱います。更新設計を誤ると、本番反映後も古いJavaScriptが使われます。

### cache-first / stale-while-revalidate

cache-firstはcacheを先に返し、なければ通信する方式です。stale-while-revalidateはcacheをすぐ表示し、
裏で最新版を取得します。前者は単純で高速、後者は速度と鮮度を両立しますが、一時的な版の差が生じます。

### CDN

ライブラリ、画像、フォントなどを複数地域から配信する仕組みです。高速化できますがネット接続と外部
サービスへ依存するため、主要資産をローカル保持する判断も必要です。

### Vercel Function

Vercel上でHTTP要求ごとに実行されるサーバーコードです。My PlannerではAPIキーをブラウザーへ公開せず
AIへ問い合わせるために使います。サーバーには表示中のDOMや端末のlocalStorageはありません。

## このアプリ固有

### memo block

見出し、本文、画像、トグルなど、メモを構成する一単位です。並べ替えや種類変更に強い一方、複数blockを
またぐ選択や貼り付けには、一枚のテキスト欄とは異なる処理が必要です。

### Atlas entry / sense

Atlas entryは表現帳の英語見出し語、senseはその中にある品詞・意味・ニュアンスのまとまりです。
`range`のように複数の意味を持つ語でも、重複カードを作らず、一つのentryへ濃さを保ったsenseを追加する
ための構造です。

### learning entry

Knowledgeに保存される一つの質問と回答です。分類、関連概念、作成日時などを持ち、別の質問から関連表示
できるようにします。

### internal knowledge record

通常メモと同じ保存基盤を使う、表現帳やKnowledgeの内部データです。保存形式を共有していても、通常の
メモ一覧にそのまま表示すべきとは限らないため、種類を識別して扱います。

### sync epoch

ログアウトやアカウント切替の前に始まった古い通信結果を無効化する世代番号です。通信開始時と完了時の
番号が違えば結果を反映せず、前ユーザーの遅い応答が新ユーザーの画面へ混ざるのを防ぎます。
