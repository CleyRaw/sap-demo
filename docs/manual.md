# Manual de Deploy — sap-demo

## Prerequisitos

- Node.js 18+
- AWS CLI v2 configurado con credenciales
- Un perfil AWS con permisos de administrador (para bootstrap y deploy)

Verificar:

```bash
node --version        # v18.x o superior
aws --version         # aws-cli/2.x
aws sts get-caller-identity   # debe mostrar tu cuenta
```

---

## 1. Clonar y configurar

```bash
git clone https://github.com/cleyraw/sap-demo.git
cd sap-demo/infrastructure
npm install
```

Crear el archivo `.env` a partir del ejemplo:

```bash
cp .env.example .env
```

Editar `.env` con tus valores reales:

```env
CDK_DEFAULT_ACCOUNT=123456789012    # tu Account ID de AWS
CDK_DEFAULT_REGION=us-east-1        # región de deploy
AWS_PROFILE=sap-demo                # perfil en ~/.aws/credentials (opcional)
STAGE=dev                           # dev | staging | prod
```

> `STAGE` es obligatoria. CDK falla si no está definida.

---

## 2. CDK Bootstrap (solo la primera vez por cuenta/región)

Bootstrap crea los recursos base que CDK necesita para operar:
un bucket S3 para assets, roles IAM de deploy, y un stack `CDKToolkit` en CloudFormation.

```bash
cd infrastructure
STAGE=dev npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

Ejemplo concreto:

```bash
STAGE=dev npx cdk bootstrap aws://123456789012/us-east-1
```

Verificar que se creó:

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus'
# Esperado: "CREATE_COMPLETE" o "UPDATE_COMPLETE"
```

> Bootstrap se ejecuta una sola vez por combinación cuenta + región.
> Si ya existe el stack `CDKToolkit`, el comando lo actualiza sin romper nada.

---

## 3. Validar antes de deploy

### Compilar TypeScript

```bash
npm run build
```

### Sintetizar templates (dry-run)

```bash
STAGE=dev npx cdk synth
```

Esto genera los templates CloudFormation en `cdk.out/` sin tocar AWS.

### Ver diferencias contra lo desplegado

```bash
STAGE=dev npx cdk diff
```

---

## 4. Deploy

### Opción A — Deploy completo (resuelve dependencias automáticamente)

```bash
STAGE=dev npx cdk deploy --all --require-approval broadening
```

`--all` despliega todos los stacks en orden de dependencias.
`--require-approval broadening` pide confirmación solo cuando se amplían permisos IAM o security groups.

### Opción B — Deploy stack por stack (orden manual)

Útil para demostrar cada capa del lakehouse por separado:

```bash
# 1. Storage — S3 buckets + Glue Catalog
STAGE=dev npx cdk deploy sap-demo-dev-storage --require-approval broadening

# 2. Governance — Lake Formation + roles IAM + vistas Athena
STAGE=dev npx cdk deploy sap-demo-dev-governance --require-approval broadening

# 3. Ingestion — EventBridge + Lambda + DynamoDB
STAGE=dev npx cdk deploy sap-demo-dev-ingestion --require-approval broadening

# 4. Processing — Glue Jobs por módulo SAP
STAGE=dev npx cdk deploy sap-demo-dev-processing --require-approval broadening

# 5. Observability — CloudWatch + Budget + SNS
STAGE=dev npx cdk deploy sap-demo-dev-observability --require-approval broadening
```

> Los nombres de stack siguen el patrón `sap-demo-{stage}-{nombre}`.
> CDK resuelve dependencias entre stacks: si StorageStack exporta el bucket ARN
> y ProcessingStack lo importa, CDK despliega Storage primero aunque uses `--all`.

---

## 5. Verificar el deploy

```bash
# Listar stacks desplegados
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?starts_with(StackName, `sap-demo`)].StackName'

# Ver outputs del StorageStack
aws cloudformation describe-stacks \
  --stack-name sap-demo-dev-storage \
  --query 'Stacks[0].Outputs'

# Verificar que el bucket RAW existe
aws s3 ls | grep sap-demo-dev-s3-raw-sap
```

---

## 6. Destruir recursos (cleanup)

### Destroy completo

```bash
STAGE=dev npx cdk destroy --all
```

### Destroy selectivo (orden inverso al deploy)

```bash
STAGE=dev npx cdk destroy sap-demo-dev-observability
STAGE=dev npx cdk destroy sap-demo-dev-processing
STAGE=dev npx cdk destroy sap-demo-dev-ingestion
STAGE=dev npx cdk destroy sap-demo-dev-governance
STAGE=dev npx cdk destroy sap-demo-dev-storage
```

> En `dev`, los buckets S3 tienen `removalPolicy: DESTROY` y `autoDeleteObjects: true`,
> así que se eliminan automáticamente. En `prod` los buckets se retienen.

---

## Referencia rápida

| Comando | Qué hace |
|---|---|
| `npx cdk synth` | Genera templates sin tocar AWS |
| `npx cdk diff` | Muestra cambios pendientes |
| `npx cdk deploy --all` | Despliega todo en orden |
| `npx cdk deploy STACK` | Despliega un stack específico |
| `npx cdk destroy --all` | Elimina todos los stacks |
| `npx cdk list` | Lista los stacks definidos |

> Todos los comandos CDK requieren `STAGE=dev` (o el stage que corresponda).
> Todos se ejecutan desde el directorio `infrastructure/`.
