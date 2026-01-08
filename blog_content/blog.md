# SwitchBot温湿度データでAWS GlueのETL処理を体感してみた

## はじめに

最近の業務で AWS Glue を触る機会があったのですが、無知さを感じることがあったので、今回簡単な ETL 処理を体験してみようと思いました。

今回は Glue を使うようなデータが手元になかったので、最近購入した SwitchBot の温湿度センサーデータを使って ETL 処理を構築してみることにしました。

### この記事で学べること

今回の記事で学ぶことができるのは以下のような内容です。

- AWS Glue における Crawlers、ETL Job の基本的な利用方法
- SwitchBot API の利用方法

### 前提知識・条件

本記事を読んでいただくために必要な知識・条件等を今回から書くようにしました。

#### AWS Glueとは？

AWS Glue はデータ収集、カタログ化、データ加工をサーバレスで実現してくれるサービスです。

具体的に AWS Glue について理解するためには、以下の Black Belt Online Seminar 資料・動画を参考にしてください。

https://pages.awscloud.com/rs/112-TZM-766/images/AWS-Black-Belt_2023_AWS-Glue_0331_v1.pdf

<iframe width="560" height="315" src="https://www.youtube.com/embed/5fbdx849AYw?si=0Yr7RVv_qhMA_mla" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

#### その他前提事項

以下、都合上記載していない部分などがあります。

- 今回は AWS CDK を利用して環境構築をしているが、AWS CDK の内容については割愛する
- 検証用の環境なので、本番ワークロードには適していない部分の可能性がある
- `Parquet` 等、一部用語の説明を割愛している部分がある

## やってみた

### 成果物

最初に今回の成果物を紹介します。

![構成図](/generated-diagrams/switchbot-pipeline-architecture.png)

今回の構成図は久しぶりに Diagram MCP を使ってみました。

処理内容を箇条書きにすると以下のような内容です。

1. 15 分おきに SwitchBot API を利用し、リビングに置いてある温湿度計の情報を取得
2. 取得したデータを S3 に JSON 形式で保存
3. 保存した JSON に対して、ETL JOB Parquet 形式に変換し、別に S3 に保存
4. 変換した S3 上のデータに対して、crawler でカタログ（テーブル）を作成
5. Amazon Athena を利用し、作成したテーブルにて SQL でクエリする

また合わせて２で保存した未加工の JSON データも Athena でクエリできるように、専用の crawler も準備しました。

API や、ETL Job、IaC 等、各種コードについては以下で公開済みです。

https://github.com/SatoshiMoriyama/switchbot-glue

### 作業手順、設計書等

今回は Kiro の Spec モードを利用し、開発しているため、要件定義・設計書・タスクリストも公開しています！

詳細な仕様や作業手順はこちらをご確認ください。

#### 要件定義

https://github.com/SatoshiMoriyama/switchbot-glue/blob/main/.kiro/specs/switchbot-data-pipeline/requirements.md

#### 設計

https://github.com/SatoshiMoriyama/switchbot-glue/blob/main/.kiro/specs/switchbot-data-pipeline/design.md

#### タスクリスト

https://github.com/SatoshiMoriyama/switchbot-glue/blob/main/.kiro/specs/switchbot-data-pipeline/tasks.md

### 実装で学んだこと・躓いたポイント

作成した内容は上記の通りなのですが、開発する際に特に学んだ点や、つまづいたことをいくつか紹介させていただきます。

#### 1.SwitchBotのトークン、シークレットの取得

まず最初に Glue で処理するデータを取得するため、SwitchBot API を資料するのですが、認証のため、トークンとシークレットを取得する必要がありました。

取得方法が少し珍しいなと感じましたが、スマホアプリから下記手順の通り取得するみたいです。

https://support.switch-bot.com/hc/ja/articles/12822710195351-%E3%83%88%E3%83%BC%E3%82%AF%E3%83%B3%E3%81%AE%E5%8F%96%E5%BE%97%E6%96%B9%E6%B3%95

Android の開発者モードを表示させるような感じですね。

#### 2.SwitchBot APIの認証について

次に取得したトークン・シークレットを使って認証するのですが、これも少し複雑でした。

下記ページに方法は書いているのですが、少し AI に要約させてみました。

https://github.com/OpenWonderLabs/SwitchBotAPI?tab=readme-ov-file#how-to-sign

##### 必要なリクエストヘッダ

API には認証のため、以下のようなリクエストヘッダが必要です。

| ヘッダー名 | 内容 | 作成方法 |
| --------- | ---- | -------- |
| `Authorization` | APIトークン | SwitchBotアプリから取得したトークンをそのまま設定 |
| `sign` | HMAC-SHA256署名 | `token + timestamp + nonce` をSHA256でハッシュ化し、Base64エンコード後に大文字変換 |
| `nonce` | ランダムな一意値 | `crypto.randomUUID()` で生成したUUID |
| `t` | タイムスタンプ | `Date.now()` で取得した現在時刻（ミリ秒） |
| `Content-Type` | コンテンツタイプ | `application/json` を固定で設定 |

なお、今回利用する API は以下の２つのみです。

1. [Get device list(デバイス一覧の取得)](https://github.com/OpenWonderLabs/SwitchBotAPI?tab=readme-ov-file#devices)
2. [Get device status(温湿度計から湿温度を取得)](https://github.com/OpenWonderLabs/SwitchBotAPI?tab=readme-ov-file#get-device-status)

#### 3.crawlerが作成するテーブル名について

少し長いので章を分けて記載します。

##### crawlerとカタログ化について

AWS Glue Crawler は、データソース（今回は JSON ファイル）を自動的にスキャンしてメタデータを抽出する機能です。

スキーマやパーティション情報などを検出し、Glue Data Catalog にテーブルとして登録します。

https://docs.aws.amazon.com/ja_jp/glue/latest/dg/add-crawler.html

##### 問題点

crawler が自動的に S3 の JSON からテーブルを作るとき、テーブル名が S3 のバケット名へ依存してしまい、分かりにくい名前となっていました。

今回 S3 バケット名は以下のように CDK で明示的な名前を指定しないため、可読性が低いバケット名となっているのですが、この内容がそのままテーブルに反映されている模様です。

```typescript:cdk-stack.ts
  this.rawDataBucket = new s3.Bucket(this, 'SwitchBotRawDataBucket', {
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  this.curatedDataBucket = new s3.Bucket(this, 'SwitchBotCuratedDataBucket', {
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
```

![S3バケット名の表示画面。](<CleanShot 2026-01-08 at 14.54.22.png>)

Crawler の設定で明示的にテーブル名を指定したかったのですが、仕様上指定できるのは接頭辞（`Prefix`）のみであり、テーブル名そのものを固定できません。

https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-glue-crawler.html#cfn-glue-crawler-tableprefix

この仕様は以下に記載されていました。

https://docs.aws.amazon.com/ja_jp/glue/latest/dg/add-crawler.html

> AWS Glue クローラーは、Amazon S3 データをスキャンしてバケット内に複数のフォルダを検出すると、フォルダ構造のテーブルのルート、およびどのフォルダがテーブルのパーティションであるかを確認します。テーブルの名前は Amazon S3 プレフィックスまたはフォルダ名に基づいています。

##### 解決策

解決策としては、以下のように予め、スキーマ・パーティションを指定しない未定義のテーブルを先に用意し、crawler の対象をこのテーブルにすることで対応できました。

##### 具体例

CDK のソースで具体例を説明します。

まず、テーブルです。

テーブルは以下の `+` の箇所の通り、対象の S3 バケットのみを指定し、スキーマ・パーティションを指定していません。

```typescript:cdk-stack.ts
  const rawDataTable = new glue.CfnTable(this, 'SwitchBotRawDataTable', {
    catalogId: this.account,
    databaseName: GLUE_DATABASE_NAME,
    tableInput: {
      name: RAW_TABLE_NAME,
      description: 'SwitchBot raw JSON data table',
      tableType: 'EXTERNAL_TABLE',
      parameters: { classification: 'json', compressionType: 'none' },
      storageDescriptor: {
+        location: `s3://${this.rawDataBucket.bucketName}/`,
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
        },
+        columns: [],
      },
+      partitionKeys: [], 
    },
  });
```

次に crawler はカタログ対象のテーブルを先ほどのテーブルにしています。

```typescript:cdk-stack.ts
    this.rawDataCrawler = new glue.CfnCrawler(this, 'SwitchBotRawDataCrawler', {
      role: this.glueCrawlerRole.roleArn,
      databaseName: GLUE_DATABASE_NAME,
      targets: {
        catalogTargets: [
+          { databaseName: GLUE_DATABASE_NAME, tables: [RAW_TABLE_NAME] },
        ],
      },
      name: 'switchbot-raw-data-crawler',
      description: 'Crawler to update switchbot_raw_data table schema',
      tablePrefix: '',
      schedule: { scheduleExpression: 'cron(0 2 * * ? *)' },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
      configuration: crawlerConfig,
    });
```

Crawler の実行時に実際のデータソースに基づいたスキーマ・パーティションを反映させることがでいるので、この仕組みを活用した手法ですね。

#### 4.crawlerのスキーマ、パーテションの検出について

テーブル名の問題解決後、crawler を実行してみると、無事スキーマが反映されてました。

![Athenaでのクエリ結果画面](<CleanShot 2026-01-08 at 15.06.20.png>)

ただし、Athena でクエリした結果、検索結果が 1 件も出てきませんでした。

![Athenaでのクエリ実行結果が0件表示されている画面](<CleanShot 2026-01-08 at 14.51.10.png>)

調査に難航したのですが、原因はパーティションが検知できていない状況でした。

結果、スキーマを 2 回動かすことで解決できました。

以下の通り、2 回実行すると、最初はテーブル（カラム）の変更のみ実施され、次の実行でパーティションが変更されている模様です。

![Crawlerの実行履歴でテーブル変更とパーティション変更が別々に実行されている画面](<CleanShot 2026-01-08 at 15.09.11.png>)

ここらの挙動に関する明確な記載を見つけることはできませんでした。
クローラーの設定等で解決可能な可能性があります。

なお、テーブル作成時にあらかじめ、パーティションを定義しておけば、一度の crawler 実施でも問題ありませんでした。

#### 5.JSONの改行有無について

次は、JSON のフォーマットについてです。

ここまでの問題を解決し、無事スキーマ・パーティションをカタログ化できたのですが、検索が以下のように失敗するようになりました。

![HIVE_CURSOR_ERRORのエラー画面](<CleanShot 2026-01-08 at 14.52.38.png>)

> HIVE_CURSOR_ERROR: Failed to read file at s3://switchbotdatapipelinestac-switchbotrawdatabucket89-5r8gezjyjr6k/year=2026/month=01/day=08/hour=14/switchbot-raw-data-2026-01-08T05-48-14-117Z.json
>このクエリは、クエリで修飾されていない限り、「switchbot_data_catalog」データベースに対して実行されました。エラーメッセージを フォーラム  に投稿するか、クエリ ID: aaf7b855-453a-4394-96e7-84c06e3fc06a とともに カスタマーサポート  にお問い合わせください

原因は、SwitchBot から取得した情報は以下のような改行付き JSON で保存していたことが原因でした。

```json
{
 "timestamp": "2026-01-07T21:39:25.739Z",
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
      "temperature": 20.4,
      "battery": 100,
      "humidity": 45,
      "deviceId": "B0E9FEC184E2",
      "deviceType": "MeterPro",
      "hubDeviceId": "000000000000"
     },
     "timestamp": "2026-01-07T21:39:25.701Z"
    }
   ],
   "timestamp": "2026-01-07T21:39:25.719Z",
   "summary": {
    "totalDevicesScanned": 3,
    "temperatureHumidityDevicesFound": 1,
    "collectionTime": "2026-01-07T21:39:25.739Z"
   }
  },
  "message": "success"
 },
 "metadata": {
  "collection_time": "2026-01-07T21:39:25.739Z",
  "api_version": "v1.1",
  "lambda_request_id": "63d23f3f-6da4-4947-ba6c-17d66a50f7c8"
 }
}
```

クローラの SerDe（サーデ）情報に'org.openx.data.jsonserde.JsonSerDe'を指定していると、起きる問題のようです。

なお、SerDe（サーデ）とは Serializer / Deserializer（シリアライザ / デシリアライザ）の略称です。

```typescript:cdk-stack.ts
    const rawDataTable = new glue.CfnTable(this, 'SwitchBotRawDataTable', {
      catalogId: this.account,
      databaseName: GLUE_DATABASE_NAME,
      tableInput: {
        name: RAW_TABLE_NAME,
        description: 'SwitchBot raw JSON data table',
        tableType: 'EXTERNAL_TABLE',
        parameters: { classification: 'json', compressionType: 'none' },
        storageDescriptor: {
          location: `s3://${this.rawDataBucket.bucketName}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat:
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
+            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
          columns: [],
        },
      },
    });
    rawDataTable.addDependency(this.glueDatabase);
```

以下ドキュメントにも明記されていました。

https://docs.aws.amazon.com/ja_jp/athena/latest/ug/json-serde.html

> Hive および OpenX ライブラリでは、JSON データが単一行で (フォーマットされていない)、そのレコードは改行文字で区切られていることが想定されています

また、改行なしの JSON が JSONL（JSON Lines）という理解でいました。しかし、１ファイルに１つの改行なしの JSON ファイルのことは厳密には JSONL とは呼ばないみたいです。

#### 6.温湿度のスキーマ推論について

次に、温湿度の処理において、特定のデータでエラーが起きていることに気づきました。

データを確認してみると、室温度データが `24` や `24.5` といった整数と小数有りの 2 種類の方で取得されるため、データによって、処理が失敗しているようでした。

対策としては、数値データしか入ってこないため、精度の高い double 型へキャストすれば良いのですが、今回は `resolveChoice` というメソッドを利用して解決しました。

https://docs.aws.amazon.com/ja_jp/glue/latest/dg/aws-glue-api-crawler-pyspark-transforms-ResolveChoice.html

##### DynamicFrameについて

なお、`resolveChoice()` は AWS Glue の DynamicFrame というデータ構造で利用できるメソッドです。

https://docs.aws.amazon.com/ja_jp/glue/latest/dg/aws-glue-api-crawler-pyspark-extensions-dynamic-frame.html

DynamicFrame は Apache Spark の DataFrame を拡張したもので、同じカラムに異なるデータ型が混在していても柔軟に処理できる特徴があります。

今回のように温度データが整数と小数で混在している場合、通常の DataFrame では型エラーが発生しやすくなります。しかし、DynamicFrame の resolveChoice() メソッドを使うことで、データ型の曖昧さを安全に解決できます。

#### 7.ジョブブックマーク

ブックマークは一度抽出したデータを次回から自動でスキップしてくれる機能で、増分データのみの処理ができる便利機能なのです。

![AWS Glueジョブブックマーク設定画面](<CleanShot 2026-01-08 at 18.54.24.png>)

これは私が Kiro のソースを理解できていなかっただけです。Kiro が作成した ETL JOB の設定にこの設定が入っており、スクリプトの修正をしたのにうまく処理されないといった事象がありました。

```typescript:cdk-stack.ts
    this.etlJob = new glue.CfnJob(this, 'SwitchBotETLJob', {
      name: 'switchbot-etl-job',
      role: this.glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: etlScriptAsset.s3ObjectUrl,
        pythonVersion: '3',
      },
      defaultArguments: {
        '--job-language': 'python',
 +       '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-metrics': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--raw_bucket': this.rawDataBucket.bucketName,
        '--curated_bucket': this.curatedDataBucket.bucketName,
        '--database_name': GLUE_DATABASE_NAME,
      },
      description: 'ETL job to convert SwitchBot JSON data to Parquet format',
      glueVersion: '4.0',
      maxRetries: 0,
      timeout: 60,
      workerType: 'G.1X',
      numberOfWorkers: 2,
    });
```

単純に私の理解不足ですね。

## まとめ

AWS Glue の基本的な機能のみですが、構成図や要件定義・設計書の共有、私が実際に開発していく上で、詰まった点を簡単にご紹介させていただきました。

ほぼ未経験な私が詰まったところを紹介させていただいたので、同じように詰まった方のお役に立てると嬉しいです。

今回、基礎的な ETL の実施でしたが、冒頭で紹介した資料に記載の通り、多くの機能が AWS Glue にはあるので、色々試してみることをお勧めします。

私は次に Athena でのクエリだけではなく、グラフなどの可視化にも挑戦してみたいと考えています。
