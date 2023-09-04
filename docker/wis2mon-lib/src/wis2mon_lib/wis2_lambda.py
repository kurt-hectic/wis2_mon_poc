import logging
import json
import base64
import boto3
import datetime

logger = logging.getLogger(__name__)

class RetryError(Exception):
    pass

class NonRecoverableError(Exception):
    pass


def kinesis_firehose_processor(event,processing_function):
    output = []
    
    for record in event['records']:
        logger.debug("processing "+record['recordId'])
    
        try:
            payload=json.loads(base64.b64decode(record["data"]))
            
            logger.debug("extracting info from: {}".format(payload))
            data = json.dumps(processing_function(payload)) + "\n"
            notification = base64.b64encode(data.encode())
            result = "Ok"
            logger.debug("processed "+record['recordId']+" "+result)
            
        except Exception as e:
            logger.error("error during WIS2 message processing",exc_info=True)
            result = "ProcessingFailed"
            notification = record["data"]

        # out
        output_record = {
            'recordId': record['recordId'],
            'result': result,
            'data': notification
        }

        output.append(output_record)

    return output

        
def kinesis_lambda_handler(event, context, fn, firehose_name ):
    """this functions receives kinesis records and extracts information from it"""
    if not event or not "Records" in event:
        return 
    
    start_time = datetime.datetime.now()
    
    logger.debug("event before processing: {}".format(event))    
    logger.info("lambda event {} records".format(len(event['Records'])))
    
    output = []

    for record in event["Records"]:
        kinesis_record = record["kinesis"]
        record_id = kinesis_record["sequenceNumber"]
        logger.debug("processing "+record_id)

        payload = json.loads(base64.b64decode(kinesis_record["data"]))
        logger.debug("extracting info from: {}".format(payload))

        data = fn(payload)

        output = output + data 

    end_time = datetime.datetime.now()
    avg_duration = ((end_time-start_time).total_seconds() * 1000 ) / len(event["Records"])

    cloudwatch = boto3.client('cloudwatch')

    response = cloudwatch.put_metric_data(
        MetricData = [
            {
                'MetricName': 'RecordExecutionDurationAverage',
                'Dimensions': [
                    {
                        'Name': 'Pipeline',
                        'Value': fn.__name__
                    },
                ],
                'Unit': 'Milliseconds',
                'Value': avg_duration
            },
            {
                'MetricName': 'RecordsProcessedNumber',
                'Dimensions': [
                    {
                        'Name': 'Pipeline',
                        'Value': fn.__name__
                    },
                ],
                'Unit': 'Count',
                'Value':  len(event["Records"])
            },
        ],
        Namespace = 'WIS2monitoring'
    )

    logger.info('processed {} records in {:.2f} seconds, average duration {:.2f} seconds'.format(len(event["Records"]), (end_time-start_time).total_seconds() , (end_time-start_time).total_seconds() / len(event["Records"])   ))
    #logger.info("submitting {} records to firehose".format(len(output)))
        
    if len(output)>0:
        firehose_client = boto3.client('firehose')
        try:
            response = firehose_client.put_record_batch(
                DeliveryStreamName=firehose_name,
                Records=[
                    { "Data" : json.dumps(d) + "\n" } for d in output 
                ]
            )

            logger.debug("response {}".format(response))
            logger.info('submitted {} records to firehose'.format(len(output)))
        except Exception as e:
            raise e
        finally:
            if firehose_client:
                firehose_client.close()
              
    return True