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
from pyspark.sql import DataFrame
from pyspark.sql.functions import *
from pyspark.sql.types import *
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

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
    
    logger.info(f"Starting ETL job: {args['JOB_NAME']}")
    logger.info(f"Raw bucket: {args['raw_bucket']}")
    logger.info(f"Curated bucket: {args['curated_bucket']}")
    logger.info(f"Database: {args['database_name']}")
    
    try:
        # Read data from Glue Data Catalog (Raw data)
        # Table name is fixed as 'switchbot_raw_data' by manual table creation
        raw_data_source = glueContext.create_dynamic_frame.from_catalog(
            database=args['database_name'],
            table_name="switchbot_raw_data"
        )
        
        logger.info(f"Raw data count: {raw_data_source.count()}")
        
        if raw_data_source.count() == 0:
            logger.warning("No data found in raw data source")
            job.commit()
            return
        
        # Convert to Spark DataFrame for easier manipulation
        raw_df = raw_data_source.toDF()
        
        # Extract and flatten the deviceStatusData array
        # The JSON structure contains an array of device status data
        flattened_df = raw_df.select(
            explode(col("devicestatusdata")).alias("device_data"),
            col("timestamp").alias("collection_timestamp")
        )
        
        # Extract fields from the nested structure
        processed_df = flattened_df.select(
            col("device_data.deviceinfo.deviceid").alias("device_id"),
            col("device_data.deviceinfo.devicename").alias("device_name"),
            col("device_data.deviceinfo.devicetype").alias("device_type"),
            col("device_data.deviceinfo.hubdeviceid").alias("hub_device_id"),
            col("device_data.status.temperature").cast("double").alias("temperature"),
            col("device_data.status.humidity").cast("int").alias("humidity"),
            col("device_data.status.battery").cast("int").alias("battery"),
            col("device_data.status.version").alias("device_version"),
            to_timestamp(col("device_data.timestamp")).alias("recorded_at"),
            to_timestamp(col("collection_timestamp")).alias("collection_time"),
            # Add partition columns for efficient querying
            date_format(to_timestamp(col("device_data.timestamp")), "yyyy").alias("year"),
            date_format(to_timestamp(col("device_data.timestamp")), "MM").alias("month"),
            date_format(to_timestamp(col("device_data.timestamp")), "dd").alias("day")
        )
        
        # Filter out null or invalid data
        cleaned_df = processed_df.filter(
            col("device_id").isNotNull() &
            col("temperature").isNotNull() &
            col("humidity").isNotNull() &
            col("recorded_at").isNotNull()
        )
        
        logger.info(f"Processed data count: {cleaned_df.count()}")
        
        if cleaned_df.count() == 0:
            logger.warning("No valid data after processing")
            job.commit()
            return
        
        # Convert back to DynamicFrame for Glue operations
        processed_dynamic_frame = DynamicFrame.fromDF(cleaned_df, glueContext, "processed_data")
        
        # Write to S3 in Parquet format with partitioning
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
        
        logger.info(f"Successfully wrote curated data to: {output_path}")
        
        # Log summary statistics
        logger.info("ETL Job Summary:")
        logger.info(f"- Total records processed: {cleaned_df.count()}")
        logger.info(f"- Unique devices: {cleaned_df.select('device_id').distinct().count()}")
        logger.info(f"- Date range: {cleaned_df.agg(min('recorded_at'), max('recorded_at')).collect()[0]}")
        
    except Exception as e:
        logger.error(f"ETL job failed with error: {str(e)}")
        raise e
    
    finally:
        job.commit()
        logger.info("ETL job completed")

if __name__ == "__main__":
    main()