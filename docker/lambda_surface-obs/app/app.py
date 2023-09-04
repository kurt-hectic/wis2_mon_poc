import logging
import sys
import json
import os
import io
import boto3
import base64

from .bufr_processing import process_bufr

from wis2mon_lib import handle_content, serialize_wis2_message, kinesis_lambda_handler

# Configure logging
logger = logging.getLogger()
log_level = os.getenv("LAMBDA_LOG_LEVEL", "INFO")
level = logging.getLevelName(log_level)
logger.setLevel(level)

logging.getLogger("bufr2geojson").setLevel(logging.ERROR)

firehose_name = os.getenv("FIREHOSE_NAME",None)


def process_surface_obs(event):
    logger.debug("processing surface obs {}".format(event))

    content = handle_content(event)
    if content:
        data = process_bufr( content )
        logger.debug("processed bufr.. extracted {} observations".format(len(data)))

        message_info = serialize_wis2_message(event,validate=False,check_cache=False) ##

        # add info about broker
        for d in data:
            d["meta_broker"] = message_info["meta_broker"]
            d["meta_topic"] = message_info["meta_topic"]
    else:
        data=[]    

    return data


def lambda_handler(event, context):
    """this functions receives kinesis records and extracts information about surface observations from it"""

    return kinesis_lambda_handler(event,context,process_surface_obs,firehose_name)

    
            
