# language: es

@REQ-002 @seguridad @critico
Característica: Auditoría inmutable y verificable
  Para poder demostrar ante un cliente o un auditor qué ocurrió con cada vehículo
  Como plataforma
  Quiero que todo cambio de estado quede registrado y que cualquier alteración sea detectable

  Antecedentes:
    Dado que existe el concesionario "kia-quito" con el usuario "asesor-a" de rol "ASESOR"
    Y que el vehículo "VIN-A-001" pertenece al concesionario "kia-quito"

  Escenario: Un cambio de estado de vehículo genera exactamente una entrada de auditoría
    Dado que estoy autenticado como "asesor-a"
    Y que el vehículo "VIN-A-001" está en estado "CERTIFICADO"
    Cuando cambio el estado del vehículo "VIN-A-001" a "DOCUMENTADO"
    Entonces se registra 1 entrada en "audit_logs"
    Y la entrada tiene la acción "VEHICLE_STATUS_CHANGED"
    Y la entrada registra el estado anterior "CERTIFICADO"
    Y la entrada registra el estado nuevo "DOCUMENTADO"
    Y la entrada registra el actor "asesor-a" con rol "ASESOR"

  Escenario: La cadena de hash encadena cada entrada con la anterior
    Dado que estoy autenticado como "asesor-a"
    Cuando ejecuto 5 cambios de estado consecutivos
    Entonces la cadena de auditoría del concesionario "kia-quito" tiene 5 entradas
    Y cada entrada referencia el hash de la entrada anterior
    Y la verificación de la cadena reporta que es válida

  Escenario: La primera entrada de un concesionario usa el hash génesis
    Dado que el concesionario "mazda-guayaquil" no tiene entradas de auditoría
    Cuando se registra su primera entrada
    Entonces esa entrada referencia el hash génesis
    Y la verificación de la cadena reporta que es válida

  Escenario: Alterar una entrada rompe la cadena de forma detectable
    Dado que existe una cadena de auditoría de 10 entradas
    Cuando se altera el contenido de la entrada número 4 directamente en la base
    Entonces la verificación de la cadena reporta que es inválida
    Y la verificación identifica la posición 4 como punto de ruptura

  Escenario: Eliminar una entrada rompe la cadena de forma detectable
    Dado que existe una cadena de auditoría de 10 entradas
    Cuando se elimina la entrada número 7 directamente en la base
    Entonces la verificación de la cadena reporta que es inválida
    Y se emite una alerta de integridad

  Escenario: El repositorio de auditoría no expone operaciones de modificación
    Cuando se inspecciona la superficie pública del repositorio de auditoría
    Entonces expone la operación "append"
    Y no expone ninguna operación de actualización
    Y no expone ninguna operación de borrado

  @lopdp
  Escenario: Los datos personales se almacenan como huella, no como valor
    Dado que estoy autenticado como "asesor-a"
    Cuando registro la documentación de un cliente con cédula "1712345678"
    Entonces la entrada de auditoría no contiene el valor "1712345678"
    Y el campo "cedula" queda marcado como redactado
    Y el campo "cedula" conserva una huella que permite detectar si cambió

  @lopdp
  Escenario: Tras suprimir datos personales la auditoría sigue siendo verificable
    Dado que existe una cadena de auditoría de 10 entradas con documentación de un cliente
    Cuando se ejerce el derecho de supresión sobre ese cliente
    Entonces los datos personales se eliminan de las colecciones de negocio
    Y la verificación de la cadena de auditoría reporta que es válida

  Escenario: Escrituras concurrentes del mismo concesionario producen una cadena única
    Dado que estoy autenticado como "asesor-a"
    Cuando se registran 50 entradas de auditoría de forma concurrente
    Entonces la cadena tiene exactamente 50 entradas
    Y la verificación de la cadena reporta que es válida
    Y no existe ninguna bifurcación de hash

  Escenario: Las cadenas de dos concesionarios son independientes
    Dado que se registran entradas de forma concurrente en "kia-quito" y en "mazda-guayaquil"
    Entonces cada concesionario tiene su propia cadena verificable
    Y ninguna entrada de un concesionario referencia el hash del otro

  Escenario: El intento de acceso entre concesionarios se audita con el tenant real
    Dado que estoy autenticado como "asesor-a"
    Cuando solicito un vehículo del concesionario "mazda-guayaquil"
    Entonces se registra una entrada con la acción "CROSS_TENANT_ACCESS_ATTEMPT"
    Y la entrada queda en la cadena del concesionario "kia-quito"
