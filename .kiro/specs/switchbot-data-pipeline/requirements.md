# 要件ドキュメント

## 概要

SwitchBot APIからデータを取得し、AWS Glueを使用してデータパイプラインを構築するシステム。データの取得、蓄積、カタログ化、加工、分析の一連の流れを通じてAWS Glueの理解を深めることを目的とする。

## 用語集

- **Data_Pipeline**: SwitchBot APIからAthenaでの分析まで一連のデータ処理フロー
- **Lambda_Function**: SwitchBot APIを呼び出してデータを取得するAWS Lambda関数
- **Raw_Bucket**: 取得したJSONデータをそのまま保存するS3バケット
- **Curated_Bucket**: 加工されたParquetデータを保存するS3バケット
- **Glue_Crawler**: S3データをスキャンしてテーブル定義を作成するAWS Glueコンポーネント
- **Glue_Job**: JSONからParquetへの変換を行うAWS Glue ETLジョブ
- **Athena_Service**: SQLクエリでデータ分析を行うAmazon Athenaサービス

## 要件

### 要件1: データ取得

**ユーザーストーリー:** システム管理者として、SwitchBotデバイスのデータを定期的に取得したい。そうすることで、デバイスの状態を継続的に監視できる。

#### 受け入れ基準

1. WHEN Lambda_Functionが実行されるとき、THE Data_Pipeline SHALL SwitchBot APIに対してHTTPSリクエストを送信する
2. WHEN SwitchBot APIからレスポンスを受信するとき、THE Lambda_Function SHALL JSONデータを取得する
3. WHEN APIリクエストが失敗するとき、THE Lambda_Function SHALL エラーログを出力し、適切なエラーハンドリングを実行する
4. WHEN Lambda_Functionが正常に実行されるとき、THE Data_Pipeline SHALL 取得したデータのタイムスタンプを記録する

### 要件2: Rawデータ蓄積

**ユーザーストーリー:** データエンジニアとして、取得したJSONデータを元の形式のまま保存したい。そうすることで、後から元データを参照できる。

#### 受け入れ基準

1. WHEN JSONデータが取得されるとき、THE Lambda_Function SHALL データをRaw_Bucketに保存する
2. WHEN データを保存するとき、THE Data_Pipeline SHALL ファイル名にタイムスタンプを含める
3. WHEN S3への保存が失敗するとき、THE Lambda_Function SHALL エラーログを出力し、リトライ処理を実行する
4. WHEN データが正常に保存されるとき、THE Data_Pipeline SHALL 保存完了のログを出力する

### 要件3: データカタログ化

**ユーザーストーリー:** データアナリストとして、S3に保存されたデータをAthenaで分析できるようにしたい。そうすることで、SQLクエリでデータを検索できる。

#### 受け入れ基準

1. WHEN Glue_CrawlerがRaw_Bucketをスキャンするとき、THE Data_Pipeline SHALL JSONファイルの構造を分析する
2. WHEN スキャンが完了するとき、THE Glue_Crawler SHALL Athena_Serviceで使用可能なテーブル定義を作成する
3. WHEN 新しいデータが追加されるとき、THE Glue_Crawler SHALL テーブル定義を自動更新する
4. WHEN テーブル定義の作成が失敗するとき、THE Glue_Crawler SHALL エラーログを出力する

### 要件4: データ加工（ETL）

**ユーザーストーリー:** データエンジニアとして、JSONデータをより効率的なParquet形式に変換したい。そうすることで、分析クエリのパフォーマンスを向上させることができる。

#### 受け入れ基準

1. WHEN Glue_JobがRaw_Bucketのデータを処理するとき、THE Data_Pipeline SHALL JSONファイルを読み込む
2. WHEN データ変換を実行するとき、THE Glue_Job SHALL JSONをParquet形式に変換する
3. WHEN 変換が完了するとき、THE Glue_Job SHALL ParquetファイルをCurated_Bucketに保存する
4. WHEN データ変換が失敗するとき、THE Glue_Job SHALL エラーログを出力し、処理を停止する
5. WHEN 変換処理が正常に完了するとき、THE Data_Pipeline SHALL 処理完了のログを出力する

### 要件5: データ分析

**ユーザーストーリー:** データアナリストとして、蓄積されたデータに対してSQLクエリを実行したい。そうすることで、SwitchBotデバイスの使用パターンや傾向を分析できる。

#### 受け入れ基準

1. WHEN Athena_ServiceでSQLクエリを実行するとき、THE Data_Pipeline SHALL Raw_BucketまたはCurated_Bucketのデータを検索対象とする
2. WHEN クエリが実行されるとき、THE Athena_Service SHALL 結果を適切な形式で返す
3. WHEN 大量のデータに対してクエリを実行するとき、THE Athena_Service SHALL 合理的な時間内で結果を返す
4. WHEN クエリが失敗するとき、THE Athena_Service SHALL 明確なエラーメッセージを提供する

### 要件6: インフラストラクチャ構築

**ユーザーストーリー:** 開発者として、AWSリソースをコードで管理したい。そうすることで、インフラストラクチャの変更を追跡し、再現可能な環境を構築できる。

#### 受け入れ基準

1. WHEN インフラストラクチャをデプロイするとき、THE Data_Pipeline SHALL AWS CDKを使用してリソースを定義する
2. WHEN CDKスタックをデプロイするとき、THE Data_Pipeline SHALL 必要なS3バケット、Lambda関数、Glueリソースを作成する
3. WHEN リソース間の権限設定が必要なとき、THE Data_Pipeline SHALL 適切なIAMロールとポリシーを自動生成する
4. WHEN 環境を削除するとき、THE Data_Pipeline SHALL CDKを使用してすべてのリソースを適切にクリーンアップする

