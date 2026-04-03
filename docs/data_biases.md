# SAP Test Data — Sesgos y Preguntas para el Agente IA

Generado automáticamente por `generate_sap_data.py`.
Columnas basadas en diccionario DD03L real (SAP ERP).

---

## Sesgos embebidos

### Sesgo 1 — Fraude de proveedor
**Módulos:** MM, FI
**Señal:** LIFNR=`0000050010` aparece en 35% de las OCs del H2 2024
y cobra `2.8x` el precio normal. Sus facturas en `BSIK` están vencidas (AUGDT vacío).
Sus entregas en `MSEG` llegan 15-25 días después (vs 1-7 días normal).

### Sesgo 2 — Equipos Sandvik poco confiables
**Módulos:** PM, CO
**Señal:** `EQUI.HERST = 'Sandvik'` genera 3x más `AUFK.AUART = 'PM01'`,
`AFVC.ARBEI` 40-80h vs 4-8h normal, y 3x más `QMEL.QMART = 'M2'`.

### Sesgo 3 — Gasto fantasma en administración
**Módulos:** FI, CO
**Señal:** En diciembre, `KOSTL = 'ADM100'` + `HKONT = '0000420000'`
registra gastos 4-5x superiores al promedio mensual.

### Sesgo 4 — Concentración de clientes China
**Módulos:** SD, FI
**Señal:** KUNNR `0000010000`-`0000010002` (LAND1='CN') = ~65% del ingreso.
Entregas 14-21 días (vs 3-7). BSID.FAEDT = BLDAT + 90 días (vs 30).

### Sesgo 5 — Stockouts en cadena
**Módulos:** MM
**Señal:** MATNR `10000`-`10004` tienen `MARC.EISBE = 0`.
OCs urgentes (`EKKO.BSART = 'UB'`) con precio +20%.

---

## Preguntas para el agente IA

### Análisis de proveedores
1. ¿Qué proveedor tiene la mayor desviación de precio vs promedio en H2 2024?
2. ¿Cuántas facturas están vencidas sin compensar (BSIK.AUGDT vacío)?
3. ¿Hay correlación proveedor vs tiempo de entrega (MSEG.BLDAT - EKKO.BEDAT)?

### Análisis de equipos y mantenimiento
4. ¿Qué marca genera mayor costo de mantenimiento correctivo (PM01)?
5. ¿Correlación entre EQUI.HERST y frecuencia de QMEL.QMART='M2'?
6. ¿Costo promedio por orden PM01, comparado por marca?

### Análisis financiero
7. ¿Centro de costo con patrón de gasto anómalo en mes específico?
8. ¿Saldo cuentas por cobrar por país de cliente?
9. ¿Plazo de pago promedio varía según LAND1?

### Análisis de ventas y cadena de suministro
10. ¿% de ingreso de los top-3 clientes? ¿Concentración de riesgo?
11. ¿Tiempo de entrega por país del cliente?
12. ¿Materiales con más OCs urgentes (BSART=UB)? ¿Coinciden con EISBE=0?

---

## Subir datos a S3

```bash
RAW_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name sap-demo-dev-storage \
  --query "Stacks[0].Outputs[?OutputKey=='RawBucketName'].OutputValue" \
  --output text --profile sap-demo)

aws s3 sync data/raw/ s3://$RAW_BUCKET/raw/ --profile sap-demo
```
