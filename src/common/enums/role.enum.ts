export enum RoleEnum {
  SOPORTE = 'SOPORTE',         // Super-admin / soporte técnico: acceso CRUD total
  JEFE_TALLER = 'JEFE_TALLER',
  SUPERVISOR = 'SUPERVISOR',   // Solo lectura: dashboard BI + agendamiento (multi-sede)
  ASESOR = 'ASESOR',
  LIDER_TECNICO = 'LIDER_TECNICO',
  PERSONAL_TALLER = 'PERSONAL_TALLER',
  DOCUMENTACION = 'DOCUMENTACION',
  BODEGUERO = 'BODEGUERO',     // Solo lectura de stock (GET /vehicles)
}
