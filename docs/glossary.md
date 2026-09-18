# 用語集

## ブラウザと画面

- DOM: JavaScriptから操作できるHTML要素のツリー
- element: buttonやdivなど、一つのHTML要素
- event: click、input、keydownなど、画面で起きた出来事
- event listener: eventが起きたときに呼ぶ関数
- render: データから画面表示を作ること
- state: 現在の画面や入力状態を表す値
- SPA: ページ全体を再読込せずJavaScriptで画面を切り替えるアプリ
- route: `#calendar`のような画面の場所
- modal: 元画面の上へ重ねて出す操作画面
- overlay: 背景を覆う層

## JavaScript

- function: 名前を付けて再利用できる処理
- argument: 関数を呼ぶときに渡す値
- parameter: 関数定義側で受け取る名前
- return value: 関数が呼び出し元へ返す値
- scope: 変数を参照できる範囲
- module: import/exportで分けたJavaScriptファイル
- callback: 後で呼んでもらうため別の処理へ渡す関数
- Promise: 後で成功または失敗が確定する非同期処理の値
- async/await: Promiseを順番に読みやすく扱う文法
- side effect: 戻り値以外に、保存や画面変更など外部状態を変えること
- pure function: 同じ入力なら同じ結果になり、外部状態を変えない関数

## データ

- JSON: オブジェクトや配列を文字列として表す形式
- schema: データが持つ項目と型の決まり
- normalize: 表記揺れや欠損を共通形式へそろえること
- validation: 必要な形式や内容を満たすか確認すること
- migration: 既存データやDB構造を新形式へ移す処理
- cache: 再取得を減らすため一時的に保存した値
- fallback: 第一候補が失敗した場合の代替処理

## 保存と同期

- localStorage: ブラウザ内に文字列を保存する仕組み
- IndexedDB: ブラウザ内でより大きく構造的なデータを扱う仕組み
- Supabase: 認証、DB、Storage、Realtimeを提供する外部サービス
- upsert: 同じIDがあれば更新、なければ追加するDB操作
- merge: 二つのデータから必要な内容を統合すること
- conflict: 複数端末が同じデータを変更した競合状態
- tombstone: 削除した事実を同期するため残す削除記録
- RLS: ログインユーザーごとに読めるDB行を制限する仕組み

## Web配信

- PWA: ホーム画面へインストールでき、オフラインにも対応するWebアプリ
- Service Worker: 画面とは別に動き、キャッシュや通信を扱うブラウザ処理
- cache-first: キャッシュを先に返し、なければ通信する方式
- stale-while-revalidate: キャッシュを返しながら裏で最新版を取得する方式
- CDN: ライブラリやフォントを配信する外部サーバー
- Vercel Function: Vercel上で要求ごとに実行されるサーバーコード

## このアプリ固有

- memo block: 見出し、本文、画像、トグルなどメモを構成する一単位
- Atlas entry: 表現帳の一つの英語見出し語
- sense: 同じ見出し語の中にある品詞・意味・ニュアンスの単位
- learning entry: Knowledgeに保存される一つの質問と回答
- internal knowledge record: 通常メモと同じ保存領域を使う表現帳やKnowledgeの内部データ
- sync epoch: アカウント切替前に始まった通信結果を無効化する世代番号
