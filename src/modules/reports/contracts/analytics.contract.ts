export const ALL_VEHICLE_STATUSES = [
  'NO_FACTURADO',
  'POR_ARRIBAR',
  'ENVIADO_A_MATRICULAR',
  'CERTIFICADO_STOCK',
  'DOCUMENTACION_PENDIENTE',
  'DOCUMENTADO',
  'ORDEN_GENERADA',
  'ASIGNADO',
  'EN_INSTALACION',
  'INSTALACION_COMPLETA',
  'REAPERTURA_OT',
  'LISTO_PARA_ENTREGA',
  'AGENDADO',
  'ENTREGADO',
  'CEDIDO',
] as const;

export interface AnalyticsFiltersApplied {
  sede: string | null;
  modelNormalized: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: 'day' | 'week' | 'month';
}

export interface AnalyticsResponseContract {
  total: number;
  vehiclesDelivered: number;
  vehiclesCreatedInPeriod: number;
  byStatus: Record<string, number>;
  bySede: Record<string, number>;
  byModel: Record<string, number>;
  byColor: Record<string, number>;
  avgDaysToDelivery: number | null;
  medianDaysToDelivery: number | null;
  byModelRotation: Record<string, { avgDays: number; count: number }>;
  byMonthlyDeliveries: Array<{ month: string; count: number }>;
  deliverySeriesGranularity?: 'day' | 'week' | 'month';
  accessories: {
    byKey: Record<
      string,
      { VENDIDO: number; OBSEQUIADO: number; NO_APLICA: number }
    >;
    topSold: Array<{ key: string; vendido: number }>;
    totalVendido: number;
    totalObsequiado: number;
    totalNoAplica: number;
  };
  topAsesores: {
    ordenesGeneradas: Array<{
      uid: string;
      name: string;
      sede: string;
      ordenes: number;
    }>;
    entregas: Array<{
      uid: string;
      name: string;
      sede: string;
      entregas: number;
    }>;
  };
  topTaller: Array<{
    uid: string;
    name: string;
    sede: string;
    totalOTs: number;
  }>;
  otif: {
    numerator: number;
    denominator: number;
    valuePct: number | null;
    missingPromisedDate: number;
    insufficientData: number;
    passed: number;
    failed: number;
    noEvaluable: number;
    totalDeliveriesInPeriod: number;
    totalDeliveriesEvaluable: number;
    failureReasons: {
      late: number;
      incomplete_docs: number;
      incomplete_accessories: number;
    };
    definitionVersion: 'v1';
  };
  filtersApplied?: AnalyticsFiltersApplied;
}
