import { Injectable } from '@nestjs/common';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ServiceOrdersService } from '../service-orders/service-orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';

@Injectable()
export class HomeService {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly serviceOrdersService: ServiceOrdersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Consolida en 1 request las 9 queries paralelas que hace el home del
   * cliente móvil. Cada sección es opcional según el rol del usuario.
   */
  async getSummary(user: AuthenticatedUser) {
    const role = user.role as string;
    const isManager = [
      RoleEnum.ASESOR,
      RoleEnum.LIDER_TECNICO,
      RoleEnum.JEFE_TALLER,
      RoleEnum.SOPORTE,
    ].includes(role as RoleEnum);
    const isTaller = role === RoleEnum.PERSONAL_TALLER;
    const sede =
      user.sede && user.sede !== 'ALL' ? user.sede : undefined;

    // Lanzar todas las queries en paralelo — mismo comportamiento que el
    // cliente anterior, pero consolidado en un único round-trip HTTP.
    const [
      recepcionadosRes,
      certificadosRes,
      documentadosRes,
      enInstalacionRes,
      listosRes,
      deliveriesRes,
      notifsRes,
      ordersRes,
      myWorkRes,
    ] = await Promise.allSettled([
      this.vehiclesService.findAll(
        { status: 'RECEPCIONADO', sede, limit: 1, page: 1 } as any,
        user,
      ),
      this.vehiclesService.findAll(
        { status: 'CERTIFICADO_STOCK', sede, limit: 5, page: 1 } as any,
        user,
      ),
      this.vehiclesService.findAll(
        { status: 'DOCUMENTADO', sede, limit: 5, page: 1 } as any,
        user,
      ),
      this.vehiclesService.findAll(
        { status: 'EN_INSTALACION', sede, limit: isTaller ? 10 : 1, page: 1 } as any,
        user,
      ),
      this.vehiclesService.findAll(
        { status: 'LISTO_PARA_ENTREGA', sede, limit: 1, page: 1 } as any,
        user,
      ),
      this.vehiclesService.todayDeliveries(user),
      this.notificationsService.getNotifications(
        user.uid,
        user.role as RoleEnum,
        user.sede,
        true,  // onlyUnread
        99,
      ),
      isManager
        ? this.serviceOrdersService.findAll(user, {
            sede,
            status: 'ASIGNADA,EN_INSTALACION',
          })
        : Promise.resolve([]),
      isTaller
        ? this.vehiclesService.findAll(
            { status: 'EN_INSTALACION', sede: user.sede, limit: 10, page: 1 } as any,
            user,
          )
        : Promise.resolve({ data: [], total: 0, page: 1, limit: 10 }),
    ]);

    const val = <T,>(
      r: PromiseSettledResult<T>,
      fallback: T,
    ): T => (r.status === 'fulfilled' ? r.value : fallback);

    const emptyPage = { data: [], total: 0, page: 1, limit: 1 };

    const certificadosData = val(certificadosRes, emptyPage);

    return {
      counts: {
        recepcionados:  (val(recepcionadosRes,  emptyPage) as any).total ?? 0,
        certificados:   (certificadosData        as any).total ?? 0,
        documentados:   (val(documentadosRes,   emptyPage) as any).total ?? 0,
        enInstalacion:  (val(enInstalacionRes,  emptyPage) as any).total ?? 0,
        listos:         (val(listosRes,          emptyPage) as any).total ?? 0,
      },
      recentVehicles:  (certificadosData as any).data ?? [],
      deliveries:      val(deliveriesRes, [] as any[]),
      notifCount:      (val(notifsRes, []) as any[]).length,
      activeOrders:    isManager
        ? (val(ordersRes, []) as any[]).slice(0, 5)
        : [],
      myWork:          isTaller
        ? (val(myWorkRes, emptyPage) as any).data ?? []
        : [],
    };
  }
}
