from django.conf import settings
from django.core.management.base import BaseCommand

import boto3
from botocore.exceptions import ClientError


class Command(BaseCommand):
    help = "Create the S3/MinIO media bucket if it does not exist."

    def handle(self, *args, **options):
        backend = settings.DEFAULT_FILE_STORAGE_BACKEND
        if "s3boto3" not in backend.lower():
            self.stdout.write("S3 storage not configured — skipping bucket creation.")
            return

        opts = settings.STORAGES["default"].get("OPTIONS", {})
        bucket = opts.get("bucket_name") or settings.MEDIA_S3_BUCKET_NAME
        endpoint = opts.get("endpoint_url") or settings.MEDIA_S3_ENDPOINT_URL
        access_key = opts.get("access_key") or settings.MEDIA_S3_ACCESS_KEY
        secret_key = opts.get("secret_key") or settings.MEDIA_S3_SECRET_KEY

        if not bucket:
            self.stderr.write("MEDIA_S3_BUCKET_NAME is not set — skipping.")
            return

        client = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
        )

        try:
            client.head_bucket(Bucket=bucket)
            self.stdout.write(f"Bucket '{bucket}' already exists.")
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchBucket"):
                client.create_bucket(Bucket=bucket)
                self.stdout.write(self.style.SUCCESS(f"Created bucket '{bucket}'."))
            else:
                raise
