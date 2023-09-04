-- Your SQL scripts for initialization goes here...
use main;

-- DROP TABLE IF EXISTS notifications;

CREATE TABLE IF NOT EXISTS notifications (
    id INT NOT NULL AUTO_INCREMENT , 
    wis2_id VARCHAR(255),
    wis2_version VARCHAR(10),
    property_datetime DATETIME,
    property_datetime_orig VARCHAR(50),
    property_data_id VARCHAR(255),
    content_encoding VARCHAR(10),
    content_size INT,
    integrity_method VARCHAR(10),
    pubtime DATETIME,
    pubtime_orig VARCHAR(50)
    meta_received_datetime DATETIME,
    meta_broker VARCHAR(50),
    meta_topic VARCHAR(255),
    meta_lambda_datetime DATETIME,
    canonical_href VARCHAR(400),
    canonical_type VARCHAR(255),
    meta_source VARCHAR(10),
    meta_cache_status INT,
    meta_validates BOOLEAN,
    meta_content_embedded BOOLEAN,
    meta_remote_content_size INT,
    date_inserted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX (date_inserted),
    INDEX (meta_topic),
    INDEX (meta_broker)
);

-- ALTER TABLE notifications ADD COLUMN property_datetime_orig VARCHAR(50) AFTER property_datetime;
-- ALTER TABLE notifications ADD COLUMN pubtime_orig VARCHAR(50) AFTER pubtime;
-- ALTER TABLE notifications ADD COLUMN meta_validates BOOLEAN AFTER meta_cache_status;

-- ALTER TABLE notifications ADD COLUMN meta_content_embedded BOOLEAN AFTER meta_cache_status;
-- ALTER TABLE notifications ADD COLUMN meta_remote_content_size INT AFTER meta_content_embedded;


CREATE TABLE IF NOT EXISTS surfaceobservations (
    id INT NOT NULL AUTO_INCREMENT , 
    wsi VARCHAR(255),
    result_time DATETIME,
    phenomenon_time VARCHAR(255),
    geom_lat FLOAT,
    geom_lon FLOAT,
    geom_height FLOAT,
    observed_property_pressure_reduced_to_mean_sea_level BOOLEAN,
    observed_property_air_temperature BOOLEAN,
    observed_property_dewpoint_temperature BOOLEAN,
    observed_property_relative_humidity BOOLEAN,
    observed_property_wind_direction BOOLEAN,
    observed_property_wind_speed BOOLEAN,
    observed_property_total_snow_depth BOOLEAN,
    all_observed_properties TEXT,
    meta_broker VARCHAR(255),
    meta_topic VARCHAR(255),
    date_inserted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,   
    PRIMARY KEY (id),
    INDEX (date_inserted),
    INDEX (meta_broker),
    INDEX (observed_property_pressure_reduced_to_mean_sea_level),
    INDEX (observed_property_air_temperature),
    INDEX (observed_property_dewpoint_temperature),
    INDEX (observed_property_relative_humidity),
    INDEX (observed_property_wind_direction),
    INDEX (observed_property_wind_speed),
    INDEX (observed_property_total_snow_depth)
);

CREATE TABLE IF NOT EXISTS caps (
    id INT NOT NULL AUTO_INCREMENT , 
    cap_identifier VARCHAR(255),
    cap_sender VARCHAR(255),
    cap_sent DATETIME,
    cap_sent_orig DATETIME,
    cap_status VARCHAR(255),
    cap_msgType VARCHAR(255),
    cap_scope VARCHAR(255),
    cap_references TEXT,
    cap_info_language VARCHAR(255),
    cap_info_category VARCHAR(255),
    cap_info_event VARCHAR(255),
    cap_info_responseType VARCHAR(255),
    cap_info_urgency VARCHAR(255),
    cap_info_severity VARCHAR(255),
    cap_info_certainty VARCHAR(255),
    cap_info_effective VARCHAR(255),
    cap_info_onset VARCHAR(255),
    cap_info_expires DATETIME,
    cap_info_expires_orig VARCHAR(255),
    cap_info_senderName VARCHAR(255),
    cap_info_headline TEXT,
    cap_info_description TEXT,
    cap_info_web VARCHAR(255),
    meta_broker VARCHAR(255),
    meta_topic VARCHAR(255),
    date_inserted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,   
    PRIMARY KEY (id),
    INDEX (date_inserted),
    INDEX (meta_broker),
    INDEX (cap_sender),
    INDEX (cap_info_category),
    INDEX (cap_info_urgency),
    INDEX (cap_info_severity)       
) DEFAULT CHARSET=utf8mb4 ;


--ALTER TABLE caps MODIFY cap_info_description TEXT ;
--ALTER TABLE caps MODIFY cap_info_headline TEXT ;
-- ALTER TABLE caps MODIFY cap_references TEXT ;




