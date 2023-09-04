## test

cd ..

docker build -t wis2monitoring_cap2json -f lambda_swic\Dockerfile

docker run -p 9009:8080 wis2monitoring_cap2json 

curl -XPOST "http://localhost:9009/2015-03-31/functions/function/invocations" -d @lambsda_swic\test\test_notification.json


### AWS setup

docker build -t wis2monitoring_cap2json .

aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 446250998069.dkr.ecr.eu-central-1.amazonaws.com

aws ecr create-repository --repository-name wis2monitoring_cap2json --image-scanning-configuration scanOnPush=true --image-tag-mutability MUTABLE

docker tag wis2monitoring_cap2json:latest 446250998069.dkr.ecr.eu-central-1.amazonaws.com/wis2monitoring_cap2json:latest

docker push 446250998069.dkr.ecr.eu-central-1.amazonaws.com/wis2monitoring_cap2json:latest

aws lambda create-function  --function-name wis2monitoring_swic_lambda --package-type Image  --code ImageUri=446250998069.dkr.ecr.eu-central-1.amazonaws.com/wis2monitoring_cap2json:latest   --role arn:aws:iam::446250998069:role/wis2monitoring_swic_lambda


#### update 


aws lambda update-function-code --function-name wis2monitoring_swic_lambda --image-uri ImageUri=446250998069.dkr.ecr.eu-central-1.amazonaws.com/wis2monitoring_cap2json:latest  