# language: es

@REQ-001 @seguridad @critico
Característica: Aislamiento entre concesionarios
  Para proteger la confidencialidad de los datos de clientes de cada concesionario
  Como plataforma multi-tenant
  Quiero que ningún tenant pueda leer ni modificar datos de otro tenant

  Antecedentes:
    Dado que existe el concesionario "kia-quito" con el usuario "asesor-a" de rol "ASESOR"
    Y que existe el concesionario "mazda-guayaquil" con el usuario "asesor-b" de rol "ASESOR"
    Y que el vehículo "VIN-B-001" pertenece al concesionario "mazda-guayaquil"

  Escenario: Un usuario no puede leer un vehículo de otro concesionario por ID directo
    Dado que estoy autenticado como "asesor-a"
    Cuando solicito el vehículo "VIN-B-001" por su ID
    Entonces recibo un estado HTTP 404
    Y la respuesta no revela que el recurso exista en otro concesionario
    Y el intento queda registrado en "audit_logs" con el tenantId "kia-quito"

  # Se exige 404 y no 403: un 403 confirma que el recurso existe en otro
  # concesionario, lo que permite enumerar inventario ajeno. Ver decisión D-104.
  Escenario: La respuesta a un recurso ajeno es indistinguible de una a un recurso inexistente
    Dado que estoy autenticado como "asesor-a"
    Cuando solicito el vehículo "VIN-B-001" por su ID
    Y solicito el vehículo "VIN-QUE-NO-EXISTE" por su ID
    Entonces ambas respuestas tienen el mismo estado HTTP
    Y ambas respuestas tienen el mismo cuerpo

  @REQ-004
  Escenario: El tenantId del token prevalece sobre el del payload
    Dado que estoy autenticado como "asesor-a"
    Cuando creo un vehículo enviando en el payload el tenantId "mazda-guayaquil"
    Entonces el vehículo queda creado con tenantId "kia-quito"
    Y el concesionario "mazda-guayaquil" no tiene vehículos nuevos

  Escenario: Un listado solo devuelve documentos del concesionario del token
    Dado que el concesionario "kia-quito" tiene 5 vehículos
    Y que el concesionario "mazda-guayaquil" tiene 3 vehículos
    Y que estoy autenticado como "asesor-a"
    Cuando solicito el listado de vehículos
    Entonces recibo exactamente 5 vehículos
    Y todos pertenecen al concesionario "kia-quito"

  Escenario: La paginación por cursor no salta a documentos de otro concesionario
    Dado que el concesionario "kia-quito" tiene 25 vehículos
    Y que el concesionario "mazda-guayaquil" tiene 25 vehículos
    Y que estoy autenticado como "asesor-a"
    Cuando recorro todas las páginas del listado de vehículos con tamaño 10
    Entonces recibo exactamente 25 vehículos en total
    Y ningún vehículo pertenece al concesionario "mazda-guayaquil"

  Escenario: Un usuario no puede modificar un documento de otro concesionario
    Dado que estoy autenticado como "asesor-a"
    Cuando intento actualizar el vehículo "VIN-B-001"
    Entonces recibo un estado HTTP 404
    Y el vehículo "VIN-B-001" conserva sus valores originales
    Y el intento queda registrado en "audit_logs" con el tenantId "kia-quito"

  Escenario: Una consulta ejecutada sin contexto de tenant falla de forma cerrada
    Dado que un repositorio se invoca fuera de un contexto de tenant
    Cuando se ejecuta una consulta de listado
    Entonces la operación lanza un error
    Y no se devuelve ningún documento

  Escenario: Un token sin tenant asignado es rechazado
    Dado que estoy autenticado con un token sin el claim "tenantId"
    Cuando solicito el listado de vehículos
    Entonces recibo un estado HTTP 401

  Escenario: Un usuario de un concesionario suspendido no puede operar
    Dado que el concesionario "kia-quito" tiene estado "SUSPENDED"
    Y que estoy autenticado como "asesor-a"
    Cuando solicito el listado de vehículos
    Entonces recibo un estado HTTP 403

  @escape-hatch
  Escenario: La operación entre concesionarios exige rol de plataforma y queda auditada
    Dado que estoy autenticado como "soporte-plataforma" con el claim "platformAdmin"
    Cuando ejecuto una operación de plataforma con el motivo "migración de índices"
    Entonces la operación se ejecuta
    Y queda registrada en "audit_logs" con la acción "PLATFORM_SCOPE_ESCALATION"
    Y el registro incluye el motivo "migración de índices"

  @escape-hatch
  Escenario: Un usuario sin claim de plataforma no puede escalar de alcance
    Dado que estoy autenticado como "asesor-a"
    Cuando ejecuto una operación de plataforma con el motivo "cualquiera"
    Entonces recibo un estado HTTP 403

  @REQ-020 @segregacion-de-funciones
  Esquema del escenario: La segregación de funciones se aplica por acción, no por pantalla
    Dado que estoy autenticado con rol "<rol>"
    Cuando intento ejecutar la acción "<accion>"
    Entonces recibo un estado HTTP <estado>

    Ejemplos:
      | rol            | accion                      | estado |
      | ASESOR         | anular_factura              | 403    |
      | ASESOR         | aprobar_certificacion_propia| 403    |
      | DOCUMENTACION  | anular_factura              | 403    |
      | LIDER_TECNICO  | emitir_factura              | 403    |
      | JEFE_TALLER    | aprobar_certificacion_propia| 403    |
      | SOPORTE        | anular_factura              | 403    |
