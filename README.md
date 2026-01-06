# SwitchBot Data Pipeline

SwitchBot APIからデータを取得し、AWS Glueを使用してデータパイプラインを構築するプロジェクトです。

## 概要

このプロジェクトは、SwitchBot APIから定期的にデバイスデータを取得し、AWS上でデータ処理パイプラインを構築します。

## アーキテクチャ

- **Lambda関数**: SwitchBot APIからデータを取得
- **S3**: Raw/Curatedデータの保存
- **AWS Glue**: ETLジョブによるデータ変換
- **Amazon Athena**: データクエリ・分析

## プロジェクト構成

```
switchbot-data-pipeline/
├── packages/
│   ├── api/                # Lambda関数のTypeScriptコード
│   │   ├── src/
│   │   │   ├── index.ts           # Lambda handler
│   │   │   ├── switchbot-client.ts # SwitchBot APIクライアント
│   │   │   └── s3-client.ts       # S3データ保存クライアント
│   │   └── package.json
│   └── cdk/                # AWS CDKインフラストラクチャコード
│       ├── lib/
│       │   └── cdk-stack.ts       # CDKスタック定義
│       ├── glue-scripts/          # Glue ETL Job用Pythonスクリプト
│       └── package.json
├── .env                    # 環境変数（ローカル開発用）
├── .env.example           # 環境変数のテンプレート
└── README.md
```

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.example`をコピーして`.env`ファイルを作成し、SwitchBot APIの認証情報を設定してください：

```bash
cp .env.example .env
```

`.env`ファイルを編集して、以下の値を設定：

```env
# SwitchBot API Configuration
# SwitchBotアプリから取得: プロフィール > 設定 > アプリバージョン > 開発者向けオプション
SWITCHBOT_TOKEN=your_switchbot_token_here
SWITCHBOT_SECRET=your_switchbot_secret_here

# AWS Configuration
AWS_REGION=ap-northeast-1
```

### 3. SwitchBot API認証情報の取得方法

1. SwitchBotアプリを開く
2. プロフィール > 設定 > アプリバージョン をタップ
3. 「開発者向けオプション」をタップ
4. トークンとシークレットをコピーして`.env`ファイルに設定

### 4. AWSの設定

AWS CLIが設定されていることを確認してください：

```bash
aws configure
```

## デプロイ

### 方法1: ルートディレクトリから（推奨）

```bash
# 全自動デプロイ（依存関係インストール、ビルド、デプロイを一括実行）
./deploy.sh
```

### 方法2: CDKディレクトリから

```bash
cd packages/cdk
pnpm run deploy
```

### 方法3: ルートからCDKデプロイのみ

```bash
pnpm run deploy:cdk
```

### Lambda関数の手動実行テスト

AWS Consoleから、またはAWS CLIで実行できます：

```bash
# AWS CLIでLambda関数を実行
aws lambda invoke \
  --function-name <function-name> \
  --payload '{}' \
  response.json
```

## 開発

### テストの実行

```bash
# API関数のテスト
cd packages/api
pnpm test

# CDKのテスト
cd packages/cdk
pnpm test
```

### ローカル開発

```bash
# TypeScriptのビルド（watch mode）
cd packages/api
pnpm run watch

# CDKのビルド（watch mode）
cd packages/cdk
pnpm run watch
```

## トラブルシューティング

### 環境変数が設定されていない場合

```
Error: Missing required environment variables: SWITCHBOT_TOKEN, SWITCHBOT_SECRET
```

→ `.env`ファイルが正しく設定されているか確認してください。

### AWS権限エラーの場合

```
AccessDenied: User is not authorized to perform: s3:PutObject
```

→ AWS CLIの認証情報とIAM権限を確認してください。

## 利用パッケージ、拡張ツール

### NPMパッケージ
- @biomejs/biome - TypeScript/JavaScript のリンター・フォーマッター
- markdownlint-cli2 - Markdown 構造チェック
- textlint - 日本語文章校正
  - textlint-rule-preset-ja-spacing - 日本語の文字間スペースルール
  - textlint-rule-preset-ja-technical-writing - 技術文書向けの日本語ルール
  - textlint-rule-preset-japanese - 日本語の基本ルール
  - textlint-rule-prh - 表記ゆれの統一
  - textlint-rule-spellcheck-tech-word - 技術用語のスペルチェック

### VSCode拡張機能（推奨）
- Biome - TypeScript/JavaScript のリント・フォーマット
- Code Spell Checker - 英単語のスペルチェック

### Kiro Steering File
- [ブログ記事評価プロンプト v2.2](https://gist.github.com/nwiizo/c75043438866100452fd249e536341d4) - ブログ記事の品質評価基準

### Kiro Agent Hooks
- Markdown Lint on Save - Markdownファイル編集時の自動文章校正

## 機能

### 文章の校正

```bash
# ブログ記事チェック（構造 + 文章）
pnpm lint

# ブログ記事修正（構造 + 文章）
pnpm lint:fix
```

### コードの校正

```bash
# TypeScriptコードチェック（フォーマット + リント）
pnpm code:check

# TypeScriptコード修正（フォーマット + リント）
pnpm code:fix
```

## セットアップ

```bash
# 依存関係のインストール
pnpm install

# 文章チェックの実行
pnpm lint

# 文章の自動修正
pnpm lint:fix
```