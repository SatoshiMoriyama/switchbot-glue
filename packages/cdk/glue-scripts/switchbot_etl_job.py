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
from pyspark.sql.functions import (
    col, explode, to_timestamp, date_format, from_utc_timestamp
)
from pyspark.sql import DataFrame


def read_raw_data(glue_context: GlueContext, s3_path: str) -> DynamicFrame:
    """Read JSON data from Raw S3 Bucket."""
    return glue_context.create_dynamic_frame.from_options(
        connection_type="s3",
        connection_options={
            "paths": [s3_path],
            "recurse": True
        },
        format="json",
        transformation_ctx="raw_data_source"
    )


def resolve_schema(frame: DynamicFrame) -> DynamicFrame:
    """Resolve ambiguous types (e.g., temperature can be int or double)."""
    return frame.resolveChoice(specs=[
        ('api_response.body.deviceStatusData.status.temperature', 'cast:double')
    ])


def transform_data(df: DataFrame) -> DataFrame:
    """Extract and flatten deviceStatusData, add partition columns."""
    # Flatten the nested structure
    flattened = df.select(
        explode(col("api_response.body.deviceStatusData")).alias("device_data"),
        col("timestamp").alias("collection_timestamp")
    )
    
    # Extract fields and add JST-based partition columns
    transformed = flattened.select(
        col("device_data.deviceInfo.deviceId").alias("device_id"),
        col("device_data.deviceInfo.deviceName").alias("device_name"),
        col("device_data.deviceInfo.deviceType").alias("device_type"),
        col("device_data.deviceInfo.hubDeviceId").alias("hub_device_id"),
        col("device_data.status.temperature").cast("double").alias("temperature"),
        col("device_data.status.humidity").cast("int").alias("humidity"),
        col("device_data.status.battery").cast("int").alias("battery"),
        col("device_data.status.version").alias("device_version"),
        to_timestamp(col("device_data.timestamp")).alias("recorded_at"),
        to_timestamp(col("collection_timestamp")).alias("collection_time"),
        from_utc_timestamp(
            to_timestamp(col("device_data.timestamp")), "Asia/Tokyo"
        ).alias("recorded_at_jst"),
        date_format(
            from_utc_timestamp(to_timestamp(col("device_data.timestamp")), "Asia/Tokyo"),
            "yyyy"
        ).alias("year"),
        date_format(
            from_utc_timestamp(to_timestamp(col("device_data.timestamp")), "Asia/Tokyo"),
            "MM"
        ).alias("month"),
        date_format(
            from_utc_timestamp(to_timestamp(col("device_data.timestamp")), "Asia/Tokyo"),
            "dd"
        ).alias("day")
    )
    
    return transformed


def filter_valid_records(df: DataFrame) -> DataFrame:
    """Filter out records with missing required fields."""
    return df.filter(
        col("device_id").isNotNull() &
        col("temperature").isNotNull() &
        col("humidity").isNotNull() &
        col("recorded_at").isNotNull()
    )


def write_curated_data(
    glue_context: GlueContext,
    frame: DynamicFrame,
    output_path: str
) -> None:
    """Write processed data to Curated S3 Bucket in Parquet format."""
    glue_context.write_dynamic_frame.from_options(
        frame=frame,
        connection_type="s3",
        connection_options={
            "path": output_path,
            "partitionKeys": ["year", "month", "day"]
        },
        format="parquet",
        transformation_ctx="write_curated_data"
    )


def main():
    """Main ETL job entry point."""
    args = getResolvedOptions(sys.argv, [
        'JOB_NAME',
        'raw_bucket',
        'curated_bucket',
        'database_name'
    ])
    
    # Initialize Glue context
    sc = SparkContext()
    glue_context = GlueContext(sc)
    job = Job(glue_context)
    job.init(args['JOB_NAME'], args)
    
    print(f"Starting ETL job: {args['JOB_NAME']}")
    
    try:
        # Read raw data
        raw_s3_path = f"s3://{args['raw_bucket']}/"
        raw_frame = read_raw_data(glue_context, raw_s3_path)
        
        raw_count = raw_frame.count()
        print(f"Raw data count: {raw_count}")
        
        if raw_count == 0:
            print("No data found in raw data source")
            job.commit()
            return
        
        # Resolve schema ambiguities
        resolved_frame = resolve_schema(raw_frame)
        
        # Transform data
        transformed_df = transform_data(resolved_frame.toDF())
        
        # Filter valid records
        cleaned_df = filter_valid_records(transformed_df)
        
        cleaned_count = cleaned_df.count()
        print(f"Processed records: {cleaned_count}")
        
        if cleaned_count == 0:
            print("No valid data after processing")
            job.commit()
            return
        
        # Write to curated bucket
        output_path = f"s3://{args['curated_bucket']}/curated-data/"
        curated_frame = DynamicFrame.fromDF(cleaned_df, glue_context, "processed_data")
        write_curated_data(glue_context, curated_frame, output_path)
        
        print(f"Successfully wrote {cleaned_count} records to Parquet")
        
    except Exception as e:
        print(f"ETL job failed: {str(e)}")
        raise
    
    finally:
        job.commit()


if __name__ == "__main__":
    main()
