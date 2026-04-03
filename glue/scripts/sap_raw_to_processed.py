import sys
from datetime import datetime, timezone

import polars as pl
import structlog
from awsglue.utils import getResolvedOptions

log = structlog.get_logger()

REQUIRED_ARGS = ['JOB_NAME', 'RAW_BUCKET', 'PROCESSED_BUCKET', 'SAP_MODULE', 'STAGE']

# Tables per SAP module — source: docs/architecture.md
MODULE_TABLES: dict[str, list[str]] = {
    'sd': ['VBAK', 'VBAP', 'VBPA', 'KNA1', 'LIKP', 'LIPS'],
    'mm': ['EKKO', 'EKPO', 'MARA', 'MARC', 'LFA1', 'MSEG'],
    'fi': ['BKPF', 'BSEG', 'SKA1', 'BSIK', 'BSID'],
    'co': ['CSKS', 'AUFK', 'COEP', 'CSKA'],
    'pm': ['AUFK', 'EQUI', 'IFLOT', 'QMEL', 'AFVC'],
}


def get_tables(module: str) -> list[str]:
    tables = MODULE_TABLES.get(module)
    if tables is None:
        raise ValueError(f"Unknown SAP module: {module}. Valid: {list(MODULE_TABLES)}")
    return tables


def process_table(
    module: str,
    table: str,
    raw_bucket: str,
    processed_bucket: str,
    ingestion_ts: str,
) -> None:
    log.info("table_start", module=module, table=table)

    s3_raw = f"s3://{raw_bucket}/raw/{module}/{table.lower()}/"
    df = pl.read_csv(s3_raw, infer_schema_length=10_000)

    if df.is_empty():
        raise ValueError(f"Empty dataset: {module}/{table} — stopping before writing corrupt data")

    # Audit columns — every processed table carries ingestion metadata
    df = df.with_columns([
        pl.lit(ingestion_ts).alias("_ingestion_ts"),
        pl.lit(module).alias("_sap_module"),
        pl.lit(table.lower()).alias("_sap_table"),
    ])

    s3_processed = f"s3://{processed_bucket}/processed/{module}/{table.lower()}/"
    df.write_delta(s3_processed, mode="overwrite")

    log.info("table_complete", module=module, table=table, rows=len(df))


def main() -> None:
    args = getResolvedOptions(sys.argv, REQUIRED_ARGS)
    module = args['SAP_MODULE'].lower()
    raw_bucket = args['RAW_BUCKET']
    processed_bucket = args['PROCESSED_BUCKET']
    stage = args['STAGE']

    log.info("job_start", job=args['JOB_NAME'], module=module, stage=stage)

    tables = get_tables(module)
    ingestion_ts = datetime.now(timezone.utc).isoformat()

    for table in tables:
        process_table(module, table, raw_bucket, processed_bucket, ingestion_ts)

    log.info("job_complete", job=args['JOB_NAME'], module=module, tables=len(tables))


if __name__ == "__main__":
    main()
