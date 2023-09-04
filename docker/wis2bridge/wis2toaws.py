import logging
import time
import sys
import threading
import time
import json
import traceback
import ssl
import os
import signal
import boto3
import random
import string

import paho.mqtt.client as mqtt_paho

from datetime import datetime


from uuid import uuid4
from awscrt import mqtt
from awsiot import mqtt_connection_builder

from paho.mqtt.properties import Properties
from paho.mqtt.packettypes import PacketTypes

log_level = os.getenv("LOG_LEVEL", "INFO")
level = logging.getLevelName(log_level)


logging.basicConfig(format='%(asctime)s %(levelname)s:%(message)s',level=level, 
    handlers=[ logging.FileHandler("debug.log"), logging.StreamHandler()] )

CA = r"./cas/AmazonRootCA1.pem"

def get_random_string(length):
    # choose from all lowercase letter
    letters = string.ascii_lowercase
    result_str = ''.join(random.choice(letters) for i in range(length))
    return result_str


topics = [t.strip() for t in os.getenv("TOPICS","cache/a/wis2/#").split(",")]
wis_broker_host = os.getenv("WIS_BROKER_HOST")
wis_broker_port = int(os.getenv("WIS_BROKER_PORT"))
wis_user = os.getenv("WIS_USERNAME")
wis_pw = os.getenv("WIS_PASSWORD")
client_id = os.getenv("CLIENT_ID") + get_random_string(6)
aws_broker = os.getenv("AWS_BROKER")

#cert_text = open(os.getenv("CERT_FILE"),"rb").read()
#key_text = open(os.getenv("KEY_FILE",None),"rb").read()
cert_id = os.getenv("CERT_ID")

key_text = bytes(os.getenv("KEY"),"utf8")


session = boto3.Session()
iot_c = session.client('iot')

#logging.debug(f"from file {cert_text}")

cert_text = iot_c.describe_certificate(
    certificateId = cert_id
)['certificateDescription']['certificatePem']
cert_text = bytes(cert_text,"utf8")

logging.debug(f"obtained cert {cert_id} {cert_text}")


# Callback when connection is accidentally lost.
def on_connection_interrupted(connection, error, **kwargs):
    logging.warning("Connection interrupted. error: {}".format(error))

# Callback when an interrupted connection is re-established.
def on_connection_resumed(connection, return_code, session_present, **kwargs):
    logging.info("Connection resumed. return_code: {} session_present: {}".format(return_code, session_present))

    if return_code == mqtt.ConnectReturnCode.ACCEPTED and not session_present:
        logging.info("Session did not persist. Resubscribing to existing topics...")
        resubscribe_future, _ = connection.resubscribe_existing_topics()

        # Cannot synchronously wait for resubscribe result because we're on the connection's event-loop thread,
        # evaluate result with a callback instead.
        resubscribe_future.add_done_callback(on_resubscribe_complete)

def on_resubscribe_complete(resubscribe_future):
    resubscribe_results = resubscribe_future.result()
    logging.info("Resubscribe results: {}".format(resubscribe_results))

    for topic, qos in resubscribe_results['topics']:
        if qos is None:
            logging.error("Server rejected resubscribe to topic: {}".format(topic))


def on_connect_wis(client, userdata, flags, rc):
    """
    set the bad connection flag for rc >0, Sets onnected_flag if connected ok
    also subscribes to topics
    """
    logging.info("Connected flags:"+str(flags)+" result code: "+str(rc)) 
    for topic in topics:   
        logging.info("subscribing to:"+str(topic))
        client_wis2.subscribe(topic,qos=1)

def on_subscribe(client,userdata,mid,granted_qos):
    """removes mid values from subscribe list"""
    logging.info("in on subscribe callback result "+str(mid))
    client.subscribe_flag=True

def on_message(client, userdata, msg):
    topic=msg.topic
    logging.debug(f"message received with topic {topic}")
    m_decode=str(msg.payload.decode("utf-8","ignore"))
    #logging.debug("message received")
    message_routing(client,topic,m_decode)

def on_disconnect(client, userdata, rc):
    logging.info("connection to broker has been lost")
    client.connected_flag=False
    client.disconnect_flag=True

def message_routing(client,topic,msg):
    #logging.debug("message_routing")
    logging.debug("routing topic: "+topic)
    logging.debug("routing message:  "+msg)
    
    #topic=topic.replace("sig/","")
    
    #topic="sdk/test/python"
    #topic="bfa/ouagadougou_met_centre/data/core/weather/surface-based-observations/synop"
    
    topic_levels = topic.split("/")

    # only take levels 4 to 12, if they are there. Levels 1-3 are fix for the moment
    topic_new = "/".join(topic_levels[3:9]) if len(topic_levels) > 10 else "/".join(topic_levels[3:])
    topic_new = topic_levels[0] + "/" + topic_new

    # insert metadata into the message
    if not msg or msg.isspace():
        logging.debug(f"discarding empty message published on {topic}")
        return
    try:
        msg = json.loads(msg)
    except json.JSONDecodeError as e:
        logging.error(f"cannot parse json message '{msg}',{e}, {topic}")
        return    

    msg["_meta"] = { "time_received" : datetime.now().isoformat() , "broker" : wis_broker_host , "topic" : topic }
    msg = json.dumps(msg)

    logging.debug(f"publishing topic {topic_new} with length {len(topic_levels)} and message length {len(msg)} and {msg}")      
    client_aws.publish(topic=topic_new,payload=msg,qos=mqtt.QoS.AT_LEAST_ONCE)
        
def create_wis2_connection():
    transport = "websockets" if wis_broker_port==443 else "tcp"
    logging.info(f"creating wis2 connection to {wis_broker_host}:{wis_broker_port} using {wis_user}/{wis_pw} over {transport}")
    
    client = mqtt_paho.Client(client_id=client_id, transport=transport,
         protocol=mqtt_paho.MQTTv311, clean_session=False)
                         
    client.username_pw_set(wis_user, wis_pw)
    if wis_broker_port != 1883:
        logging.info("setting up TLS connection")
        client.tls_set(certfile=None, keyfile=None, cert_reqs=ssl.CERT_REQUIRED)
    
    client.on_message = on_message
    client.on_connect = on_connect_wis
    client.on_subscribe = on_subscribe
    client.on_disconnect = on_disconnect
    
    #properties=Properties(PacketTypes.CONNECT)
    #properties.SessionExpiryInterval=30*60 # in seconds
    
    client.connect(wis_broker_host,
                   #port=8883,
                   port=wis_broker_port,
                   #clean_start=mqtt_paho.,
                   #properties=properties,
                   keepalive=60)
    
    return client
    
def create_aws_connection():
    logging.info(f"creating AWS connection to {aws_broker}")
    return mqtt_connection_builder.mtls_from_bytes( 
        endpoint =  aws_broker, 
        client_id = client_id,
        on_connection_interrupted = on_connection_interrupted,
        on_connection_resumed  = on_connection_resumed,
        cert_bytes  = cert_text ,
        pri_key_bytes = key_text,
        ca_filepath = CA
    )

def handler(signum, frame):
    signame = signal.Signals(signum).name
    logging.info(f"received signal {signame}")
    client_wis2.loop_stop()
    client_wis2.disconnect()
    
    time.sleep(5)
    client_aws.disconnect()


signal.signal(signal.SIGTERM, handler)
signal.signal(signal.SIGINT, handler)
                
# start
try:
    logging.info("creating connection to AWS")
    client_aws = create_aws_connection()
    connect = client_aws.connect()
    connect.result()
    logging.info("connected to AWS")    
    
    logging.info("creating connection to WIS2")
    client_wis2 = create_wis2_connection()
    logging.info("connected to WIS2")

    client_wis2.loop_forever() #start loop
    logging.info("loop")

except Exception as e:
    logging.error("connection failed "+str(e))
    traceback.print_exc()
