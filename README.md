# ふたりチャット

合言葉で入る、ふたり向けのシンプルなメッセージアプリです。

## 起動

1. `npm install` を実行する。
2. `data/settings.json.example` を `data/settings.json` にコピーする。
3. `npx web-push generate-vapid-keys` を実行し、出た鍵を `settings.json` のVAPID欄へ入れる。
4. `password` をふたりだけの合言葉に変更する。
5. このフォルダで `npm start` を実行する。
6. 表示されたURLをスマホで開く。

ローカルネットワーク内なら、PCに表示される `http://192.168.x.x:3000` を同じWi-Fiのスマホで開けます。

## 公開について

外からいつでも使うには、Node.jsを動かせるホスティング（Render / Railway / Fly.io / VPSなど）にこのフォルダを配置します。公開前に必ず `data/settings.json` の合言葉を強いものへ変え、HTTPSのURLを使ってください。

### Railwayで公開する場合

RailwayのVariablesに、次の3つを設定します（値はGitHubへ保存しない）。

- `CHAT_PASSWORD` — 合言葉
- `SESSION_SECRET` — 32文字以上のランダムな文字列
- `ROOM_NAME` — `skin log`

さらにRailway Volumeを `/app/data` にマウントします。これでメッセージと写真がデプロイ後も残ります。

## 通知

通知は公開後のHTTPS URLで利用できます。iPhoneではSafariの共有メニューから「ホーム画面に追加」を行い、そのアイコンからアプリを開いて「通知をオンにする」を押してください。送信者本人には通知を出さず、相手の端末へだけ送ります。

`data/messages.json` は会話ログです。サーバーのディスクが消える無料ホスティングでは、会話も消える場合があります。
