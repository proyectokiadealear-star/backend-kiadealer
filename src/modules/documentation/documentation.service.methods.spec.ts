import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentationService } from './documentation.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * Cubre el resto de la API pública de DocumentationService que
 * documentation.service.spec.ts no ejerce (ese archivo se concentra en el
 * auto-avance a CERTIFICADO_STOCK). Acá el foco es verificar que cada método
 * delega correctamente en los repositorios con scope de tenant
 * (DocumentationRepository / VehicleFieldsRepository /
 * ServiceOrderLookupRepository) en vez de tocar Firestore crudo, y que el
 * `tenantId` nunca sale del service hacia esos repositorios (sale del
 * contexto, dentro de cada repositorio).
 */

const docUser: AuthenticatedUser = {
  uid: 'doc-uid',
  role: RoleEnum.DOCUMENTACION,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Laura Doc',
  email: 'doc@kia.com',
  tenantId: 'kia-quito',
};

const buildFirebaseMock = () => ({
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/file.pdf'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn().mockReturnValue('SERVER_TIMESTAMP'),
});

const buildVehiclesServiceMock = () => ({
  assertExists: jest.fn(),
  changeStatus: jest.fn().mockResolvedValue(undefined),
  addStatusHistory: jest.fn().mockResolvedValue(undefined),
});

const buildNotificationsMock = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
});

const buildDocumentationRepoMock = () => ({
  create: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn().mockResolvedValue(null),
  findByIdOrThrow: jest
    .fn()
    .mockImplementation((_id: string, notFound: () => Error) => {
      throw notFound();
    }),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(true),
});

const buildVehicleFieldsMock = () => ({
  updateFields: jest.fn().mockResolvedValue(true),
});

const buildServiceOrderLookupMock = () => ({
  findLatestByVehicleId: jest.fn().mockResolvedValue(null),
  updateFields: jest.fn().mockResolvedValue(true),
});

describe('DocumentationService — resto de la API pública', () => {
  let service: DocumentationService;
  let firebase: ReturnType<typeof buildFirebaseMock>;
  let vehiclesService: ReturnType<typeof buildVehiclesServiceMock>;
  let notificationsService: ReturnType<typeof buildNotificationsMock>;
  let documentationRepo: ReturnType<typeof buildDocumentationRepoMock>;
  let vehicleFields: ReturnType<typeof buildVehicleFieldsMock>;
  let serviceOrderLookup: ReturnType<typeof buildServiceOrderLookupMock>;

  beforeEach(() => {
    firebase = buildFirebaseMock();
    vehiclesService = buildVehiclesServiceMock();
    notificationsService = buildNotificationsMock();
    documentationRepo = buildDocumentationRepoMock();
    vehicleFields = buildVehicleFieldsMock();
    serviceOrderLookup = buildServiceOrderLookupMock();

    service = new DocumentationService(
      firebase as never,
      vehiclesService as never,
      notificationsService as never,
      documentationRepo as never,
      vehicleFields as never,
      serviceOrderLookup as never,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ── sendToRegistration ──────────────────────────────────────────────────
  describe('sendToRegistration', () => {
    it('transiciona POR_ARRIBAR → ENVIADO_A_MATRICULAR', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.POR_ARRIBAR,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      const result = await service.sendToRegistration(
        'v1',
        '2026-01-01',
        docUser,
      );

      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.ENVIADO_A_MATRICULAR,
        docUser,
        expect.any(Object),
      );
      expect(result.newStatus).toBe(VehicleStatus.ENVIADO_A_MATRICULAR);
    });

    it('rechaza si el vehículo no está en POR_ARRIBAR', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
      });

      await expect(
        service.sendToRegistration('v1', '2026-01-01', docUser),
      ).rejects.toThrow(BadRequestException);
      expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    });
  });

  // ── receiveRegistration ─────────────────────────────────────────────────
  describe('receiveRegistration', () => {
    it('escribe la fecha vía el puente de vehicles, sin cambiar el estado', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.ENVIADO_A_MATRICULAR,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      await service.receiveRegistration('v1', '2026-02-01', docUser);

      expect(vehicleFields.updateFields).toHaveBeenCalledWith('v1', {
        registrationReceivedDate: '2026-02-01',
        updatedAt: 'SERVER_TIMESTAMP',
      });
      expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    });

    it('rechaza en un estado no permitido', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.POR_ARRIBAR,
      });

      await expect(
        service.receiveRegistration('v1', '2026-02-01', docUser),
      ).rejects.toThrow(BadRequestException);
      expect(vehicleFields.updateFields).not.toHaveBeenCalled();
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('devuelve la documentación con signed URLs regeneradas', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        vehicleInvoiceUrl: 'https://old/invoice.pdf',
        giftEmailUrls: ['https://old/gift-0.pdf'],
        accessoryInvoiceUrls: [],
      });

      const result = await service.findOne('v1');

      expect(documentationRepo.findByIdOrThrow).toHaveBeenCalledWith(
        'v1',
        expect.any(Function),
      );
      expect(result['vehicleInvoiceUrl']).toBe('https://signed.url/file.pdf');
      expect(result['giftEmailUrls']).toEqual(['https://signed.url/file.pdf']);
    });

    it('propaga el 404 del repositorio (documento ajeno o inexistente)', async () => {
      documentationRepo.findByIdOrThrow.mockImplementation(
        (_id: string, notFound: () => Error) => {
          throw notFound();
        },
      );

      await expect(service.findOne('v1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    beforeEach(() => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        giftEmailUrls: [],
        accessoryInvoiceUrls: [],
      });
    });

    it('actualización parcial sin cambio de estado — usa el repositorio, no Firestore crudo', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        isReopening: false,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      const result = await service.update(
        'v1',
        { clientPhone: '0991112222' } as never,
        docUser,
      );

      expect(documentationRepo.update).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ clientPhone: '0991112222' }),
      );
      expect(result).toEqual({ vehicleId: 'v1', updated: true });
    });

    it('reapertura: agrega accesorios nuevos al checklist de la OT vigente y limpia flags en vehicles', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTACION_PENDIENTE,
        isReopening: true,
        reopenAccessories: ['aros'],
        reopenReason: 'Cliente pidió aros',
        reopenRequestedByName: 'Pedro',
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });
      serviceOrderLookup.findLatestByVehicleId.mockResolvedValue({
        id: 'order-1',
        checklist: [],
        accessories: [],
      });

      const result = await service.update(
        'v1',
        { accessories: [] } as never,
        docUser,
      );

      expect(serviceOrderLookup.updateFields).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({
          checklist: [{ key: 'aros', installed: false }],
          status: 'ASIGNADA',
        }),
      );
      expect(vehicleFields.updateFields).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ isReopening: false }),
      );
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.ASIGNADO,
        docUser,
        expect.any(Object),
      );
      expect(result.newStatus).toBe(VehicleStatus.ASIGNADO);
    });

    it('reapertura sin OT vigente accesible: no rompe, solo omite el checklist', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTACION_PENDIENTE,
        isReopening: true,
        reopenAccessories: ['aros'],
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });
      serviceOrderLookup.findLatestByVehicleId.mockResolvedValue(null);

      await service.update('v1', { accessories: [] } as never, docUser);

      expect(serviceOrderLookup.updateFields).not.toHaveBeenCalled();
      expect(vehicleFields.updateFields).toHaveBeenCalled();
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────
  describe('remove', () => {
    it('borra los PDFs con URL y el documento vía el repositorio', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        vehicleInvoiceUrl: 'https://x/invoice.pdf',
        giftEmailUrls: [],
        accessoryInvoiceUrls: [],
      });
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      const result = await service.remove('v1', docUser);

      expect(firebase.deleteFile).toHaveBeenCalledWith(
        'vehicles/v1/docs/vehicle-invoice.pdf',
      );
      expect(documentationRepo.delete).toHaveBeenCalledWith('v1');
      expect(result).toEqual({ vehicleId: 'v1', deleted: true });
    });

    it('propaga el 404 si la documentación no existe o es ajena', async () => {
      await expect(service.remove('v1', docUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(documentationRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ── removeFile ───────────────────────────────────────────────────────────
  describe('removeFile', () => {
    beforeEach(() => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });
    });

    it('vehicleInvoice: borra el archivo y limpia la URL vía el repositorio', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        vehicleInvoiceUrl: 'https://x/invoice.pdf',
      });

      await service.removeFile('v1', 'vehicleInvoice', docUser);

      expect(documentationRepo.update).toHaveBeenCalledWith('v1', {
        vehicleInvoiceUrl: null,
        updatedAt: 'SERVER_TIMESTAMP',
      });
    });

    it('giftEmail con index: elimina solo ese elemento del array', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        giftEmailUrls: ['https://x/0.pdf', 'https://x/1.pdf'],
      });

      await service.removeFile('v1', 'giftEmail', docUser, 0);

      expect(documentationRepo.update).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ giftEmailUrls: ['https://x/1.pdf'] }),
      );
    });

    it('giftEmail con index fuera de rango rechaza con 400', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        giftEmailUrls: ['https://x/0.pdf'],
      });

      await expect(
        service.removeFile('v1', 'giftEmail', docUser, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('accessoryInvoice sin index: elimina todos', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        accessoryInvoiceUrls: ['https://x/0.pdf'],
      });

      await service.removeFile('v1', 'accessoryInvoice', docUser);

      expect(documentationRepo.update).toHaveBeenCalledWith('v1', {
        accessoryInvoiceUrls: [],
        accessoryInvoiceUrl: null,
        updatedAt: 'SERVER_TIMESTAMP',
      });
    });

    it('fileType inválido rechaza con 400', async () => {
      documentationRepo.findByIdOrThrow.mockResolvedValue({ id: 'v1' });

      await expect(
        service.removeFile('v1', 'otro' as never, docUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── revertToPorArribar ──────────────────────────────────────────────────
  describe('revertToPorArribar', () => {
    it('elimina la documentación existente y revierte a POR_ARRIBAR', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });
      documentationRepo.findById.mockResolvedValue({
        id: 'v1',
        vehicleInvoiceUrl: 'https://x/invoice.pdf',
        giftEmailUrls: [],
        accessoryInvoiceUrls: [],
      });

      const result = await service.revertToPorArribar(
        'v1',
        { reason: 'Canceló la compra' },
        docUser,
      );

      expect(documentationRepo.delete).toHaveBeenCalledWith('v1');
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.POR_ARRIBAR,
        docUser,
        expect.any(Object),
      );
      expect(result.newStatus).toBe(VehicleStatus.POR_ARRIBAR);
    });

    it('sin documentación previa: no intenta borrar nada, solo revierte el estado', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.POR_ARRIBAR,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });
      documentationRepo.findById.mockResolvedValue(null);

      await service.revertToPorArribar('v1', { reason: 'x' }, docUser);

      expect(documentationRepo.delete).not.toHaveBeenCalled();
      expect(vehiclesService.changeStatus).toHaveBeenCalled();
    });

    it('bloquea la reversión en estados finales (ENTREGADO/CEDIDO)', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.ENTREGADO,
      });

      await expect(
        service.revertToPorArribar('v1', { reason: 'x' }, docUser),
      ).rejects.toThrow(BadRequestException);
      expect(documentationRepo.findById).not.toHaveBeenCalled();
    });
  });

  // ── billVehicle ──────────────────────────────────────────────────────────
  describe('billVehicle', () => {
    it('factura y transiciona NO_FACTURADO → POR_ARRIBAR', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.NO_FACTURADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      const result = await service.billVehicle('v1', docUser);

      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.POR_ARRIBAR,
        docUser,
        expect.any(Object),
      );
      expect(result.newStatus).toBe(VehicleStatus.POR_ARRIBAR);
    });

    it('rechaza si el vehículo no está NO_FACTURADO', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
      });

      await expect(service.billVehicle('v1', docUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── changeSede ───────────────────────────────────────────────────────────
  describe('changeSede', () => {
    it('cambia la sede sin tocar el estado', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'CH1',
      });

      const result = await service.changeSede(
        'v1',
        SedeEnum.GRANDA_CENTENO,
        docUser,
      );

      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.DOCUMENTADO,
        docUser,
        expect.objectContaining({
          extraFields: { sede: SedeEnum.GRANDA_CENTENO },
        }),
      );
      expect(result.newSede).toBe(SedeEnum.GRANDA_CENTENO);
    });
  });

  // ── transferConcessionaire (cesión) ─────────────────────────────────────
  describe('transferConcessionaire', () => {
    it('cede el vehículo al concesionario destino dentro del MISMO tenant (no cruza tenants)', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.LISTO_PARA_ENTREGA,
        chassis: 'CH1',
      });

      const result = await service.transferConcessionaire(
        'v1',
        'LogiManta',
        docUser,
      );

      // El destino es metadata (extraFields), nunca una operación entre tenants:
      // ni documentationRepo ni vehicleFields conocen otro tenantId acá.
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.CEDIDO,
        docUser,
        expect.objectContaining({
          extraFields: expect.objectContaining({
            targetConcessionaire: 'LogiManta',
          }),
        }),
      );
      expect(result).toEqual({
        vehicleId: 'v1',
        newStatus: VehicleStatus.CEDIDO,
        targetConcessionaire: 'LogiManta',
      });
    });

    it('sube el documento de cesión si viene adjunto', async () => {
      vehiclesService.assertExists.mockResolvedValue({
        status: VehicleStatus.LISTO_PARA_ENTREGA,
        chassis: 'CH1',
      });
      const file = {
        buffer: Buffer.from('pdf'),
        mimetype: 'application/pdf',
      } as never;

      await service.transferConcessionaire('v1', 'LogiManta', docUser, file);

      expect(firebase.uploadBuffer).toHaveBeenCalled();
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.CEDIDO,
        docUser,
        expect.objectContaining({
          extraFields: expect.objectContaining({
            transferDocUrl: 'https://signed.url/file.pdf',
          }),
        }),
      );
    });
  });
});
