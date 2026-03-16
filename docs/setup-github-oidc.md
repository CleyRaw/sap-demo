# Setup: GitHub Actions OIDC con AWS

Este documento explica cómo configurar la autenticación OIDC entre GitHub Actions y AWS.
Es un paso manual, único, que se hace una sola vez por cuenta AWS.

## Por qué OIDC y no Access Keys

Con Access Keys (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY):
- Las credenciales son de larga duración — si se filtran, el atacante tiene acceso indefinido.
- GitHub las guarda encriptadas, pero cualquier brecha expone todas las pipelines.

Con OIDC:
- GitHub emite un JWT por job. AWS lo verifica y emite credenciales que duran 15 minutos.
- Si el JWT se filtra, expira sola en minutos. Sin rotación manual, sin gestión de secretos.

## Paso 1: Crear el OIDC Provider en AWS (una sola vez por cuenta)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --profile sap-demo
```

> Si ya existe el provider, este comando falla con `EntityAlreadyExists`. Es normal, no hay que crearlo de nuevo.

## Paso 2: Crear el IAM Role para GitHub Actions

```bash
# Reemplaza TU_ACCOUNT_ID con tu Account ID de 12 dígitos
aws iam create-role \
  --role-name sap-demo-dev-github-actions-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "arn:aws:iam::TU_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          "StringLike": {
            "token.actions.githubusercontent.com:sub": "repo:CleyRaw/sap-demo:*"
          }
        }
      }
    ]
  }' \
  --profile sap-demo
```

La condition `StringLike` con `repo:CleyRaw/sap-demo:*` limita el role a este repo específico.
Nadie más puede asumir este role, ni siquiera otros repos de la misma cuenta GitHub.

## Paso 3: Crear y adjuntar la policy

Permisos mínimos para `cdk synth` y `cdk diff`:

```bash
aws iam create-policy \
  --policy-name sap-demo-dev-github-actions-cdk-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "CloudFormationRead",
        "Effect": "Allow",
        "Action": [
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:GetTemplate",
          "cloudformation:ValidateTemplate",
          "cloudformation:ListStacks"
        ],
        "Resource": "arn:aws:cloudformation:us-east-1:TU_ACCOUNT_ID:stack/sap-demo-*"
      },
      {
        "Sid": "S3CDKAssets",
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::cdk-*-assets-TU_ACCOUNT_ID-us-east-1",
          "arn:aws:s3:::cdk-*-assets-TU_ACCOUNT_ID-us-east-1/*"
        ]
      },
      {
        "Sid": "SSMRead",
        "Effect": "Allow",
        "Action": ["ssm:GetParameter"],
        "Resource": "arn:aws:ssm:us-east-1:TU_ACCOUNT_ID:parameter/cdk-bootstrap/*"
      }
    ]
  }' \
  --profile sap-demo

# Adjuntar la policy al role
aws iam attach-role-policy \
  --role-name sap-demo-dev-github-actions-role \
  --policy-arn arn:aws:iam::TU_ACCOUNT_ID:policy/sap-demo-dev-github-actions-cdk-policy \
  --profile sap-demo
```

## Paso 4: Obtener el Role ARN

```bash
aws iam get-role \
  --role-name sap-demo-dev-github-actions-role \
  --query 'Role.Arn' \
  --output text \
  --profile sap-demo
```

Output esperado: `arn:aws:iam::TU_ACCOUNT_ID:role/sap-demo-dev-github-actions-role`

## Paso 5: Agregar GitHub Secrets

En el repo GitHub → Settings → Secrets and variables → Actions:

| Secret | Valor |
|--------|-------|
| `AWS_GITHUB_ACTIONS_ROLE_ARN` | El ARN del paso anterior |
| `AWS_ACCOUNT_ID` | Tu Account ID de 12 dígitos |

## Verificación

1. Crear un PR de `feature/test` → `main` con cualquier cambio en `infrastructure/`
2. El workflow `CDK Synth` debe ejecutarse y pasar ✓
3. En los logs debe verse `Assumed role arn:aws:iam::...`
