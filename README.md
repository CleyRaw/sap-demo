# SAP Demo — Data Lakehouse on AWS

Professional portfolio: enterprise data lakehouse architecture integrating SAP module data with AWS services. Demonstrates data engineering, cloud data architecture, and FinOps practices.

## Architecture

Event-driven ingestion: CSV uploads to S3 trigger EventBridge → Lambda → Glue Jobs with DynamoDB concurrency control.

```
                        ┌──────────────────────────────────────────────┐
                        │                 AWS Account                  │
                        │                                              │
  CSV Upload            │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
  (SAP Module) ────────►│  │    S3    │─►│  Event   │─►│   Lambda   │  │
                        │  │   RAW    │  │  Bridge  │  │  Trigger   │  │
                        │  └──────────┘  └──────────┘  └─────┬──────┘  │
                        │                                    │         │
                        │  ┌──────────┐  ┌──────────┐  ┌─────▼──────┐  │
                        │  │    S3    │◄─│   Glue   │◄─│  DynamoDB  │  │
                        │  │PROCESSED │  │   Job    │  │   Lock     │  │
                        │  │(Delta Lk)│  │ (Polars) │  └────────────┘  │
                        │  └────┬─────┘  └──────────┘                  │
                        │       │                                      │
                        │  ┌────▼─────┐  ┌──────────┐                  │
                        │  │  Athena  │─►│   SAP    │                  │
                        │  │  Views   │  │   Dict   │                  │
                        │  │(CURATED) │  │ (Glue DB)│                  │
                        │  └──────────┘  └──────────┘                  │
                        │                                              │
                        │  ┌──────────┐  ┌──────────┐                  │
                        │  │CloudWatch│  │   AWS    │                  │
                        │  │Dashboards│  │  Budget  │                  │
                        │  └──────────┘  └──────────┘                  │
                        └───────────────────────────────────────────────┘
```

## Data Flow

```
RAW (CSV)  →  PROCESSED (Delta Lake)  →  CURATED (Athena views)
```

- **RAW:** Original CSV partitioned by SAP module
- **PROCESSED:** Delta Lake with schema enforcement and typed columns
- **CURATED:** Athena views over Processed with translated column names from SAP data dictionary (no physical tables)

## SAP Modules

| Module | Area | Key Tables |
|--------|------|------------|
| SD | Sales & Distribution | VBAK, VBAP, KNA1 |
| MM | Materials Management | MARA, EKKO, LFA1 |
| FI | Financial Accounting | BKPF, BSEG, SKA1 |
| CO | Controlling | CSKS, COSS, AUFK |
| PM | Plant Maintenance | EQUI, AUFK, QMEL |

## Tech Stack

| Layer | Technology |
|-------|------------|
| IaC | AWS CDK TypeScript (strict mode) |
| Processing | Glue Python Shell (0.0625 DPU) + Polars + Delta Lake |
| Catalog | AWS Glue Data Catalog |
| Governance | Lake Formation (column-level security per SAP module) |
| Concurrency | DynamoDB optimistic locking |
| Query | Amazon Athena (serverless SQL) |
| CI/CD | GitHub Actions + OIDC (no long-lived credentials) |

## CDK Stacks

```
1. StorageStack       — S3 buckets + Glue Catalog database
2. GovernanceStack    — Lake Formation + module-specific IAM roles
3. IngestionStack     — EventBridge + Lambda trigger + DynamoDB concurrency
4. ProcessingStack    — Glue Jobs RAW→Processed per module
5. ObservabilityStack — CloudWatch dashboards + budget alerts ($15/month)
```

## Local Setup

**Prerequisites:** Node.js 18+, AWS CLI configured, CDK CLI

```bash
cd infrastructure
npm install
cdk bootstrap    # once per account/region
cdk synth        # verify synthesis
cdk diff         # review changes
cdk deploy StorageStack
```

## CI/CD

GitHub Actions validates CDK synthesis on PRs to `main` and displays proposed infrastructure changes on pushes to `develop`. Authentication uses OIDC — no long-lived AWS credentials stored in GitHub.

See `docs/setup-github-oidc.md` for IAM role and GitHub Secrets configuration.

## Cost Estimation (Demo Workload)

| Service | Cost |
|---------|------|
| S3 | ~$0.01/month |
| Glue Python Shell | ~$0.03/run |
| Lambda | Free tier |
| EventBridge | Free tier |
| Glue Catalog | Free (first 1M objects) |
| Athena | Minimal with partitioning |
| DynamoDB | Free tier |
| **Total** | **< $5/month** |

## Roadmap

- [x] Phase 0-1: Repository + StorageStack + CI/CD
- [ ] Phase 2: Lake Formation governance
- [ ] Phase 3: EventBridge ingestion + DynamoDB locking
- [ ] Phase 4: Glue Jobs (Polars + Delta Lake)
- [ ] Phase 5: Athena views with SAP dictionary
- [ ] Phase 6: CloudWatch + budget monitoring
- [ ] Phase 7+: Redshift Serverless, AI Agent, SageMaker Unified Studio