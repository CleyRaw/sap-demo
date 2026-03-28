# Teacher — CDK Concepts

Este archivo crece con cada fase. Documenta los conceptos de CDK que se van usando.

---

## Fase 0 — Base CDK

### Que genero `cdk init` y por que cada archivo

Un proyecto CDK TypeScript tiene esta estructura minima:

```
infrastructure/
  bin/app.ts          → Entry point. Aqui se instancian los stacks.
  lib/*.ts            → Definicion de stacks y constructs.
  cdk.json            → Configuracion del CLI: como ejecutar la app, contexto, watch.
  tsconfig.json       → Configuracion TypeScript. strict: true obligatorio.
  package.json        → Dependencias. aws-cdk-lib es la unica libreria core.
  .env.example        → Variables de entorno para configurar cuenta y region.
```

`cdk.json` tiene la clave `"app"` que le dice al CLI como ejecutar tu codigo:
```json
{
  "app": "npx ts-node bin/app.ts"
}
```
Cuando corres `cdk synth`, el CLI ejecuta ese comando, que corre tu TypeScript,
y CDK genera el CloudFormation como output.

---

### Entry point: bin/app.ts

```typescript
const app = new cdk.App();
new SapDemoStack(app, 'sap-demo-dev', { ... });
```

`App` es la raiz del arbol. Todo stack es hijo de `App`.
El segundo argumento (`'sap-demo-dev'`) es el **Stack ID**: nombre unico
que CloudFormation usa para identificar el stack. Si lo cambias, CDK crea
un stack nuevo en vez de actualizar el existente.

Las `tags` en el entry point se propagan automaticamente a todos los recursos
del stack. No hay que repetirlas en cada recurso.

---

### App, Stack y Construct

CDK organiza todo en un arbol de 3 niveles:

```
App                          → Raiz. Solo hay uno. No genera recursos.
  └── Stack                  → Unidad de deploy. = 1 template CloudFormation.
        └── Construct        → Un recurso o grupo de recursos.
```

**App**: contenedor raiz. No se despliega. Solo agrupa stacks.

**Stack**: cada stack genera un template CloudFormation independiente.
Se despliega de forma atomica: o todo se crea o nada.
Regla practica: un stack por capa logica (storage, compute, networking).

**Construct**: bloque de construccion. Puede ser:
- **L1 (CfnXxx)**: mapeo 1:1 con CloudFormation. Control total, verbose.
- **L2 (ej: s3.Bucket)**: abstraccion con defaults inteligentes. El mas comun.
- **L3 (Patterns)**: combina multiples recursos. Ej: LambdaRestApi.

Para este proyecto usaremos L2 en casi todo. L1 solo cuando L2 no exista
(ej: Glue CfnJob no tiene equivalente L2).

---

### Synthesize vs Deploy

```bash
cdk synth     → Genera el template CloudFormation (local, sin tocar AWS)
cdk diff      → Compara tu codigo con lo desplegado (requiere credenciales AWS)
cdk deploy    → Despliega el stack en AWS
```

`synth` es tu test local. Si compila y sintetiza, la estructura es valida.
`diff` antes de `deploy` siempre. Es el "code review" de tu infraestructura.

El output de `synth` va a `cdk.out/`. Puedes ver el JSON generado ahi.

---

### CloudFormation equivalente de esta fase

El stack vacio genera este template (simplificado):

```yaml
Resources:
  CDKMetadata:
    Type: AWS::CDK::Metadata
Parameters:
  BootstrapVersion:
    Type: AWS::SSM::Parameter::Value<String>
    Default: /cdk-bootstrap/hnb659fds/version
```

`CDKMetadata` es automatico y no genera costo. Lo agrega CDK para tracking.
`BootstrapVersion` verifica que tu cuenta tenga el bootstrap necesario.

En la Fase 1, cuando agreguemos el bucket RAW, veras como este template
crece con `AWS::S3::Bucket` y sus propiedades.

---

## Fase 1 — RAW Bucket (S3)

### Construct L2: s3.Bucket

Un Construct L2 es una abstraccion sobre CloudFormation con defaults inteligentes.
En vez de escribir esto en CloudFormation:

```yaml
Resources:
  RawBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: sap-demo-dev-s3-raw-sap
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      LifecycleConfiguration:
        Rules:
          - Id: raw-to-infrequent-access
            Status: Enabled
            Transitions:
              - StorageClass: STANDARD_IA
                TransitionInDays: 30
    UpdateReplacePolicy: Delete
    DeletionPolicy: Delete
```

Escribes esto en CDK:

```typescript
new s3.Bucket(this, 'RawBucket', {
  bucketName: `${projectName}-${environment}-s3-raw-sap`,
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [{
    transitions: [{
      storageClass: s3.StorageClass.INFREQUENT_ACCESS,
      transitionAfter: cdk.Duration.days(30),
    }],
  }],
});
```

CDK traduce tus 10 lineas TypeScript a ~30 lineas YAML de CloudFormation.
Ademas agrega `BlockPublicAccess` con todos los flags en `true`, que en
CloudFormation tendrias que poner manualmente.

---

### Nombre fijo vs nombre auto-generado (hash)

Con `bucketName` explicito, el nombre es predecible:

```typescript
new s3.Bucket(this, 'RawBucket', {
  bucketName: `${projectName}-${stage}-s3-raw-sap`,
});
// Resultado: sap-demo-dev-s3-raw-sap
```

Sin `bucketName`, CDK genera un nombre con hash unico:

```typescript
new s3.Bucket(this, 'RawBucket');
// Resultado: sap-demo-dev-storage-rawbucket8de4ba9d-qolis8y06on7
```

El hash viene del construct path (`sap-demo-dev-storage/RawBucket`) y
garantiza unicidad. AWS recomienda nombres auto-generados porque CDK
puede reemplazar el recurso sin conflictos de nombre. Pero para buckets
S3 que aparecen en documentacion, scripts, y son referenciados por
otros stacks, nombre fijo es mejor.

En este proyecto usamos nombre fijo para S3 porque:
- Los nombres estan documentados en `architecture.md`
- Otros stacks los reciben via props, no por nombre
- La convension `{proyecto}-{stage}-{tipo}-{descriptor}` ya es unica

---

### Encryption: S3 Managed vs KMS

**S3 Managed (AES256):** Gratis. AWS maneja las llaves. No tienes control
sobre rotacion ni acceso a la llave. Suficiente para la mayoria de casos.

**KMS:** $1/mes por llave + $0.03 por 10,000 requests. Necesario cuando:
- Compliance requiere llaves propias (BYOK)
- Necesitas audit trail de quien desencripta que (CloudTrail)
- Quieres revocar acceso a datos sin borrarlos

Para sap-demo, S3 Managed es correcto. No hay requisitos de compliance.

---

### Lifecycle Rules (FinOps)

S3 tiene storage classes con diferente costo:

| Storage Class | Costo/GB/mes | Caso de uso |
|---|---|---|
| Standard | $0.023 | Acceso frecuente |
| Infrequent Access (IA) | $0.0125 | Acceso < 1 vez/mes |
| Glacier | $0.004 | Archivado (minutos a horas para recuperar) |

Los datos RAW se procesan una vez y rara vez se vuelven a leer.
La regla `transitionAfter: 30 days` mueve automaticamente a IA,
ahorrando ~45% en storage sin perder acceso inmediato.

---

### autoDeleteObjects y removalPolicy

En dev, configuramos:
```typescript
removalPolicy: cdk.RemovalPolicy.DESTROY,
autoDeleteObjects: true,
```

Esto permite que `cdk destroy` elimine el bucket aunque tenga objetos.
CDK crea una Lambda custom resource que vacia el bucket antes de eliminarlo
(por eso el template tiene `Custom::S3AutoDeleteObjects`).

En prod, `RETAIN` asegura que `cdk destroy` nunca borre datos.

---

### CfnOutput: exportar valores entre stacks

```typescript
new cdk.CfnOutput(this, 'RawBucketArn', {
  value: this.rawBucket.bucketArn,
  exportName: `${projectName}-${environment}-raw-bucket-arn`,
});
```

Genera en CloudFormation:
```yaml
Outputs:
  RawBucketArn:
    Value: !GetAtt RawBucket.Arn
    Export:
      Name: sap-demo-dev-raw-bucket-arn
```

Otros stacks pueden importar este valor con `Fn::ImportValue`.
Pero en CDK preferimos pasar referencias via props (mas seguro, con tipos).
Los CfnOutput son utiles para scripts externos y para ver valores en la consola.

---

### eventBridgeEnabled

```typescript
eventBridgeEnabled: true,
```

Habilita que S3 envie eventos a EventBridge cuando se suben/eliminan objetos.
No lo usamos todavia (eso es Fase 6), pero lo configuramos ahora porque
cambiar esta propiedad despues requiere un update del bucket que puede tener
side effects en produccion.

Regla: configurar integraciones futuras conocidas desde el inicio es mejor
que parchear despues.
