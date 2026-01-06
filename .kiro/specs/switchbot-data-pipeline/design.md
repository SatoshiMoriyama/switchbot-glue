# 設計ドキュメント

## システム概要

SwitchBot温湿度計からデータを収集し、AWS Glueを使用してデータパイプラインを構築するシステム。温湿度データの取得、蓄積、カタログ化、加工、分析の一連の流れを実現する。

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
- SwitchBot APIからデバイス一覧を取得
- 温湿度計（MeterPro/Meter/MeterPlus）を識別
- 各温湿度計のステータス情報を取得
- 構造化されたデータをS3に保存

#### 実装詳細

**環境変数:**
- `SWITCHBOT_TOKEN`: SwitchBot APIトークン
- `SWITCHBOT_SECRET`: SwitchBot APIシークレット
- `S3_RAW_BUCKET`: Raw データ保存用S3バケット名

**処理フロー:**
1. 環境変数の検証
2. SwitchBotClientの初期化
3. デバイス一覧の取得 (`/v1.1/devices`)
4. 温湿度計デバイスの識別
5. 各デバイスのステータス取得 (`/v1.1/devices/{deviceId}/status`)
6. データの構造化
7. S3への保存

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
- SwitchBot API認証の処理
- HTTPSリクエストの送信
- エラーハンドリング

#### 認証方式
- Authorization: トークン（Bearerプレフィックスなし）
- sign: HMAC-SHA256署名（大文字変換）
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
- **データ形式**: JSON Lines（1行1レコード）- Athena/Hiveの分散処理に最適化

#### データ保存形式の重要な考慮事項
- **JSON Lines形式を採用**: `JSON.stringify(data)`（インデントなし）
- **理由**: 
  - Athena/Hiveは行単位で並列処理するため、JSON Linesの方がパフォーマンスが良い
  - ファイルサイズが小さくなる（インデント不要）
  - 複数行JSONはSerDeの設定が複雑になりがち
  - AWS公式ドキュメントでもJSON Lines推奨

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
- **スキーマ進化対応**: Crawlerが新しいカラムを自動追加

### 5. Glue Crawler

#### 設定
- **データソース**: 既存のData Catalogテーブル（catalogTargets）
- **更新対象**: `switchbot_raw_data`テーブル
- **動作**: S3の実データをスキャンしてスキーマとパーティションを更新
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

### 5. Glue ETL Job

#### 処理内容
- **入力**: Glue Data Catalogの`switchbot_raw_data`テーブル
- deviceStatusDataを抽出・展開
- Parquet形式に変換
- Curated Bucketに保存

#### ETLスクリプトの重要な設定
```python
# 固定テーブル名を使用
raw_data_source = glueContext.create_dynamic_frame.from_catalog(
    database=args['database_name'],
    table_name="switchbot_raw_data"  # 固定名
)

# api_response.body.deviceStatusDataを展開
flattened_df = raw_df.select(
    explode(col("api_response.body.devicestatusdata")).alias("device_data"),
    col("timestamp").alias("collection_timestamp")
)
```

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
- API認証失敗: 401エラーをキャッチしてログ出力
- デバイス個別エラー: 他デバイス処理を継続
- S3保存失敗: リトライ機構

### SwitchBot Client  
- ネットワークエラー: 詳細なエラーメッセージ
- HTTP エラー: ステータスコードとメッセージを含む例外
- JSON パースエラー: 元のレスポンスを含むエラー

## セキュリティ考慮事項

### 認証情報管理
- SwitchBot トークン/シークレット: Lambda環境変数（暗号化推奨）
- IAM ロール: 最小権限の原則
- S3 バケット: パブリックアクセス禁止

### ネットワーク
- HTTPS通信のみ
- VPC内Lambda（オプション）
- S3 VPCエンドポイント（オプション）

## 監視・ログ

### CloudWatch Logs
- Lambda実行ログ
- API呼び出し結果
- エラー詳細
- 処理サマリー

### CloudWatch Metrics
- Lambda実行時間
- エラー率
- 処理されたデバイス数
- S3保存成功率

## 運用考慮事項

### データ形式の重要な学習事項

#### JSON Lines vs 整形JSON
- **問題**: 当初、`JSON.stringify(data, null, 2)`で整形JSONを保存
- **結果**: AthenaでHIVE_CURSOR_ERRORが発生
- **原因**: AthenaのJsonSerDeは1行1レコード（JSON Lines）を期待
- **解決**: `JSON.stringify(data)`でインデントなしの1行形式に変更

#### テーブル名固定化の重要性
- **問題**: S3ターゲットのCrawlerはバケット名を含むテーブル名を生成
- **結果**: `switchbot_switchbotdatapipelinestac_switchbotrawdatabucket89_fkgdkxfi5h2c`
- **解決**: 手動テーブル作成 + catalogTargetsでの更新方式
- **利点**: ETLスクリプトでテーブル名が安定

### スケジューリング
- **EventBridge Scheduler**: 15分間隔でのLambda関数定期実行
  - L2コンストラクト（`aws-scheduler`）を使用
  - `LambdaInvoke`ターゲットでLambda関数を呼び出し
  - 自動的なIAM権限設定
- Glue Crawler: 日次実行
- Glue ETL Job: Crawlerの後に実行

### コスト最適化
- Lambda: 実行時間の最小化
- S3: ライフサイクルポリシー
- Athena: パーティション活用
- Glue: 必要最小限のDPU設定

### データ保持ポリシー
- Raw データ: 1年間保持
- Curated データ: 3年間保持
- ログ: 30日間保持