# 設計ドキュメント

## システム概要

SwitchBot温湿度計からデータを収集し、AWS Glueを使用してデータパイプラインを構築するシステム。温湿度データの取得、蓄積、カタログ化、加工、分析の一連の流れを実現する。

## アーキテクチャ図

```
[SwitchBot API] 
       ↓ HTTPS
[Lambda Function] 
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

### 4. Glue Crawler

#### 設定
- データソース: Raw S3 Bucket
- 出力: Glue Data Catalog
- スケジュール: 日次実行
- テーブルプレフィックス: `switchbot_`

#### 期待されるテーブル構造
```sql
CREATE TABLE switchbot_devicestatusdata (
  deviceinfo struct<
    deviceid: string,
    devicename: string,
    devicetype: string,
    hubdeviceid: string
  >,
  status struct<
    version: string,
    temperature: double,
    battery: int,
    humidity: int,
    deviceid: string,
    devicetype: string,
    hubdeviceid: string
  >,
  timestamp: string
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
- Raw BucketからJSONデータを読み込み
- deviceStatusDataを抽出
- Parquet形式に変換
- Curated Bucketに保存

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

### スケジューリング
- EventBridge: 15分間隔での定期実行
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