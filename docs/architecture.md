# Arquitectura — sap-demo

## Descripcion

Data Lakehouse sobre AWS con datos simulados de SAP.
Modulos: SD (Sales & Distribution), MM (Materials Management), FI (Financial Accounting), CO (Controlling), PM (Plant Maintenance).

Los datos CSV tienen un sesgo intencional para analisis posterior con agente IA en AWS.
El diccionario de datos SAP se sube como database independiente en Glue Catalog.

---

## Flujo de Datos

```
CSV (simulados)
    |
    v
S3 RAW bucket (raw/{modulo}/{tabla}/)
    |
    | S3 publica evento a EventBridge (eventBridgeEnabled: true)
    | EventBridge filtra por prefijo de modulo (sd/, mm/, etc.)
    v
Lambda trigger (verifica lock en DynamoDB, lanza Glue Job)
    |
    v
Glue Job Python Shell (Polars + Delta)
    |
    v
S3 PROCESSED bucket (Delta Lake, tablas fisicas)
    |
    v
Athena CURATED views (nombres amigables via diccionario SAP)
    |
    v
Consumo (QuickSight / notebooks / agente IA)
```

---

## Stacks CDK (orden de deploy)

| # | Stack | Descripcion |
|---|---|---|
| 1 | StorageStack | S3 buckets (raw, processed, artifacts) + Glue Catalog |
| 2 | GovernanceStack | Lake Formation + roles IAM por modulo + vistas Athena Curated |
| 3 | IngestionStack | EventBridge rules + Lambda trigger + DynamoDB locks |
| 4 | ProcessingStack | Glue Jobs RAW->Processed por modulo SAP |
| 5 | ObservabilityStack | CloudWatch alarms + dashboard + AWS Budget ($15/mes) |

---

## Capas del Data Lake

| Capa | Formato | Proposito |
|---|---|---|
| RAW | CSV | Datos tal cual salen de SAP (simulados) |
| PROCESSED | Delta Lake (tablas fisicas en S3) | Datos limpios, tipados, con metadata de ingesta |
| CURATED | Vistas Athena (no tablas fisicas) | Vistas sobre Processed con nombres de columnas amigables del diccionario SAP. Ej: `erdat` -> `fecha_creacion`. Sin joins ni transformaciones adicionales. |

---

## Inventario de Servicios AWS

| Servicio | Proposito en el proyecto | Free tier aplica |
|---|---|---|
| S3 | Almacenamiento de datos (raw, processed, artifacts) | Si (5 GB) |
| Glue Data Catalog | Metadata de tablas y columnas | Si (1M objetos) |
| Glue Python Shell | Procesamiento ETL RAW->Processed | No ($0.44/DPU-hora) |
| Lambda | Trigger de Glue Jobs desde EventBridge | Si (1M requests/mes) |
| EventBridge | Deteccion de eventos S3 y enrutamiento | Si (1M eventos/mes) |
| DynamoDB | Locks de concurrencia para Glue Jobs | Si (25 GB + 25 WCU/RCU) |
| Athena | Queries SQL sobre Processed + vistas Curated | No ($5/TB escaneado) |
| Lake Formation | Gobernanza y permisos por modulo SAP | Si (sin costo adicional) |
| CloudWatch | Logs, alarmas, dashboard | Si (10 alarmas, 3 dashboards) |
| AWS Budgets | Alerta de costos a $15/mes | Si (2 budgets gratis) |
| IAM | Roles y policies por servicio | Si (sin costo) |
| VPC Endpoints | Acceso a S3 y DynamoDB sin NAT Gateway | Si (Gateway endpoints gratis) |

---

## Inventario de Recursos (por stack)

### StorageStack
| Recurso | Nombre fisico | Tipo |
|---|---|---|
| S3 Bucket RAW | `sap-demo-{env}-s3-raw-sap` | `aws_s3.Bucket` |
| S3 Bucket Processed | `sap-demo-{env}-s3-processed-sap` | `aws_s3.Bucket` |
| S3 Bucket Artifacts | `sap-demo-{env}-s3-artifacts-sap` | `aws_s3.Bucket` |
| Glue Database (por modulo x2) | `raw_{modulo}`, `processed_{modulo}` | `aws_glue.CfnDatabase` |
| Glue Database (diccionario) | `sap_dictionary` | `aws_glue.CfnDatabase` |

### GovernanceStack
| Recurso | Nombre fisico | Tipo |
|---|---|---|
| Lake Formation Settings | - | `aws_lakeformation.CfnDataLakeSettings` |
| Lake Formation Resource | - | `aws_lakeformation.CfnResource` |
| IAM Role SD Analyst | `sap-demo-{env}-lakeformation-sd-analyst-role` | `aws_iam.Role` |
| IAM Role MM Analyst | `sap-demo-{env}-lakeformation-mm-analyst-role` | `aws_iam.Role` |
| IAM Role FI Analyst | `sap-demo-{env}-lakeformation-fi-analyst-role` | `aws_iam.Role` |
| IAM Role CO Analyst | `sap-demo-{env}-lakeformation-co-analyst-role` | `aws_iam.Role` |
| IAM Role PM Analyst | `sap-demo-{env}-lakeformation-pm-analyst-role` | `aws_iam.Role` |
| IAM Role Admin | `sap-demo-{env}-lakeformation-admin-role` | `aws_iam.Role` |
| Lake Formation Permissions | (por modulo y tabla) | `aws_lakeformation.CfnPermissions` |
| Athena Workgroup | `sap-demo-{env}-workgroup` | `aws_athena.CfnWorkGroup` |

### IngestionStack
| Recurso | Nombre fisico | Tipo |
|---|---|---|
| EventBridge Rule | `sap-demo-{env}-events-s3-upload` | `aws_events.Rule` |
| Lambda Function | `sap-demo-{env}-lambda-trigger-glue` | `aws_lambda.Function` |
| IAM Role Lambda | `sap-demo-{env}-lambda-trigger-role` | `aws_iam.Role` |
| DynamoDB Table | `sap-demo-{env}-dynamo-job-locks` | `aws_dynamodb.Table` |

### ProcessingStack
| Recurso | Nombre fisico | Tipo |
|---|---|---|
| Glue Job SD | `sap-demo-{env}-glue-sd-raw-to-processed` | `aws_glue.CfnJob` |
| Glue Job MM | `sap-demo-{env}-glue-mm-raw-to-processed` | `aws_glue.CfnJob` |
| Glue Job FI | `sap-demo-{env}-glue-fi-raw-to-processed` | `aws_glue.CfnJob` |
| Glue Job CO | `sap-demo-{env}-glue-co-raw-to-processed` | `aws_glue.CfnJob` |
| Glue Job PM | `sap-demo-{env}-glue-pm-raw-to-processed` | `aws_glue.CfnJob` |
| IAM Role Glue | `sap-demo-{env}-glue-role` | `aws_iam.Role` |

### ObservabilityStack
| Recurso | Nombre fisico | Tipo |
|---|---|---|
| CloudWatch Dashboard | `sap-demo-{env}-dashboard` | `aws_cloudwatch.Dashboard` |
| CloudWatch Alarm (Glue failures) | `sap-demo-{env}-alarm-glue-failures` | `aws_cloudwatch.Alarm` |
| AWS Budget | `sap-demo-{env}-budget` | `aws_budgets.CfnBudget` |
| SNS Topic (alertas) | `sap-demo-{env}-sns-alerts` | `aws_sns.Topic` |

---

## Modulos SAP

| Modulo | Tablas principales |
|---|---|
| SD | VBAK, VBAP, VBPA, KNA1, LIKP, LIPS |
| MM | EKKO, EKPO, MARA, MARC, LFA1, MSEG |
| FI | BKPF, BSEG, SKA1, BSIK, BSID |
| CO | CSKS, AUFK, COEP, CSKA |
| PM | AUFK, EQUI, IFLOT, QMEL, AFVC |

---

## Diccionario de Datos SAP

El diccionario de datos se sube como database independiente en Glue Catalog (`sap_dictionary`).
Contiene metadata de tablas y columnas SAP que se usa para:
- Generar los alias de columnas en las vistas Curated de Athena
- Documentar el significado de cada campo
- Alimentar el agente IA para analisis contextual

---

## Decisiones de Arquitectura

Ver ADRs en el vault de Obsidian: `01-proyecto/architecture-decisions.md`

---

## Roadmap

### Fases actuales (0-11): Lakehouse single-account
Ver skill `/phase` para el detalle de cada fase.
Fase actual: **FASE 0 — Base CDK** (por iniciar)

### Fases futuras (post-lakehouse)
| Fase | Descripcion | Servicios nuevos |
|---|---|---|
| 12 | Redshift Serverless | Carga desde Processed, queries analiticos complejos, warehouse layer |
| 13 | Agente IA | Analisis de sesgo en datos SAP con Bedrock o SageMaker |
| 14 | SageMaker Unified Studio | Data mesh, gobierno de datos centralizado, catalogo unificado entre dominios |
| 15 | Multi-cuenta AWS (Organizations) | Landing zone con Control Tower o CDK Pipelines cross-account |

### Estructura multi-cuenta (Fase 15)
| Cuenta | Proposito |
|---|---|
| Management | AWS Organizations, billing consolidado, SCPs |
| Dev | Desarrollo y testing de todos los stacks |
| Prod | Workloads productivos, acceso restringido |
| Governance | Lake Formation central, catalogo compartido, IAM Identity Center |
| Analytics | Dominios SageMaker, Redshift, QuickSight |
| Log Archive | CloudWatch Logs centralizados, CloudTrail, auditoria |
| Backup | Replicas S3 cross-account, retenciones de compliance |