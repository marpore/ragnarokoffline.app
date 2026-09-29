# Ragnarok Offline × 社内ツール連携設計

ragnarokoffline.app（rAthena + roBrowserLegacy）をハブにした社内ゲーミフィケーションの integration 設計。
公式クライアント改造・非公開アセット配布はしない。OSS Web アプリの Mod と一般 API 連携のみ。

## 実装状況

- `sync/` に専用 HTTP エンドポイントとメモリ上の fixture を使う sync v0 骨格を実装済み。`mods/` に 5 つの Mod シェルを配置済み。
- ゲーム連携とクライアント起動の検証は公式 GRF の入手待ち。sync のテストと curl 検証には GRF も Docker も不要。

## ゴール

Linear / Slack / Sentry / Intercom / GitHub / Grok（Cursor）の状況をゲーム世界で俯瞰し、対象オブジェクトから Read / 軽い Write できるようにする。コード変更の確認・編集はブラウザ側。

## アーキテクチャ（確定）

- **ローカル優先**: Mac 上の sync サーバが起動時 API 一括フェッチ＋ローカル Webhook でホットキャッシュを持つ。
- **正本**: 各外部サービス。ローカルは薄いキャッシュ（メモリ or Redis）。
- **Supabase**: 後付けオプション（当初必須ではない）。無料枠を圧迫する全量ミラーはしない。
- **トンネル**: デモ／稼働中のみ ngrok 等でローカル Webhook を外部に公開。
- **安全網**: Mac 停止中のイベントは次回起動の pull で追いつく。

```
Linear / Slack / Sentry / Intercom / GitHub
        │ Webhook（トンネル）＋ 起動時 API pull
        ▼
Mac sync サーバ (:8787)  … ホットキャッシュ
        │
        ▼
ragnarokoffline.app（Mod）
        │ LAN Hosting
        ▼
Mac / 同一 Wi-Fi スマホの WebGL クライアント
```

## 世界での役割分担

| 場所 | 意味 | 主なソース |
|------|------|------------|
| メンバー島 | チームの仕事 | Linear（＋紐づく GitHub PR） |
| プロンテラ異変掲示板 | システム障害 | Sentry |
| 宿屋・顧客の間 | お客の声 | Intercom |
| Grok NPC | AI 相談 | Grok / Cursor への誘導 |
| 一般チャット | ゲーム内会話のみ | 外部連携しない |

行き先は **触ったオブジェクト種別** で決める。一般チャット用の振り分けルータ（`POST /chat`）は置かない。

## 外部サービス ↔ オブジェクト ↔ Read / Write

| 外部 | ゲーム内オブジェクト | Read | Write |
|------|----------------------|------|-------|
| **Linear** | メンバー島の **タスク Mob**（頭上＝チケット名、見た目＝優先度） | 調べる → チケット窓（概要・status・コメント直近） | コメント、status 変更。Done でデスポーン |
| **GitHub PR** | 同じ Mob の **PR 印／CI オーラ**（窓タブ「PR」） | CI、レビューコメント直近、PR メタ | 軽い PR コメント。**diff・変更確認・編集はブラウザ** |
| **Slack** | 島の **看板／伝言 NPC** | 直近メッセージ | 「伝える」から送信／下書き |
| **Sentry** | **異変掲示板**の張り紙（fatal は緊急クエスト） | 要約・ID・時刻 | 基本 Read。ack／resolve は任意 |
| **Intercom** | 宿屋の **手紙／受付キュー** | スレッド要約 | 返信。クローズで済棚 |
| **Grok / Cursor** | **Grok NPC** | 会話（任意） | NPC 会話。重い作業は Cursor／ブラウザへ |
| **移動** | HUD・街ポータル・詠唱ワープ | 未解決数バッジ等 | テレポのみ |

### 共通ルール

- 長い本文・diff・添付はゲームでは冒頭のみ。全文は外部リンク。
- Read はローカルキャッシュ。Write は対象別 API。
- Linear の仕事 Mob と Sentry／Intercom は場所も見た目も混ぜない。

## メンバー島

- Slack メンバーごとに個人島（インスタンスマップ）を 1 つ。
- 島の Mob ＝その人に Linear でアサイン中のチケット。
- 島の伝言 NPC＝そのメンバー向け Slack（許可されたチャンネル／DM）。
- 紐づけ: `members`（slack_user_id ↔ island_map_id ↔ character_id）。

## GitHub PR と Mob の連携

| 変化 | 世界 |
|------|------|
| PR 開く | Mob に PR 印 |
| CI 赤／緑／黄 | オーラ色 |
| レビューコメント増 | 窓バッジ（任意で島に一行） |
| Merged またはチケット Done | 印消去・Mob デスポーン |

紐づけ初期実装: PR 本文／ブランチ名／Linear attachment のチケット ID（例: `JOR-xxx`）。

## Sentry / Intercom の見せ方

- **Sentry**: 日常は掲示板。fatal／急増のみ緊急クエスト＋レート制限付き announce。
- **Intercom**: 宿屋の手紙。Linear 化済みなら「クエスト化」印と島 Mob へジャンプ。

## すばやいアクセス

1. チャット詠唱: `@島 名前` / `@異変` / `@宿屋` → ワープ
2. HUD: 島一覧・Sentry 数・Intercom 未読
3. 街ポータル 3 本: 諸島／異変掲示板／顧客の間
4. チケット ID（`JOR-123`）→ 「Mob の島へ」／「詳細を開く」

## チケット窓 UX（Linear Mob）

1. Mob をクリック／調べる。
2. 窓（v0 は NPC 会話風、v1 は HTML オーバーレイ）:
   - 概要: タイトル、status、優先度、assignee、ID
   - コメント: 直近 N 件＋入力
   - PR: CI・コメント要約＋「GitHub で開く」「Cursor で開く」
3. コメント送信 → `POST /linear/tickets/:id/comments` → キャッシュ更新。
4. Done → Mob 消滅。

Sentry 張り紙・Intercom 手紙も同じ「調べる → 詳細窓」パターン。

## ローカル sync サーバ

想定: `http://127.0.0.1:8787`（トンネルで外部公開）

### Webhooks

| パス | 元 | 処理 |
|------|-----|------|
| `POST /hooks/linear` | Linear | issue/comment → 島 Mob・コメントキャッシュ |
| `POST /hooks/slack` | Slack Events | 許可 ch/DM のみ（署名検証） |
| `POST /hooks/sentry` | Sentry | 掲示板／緊急クエスト |
| `POST /hooks/intercom` | Intercom | 宿屋の手紙 |
| `POST /hooks/github` | GitHub | PR / checks / review comments → Mob 印 |

### Write / Read API（対象別・ルータなし）

```
POST   /linear/tickets/:id/comments
PATCH  /linear/tickets/:id
GET    /linear/tickets/:id

POST   /slack/send

POST   /grok/talk

POST   /github/prs/:id/comments
GET    /github/prs/:id

POST   /intercom/conversations/:id/reply

GET    /sentry/issues/:id

GET    /sync/status
```

### 起動シーケンス

1. ragnarokoffline.app 起動
2. sync サーバ起動（:8787）＋必要ならトンネル ON
3. Pull 安全網: Linear オープン＋直近コメント、Sentry 未解決、Intercom オープン、GitHub はオープン PR、Slack は任意で許可 ch 直近のみ
4. キャッシュ構築 → 島 Mob・掲示板・宿屋を配置／更新
5. Webhook 受信開始
6. クライアント接続（Mac / スマホ LAN）

## キャッシュ方針（薄く持つ）

- チケット: オープン＋最近 Done（例: 30 日で prune）
- Linear / PR コメント: 直近 N 件（例: 50）。不足時のみ API backfill
- Slack: 許可範囲のみ、短期 prune（例: 14 日）
- 添付バイナリは持たず URL のみ
- Redis は人数・負荷が増えてから。初期はプロセスメモリで可

## Mod 構成

```
mods/
  shared/         # sync クライアント、テレポ、HUD、共通型
  linear-mobs/    # 島 Mob、チケット窓、PR 印
  alerts-board/   # Sentry 掲示板・緊急クエスト
  intercom-inn/   # 宿屋の手紙
  grok-npc/       # Grok NPC 会話（POST /grok/talk）
```

各 Mod: `mod.json` + `client/`（JS）+ 必要なら rAthena スクリプト。
Extension Hooks で調べる／NPC 会話をインターセプトし、対応 API だけを叩く。

## やらないこと

- 公式クライアント改造、非公開アセット配布
- 一般チャットからの外部振り分けルータ
- ゲーム内での diff 確認・コード編集
- 全 Slack / 全 Linear 履歴の永久ミラー
- クライアントへの外部サービストークン配布（トークンは Mac sync のみ）

## 実装スライス案

0. 最小疎通（app 導入、スマホ LAN、テストキャラ移動）
1. sync サーバ骨格＋起動 pull（Linear のみ）＋島 Mob
2. チケット窓 Read/Write（コメント）
3. GitHub PR 印＋CI＋ブラウザリンク
4. Sentry 掲示板
5. Intercom 宿屋
6. Slack 島伝言
7. Grok NPC
8.（任意）Supabase へのハブ移設

## 改訂メモ

- ローカル Webhook 優先、Supabase はオプション
- インタラクト対象が API 行き先を決める（`POST /chat` ルータ廃止）
- コード変更の**確認**もブラウザ（ゲームはメタとコメントまで）
