#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AWS_REGION:?Set AWS_REGION, e.g. ap-south-1}"
: "${GEMINI_SECRET_ARN:?Set GEMINI_SECRET_ARN to your existing Secrets Manager secret ARN}"
: "${GEMINI_MODEL:?Set GEMINI_MODEL to an available image-capable Gemini model ID}"
STACK_NAME="${STACK_NAME:-commonboard}"
for command in aws sam npm; do command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }; done
aws sts get-caller-identity --query Account --output text
npm ci
npm run check
sam validate --lint --template-file template.yaml --region "$AWS_REGION"
sam deploy --template-file template.yaml --stack-name "$STACK_NAME" --region "$AWS_REGION" --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides "GeminiSecretArn=$GEMINI_SECRET_ARN" "GeminiModel=$GEMINI_MODEL" "LocalOrigin=${LOCAL_ORIGIN:-http://localhost:5173}"
mkdir -p artifacts
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query 'Stacks[0].Outputs' --output json > artifacts/stack-outputs.json
node scripts/configure-frontend.mjs artifacts/stack-outputs.json
npm run build -w frontend
BUCKET=$(node -e 'const o=require("./artifacts/stack-outputs.json");console.log(o.find(x=>x.OutputKey==="FrontendBucketName").OutputValue)')
DISTRIBUTION=$(node -e 'const o=require("./artifacts/stack-outputs.json");console.log(o.find(x=>x.OutputKey==="DistributionId").OutputValue)')
aws s3 sync frontend/dist/ "s3://$BUCKET/" --exclude index.html --cache-control 'public,max-age=31536000,immutable' --region "$AWS_REGION"
aws s3 cp frontend/dist/index.html "s3://$BUCKET/index.html" --cache-control 'no-cache,max-age=0,must-revalidate' --content-type text/html --region "$AWS_REGION"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*'
node -e 'const o=require("./artifacts/stack-outputs.json");console.log("Website:",o.find(x=>x.OutputKey==="WebsiteUrl").OutputValue)'
