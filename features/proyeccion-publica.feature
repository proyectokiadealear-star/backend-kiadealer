# language: es

@REQ-014 @REQ-015 @seguridad @critico
Característica: Proyección pública y bóveda documental
  Para reducir las consultas de estado que hoy atiende el asesor
  Sin exponer la operación interna del concesionario ante su propio cliente
  Quiero que el cliente final vea hitos curados, una fecha estimada y sus documentos

  Antecedentes:
    Dado que existe el concesionario "kia-quito" con el mapa de hitos por defecto
    Y que el vehículo "VIN-A-001" pertenece al concesionario "kia-quito"
    Y que existe un token de acceso válido para el vehículo "VIN-A-001"

  @REQ-014
  Escenario: La respuesta pública nunca contiene vocabulario interno
    Cuando consulto la vista pública con el token válido
    Entonces la respuesta no contiene ningún valor de estado interno
    Y la respuesta no contiene ningún nombre de rol interno
    Y la respuesta no contiene el campo "tenantId"
    Y la respuesta no contiene el campo "establishmentId"
    Y la respuesta no contiene notas internas ni técnico asignado

  @REQ-014
  Esquema del escenario: Cada estado interno se proyecta a un hito curado
    Dado que el vehículo "VIN-A-001" está en estado "<estado_interno>"
    Cuando consulto la vista pública con el token válido
    Entonces el hito mostrado es "<hito>"
    Y la respuesta no contiene el texto "<estado_interno>"

    Ejemplos:
      | estado_interno       | hito         |
      | POR_ARRIBAR          | recibido     |
      | ENVIADO_A_MATRICULAR | recibido     |
      | CERTIFICADO          | preparacion  |
      | DOCUMENTADO          | preparacion  |
      | OT_GENERADA          | preparacion  |
      | EN_INSTALACION       | preparacion  |
      | LISTO_PARA_ENTREGA   | listo        |
      | AGENDADO             | listo        |
      | ENTREGADO            | entregado    |

  Escenario: Un retraso interno no cambia el hito visible para el cliente
    Dado que el vehículo "VIN-A-001" está en estado "DOCUMENTADO" desde hace 12 días
    Cuando consulto la vista pública con el token válido
    Entonces el hito mostrado es "preparacion"
    Y la respuesta no indica retraso
    Y la respuesta no contiene la cantidad de días en la etapa

  Escenario: Un estado interno sin hito mapeado cae al último hito conocido
    Dado que el vehículo "VIN-A-001" está en un estado sin mapeo configurado
    Cuando consulto la vista pública con el token válido
    Entonces la respuesta devuelve el último hito conocido
    Y la respuesta no contiene el estado interno
    Y la operación no falla

  Escenario: Con cita agendada la fecha se presenta como confirmada
    Dado que el vehículo "VIN-A-001" tiene una cita de entrega el "2026-08-14"
    Cuando consulto la vista pública con el token válido
    Entonces la fecha estimada es "2026-08-14"
    Y la confianza de la fecha es "confirmed"

  Escenario: Sin cita la fecha se estima con el histórico del propio concesionario
    Dado que el vehículo "VIN-A-001" no tiene cita agendada
    Y que el concesionario "kia-quito" tiene un histórico de duraciones por etapa
    Cuando consulto la vista pública con el token válido
    Entonces la respuesta incluye una fecha estimada
    Y la confianza de la fecha es "estimated"
    Y la estimación usa el histórico del concesionario "kia-quito"

  @seguridad
  Escenario: Un token no puede acceder a un vehículo de otro concesionario
    Dado que existe un token del concesionario "mazda-guayaquil"
    Cuando consulto la vista pública del vehículo "VIN-A-001" con ese token
    Entonces recibo un estado HTTP 404

  @seguridad
  Escenario: Un token revocado deja de dar acceso
    Dado que el token del vehículo "VIN-A-001" fue revocado
    Cuando consulto la vista pública con ese token
    Entonces recibo un estado HTTP 404

  @seguridad
  Escenario: Un token inexistente no se distingue de uno revocado
    Cuando consulto la vista pública con un token inexistente
    Y consulto la vista pública con un token revocado
    Entonces ambas respuestas tienen el mismo estado HTTP
    Y ambas respuestas tienen el mismo cuerpo

  @seguridad
  Escenario: El token no se almacena en claro
    Dado que se genera un token de acceso para el vehículo "VIN-A-001"
    Cuando se inspecciona el registro almacenado
    Entonces el registro no contiene el token en claro
    Y el registro contiene una huella del token

  @seguridad
  Escenario: El endpoint público está protegido por límite de tasa
    Cuando realizo 100 consultas a la vista pública en un minuto
    Entonces las consultas por encima del límite reciben un estado HTTP 429
    Y el token queda marcado para revisión

  @REQ-015
  Escenario: El acta entregada es verificable byte a byte
    Dado que el vehículo "VIN-A-001" fue entregado con acta firmada
    Cuando descargo el acta desde la bóveda
    Entonces el documento coincide con la huella registrada al momento de la entrega

  @REQ-015
  Escenario: Una alteración del documento se detecta
    Dado que el vehículo "VIN-A-001" fue entregado con acta firmada
    Cuando se altera un byte del documento almacenado
    Entonces la verificación de integridad falla
    Y se emite una alerta

  @REQ-015
  Escenario: Cada descarga de documento queda registrada
    Cuando descargo el acta desde la bóveda
    Entonces se registra la descarga con la fecha y la dirección IP
    Y el concesionario puede consultar quién accedió al documento

  @REQ-015
  Escenario: El acceso a la bóveda no expira tras la entrega
    Dado que el vehículo "VIN-A-001" fue entregado hace 3 años
    Cuando consulto la vista pública con el token válido
    Entonces puedo descargar el acta
    Y puedo descargar las fotos de la ceremonia

  Escenario: Antes de la entrega la bóveda no expone documentos internos
    Dado que el vehículo "VIN-A-001" está en estado "DOCUMENTADO"
    Y que existe una factura del proveedor cargada por el área de documentación
    Cuando consulto la vista pública con el token válido
    Entonces la bóveda no ofrece la factura del proveedor
    Y la bóveda solo ofrece documentos marcados como visibles para el cliente

  @arquitectura
  Escenario: El controlador público no accede a repositorios internos
    Cuando se inspecciona el controlador de la superficie pública
    Entonces su única dependencia de datos es el servicio de proyección pública
