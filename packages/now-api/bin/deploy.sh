#!/bin/bash
set -e # exit on any errors
# usage: ./deploy.sh staging f0478bd7c2f584b41a49405c91a439ce9d944657
# license: public domain

APP=$1
VERSION=$2
AWS_ACCOUNT_ID=212646169882
EB_BUCKET=elasticbeanstalk-us-east-1-212646169882
ZIP=$VERSION.zip

aws configure set default.region us-east-1

# Authenticate against our Docker registry
eval $(aws ecr get-login --no-include-email)

# Build and push the image
docker build -t $APP:$VERSION .
docker tag $APP:$VERSION $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/$APP:$VERSION
docker tag $APP:$VERSION $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/$APP:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/$APP:$VERSION

# Replace the <AWS_ACCOUNT_ID> with the real ID
sed -i='' "s/<AWS_ACCOUNT_ID>/$AWS_ACCOUNT_ID/" Dockerrun.aws.json
# Replace the <NAME> with the real name
sed -i='' "s/<NAME>/$APP/" Dockerrun.aws.json
# Replace the <TAG> with the real version number
sed -i='' "s/<TAG>/$VERSION/" Dockerrun.aws.json

# Zip up the Dockerrun file (feel free to zip up an .ebextensions directory with it)
zip -r $ZIP Dockerrun.aws.json .ebextensions/.config .ebextensions/* cron.yaml

aws s3 cp $ZIP s3://$EB_BUCKET/$ZIP

# Create a new application version with the zipped up Dockerrun file
aws elasticbeanstalk create-application-version --application-name $APP \
    --version-label $VERSION --source-bundle S3Bucket=$EB_BUCKET,S3Key=$ZIP

# Update the environment to use the new application version
for EB_ENV in "${@:3:99}"; do
  aws elasticbeanstalk update-environment --environment-name $EB_ENV \
        --version-label $VERSION
done