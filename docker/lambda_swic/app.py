import logging
import sys
import json
import xmltodict
import os
import base64
import boto3

from wis2mon_lib import handle_content, serialize_wis2_message, kinesis_lambda_handler

# Configure logging
logger = logging.getLogger()
log_level = os.getenv("LAMBDA_LOG_LEVEL", "INFO")
level = logging.getLevelName(log_level)
logger.setLevel(level)

logging.getLogger("xml2dict").setLevel(logging.ERROR)

firehose_name = os.getenv("FIREHOSE_NAME",None)

def extract_cap_infos(cap_message):
    logger.debug("processing cap {}".format(cap_message))

    infos = []

    # regular elements on first level
    fields = ["identifier","sender","sent","status","msgType","scope","references" ]
    cap_fields = {}
    for f in fields:
        cap_fields[f"cap_{f}"] = cap_message.get(f,"") 

    info_elements = cap_message.get("info",[])

    if not isinstance(info_elements, list):
        info_elements = [ info_elements, ]

    for cap_info in info_elements:
    
        info_fields = ["language","event","responseType","urgency","severity","certainty","effective","onset","expires","senderName", "headline","description","web"]
        info_fields_list = ["category"]

        cap_info_fields = {}

        for k in info_fields:
            cap_info_fields[f"cap_info_{k}"] = cap_info.get(k,"")

        for k in info_fields_list:
            cap_info_fields[f"cap_info_{k}"] = ",".join(cap_info.get(k,[]))

        infos.append( {**cap_fields,**cap_info_fields} )
    
    if len(infos) == 0:
        infos.append(  {**cap_fields, **{ f"cap_info{k}":"" for (k,v) in info_fields.items()  } } )

    logger.debug("returning {}".format(infos))

    return infos

def remove_namespace(name):
    if not ":" in name:
        return name
    else:
        return name.split(":")[-1]

def alter_keys(dictionary, func):
    empty = {}
    if not isinstance(dictionary,dict):
        return dictionary
    if dictionary and len(dictionary)>0:
        for k, v in dictionary.items():
            if isinstance(v, dict):
                empty[func(k)] = alter_keys(v, func)
            if isinstance(v, str):
                empty[func(k)] = v
            if isinstance(v, list):
                empty[func(k)] = [ alter_keys(e,func) for e in v ]
    return empty

def process_cap(event):

    logger.debug("processing CAP {}".format(event))
    content = handle_content(event)
    logger.debug("CAP content {}".format(content))

    cap_infos = []
    if content:
        cap = xmltodict.parse(content)
        cap = alter_keys(cap,remove_namespace)
        logger.debug("CAP as dict {}".format(cap))

        if cap and "alert" in cap:

            cap = cap["alert"]
            
            logger.debug( json.dumps(cap,indent=4) )

            # extract info
            cap_infos = extract_cap_infos(cap)
        
            message_info = serialize_wis2_message(event,validate=False,check_cache=False) ##

            # add info about broker
            for d in cap_infos:
                d["meta_broker"] = message_info["meta_broker"]
                d["meta_topic"] = message_info["meta_topic"]

        else:
            logger.error("no alert element in {} parsed as {}".format(content,cap))

    return cap_infos


def lambda_handler(event, context):
    """this functions receives kinesis records and extracts information about CAPs from it"""
    
    return kinesis_lambda_handler(event,context,process_cap,firehose_name)
    



