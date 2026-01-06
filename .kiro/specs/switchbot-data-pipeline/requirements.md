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

### 要件1: 温湿度データ取得

**ユーザーストーリー:** システム管理者として、SwitchBot温湿度計のデータを定期的に取得したい。そうすることで、室内環境を継続的に監視できる。

#### 受け入れ基準

1. WHEN Lambda_Functionが実行されるとき、THE Data_Pipeline SHALL SwitchBot APIに対してHTTPSリクエストを送信する
2. WHEN SwitchBot APIからデバイス一覧を受信するとき、THE Lambda_Function SHALL 温湿度計（MeterPro、Meter、MeterPlus）を識別する
3. WHEN 温湿度計が見つかるとき、THE Lambda_Function SHALL 各デバイスのステータスAPIを呼び出して温度・湿度・バッテリー情報を取得する
4. WHEN APIリクエストが失敗するとき、THE Lambda_Function SHALL エラーログを出力し、他のデバイスの処理を継続する
5. WHEN Lambda_Functionが正常に実行されるとき、THE Data_Pipeline SHALL 取得したデータのタイムスタンプを記録する

### 要件2: 温湿度データ蓄積

**ユーザーストーリー:** データエンジニアとして、取得した温湿度データを構造化された形式で保存したい。そうすることで、後から時系列データとして分析できる。

#### 受け入れ基準

1. WHEN 温湿度データが取得されるとき、THE Lambda_Function SHALL deviceStatusDataのみを含む構造化されたJSONをRaw_Bucketに保存する
2. WHEN データを保存するとき、THE Data_Pipeline SHALL ファイル名にタイムスタンプを含め、年/月/日/時のパーティション構造で保存する
3. WHEN 保存するデータに、THE Lambda_Function SHALL 各デバイスの温度・湿度・バッテリー情報とタイムスタンプを含める
4. WHEN S3への保存が失敗するとき、THE Lambda_Function SHALL エラーログを出力し、リトライ処理を実行する
5. WHEN データが正常に保存されるとき、THE Data_Pipeline SHALL 保存完了のログと処理サマリーを出力する

### 要件3: 温湿度データカタログ化

**ユーザーストーリー:** データアナリストとして、S3に保存された温湿度データをAthenaで分析できるようにしたい。そうすることで、SQLクエリで時系列の温湿度変化を検索できる。

#### 受け入れ基準

1. WHEN Glue_CrawlerがRaw_Bucketをスキャンするとき、THE Data_Pipeline SHALL 温湿度データのJSONファイル構造を分析する
2. WHEN スキャンが完了するとき、THE Glue_Crawler SHALL deviceStatusDataテーブルをAthena_Serviceで使用可能な形で作成する
3. WHEN 新しい温湿度データが追加されるとき、THE Glue_Crawler SHALL テーブル定義を自動更新し、パーティションを追加する
4. WHEN テーブル定義の作成が失敗するとき、THE Glue_Crawler SHALL エラーログを出力する
5. WHEN テーブルが正常に作成されるとき、THE Data_Pipeline SHALL 温度・湿度・バッテリー・タイムスタンプの各カラムが適切に定義される

### 要件4: 温湿度データ変換（ETL）

**ユーザーストーリー:** データエンジニアとして、温湿度JSONデータをより効率的なParquet形式に変換したい。そうすることで、時系列分析クエリのパフォーマンスを向上させることができる。

#### 受け入れ基準

1. WHEN Glue_JobがRaw_Bucketの温湿度データを処理するとき、THE Data_Pipeline SHALL deviceStatusDataを含むJSONファイルを読み込む
2. WHEN データ変換を実行するとき、THE Glue_Job SHALL 温湿度データをParquet形式に変換し、時系列分析に適した構造にする
3. WHEN 変換が完了するとき、THE Glue_Job SHALL ParquetファイルをCurated_Bucketに日付パーティション構造で保存する
4. WHEN データ変換が失敗するとき、THE Glue_Job SHALL エラーログを出力し、処理を停止する
5. WHEN 変換処理が正常に完了するとき、THE Data_Pipeline SHALL 処理完了のログと変換されたレコード数を出力する

### 要件5: 温湿度データ分析

**ユーザーストーリー:** データアナリストとして、蓄積された温湿度データに対してSQLクエリを実行したい。そうすることで、室内環境の変化パターンや傾向を分析できる。

#### 受け入れ基準

1. WHEN Athena_ServiceでSQLクエリを実行するとき、THE Data_Pipeline SHALL Raw_BucketまたはCurated_Bucketの温湿度データを検索対象とする
2. WHEN 時系列クエリが実行されるとき、THE Athena_Service SHALL 温度・湿度の変化を時間軸で分析できる結果を返す
3. WHEN 大量の温湿度データに対してクエリを実行するとき、THE Athena_Service SHALL パーティション機能を活用して合理的な時間内で結果を返す
4. WHEN クエリが失敗するとき、THE Athena_Service SHALL 明確なエラーメッセージを提供する
5. WHEN 分析クエリが実行されるとき、THE Data_Pipeline SHALL デバイス別・時間別の温湿度統計情報を取得できる

### 要件6: インフラストラクチャ構築

**ユーザーストーリー:** 開発者として、AWSリソースをコードで管理したい。そうすることで、インフラストラクチャの変更を追跡し、再現可能な環境を構築できる。

#### 受け入れ基準

1. WHEN インフラストラクチャをデプロイするとき、THE Data_Pipeline SHALL AWS CDKを使用してリソースを定義する
2. WHEN CDKスタックをデプロイするとき、THE Data_Pipeline SHALL 必要なS3バケット、Lambda関数、Glueリソースを作成する
3. WHEN リソース間の権限設定が必要なとき、THE Data_Pipeline SHALL 適切なIAMロールとポリシーを自動生成する
4. WHEN 環境を削除するとき、THE Data_Pipeline SHALL CDKを使用してすべてのリソースを適切にクリーンアップする

