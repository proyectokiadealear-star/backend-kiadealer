export enum VehicleStatus {
  // FASE 1 — INGRESO Y CERTIFICACIÓN
  RECEPCIONADO = 'Recepcionado en Taller',
  CERTIFICADO_STOCK = 'Certificado en Stock',

  // FASE 2 — DOCUMENTACIÓN
  DOCUMENTACION_PENDIENTE = 'Documentación Pendiente',
  DOCUMENTADO = 'Documentado',

  // FASE 3 — ACCESORIZACIÓN
  ORDEN_GENERADA = 'Orden de Trabajo Generada',
  ASIGNADO = 'Asignado a Técnico',
  EN_INSTALACION = 'En Instalación',
  INSTALACION_COMPLETA = 'Instalación Completada',

  // FASE 4 — ENTREGA
  LISTO_PARA_ENTREGA = 'Listo para Entrega',
  AGENDADO = 'Agendado para Entrega',
  ENTREGADO = 'Entregado',

  // ESTADOS DE EXCEPCIÓN
  REAPERTURA_OT = 'Reapertura de Orden',
  CEDIDO = 'Cedido a otro Concesionario',
}
