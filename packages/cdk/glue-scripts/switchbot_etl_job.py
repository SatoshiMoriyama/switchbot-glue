"""
SwitchBot Data ETL Job
Converts JSON data from Raw S3 Bucket to Parquet format in Curated S3 Bucket
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql.functions import col, explode, to_timestamp, date_format, coalesce

def main():
    # Get job parameters
    args = getResolvedOptions(sys.argv, [
        'JOB_NAME',
        'raw_bucket',
        'curated_bucket',
        'database_name'
    ])
    
    # Initialize Glue context
    sc = SparkContext()
    glueContext = GlueContext(sc)
    spark = glueContext.spark_session
    job = Job(glueContext)
    job.init(args['JOB_NAME'], args)
    
    print(f"Starting ETL job: {args['JOB_NAME']}")
    
    try:
        raw_s3_path = f"s3://{args['raw_bucket']}/"
        
        # Read JSON data from Raw S3 Bucket
        raw_data_source = glueContext.create_dynamic_frame.from_options(
            connection_type="s3",
            connection_options={
                "paths": [raw_s3_path],
                "recurse": True
            },
            format="json",
            transformation_ctx="raw_data_source"
        )
        
        raw_count = raw_data_source.count()
        print(f"Raw data count: {raw_count}")
        
        if raw_count == 0:
            print("No data found in raw data source")
            job.commit()
            return
        
        # Convert to Spark DataFrame
        raw_df = raw_data_source.toDF()
        
        # Extract and flatten the deviceStatusData array
        flattened_df = raw_df.select(
            explode(col("api_response.body.deviceStatusData")).alias("device_data"),
            col("timestamp").alias("collection_timestamp")
        )
        
        # Extract fields from nested structure
        # Note: temperature can be either double or struct<double:double,int:int> depending on data
        # Use coalesce with try to handle both cases
        processed_df = flattened_df.select(
            col("device_data.deviceInfo.deviceId").alias("device_id"),
            col("device_data.deviceInfo.deviceName").alias("device_name"),
            col("device_data.deviceInfo.deviceType").alias("device_type"),
            col("device_data.deviceInfo.hubDeviceId").alias("hub_device_id"),
            # Handle temperature - try struct fields first, then direct cast
            coalesce(
                col("device_data.status.temperature.double"),
                col("device_data.status.temperature.int").cast("double"),
                col("device_data.status.temperature").cast("double")
            ).alias("temperature"),
            col("device_data.status.humidity").cast("int").alias("humidity"),
            col("device_data.status.battery").cast("int").alias("battery"),
            col("device_data.status.version").alias("device_version"),
            to_timestamp(col("device_data.timestamp")).alias("recorded_at"),
            to_timestamp(col("collection_timestamp")).alias("collection_time"),
            date_format(to_timestamp(col("device_data.timestamp")), "yyyy").alias("year"),
            date_format(to_timestamp(col("device_data.timestamp")), "MM").alias("month"),
            date_format(to_timestamp(col("device_data.timestamp")), "dd").alias("day")
        )
        
        # Filter out invalid data
        cleaned_df = processed_df.filter(
            col("device_id").isNotNull() &
            col("temperature").isNotNull() &
            col("humidity").isNotNull() &
            col("recorded_at").isNotNull()
        )
        
        cleaned_count = cleaned_df.count()
        print(f"Processed records: {cleaned_count}")
        
        if cleaned_count == 0:
            print("No valid data after processing")
            job.commit()
            return
        
        # Convert back to DynamicFrame and write to Curated S3 Bucket
        processed_dynamic_frame = DynamicFrame.fromDF(cleaned_df, glueContext, "processed_data")
        output_path = f"s3://{args['curated_bucket']}/curated-data/"
        
        glueContext.write_dynamic_frame.from_options(
            frame=processed_dynamic_frame,
            connection_type="s3",
            connection_options={
                "path": output_path,
                "partitionKeys": ["year", "month", "day"]
            },
            format="parquet",
            transformation_ctx="write_curated_data"
        )
        
        print(f"Successfully wrote {cleaned_count} records to Parquet")
        
    except Exception as e:
        print(f"ETL job failed: {str(e)}")
        raise e
    
    finally:
        job.commit()

if __name__ == "__main__":
    main()
