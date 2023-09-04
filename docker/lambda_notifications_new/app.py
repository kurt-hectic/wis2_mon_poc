import logging
import sys
import json
import base64
import os
import datetime

from wis2mon_lib import serialize_wis2_message, kinesis_lambda_handler

# Configure logging
logger = logging.getLogger()
log_level = os.getenv("LAMBDA_LOG_LEVEL", "INFO")
validate_schema = os.getenv("LAMBDA_VALIDATE","True").lower() in ('true', '1', 't', 'yes')
level = logging.getLevelName(log_level)
logger.setLevel(level)
#streamHandler = logging.StreamHandler(stream=sys.stdout)
#formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
#streamHandler.setFormatter(formatter)
#logger.addHandler(streamHandler)  
# 

firehose_name = os.getenv("FIREHOSE_NAME",None)


def process_notification(event):
    logger.debug("processing notification {}".format(event))
    ret = serialize_wis2_message(event,validate=validate_schema)
    return [ret,] 

 
def lambda_handler(event, context):
    """this functions receives kinesis records and extracts information about surface observations from it"""
    return kinesis_lambda_handler(event,context,process_notification,firehose_name)


# def lambda_handler(event, context):
#     """this functions receives kinesis records and extracts wis2 notification information from it"""
#     if not event or "records" not in event:
#         return 
    
#     start_time = datetime.datetime.now()
    
#     logger.info("lambda event {} records".format(len(event['records'])))
#     logger.debug("event before processing: {}".format(event))
    
#     output = []
    
#     for record in event['records']:
#         logger.debug("processing "+record['recordId'])
    
#         try:
#             payload=json.loads(base64.b64decode(record["data"]))
            
#             logger.debug("extracting info from: {}".format(payload))
#             message_info = json.dumps(serialize_wis2_message(payload,validate=validate_schema)) + "\n"
#             notification = base64.b64encode(message_info.encode())
#             result = "Ok"
#             logger.debug("processed "+record['recordId']+" "+result)
            
#         except Exception as e:
#             logger.error("error during WIS2 message processing",exc_info=True)
#             result = "ProcessingFailed"
#             notification = record["data"]

#         # out
#         output_record = {
#             'recordId': record['recordId'],
#             'result': result,
#             'data': notification
#         }

#         output.append(output_record)

#     response = output

#     end_time = datetime.datetime.now()

        
#     logger.info('processed {} records in {:.2f} seconds, average duration {:.2f} seconds'.format(len(response), (end_time-start_time).total_seconds() , (end_time-start_time).total_seconds() / len(response)   ))
    
#     return {'records': response}