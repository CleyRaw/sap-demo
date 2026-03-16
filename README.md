# SAP Demo — Data Lakehouse on AWS

Portfolio profesional que simula un Data Lakehouse empresarial integrando datos de módulos SAP con AWS.
Demuestra competencias en Data Engineering, arquitectura de datos en la nube y prácticas FinOps.

## Arquitectura

```
                    ┌─────────────────────────────────────────────────────┐
                    │                  EVENT-DRIVEN INGESTION              │
                    │                                                      │
  SAP Modules       │   S3 Upload      EventBridge      Lambda    DynamoDB │
  (CSV Simulated)──►│──────────────►──────────────►──────────►──(lock)    │
  SD / MM / FI      │                                    │                 │
  CO / PM           │                                    ▼                 │
                    │                              Glue Job trigger        │
                    └────────────────────────────────────┼────────────────┘
                                                         │
                    ┌────────────────────────────────────▼────────────────┐
                    │                    STORAGE LAYERS                    │
                    │                                                      │
                    │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
                    │  │   RAW Layer  │  │  PROCESSED   │  │ARTIFACTS │  │
                    │  │              │  │              │  │          │  │
                    │  │ CSV originales│  │ Delta Lake   │  │ Scripts  │  │
                    │  │ particionados│  │ Schema enforc│  │ Configs  │  │
                    │  │ por módulo   │  │ Nombres SAP  │  │ Dict SAP │  │
                    │  └──────────────┘  └──────┬───────┘  └──────────┘  │
                    └─────────────────────────────┼────────────────────────┘
                                                  │
                    ┌─────────────────────────────▼────────────────────────┐
                    │              CURATED LAYER (sin costo de storage)     │
                    │                                                        │
                    │  Athena Views sobre Delta Processed                    │
                    │  Columnas renombradas con diccionario SAP              │
                    │  Una vista por idioma (es/en) por tabla SAP           │
                    │                                                        │
                    │  curated_sd_vbak_es ──► processed/sd/vbak/ (Delta)   │
                    │  curated_sd_vbak_en ──► processed/sd/vbak/ (Delta)   │
                    └─────────────────────────────┬────────────────────────┘
                                                  │
                    ┌─────────────────────────────▼────────────────────────┐
                    │                     CONSUMPTION                       │
                    │                                                        │
                    │   Amazon Athena (SQL ad-hoc)                          │
                    │   Amazon Q in QuickSight (lenguaje natural)           │
                    └────────────────────────────────────────────────────────┘
```

## Módulos SAP Simulados

| Módulo | Nombre | Tablas principales |
|--------|--------|-------------------|
| SD | Sales & Distribution | VBAK (cabecera órdenes), VBAP (posiciones), KNA1 (clientes) |
| MM | Materials Management | MARA (materiales), EKKO (órdenes de compra), LFA1 (proveedores) |
| FI | Financial Accounting | BKPF (cabecera documentos), BSEG (posiciones), SKA1 (cuentas) |
| CO | Controlling | CSKS (centros de costo), COSS (totales CO), AUFK (órdenes internas) |
| PM | Plant Maintenance | EQUI (equipos), AUFK (órdenes PM), QMEL (notificaciones) |

## Stack Tecnológico

| Capa | Tecnología | Decisión |
|------|-----------|----------|
| IaC | AWS CDK TypeScript | Type-safe, código revisable, no ClickOps |
| Procesamiento | Glue Python Shell (0.0625 DPU) | FinOps: sin Spark para este volumen |
| Transformación | Polars + Delta Lake | Más rápido que Pandas, API explícita. Delta sobre Iceberg: mejor soporte en Python |
| Metastore | AWS Glue Data Catalog | Estándar AWS, integrado con Athena y Lake Formation |
| Gobernanza | AWS Lake Formation | Column-level security por módulo SAP |
| Concurrencia | DynamoDB | Optimistic locking entre Glue Jobs |
| SQL | Amazon Athena | Serverless, paga por query, integrado con Delta |
| BI | Amazon Q in QuickSight | NLQ sobre el lakehouse |
| CI/CD | GitHub Actions + OIDC | Sin credenciales de larga duración |

## CDK Stacks (orden de deploy)

```
1. StorageStack       — S3 buckets + Glue Catalog database
2. GovernanceStack    — Lake Formation + IAM roles por módulo SAP
3. IngestionStack     — EventBridge + Lambda trigger + DynamoDB concurrency
4. ProcessingStack    — Glue Jobs RAW→Processed (uno por módulo SAP)
5. ObservabilityStack — CloudWatch dashboards + AWS Budget alert ($15/mes)
```

## Setup Local

### Prerrequisitos

- Node.js 18+
- AWS CLI configurado (`aws configure --profile sap-demo`)
- CDK CLI: `npm install -g aws-cdk`

### Primer deploy

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/CleyRaw/sap-demo.git
cd sap-demo/infrastructure
npm ci

# 2. Bootstrap CDK en tu cuenta (una sola vez por cuenta+región)
# Crea el stack CDKToolkit con los recursos que CDK necesita para operar
aws cdk bootstrap aws://TU_ACCOUNT_ID/us-east-1 --profile sap-demo

# 3. Verificar que el stack sintetiza correctamente (sin credenciales de deploy)
npx cdk synth

# 4. Ver qué se va a crear
npx cdk diff --profile sap-demo

# 5. Deploy
npx cdk deploy storage-stack --profile sap-demo
```

### Variables de entorno

Copia `.env.dev.example` como `.env.dev` y completa los valores.
El archivo `.env.dev` está en `.gitignore` — nunca lo commitees.

## CI/CD

GitHub Actions con autenticación OIDC (sin claves de larga duración):

| Trigger | Job | Acción |
|---------|-----|--------|
| PR → `main` | `synth` | Valida que el CDK compila y sintetiza |
| Push → `develop` | `diff` | Muestra los cambios que se deployarían |

### Setup OIDC (una sola vez)

Ver [docs/setup-github-oidc.md](docs/setup-github-oidc.md) para configurar el IAM Role
y los GitHub Secrets requeridos (`AWS_GITHUB_ACTIONS_ROLE_ARN`, `AWS_ACCOUNT_ID`).

## Estimación de Costos (demo workload)

| Servicio | Costo estimado |
|----------|---------------|
| S3 (datos demo < 1GB) | ~$0.01/mes |
| Glue Python Shell (0.0625 DPU × $0.44/h) | ~$0.05 por job run |
| Lambda (trigger) | $0 (free tier) |
| EventBridge | $0 (free tier) |
| Glue Catalog | $0 (primer millón de objetos) |
| Athena | ~$0 con particiones bien hechas |
| DynamoDB | $0 (free tier para este volumen) |
| **Total estimado** | **< $5/mes** |

> Amazon Q in QuickSight: $18-24/usuario/mes. Usar prueba de 30 días para el portfolio.

## Roadmap

- [x] **Fase 1** — Base: repositorio + StorageStack + CI/CD
- [ ] **Fase 2** — Gobernanza: Lake Formation + roles IAM por módulo SAP
- [ ] **Fase 3** — Ingesta: EventBridge + Lambda + DynamoDB concurrency lock
- [ ] **Fase 4** — Procesamiento: Glue Jobs RAW→Processed (Polars + Delta Lake)
- [ ] **Fase 5** — Curated: vistas Athena con diccionario SAP + column-level security
- [ ] **Fase 6** — Observabilidad: CloudWatch + AWS Budget alert
- [ ] **Fase 7+** — Redshift Serverless (Spectrum sobre S3 Processed)
