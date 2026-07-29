# language: es

@REQ-003 @critico
Característica: Importación de vehículos desde fuentes externas
  Para poder incorporar un concesionario sin depender de que su DMS tenga API
  Como plataforma
  Quiero importar vehículos desde distintos formatos, de forma idempotente y con reporte de rechazos

  Antecedentes:
    Dado que existe el concesionario "kia-quito" con el mapeo de importación "kdcs-kia"
    Y que existe el concesionario "mazda-guayaquil" con el mapeo de importación "generico-csv"
    Y que estoy autenticado como "jefe-taller-a" del concesionario "kia-quito"

  @dos-formatos
  Escenario: Importar el formato Excel de KIA produce vehículos normalizados
    Cuando importo el archivo "kdcs-kia-enero.xlsx"
    Entonces la importación termina correctamente
    Y se crean 42 vehículos en el concesionario "kia-quito"
    Y todos los vehículos tienen un establecimiento resuelto

  @dos-formatos
  Escenario: Importar un CSV genérico con otro mapeo produce vehículos equivalentes
    Dado que estoy autenticado como "jefe-taller-b" del concesionario "mazda-guayaquil"
    Cuando importo el archivo "inventario-generico.csv"
    Entonces la importación termina correctamente
    Y los vehículos creados tienen la misma estructura normalizada que los del formato KIA
    Y no fue necesario modificar código para soportar el formato

  Escenario: Reimportar el mismo archivo no duplica ni reprocesa
    Dado que ya importé el archivo "kdcs-kia-enero.xlsx"
    Cuando importo nuevamente el archivo "kdcs-kia-enero.xlsx"
    Entonces la importación reporta 0 vehículos creados
    Y la importación reporta 0 vehículos actualizados
    Y se devuelve el reporte de la importación original

  Escenario: Un VIN repetido dentro del concesionario actualiza en lugar de duplicar
    Dado que ya existe el vehículo con VIN "3KPA24AD5LE300001"
    Cuando importo un archivo que contiene el VIN "3KPA24AD5LE300001" con color distinto
    Entonces existe un único vehículo con ese VIN en el concesionario
    Y la importación reporta 1 vehículo actualizado

  Escenario: El mismo VIN puede existir en dos concesionarios distintos
    Dado que el concesionario "kia-quito" tiene el vehículo con VIN "3KPA24AD5LE300001"
    Cuando el concesionario "mazda-guayaquil" importa un archivo con el VIN "3KPA24AD5LE300001"
    Entonces cada concesionario tiene su propio vehículo con ese VIN
    Y los registros son independientes

  Escenario: Un vehículo en estado protegido no es pisado por la importación
    Dado que el vehículo con VIN "3KPA24AD5LE300002" está en estado "EN_INSTALACION"
    Y que "EN_INSTALACION" está configurado como estado protegido
    Cuando importo un archivo que trae ese VIN en estado "POR_ARRIBAR"
    Entonces el vehículo conserva el estado "EN_INSTALACION"
    Y la importación lo reporta como rechazado con el motivo "PROTECTED_STATUS"

  Escenario: Las filas inválidas se rechazan con motivo y número de fila
    Cuando importo el archivo "kdcs-con-errores.xlsx"
    Entonces la importación termina correctamente
    Y el reporte incluye un rechazo en la fila 12 con el motivo "INVALID_VIN"
    Y el reporte incluye un rechazo en la fila 27 con el motivo "UNKNOWN_ESTABLISHMENT"
    Y las filas válidas del mismo archivo sí se importaron

  Escenario: Las reglas de derivación de estado se aplican por prioridad
    Cuando importo un archivo con una fila que cumple dos reglas de estado
    Entonces se aplica la regla de mayor prioridad
    Y el resultado es determinista entre ejecuciones

  Escenario: Las filas marcadas para descartar no llegan al sistema
    Cuando importo un archivo con 10 filas en estado "ENTREGADO"
    Entonces esas 10 filas no generan vehículos
    Y el reporte las cuenta como omitidas

  @lopdp
  Escenario: Los vehículos sin factura no conservan datos personales del cliente
    Cuando importo un archivo con una fila sin número de factura
    Entonces el vehículo se crea con estado "NO_FACTURADO"
    Y el vehículo no contiene datos personales del cliente

  Escenario: Una importación no toca datos de otro concesionario
    Dado que el concesionario "mazda-guayaquil" tiene 30 vehículos
    Cuando importo el archivo "kdcs-kia-enero.xlsx" en el concesionario "kia-quito"
    Entonces el concesionario "mazda-guayaquil" sigue teniendo 30 vehículos
    Y ninguno de sus vehículos fue modificado

  Escenario: El reporte de importación queda persistido y auditado
    Cuando importo el archivo "kdcs-kia-enero.xlsx"
    Entonces el reporte de importación queda disponible en el panel de administración
    Y se registra una entrada en "audit_logs" con la acción "IMPORT_EXECUTED"
    Y el reporte identifica al usuario que ejecutó la importación

  Escenario: La verificación de conectividad no produce efectos secundarios
    Cuando ejecuto la verificación de estado del conector
    Entonces recibo el resultado de la verificación
    Y no se creó ningún vehículo
    Y no se registró ninguna importación
