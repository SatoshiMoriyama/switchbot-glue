# データスキーマ仕様書

## 概要

SwitchBot 温湿度データパイプラインで使用されるデータ構造の詳細仕様。Raw データから Curated データまでの変換過程を含む。

## 1. SwitchBot API レスポンス

### デバイス一覧 API (`/v1.1/devices`)

```json
{
  "statusCode": 100,
  "body": {
    "deviceList": [
      {
        "deviceId": "B0E9FEC184E2",
        "deviceName": "温湿度計Pro E2", 
        "deviceType": "MeterPro",
        "enableCloudService": true,
        "hubDeviceId": "000000000000"
      }
    ],
    "infraredRemoteList": [
      {
        "deviceId": "02-202512061054-26361426",
        "deviceName": "テレビ",
        "remoteType": "TV", 
        "hubDeviceId": "EB011571B7CA"
      }
    ]
  },
  "message": "success"
}
```

### デバイスステータス API (`/v1.1/devices/{deviceId}/status`)

```json
{
  "statusCode": 100,
  "body": {
    "version": "V1.8",
    "temperature": 21.3,
    "battery": 100,
    "humidity": 50,
    "deviceId": "B0E9FEC184E2",
    "deviceType": "MeterPro",
    "hubDeviceId": "000000000000"
  },
  "message": "success"
}
```

## 2. Raw S3 データ構造

### ファイル形式
- **形式**: JSON
- **エンコーディング**: UTF-8
- **圧縮**: なし

### ファイル構造

```json
{
  "timestamp": "2026-01-06T06:10:50.831Z",
  "api_response": {
    "statusCode": 100,
    "body": {
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
            "temperature": 20.5,
            "battery": 100,
            "humidity": 51,
            "deviceId": "B0E9FEC184E2",
            "deviceType": "MeterPro", 
            "hubDeviceId": "000000000000"
          },
          "timestamp": "2026-01-06T06:10:50.830Z"
        }
      ],
      "timestamp": "2026-01-06T06:10:50.830Z",
      "summary": {
        "totalDevicesScanned": 3,
        "temperatureHumidityDevicesFound": 1,
        "collectionTime": "2026-01-06T06:10:50.830Z"
      }
    },
    "message": "success"
  },
  "metadata": {
    "collection_time": "2026-01-06T06:10:50.831Z",
    "api_version": "v1.1",
    "lambda_request_id": "6b2ea348-48db-4a2c-b57e-ccc6e49f1a19"
  }
}
```

### フィールド定義

#### トップレベル
| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| タイムスタンプ | string | ✓ | データ収集時刻（ISO 8601） |
| api_response | object | ✓ | SwitchBot APIレスポンス |
| metadata | object | ✓ | メタデータ情報 |

#### api_response.body.deviceStatusData[]
| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| deviceInfo | object | ✓ | デバイス基本情報 |
| status | object | ✓ | デバイスステータス |
| タイムスタンプ | string | ✓ | ステータス取得時刻 |

#### deviceInfo
| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| deviceId | string | ✓ | デバイス一意識別子 |
| deviceName | string | ✓ | デバイス名 |
| deviceType | string | ✓ | デバイスタイプ（MeterPro/Meter/MeterPlus） |
| hubDeviceId | string | ✓ | ハブデバイスID |

#### status
| フィールド | 型 | 必須 | 説明 | 単位 | 範囲 |
|-----------|---|------|------|------|------|
| version | string | ✓ | ファームウェアバージョン | - | - |
| temperature | number | ✓ | 温度 | ℃ | -20.0 ~ 60.0 |
| humidity | integer | ✓ | 湿度 | % | 0 ~ 100 |
| battery | integer | ✓ | バッテリー残量 | % | 0 ~ 100 |
| deviceId | string | ✓ | デバイスID（重複） | - | - |
| deviceType | string | ✓ | デバイスタイプ（重複） | - | - |
| hubDeviceId | string | ✓ | ハブデバイスID（重複） | - | - |

#### summary
| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| totalDevicesScanned | integer | ✓ | スキャンしたデバイス総数 |
| temperatureHumidityDevicesFound | integer | ✓ | 発見した温湿度計数 |
| collectionTime | string | ✓ | 収集完了時刻 |

#### metadata
| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| collection_time | string | ✓ | 収集時刻 |
| api_version | string | ✓ | 使用したAPI バージョン |
| lambda_request_id | string | ✓ | Lambda リクエストID |

## 3. Glue Data Catalog スキーマ

### テーブル名
`switchbot_devicestatusdata`

### パーティション
```
year=2026/month=01/day=06/hour=05/
```

### カラム定義

| カラム名 | データ型 | 説明 |
|---------|---------|------|
| deviceinfo | struct | デバイス情報構造体 |
| deviceinfo.deviceid | string | デバイスID |
| deviceinfo.devicename | string | デバイス名 |
| deviceinfo.devicetype | string | デバイスタイプ |
| deviceinfo.hubdeviceid | string | ハブデバイスID |
| status | struct | ステータス情報構造体 |
| status.version | string | ファームウェアバージョン |
| status.temperature | double | 温度 |
| status.battery | bigint | バッテリー残量 |
| status.humidity | bigint | 湿度 |
| status.deviceid | string | デバイスID |
| status.devicetype | string | デバイスタイプ |
| status.hubdeviceid | string | ハブデバイスID |
| タイムスタンプ | string | タイムスタンプ |

### パーティションカラム

| カラム名 | データ型 | 説明 |
|---------|---------|------|
| year | string | 年（YYYY） |
| month | string | 月（MM） |
| day | string | 日（DD） |
| hour | string | 時（HH） |

## 4. Curated データ（Parquet）

### テーブル名
`curated_switchbot_temperature_humidity`

### スキーマ

| カラム名 | データ型 | Null許可 | 説明 |
|---------|---------|----------|------|
| device_id | string | No | デバイス一意識別子 |
| device_name | string | No | デバイス名 |
| device_type | string | No | デバイスタイプ |
| hub_device_id | string | Yes | ハブデバイスID |
| firmware_version | string | Yes | ファームウェアバージョン |
| temperature | decimal(4,1) | No | 温度（℃） |
| humidity | integer | No | 湿度（％） |
| battery | integer | No | バッテリー残量（％） |
| recorded_at | タイムスタンプ | No | 測定時刻 |
| collection_date | date | No | 収集日（パーティション用） |
| collection_hour | integer | No | 収集時（パーティション用） |

### パーティション構造
```
collection_date=2026-01-06/collection_hour=5/
```

### データ品質制約

#### temperature
- 範囲: -20.0 ≤ temperature ≤ 60.0
- 精度: 小数点第 1 位まで

#### humidity  
- 範囲: 0 ≤ humidity ≤ 100
- 型: 整数

#### battery
- 範囲: 0 ≤ battery ≤ 100  
- 型: 整数

#### recorded_at
- 形式: ISO 8601 タイムスタンプ
- タイムゾーン: UTC

## 5. データ変換ルール

### Raw → Curated 変換

```sql
SELECT 
  deviceinfo.deviceid as device_id,
  deviceinfo.devicename as device_name,
  deviceinfo.devicetype as device_type,
  deviceinfo.hubdeviceid as hub_device_id,
  status.version as firmware_version,
  CAST(status.temperature AS DECIMAL(4,1)) as temperature,
  status.humidity as humidity,
  status.battery as battery,
  CAST(timestamp AS TIMESTAMP) as recorded_at,
  DATE(timestamp) as collection_date,
  HOUR(timestamp) as collection_hour
FROM raw_switchbot_data.devicestatusdata
WHERE status.temperature IS NOT NULL 
  AND status.humidity IS NOT NULL
  AND status.battery IS NOT NULL;
```

### データクレンジングルール

1. **温度異常値除外**: temperature < -20 OR temperature > 60
2. **湿度異常値除外**: humidity < 0 OR humidity > 100  
3. **バッテリー異常値除外**: battery < 0 OR battery > 100
4. **NULL値除外**: 必須フィールドが NULL の場合
5. **重複除外**: device_id + recorded_at の組み合わせで重複除外

## 6. 分析用ビュー

### 日次統計ビュー

```sql
CREATE VIEW daily_temperature_humidity_stats AS
SELECT 
  device_id,
  device_name,
  collection_date,
  COUNT(*) as measurement_count,
  AVG(temperature) as avg_temperature,
  MIN(temperature) as min_temperature, 
  MAX(temperature) as max_temperature,
  AVG(humidity) as avg_humidity,
  MIN(humidity) as min_humidity,
  MAX(humidity) as max_humidity,
  AVG(battery) as avg_battery
FROM curated_switchbot_temperature_humidity
GROUP BY device_id, device_name, collection_date;
```

### 時間別トレンドビュー

```sql
CREATE VIEW hourly_temperature_trend AS  
SELECT 
  device_name,
  collection_date,
  collection_hour,
  AVG(temperature) as avg_temperature,
  AVG(humidity) as avg_humidity,
  COUNT(*) as measurement_count
FROM curated_switchbot_temperature_humidity
GROUP BY device_name, collection_date, collection_hour
ORDER BY collection_date, collection_hour;
```