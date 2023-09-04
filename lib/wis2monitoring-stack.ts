import * as cdk from 'aws-cdk-lib';
import {
  aws_s3 as s3, aws_iam as iam, aws_ec2 as ec2,
  aws_iot as iot, aws_ecs as ecs, aws_ecr as ecr, aws_lambda as lambda,
  aws_kinesis as kinesis, aws_logs as aws_logs, aws_ecs_patterns as ecs_patterns,
  aws_s3_notifications as s3_notify, aws_sqs as sqs, aws_events as events, aws_events_targets as targets
} from 'aws-cdk-lib';



import { SqsEventSource, KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

import * as iot_alpha from '@aws-cdk/aws-iot-alpha';
import * as actions from '@aws-cdk/aws-iot-actions-alpha';

import * as destinations from '@aws-cdk/aws-kinesisfirehose-destinations-alpha';
import * as firehose from "@aws-cdk/aws-kinesisfirehose-alpha";

import { Construct } from 'constructs';
import { PartitionKey } from 'aws-cdk-lib/aws-appsync';
//import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';


import { CdkResourceInitializer } from '../lib/resource-initializer';
import { DatabaseClusterEngine, ServerlessCluster, Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion } from 'aws-cdk-lib/aws-rds'


import * as fs from 'fs'
import * as path from 'path';


export class Wis2MonitoringStack extends cdk.Stack {

  vpc: ec2.Vpc;
  bucket: s3.Bucket;
  dbCluster: ServerlessCluster;
  dbCredentials: DatabaseSecret;

  metricPolicy: iam.Policy;

  certificateMF: iot.CfnCertificate;
  certificateCMA: iot.CfnCertificate;

  csr_file: string = "./resources/cert.csr";
  csrCma_file: string = "./resources/cert_cma.csr";
  key: string = "./resources/privatekey.pem";
  keyCma: string = "./resources/privatekey_cma.pem";

  RETENTION: number = 24; // 24 hours, records only available 24h in cache   

  secrets = JSON.parse(fs.readFileSync('env_secret.json', 'utf-8'));

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // IOT setup

    // logging 

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
      }, {
        cidrMask: 24,
        name: 'compute',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }, {
        cidrMask: 28,
        name: 'rds',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }]
    })

    this.bucket = new s3.Bucket(this, "Kinesis2RDSBucket", {
      versioned: false, removalPolicy: cdk.RemovalPolicy.DESTROY, autoDeleteObjects: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(90) }
      ]
    });

    const policyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cloudwatch:PutMetricData"],
      resources: ['*'],
    });

    this.metricPolicy =  new iam.Policy(this, "publish-metric-policy", { 
      statements: [ policyStatement ]
    })  


    this.setupIOT();
    this.setupBridge("");
    //this.setupBridge("Alt");
    
    this.setupDBInfrastructure(id);
    this.setupDBImport();

    this.setupNotificationPipeline();
    this.setupSurfaceObsPipeline();
    this.setupCAPPipeline();

  }


  setupIOT(): void {

    // const role = new iam.Role(this, "IOTCoreRole", {
    //   assumedBy: new iam.ServicePrincipal("iot.amazonaws.com")
    // });

    // role.addToPolicy(new iam.PolicyStatement({
    //   effect: iam.Effect.ALLOW,
    //   //resources: ["arn:aws:logs:*:735286310638:log-group:*:log-stream:*"],
    //   resources: ["*"],
    //   actions: [
    //     "logs:CreateLogGroup",
    //     "logs:CreateLogStream",
    //     "logs:PutLogEvents",
    //     "logs:PutMetricFilter",
    //     "logs:PutRetentionPolicy",
    //     "cloudwatch:SetAlarmState",
    //     "cloudwatch:PutMetricData",
    //   ]
    // }));

    // const cfnLogging = new iot.CfnLogging(this, "CoreLogging", {
    //   accountId: "735286310638",
    //   defaultLogLevel: "WARN",
    //   roleArn: role.roleArn
    // });


    const thing = new iot.CfnThing(this, "Thing_MF", {
      attributePayload: {
        attributes: { "attributes_key": "attributes" },
      },
      thingName: "wis2bridge"
    });

    const thingCMA = new iot.CfnThing(this, "Thing_CMA", {
      attributePayload: {
        attributes: { "attributes_key": "attributes" },
      },
      thingName: "wis2bridgeCMA"
    });

    this.certificateMF = new iot.CfnCertificate(this, "Certificate_MF", {
      status: "ACTIVE",
      certificateSigningRequest: fs.readFileSync(this.csr_file, "utf8")
    });

    this.certificateCMA = new iot.CfnCertificate(this, "Certificate_CMA", {
      status: "ACTIVE",
      certificateSigningRequest: fs.readFileSync(this.csrCma_file, "utf8")
    });


    new cdk.CfnOutput(this, "CertificateId", { value: this.certificateMF.attrId });
    new cdk.CfnOutput(this, "CertificateId_CMA", { value: this.certificateCMA.attrId });

    const policy = new iot.CfnPolicy(this, 'BridgePolicy', {
      policyDocument: {
        "Version": '2012-10-17',
        "Statement": [
          {
            "Effect": 'Allow',
            "Action": ['iot:*'],
            "Resource": ['*'],
          },
        ],
      },
      policyName: "bridgepolicy"
    });

    const policyPrincipalAttachment = new iot.CfnPolicyPrincipalAttachment(this, "PolicyPrincipalAttachment_MF", {
      policyName: policy.policyName || 'PolicyPrincipalAttachment_MF',
      principal: this.certificateMF.attrArn
    });

    const thingPrincipalAttachment = new iot.CfnThingPrincipalAttachment(this, 'ThingPrincipalAttachment_MF', {
      thingName: thing.thingName || 'ThingPrincipalAttachment',
      principal: this.certificateMF.attrArn
    });

    const policyPrincipalAttachmentCMA = new iot.CfnPolicyPrincipalAttachment(this, "PolicyPrincipalAttachment_CMA", {
      policyName: policy.policyName || 'PolicyPrincipalAttachment_CMA',
      principal: this.certificateCMA.attrArn
    });

    const thingPrincipalAttachmentCMA = new iot.CfnThingPrincipalAttachment(this, 'ThingPrincipalAttachment_CMA', {
      thingName: thingCMA.thingName || 'ThingPrincipalAttachment',
      principal: this.certificateCMA.attrArn
    });

  }

  setupBridge(suffix: string): void {


    const cluster = new ecs.Cluster(this, "BridgeEcsCluster"+suffix, { vpc: this.vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "BridgeTask"+suffix, { family: "BridgeTask"+suffix, memoryLimitMiB: 512, cpu: 256  });
    taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
      resources: ['arn:aws:iot:*:*:cert/*'],
      actions: ['iot:DescribeCertificate']
    }));

    const image = ecs.ContainerImage.fromAsset("./docker/wis2bridge");

    const my_environment = {
      "WIS_USERNAME": this.secrets["WIS_MF_USERNAME"], "WIS_PASSWORD": this.secrets["WIS_MF_PASSWORD"], "TOPICS": "$share/wmo/cache/a/wis2/#,$share/wmo/origin/a/wis2/#",
      "CLIENT_ID": "wis2bridge"+suffix, "AWS_BROKER": "awyxyfhut1ugd-ats.iot.eu-central-1.amazonaws.com",
      "WIS_BROKER_HOST": "globalbroker.meteo.fr", "WIS_BROKER_PORT": "443",
      "CERT_ID": this.certificateMF.attrId, "KEY": fs.readFileSync(this.key, "utf8"), "LOG_LEVEL": "INFO"
    };

    const my_environment_cma = {
      "WIS_USERNAME": this.secrets["WIS_USERNAME"], "WIS_PASSWORD": this.secrets["WIS_PASSWORD"], "TOPICS": "$share/wmogroup/cache/a/wis2/#,$share/wmogroup/origin/a/wis2/#",
      "CLIENT_ID": "wis2bridge_cma"+suffix, "AWS_BROKER": "awyxyfhut1ugd-ats.iot.eu-central-1.amazonaws.com",
      "WIS_BROKER_HOST": "gb.wis.cma.cn", "WIS_BROKER_PORT": "1883",
      "CERT_ID": this.certificateCMA.attrId, "KEY": fs.readFileSync(this.keyCma, "utf8"), "LOG_LEVEL": "INFO"
    };

    const container = taskDefinition.addContainer("BridgeApp_MF"+suffix, {
      image: image,
      environment: my_environment,
      logging: new ecs.AwsLogDriver({ streamPrefix: "BrideLog_MF"+suffix, mode: ecs.AwsLogDriverMode.NON_BLOCKING })
    });

    const containerCMA = taskDefinition.addContainer("BridgeApp_CMA"+suffix, {
      image: image,
      environment: my_environment_cma,
      logging: new ecs.AwsLogDriver({ streamPrefix: "BrideLog_CMA"+suffix, mode: ecs.AwsLogDriverMode.NON_BLOCKING })
    });

    const service = new ecs.FargateService(this, "BridgeService"+suffix, {
      cluster: cluster,
      taskDefinition: taskDefinition, desiredCount: 2
    });

  }

  setupNotificationPipeline(): void {
    const sourceStream = new kinesis.Stream(this, "NotificationInputStream",  { 
      retentionPeriod: cdk.Duration.hours(this.RETENTION), 
      streamMode: cdk.aws_kinesis.StreamMode.PROVISIONED,
      shardCount: 20
    })

    const sourceStreamNew = new kinesis.Stream(this, "NotificationInputStreamNew",  { 
      retentionPeriod: cdk.Duration.hours(this.RETENTION), 
      streamMode: cdk.aws_kinesis.StreamMode.PROVISIONED,
      shardCount: 15
    })

    const topicRule = new iot_alpha.TopicRule(this, "NotificationRule", {
      sql: iot_alpha.IotSql.fromStringAsVer20160323("SELECT * FROM '#'"),
      actions: [
        //new actions.KinesisPutRecordAction(sourceStream, { partitionKey: "${topic()}" }
        new actions.KinesisPutRecordAction(sourceStreamNew, { partitionKey: "${newuuid()}" }
        )
      ]
    }
    );

    // new stuff

    const firehoseStream = new firehose.DeliveryStream(this, 'NotificationDeliveryStreamNew', {
      destinations: [new destinations.S3Bucket(this.bucket, {
        dataOutputPrefix: "to-be-processed/notifications/",
        bufferingInterval: cdk.Duration.seconds(60),
        //bufferingSize: cdk.Size.mebibytes(1)  
      })]
      ,
    });

    const lambdaFunctionNew = new lambda.DockerImageFunction(this, "NotificationLambdaNew", {
      functionName: "NotificationLambdaNew",
      code: lambda.DockerImageCode.fromImageAsset(
        "./docker", {
        file: "Dockerfile-lambda_notifications_new",
        exclude: [   "./lambda_surface-obs", "./wis2bridge", "./rds-init-fn-code", "./lambda_swic"] // do not re-deploy for changes in these directories
      }),
      environment: { "LAMBDA_LOG_LEVEL": "INFO", "LAMBDA_VALIDATE": "True", "FIREHOSE_NAME": firehoseStream.deliveryStreamName },
      timeout: cdk.Duration.minutes(10),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      architecture: lambda.Architecture.X86_64,
    });

    lambdaFunctionNew.role?.attachInlinePolicy(this.metricPolicy);

    firehoseStream.grantPutRecords(lambdaFunctionNew);

    lambdaFunctionNew.addEventSource(new KinesisEventSource(sourceStreamNew, {
      batchSize: 300, // default
      maxBatchingWindow: cdk.Duration.seconds(45),
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      reportBatchItemFailures: false,
      bisectBatchOnError: true,
      parallelizationFactor: 10
    }));


  }

  setupSurfaceObsPipeline(): void {

    const sourceStream = new kinesis.Stream(this, "SurfaceObsInputStream", { retentionPeriod: cdk.Duration.hours(this.RETENTION), streamMode: cdk.aws_kinesis.StreamMode.PROVISIONED })

    const topicRule = new iot_alpha.TopicRule(this, "SurfaceObsRule", {
      sql: iot_alpha.IotSql.fromStringAsVer20160323("SELECT * FROM 'cache/+/+/data/core/weather/surface-based-observations/synop'"),
      actions: [
        new actions.KinesisPutRecordAction(sourceStream, { partitionKey: "${topic()}" }
        )
      ]
    }
    );

    const firehoseStream = new firehose.DeliveryStream(this, 'SurfaceObsDeliveryStream', {
      destinations: [new destinations.S3Bucket(this.bucket, {
        dataOutputPrefix: "to-be-processed/surface-observations/",
        bufferingInterval: cdk.Duration.seconds(60),
        //bufferingSize: cdk.Size.mebibytes(1)  
      })]
      ,
    });

    const lambdaFunction = new lambda.DockerImageFunction(this, "SurfaceObsLambda", {
      functionName: "SurfaceObsLambda",
      code: lambda.DockerImageCode.fromImageAsset(
        "./docker/", {
        file: "Dockerfile-lambda_surface-obs",
        exclude: ["./lambda_notifications_new","./wis2bridge", "./rds-init-fn-code", "./lambda_swic"] // do not re-deploy for changes in these directories
      }),
      environment: { "LAMBDA_LOG_LEVEL": "INFO", "FIREHOSE_NAME": firehoseStream.deliveryStreamName },
      timeout: cdk.Duration.minutes(10),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      //architecture: lambda.Architecture.X86_64
    });

    lambdaFunction.role?.attachInlinePolicy(this.metricPolicy);


    firehoseStream.grantPutRecords(lambdaFunction);

    lambdaFunction.addEventSource(new KinesisEventSource(sourceStream, {
      batchSize: 50, // default
      maxBatchingWindow: cdk.Duration.seconds(60),
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      reportBatchItemFailures: false,
      bisectBatchOnError: true,
    }));





  }

  setupCAPPipeline(): void {

    const sourceStream = new kinesis.Stream(this, "CAPInputStream", { retentionPeriod: cdk.Duration.hours(this.RETENTION), streamMode: cdk.aws_kinesis.StreamMode.PROVISIONED })

    const topicRule = new iot_alpha.TopicRule(this, "CAPRule", {
      sql: iot_alpha.IotSql.fromStringAsVer20160323("SELECT * FROM 'cache/+/swic/data/core/weather/advisories-warnings/#'"),
      actions: [
        new actions.KinesisPutRecordAction(sourceStream, { partitionKey: "${topic()}" }
        )
      ]
    }
    );

    const firehoseStream = new firehose.DeliveryStream(this, 'CAPDeliveryStream', {
      destinations: [new destinations.S3Bucket(this.bucket, {
        dataOutputPrefix: "to-be-processed/swic/",
        bufferingInterval: cdk.Duration.seconds(60),
        //bufferingSize: cdk.Size.mebibytes(1)  
      })]
      ,
    });

    const lambdaFunction = new lambda.DockerImageFunction(this, "CAPLambda", {
      functionName: "CAPLambda",
      code: lambda.DockerImageCode.fromImageAsset(
        "./docker/", {
        file: "Dockerfile-lambda_swic",
        exclude: ["./lambda_notifications_new","./wis2bridge", "./rds-init-fn-code",  "./lambda_surface-obs"] // do not re-deploy for changes in these directories
      }),
      environment: { "LAMBDA_LOG_LEVEL": "INFO", "FIREHOSE_NAME": firehoseStream.deliveryStreamName },
      timeout: cdk.Duration.minutes(10),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      //architecture: lambda.Architecture.X86_64
    });
    
    lambdaFunction.role?.attachInlinePolicy(this.metricPolicy);


    firehoseStream.grantPutRecords(lambdaFunction);

    lambdaFunction.addEventSource(new KinesisEventSource(sourceStream, {
      batchSize: 50, // default
      maxBatchingWindow: cdk.Duration.seconds(60),
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      reportBatchItemFailures: false,
      bisectBatchOnError: true,
    }));





  }

  setupDBInfrastructure(id: string): void {

    const instanceIdentifier = 'mysql-01'
    const credsSecretName = `/${id}/rds/creds/${instanceIdentifier}`.toLowerCase()
    this.dbCredentials = new DatabaseSecret(this, 'MysqlRdsCredentials', {
      secretName: credsSecretName,
      username: 'admin'
    });

    const auroraSg = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: this.vpc,
      description: "Allow ssh access to aurora cluster",
      allowAllOutbound: true
    })

    auroraSg.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(3306)
    )

    this.dbCluster = new ServerlessCluster(this, "AuroraCluster", {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc: this.vpc,
      enableDataApi: true,
      credentials: Credentials.fromSecret(this.dbCredentials),
      defaultDatabaseName: "main",
      securityGroups: [auroraSg]
    })


    // initialize database

    const initializer = new CdkResourceInitializer(this, 'RdsInit', {
      config: {
        credsSecretName
      },
      fnLogRetention: aws_logs.RetentionDays.FIVE_MONTHS,
      fnCode: lambda.DockerImageCode.fromImageAsset("./docker/rds-init-fn-code", {}),
      fnTimeout: cdk.Duration.minutes(2),
      fnSecurityGroups: [],
      vpc: this.vpc,
      subnetsSelection: this.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      })
    })
    // manage resources dependency
    initializer.customResource.node.addDependency(this.dbCluster)

    // allow the initializer function to connect to the RDS instance
    this.dbCluster.connections.allowFrom(initializer.function, ec2.Port.tcp(3306))

    // allow initializer function to read RDS instance creds secret
    this.dbCredentials.grantRead(initializer.function)

    new cdk.CfnOutput(this, 'Rds InitFn Response', {
      value: cdk.Token.asString(initializer.response)
    })

    // acces the DB via mini EC2 instance
    const bastionSG = new ec2.SecurityGroup(this, 'BastionSg', {
      vpc: this.vpc,
      allowAllOutbound: true,
    });

    bastionSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'allow SSH access from anywhere',
    );

    const bastionEc2Instance = new ec2.Instance(this, 'BastionEc2Instance', {
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: bastionSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      keyName: 'wis2monitoring-key',
    });

    new cdk.CfnOutput(this, "Bastion IP address", {
      value: bastionEc2Instance.instancePublicIp
    });

    this.dbCluster.connections.allowFrom(bastionEc2Instance, ec2.Port.tcp(3306))

    // cleanup DB

    const cleanupLambda = new lambda.Function(this, 'cleanupLambda', {
      code: lambda.Code.fromAsset('lambda/cleanup'),
      handler: 'cleanup.handler',
      runtime: lambda.Runtime.PYTHON_3_9,
      timeout: cdk.Duration.minutes(10),
      environment: {
        "BUCKET": this.bucket.bucketArn,
        "CLUSTER_ARN": this.dbCluster.clusterArn,
        "SECRET_ARN": this.dbCredentials.secretArn,
        "DB_NAME": "main",
        "NR_DAYS_KEEP": "90",
        "LAMBDA_LOG_LEVEL": "INFO"
      }

    });

    // allow cleanup function access to credentials and database API
    this.dbCluster.grantDataApiAccess(cleanupLambda);


    const event = new events.Rule(this, 'cleanupLambdaRule', {
      description: "cleanup with DB periodically",
      targets: [new targets.LambdaFunction(cleanupLambda)],
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
    }
    );

  }

  setupDBImport(): void {


    // setup Queues

    const notificationSource = this.setupImport("notifications", "to-be-processed/notifications/")
    const surfaceObsSource = this.setupImport("surfaceobservations", "to-be-processed/surface-observations/")
    const CAPSource = this.setupImport("CAPs", "to-be-processed/swic/")


    const fn = new lambda.Function(this, "S3importFunction", {
      functionName: "S3importFunction",
      code: lambda.Code.fromAsset("lambda/s3tords"),
      handler: 'app.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_9,
      // code: lambda.DockerImageCode.fromImageAsset(
      //   "./docker", {
      //   file: "Dockerfile-lambda_s3tords",
      //   exclude: ["./lambda_surface-obs", "./wis2mon-lib", "./wis2bridge", "./rds-init-fn-code", "./lambda_notifications"] // do not re-deploy for changes in these directories

      // }),
      environment: {
        "BUCKET": this.bucket.bucketArn,
        "CLUSTER_ARN": this.dbCluster.clusterArn,
        "SECRET_ARN": this.dbCredentials.secretArn,
        "DB_NAME": "main",
        "LAMBDA_LOG_LEVEL": "INFO",
        "PROCESSED_PREFIX": "processed",
        "DB_BATCH_SIZE": "1000",
        "NOTIFCIATION_SOURCE_ARN": notificationSource.queue.queueArn,
        "SURFACEOBS_SOURCE_ARN": surfaceObsSource.queue.queueArn,
        "CAP_SOURCE_ARN": CAPSource.queue.queueArn
      },
      timeout: cdk.Duration.minutes(10),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      architecture: lambda.Architecture.X86_64
    });

    fn.role?.attachInlinePolicy(this.metricPolicy);

    this.bucket.grantReadWrite(fn);
    this.dbCluster.grantDataApiAccess(fn);
    //this.dbCredentials.grantRead(fn); // included in call above


    fn.addEventSource(notificationSource);
    fn.addEventSource(surfaceObsSource);
    fn.addEventSource(CAPSource);

    // surface-obs

  }

  setupImport(name: string, prefix: string): SqsEventSource {

    const deadLetterQueue = new sqs.Queue(this, "DLDqueue_" + name, {
      queueName: "dlq_" + name,
      deliveryDelay: cdk.Duration.millis(0),
      retentionPeriod: cdk.Duration.days(14),
    });

    const queue = new sqs.Queue(this, "S3ImportQueue_" + name, {
      queueName: "S3ImportQueue_" + name,
      visibilityTimeout: cdk.Duration.minutes(6 * 3),
      deadLetterQueue: {
        maxReceiveCount: 2,
        queue: deadLetterQueue
      }
    });

    this.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3_notify.SqsDestination(queue), {
      prefix: prefix
    });

    const eventSource = new SqsEventSource(queue, {
      reportBatchItemFailures: true,
      batchSize: 5, // maximum number of files processed by one lambda invocation
      maxBatchingWindow: cdk.Duration.seconds(10),
      maxConcurrency: 3 // maximum number of parallel lambda invocations
    });


    return eventSource

  }


}
