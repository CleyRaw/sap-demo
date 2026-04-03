import json
import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

glue = boto3.client('glue')
dynamodb = boto3.resource('dynamodb')

PROJECT_NAME = os.environ['PROJECT_NAME']
STAGE = os.environ['STAGE']
LOCKS_TABLE = os.environ['LOCKS_TABLE']

VALID_MODULES = {'sd', 'mm', 'fi', 'co', 'pm'}
LOCK_TTL_SECONDS = 7200  # 2 hours — covers max Glue Python Shell runtime


def get_module(key: str) -> str:
    # S3 key format: raw/{module}/{table}/filename.csv
    parts = key.split('/')
    if len(parts) < 3 or parts[0] != 'raw':
        raise ValueError(f"Unexpected S3 key format: {key!r}")
    module = parts[1]
    if module not in VALID_MODULES:
        raise ValueError(f"Unknown module in S3 key: {module!r}")
    return module


def acquire_lock(table, module: str, placeholder_id: str) -> bool:
    """Atomic write — fails if item already exists (another job is running)."""
    try:
        table.put_item(
            Item={
                'module': module,
                'job_run_id': placeholder_id,
                'locked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'ttl': int(time.time()) + LOCK_TTL_SECONDS,
            },
            ConditionExpression='attribute_not_exists(module)',
        )
        return True
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        return False


def release_lock(table, module: str) -> None:
    table.delete_item(Key={'module': module})


def handler(event: dict, _context: object) -> dict:
    detail = event['detail']
    bucket: str = detail['bucket']['name']
    key: str = detail['object']['key']

    logger.info(json.dumps({"event": "s3_upload", "bucket": bucket, "key": key}))

    module = get_module(key)
    job_name = f"{PROJECT_NAME}-{STAGE}-glue-{module}-raw-to-processed"
    table = dynamodb.Table(LOCKS_TABLE)

    placeholder_id = f"pending-{int(time.time())}"
    if not acquire_lock(table, module, placeholder_id):
        logger.warning(json.dumps({"event": "lock_exists", "module": module, "skipped": True}))
        return {'statusCode': 200, 'skipped': True, 'reason': 'lock_exists', 'module': module}

    try:
        response = glue.start_job_run(
            JobName=job_name,
            Arguments={'--SAP_MODULE': module},
        )
        run_id: str = response['JobRunId']

        # Replace placeholder with real Glue run ID
        table.update_item(
            Key={'module': module},
            UpdateExpression='SET job_run_id = :run_id',
            ExpressionAttributeValues={':run_id': run_id},
        )

        logger.info(json.dumps({"event": "job_started", "job": job_name, "run_id": run_id}))
        return {'statusCode': 200, 'jobRunId': run_id, 'module': module}

    except Exception:
        # Glue job failed to start — release lock so next S3 event can retry
        release_lock(table, module)
        raise
