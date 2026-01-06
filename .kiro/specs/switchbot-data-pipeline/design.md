# 設計ドキュメント

## システム概要

SwitchBot 温湿度計からデータを収集し、AWS Glue を使用してデータパイプラインを構築するシステム。温湿度データの取得、蓄積、カタログ化、加工、分析の一連の流れを実現する。

## アーキテクチャ図

```
[EventBridge Scheduler] 
       ↓ 15分間隔
[Lambda Function] 
       ↓ HTTPS
[SwitchBot API] 
       ↓ S3 PUT
[Raw S3 Bucket] 
       ↓ Glue Crawler
[Glue Data Catalog] 
       ↓ Glue ETL Job
[Curated S3 Bucket] 
       ↓ Athena Query
[分析結果]
```

## コンポーネント設計

### 1. Lambda Function (SwitchBot Data Collection)

#### 責務
- SwitchBot API からデバイス一覧を取得
- 温湿度計（MeterPro/Meter/MeterPlus）を識別
- 各温湿度計のステータス情報を取得
- 構造化されたデータを S3 に保存

#### 実装詳細

**環境変数:**
- `SWITCHBOT_TOKEN`: SwitchBot API トークン
- `SWITCHBOT_SECRET`: SwitchBot API シークレット
- `S3_RAW_BUCKET`: Raw データ保存用 S3 バケット名

**処理フロー:**
1. 環境変数の検証
2. SwitchBotClient の初期化
3. デバイス一覧の取得 (`/v1.1/devices`)
4. 温湿度計デバイスの識別
5. 各デバイスのステータス取得 (`/v1.1/devices/{deviceId}/status`)
6. データの構造化
7. S3 への保存

**出力データ構造:**
```json
{
  "deviceStatusData": [
    {
      "deviceInfo": {
        "deviceId": "B0E9FEC184E2",
        "deviceName": "温湿度計Pro E2",
        "deviceType": "MeterPro",
        "hubDeviceId": "000000000000"
      },
      "status": {
        "version": "V1.8",
        "temperature": 21.3,
        "battery": 100,
        "humidity": 50,
        "deviceId": "B0E9FEC184E2",
        "deviceType": "MeterPro",
        "hubDeviceId": "000000000000"
      },
      "timestamp": "2026-01-06T05:26:32.024Z"
    }
  ],
  "timestamp": "2026-01-06T05:26:32.024Z",
  "summary": {
    "totalDevicesScanned": 3,
    "temperatureHumidityDevicesFound": 1,
    "collectionTime": "2026-01-06T05:26:32.024Z"
  }
}
```

### 2. SwitchBot API Client

#### 責務
- SwitchBot API 認証の処理
- HTTPS リクエストの送信
- エラーハンドリング

#### 認証方式
- Authorization: トークン（Bearer プレフィックスなし）
- sign: HMAC-SHA256 署名（大文字変換）
- nonce: "requestID"（固定値）
- t: タイムスタンプ

#### API エンドポイント
- デバイス一覧: `GET /v1.1/devices`
- デバイスステータス: `GET /v1.1/devices/{deviceId}/status`

### 3. S3 Data Storage

#### Raw Bucket構造
```
s3://bucket-name/
├── year=2026/
│   ├── month=01/
│   │   ├── day=06/
│   │   │   ├── hour=05/
│   │   │   │   └── switchbot-raw-data-2026-01-06T05-19-11-223Z.json
```

#### ファイル命名規則
- `switchbot-raw-data-{ISO8601-timestamp}.json`
- パーティション: year/month/day/hour
- **データ形式**: JSON Lines（1 行 1 レコード）- Athena/Hive の分散処理に最適化

#### データ保存形式の重要な考慮事項
- **JSON Lines形式を採用**: `JSON.stringify(data)`（インデントなし）
- **理由**: 
  - Athena/Hive は行単位で並列処理するため、JSON Lines の方がパフォーマンスが良い
  - ファイルサイズが小さくなる（インデント不要）
  - 複数行 JSON は SerDe の設定が複雑になりがち
  - AWS 公式ドキュメントでも JSON Lines 推奨

### 4. Glue Data Catalog

#### テーブル作成方式
**手動テーブル作成 + Crawler更新方式を採用**

1. **手動テーブル作成（CDK）**:
   ```typescript
   const rawDataTable = new glue.CfnTable(this, 'SwitchBotRawDataTable', {
     tableInput: {
       name: 'switchbot_raw_data', // 固定テーブル名
       parameters: {
         classification: 'json',
         compressionType: 'none',
       },
       columns: [], // 空 - Crawlerが後で追加
       partitionKeys: [
         { name: 'year', type: 'string' },
         { name: 'month', type: 'string' },
         { name: 'day', type: 'string' },
         { name: 'hour', type: 'string' },
       ],
     },
   });
   ```

2. **Crawler設定（catalogTargets）**:
   ```typescript
   targets: {
     catalogTargets: [
       {
         databaseName: 'switchbot_data_catalog',
         tables: ['switchbot_raw_data'], // 既存テーブルを更新
       },
     ],
   }
   ```

#### この方式の利点
- **テーブル名が固定**: `switchbot_raw_data`（バケット名に依存しない）
- **ETLスクリプトが安定**: テーブル名変更の心配なし
- **パーティション構造の事前定義**: year/month/day/hour
- **スキーマ進化対応**: Crawler が新しいカラムを自動追加

### 5. Glue Crawler

#### 設定
- **データソース**: 既存の Data Catalog テーブル（catalogTargets）
- **更新対象**: `switchbot_raw_data` テーブル
- **動作**: S3 の実データをスキャンしてスキーマとパーティションを更新
- **スケジュール**: 日次実行
- **スキーマ変更ポリシー**: `UPDATE_IN_DATABASE`（新カラム追加）

#### 期待されるテーブル構造（Crawler実行後）
```sql
CREATE TABLE switchbot_raw_data (
  timestamp string,
  api_response struct<
    statusCode: int,
    body: struct<
      deviceStatusData: array<struct<
        deviceInfo: struct<
          deviceId: string,
          deviceName: string,
          deviceType: string,
          hubDeviceId: string
        >,
        status: struct<
          version: string,
          temperature: double,
          battery: int,
          humidity: int,
          deviceId: string,
          deviceType: string,
          hubDeviceId: string
        >,
        timestamp: string
      >>,
      timestamp: string,
      summary: struct<
        totalDevicesScanned: int,
        temperatureHumidityDevicesFound: int,
        collectionTime: string
      >
    >,
    message: string
  >,
  metadata: struct<
    collection_time: string,
    api_version: string,
    lambda_request_id: string
  >
)
PARTITIONED BY (
  year string,
  month string,
  day string,
  hour string
)
```

### 6. Glue ETL Job

#### 処理内容
- **入力**: Raw S3 Bucket（直接読み込み）- Crawler に依存しない
- deviceStatusData を抽出・展開
- Parquet 形式に変換
- Curated Bucket に保存

#### ETLスクリプトの重要な設定
```python
# S3から直接読み込み（Data Catalogに依存しない）
raw_s3_path = f"s3://{args['raw_bucket']}/"

raw_data_source = glueContext.create_dynamic_frame.from_options(
    connection_type="s3",
    connection_options={
        "paths": [raw_s3_path],
        "recurse": True
    },
    format="json",
    transformation_ctx="raw_data_source"
)

# api_response.body.deviceStatusDataを展開
flattened_df = raw_df.select(
    explode(col("api_response.body.deviceStatusData")).alias("device_data"),
    col("timestamp").alias("collection_timestamp")
)

# 温度フィールドは型混在のためcoalesceで処理
processed_df = flattened_df.select(
    col("device_data.deviceInfo.deviceId").alias("device_id"),
    coalesce(
        col("device_data.status.temperature.double"),
        col("device_data.status.temperature.int").cast("double")
    ).alias("temperature"),
    # ... other fields
)
```

#### この方式の利点
- **Crawlerに依存しない**: 新しい S3 ファイルを即座に処理可能
- **リアルタイム性**: Raw Crawler の実行を待つ必要がない
- **シンプルな運用**: Lambda → S3 → ETL Job の直接的なフロー

#### 出力スキーマ
```
device_id: string
device_name: string  
device_type: string
temperature: double
humidity: int
battery: int
recorded_at: timestamp
collection_date: date
```

### 6. Athena分析

#### 想定クエリ例

**時系列温度変化:**
```sql
SELECT 
  recorded_at,
  device_name,
  temperature,
  humidity
FROM curated_switchbot_data 
WHERE collection_date >= current_date - interval '7' day
ORDER BY recorded_at;
```

**デバイス別統計:**
```sql
SELECT 
  device_name,
  AVG(temperature) as avg_temp,
  MIN(temperature) as min_temp,
  MAX(temperature) as max_temp,
  AVG(humidity) as avg_humidity
FROM curated_switchbot_data 
WHERE collection_date = current_date
GROUP BY device_name;
```

## エラーハンドリング

### Lambda Function
- 環境変数不足: 起動時エラー
- API 認証失敗: 401 エラーをキャッチしてログ出力
- デバイス個別エラー: 他デバイス処理を継続
- S3 保存失敗: リトライ機構

### SwitchBot Client  
- ネットワークエラー: 詳細なエラーメッセージ
- HTTP エラー: ステータスコードとメッセージを含む例外
- JSON パースエラー: 元のレスポンスを含むエラー

## セキュリティ考慮事項

### 認証情報管理
- SwitchBot トークン/シークレット: Lambda 環境変数（暗号化推奨）
- IAM ロール: 最小権限の原則
- S3 バケット: パブリックアクセス禁止

### ネットワーク
- HTTPS 通信のみ
- VPC 内 Lambda（オプション）
- S3 VPC エンドポイント（オプション）

## 監視・ログ

### CloudWatch Logs
- Lambda 実行ログ
- API 呼び出し結果
- エラー詳細
- 処理サマリー

### CloudWatch Metrics
- Lambda 実行時間
- エラー率
- 処理されたデバイス数
- S3 保存成功率

## 運用考慮事項

### データ形式の重要な学習事項

#### JSON Lines vs 整形JSON
- **問題**: 当初、`JSON.stringify(data, null, 2)` で整形 JSON を保存
- **結果**: Athena で HIVE_CURSOR_ERROR が発生
- **原因**: Athena の JsonSerDe は 1 行 1 レコード（JSON Lines）を期待
- **解決**: `JSON.stringify(data)` でインデントなしの 1 行形式に変更

#### テーブル名固定化の重要性
- **問題**: S3 ターゲットの Crawler はバケット名を含むテーブル名を生成
- **結果**: `switchbot_switchbotdatapipelinestac_switchbotrawdatabucket89_fkgdkxfi5h2c`
- **解決**: 手動テーブル作成 + catalogTargets での更新方式
- **利点**: ETL スクリプトでテーブル名が安定

#### ETL Job データソース方式の変更
- **問題**: Data Catalog ベースだと、Crawler が実行されないと新しい S3 ファイルが見えない
- **結果**: S3 に 33 ファイルあっても Data Catalog に 6 パーティションしか登録されていないと 6 件しか処理されない
- **解決**: S3 から直接読み込む方式に変更（`from_options`）
- **利点**: Crawler に依存せず、リアルタイムで S3 の全ファイルを処理可能

#### パーティションキー事前定義の検証結果
- **実験**: Curated テーブルをパーティションキーなしで作成
- **結果**: Crawler がパーティションキー（year, month, day）を自動検出・追加
- **結論**: 手動テーブル作成時にパーティションキーを事前定義する必要はない（Crawler が自動検出）

#### 温度フィールドの型推論問題
- **問題**: SwitchBot API が温度を整数（21）または小数（21.5）で返す
- **結果**: Glue が `struct<double:double,int:int>` として推論し、直接キャストでエラー
- **エラー**: `AnalysisException: cannot cast struct<double:double,int:int> to double`
- **解決**: `coalesce(col("temperature.double"), col("temperature.int").cast("double"))` で両方の型に対応
- **教訓**: 数値フィールドは型が混在する可能性があるため、Glue のスキーマ推論結果を確認すること

### スケジューリング
- **EventBridge Scheduler**: 15 分間隔での Lambda 関数定期実行
  - L2 コンストラクト（`aws-scheduler`）を使用
  - `LambdaInvoke` ターゲットで Lambda 関数を呼び出し
  - 自動的な IAM 権限設定
- Glue Crawler: 日次実行
- Glue ETL Job: Crawler の後に実行

### コスト最適化
- Lambda: 実行時間の最小化
- S3: ライフサイクルポリシー
- Athena: パーティション活用
- Glue: 必要最小限の DPU 設定

### データ保持ポリシー
- Raw データ: 1 年間保持
- Curated データ: 3 年間保持
- ログ: 30 日間保持