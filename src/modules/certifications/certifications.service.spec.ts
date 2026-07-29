import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CertificationsService } from './certifications.service';
import { CertificationsRepository } from './certifications.repository';
import { VehicleFieldsRepository } from './vehicle-fields.repository';
import { FirebaseService } from '../../firebase/firebase.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VehicleStatus } from '../../common/enums/vehicle-status.enum';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const asesorUser: AuthenticatedUser = {
  uid: 'asesor-uid',
  role: RoleEnum.ASESOR,
  sede: SedeEnum.SURMOTOR,
  active: true,
  displayName: 'Pedro Asesor',
  email: 'asesor@kia.com',
};

describe('CertificationsService', () => {
  let service: CertificationsService;
  let vehiclesService: jest.Mocked<Partial<VehiclesService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let certifications: jest.Mocked<
    Pick<
      CertificationsRepository,
      'findById' | 'findByIdOrThrow' | 'create' | 'update' | 'delete'
    >
  >;
  let vehicleFields: jest.Mocked<Pick<VehicleFieldsRepository, 'updateFields'>>;
  let firebaseService: any;

  beforeEach(async () => {
    vehiclesService = {
      assertExists: jest.fn(),
      changeStatus: jest.fn().mockResolvedValue(undefined),
      addStatusHistory: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    // Por defecto: no hay certificación previa (CREATE puro). Cada test
    // sobreescribe según el branch que ejercita.
    certifications = {
      findById: jest.fn().mockResolvedValue(null),
      findByIdOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    vehicleFields = {
      updateFields: jest.fn().mockResolvedValue(undefined),
    };
    firebaseService = {
      uploadBuffer: jest.fn().mockResolvedValue('gs://bucket/rims-photo'),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/rims.jpg'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      serverTimestamp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationsService,
        { provide: FirebaseService, useFactory: () => firebaseService },
        { provide: VehiclesService, useFactory: () => vehiclesService },
        {
          provide: NotificationsService,
          useFactory: () => notificationsService,
        },
        { provide: CertificationsRepository, useFactory: () => certifications },
        { provide: VehicleFieldsRepository, useFactory: () => vehicleFields },
      ],
    }).compile();

    service = module.get<CertificationsService>(CertificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw BadRequestException if vehicle has an unknown certification status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: 'ESTADO_INVALIDO' as VehicleStatus,
      sede: SedeEnum.SURMOTOR,
    });

    // No cert doc previo (isUpsert = false)
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 5,
      imprints: 'CON_IMPRONTAS',
    };

    await expect(service.create('v1', dto as any, asesorUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should certify vehicle in DOCUMENTACION_PENDIENTE without changing status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v-doc-pending',
      status: VehicleStatus.DOCUMENTACION_PENDIENTE,
      sede: SedeEnum.SURMOTOR,
      chassis: 'DOC123',
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v-doc-pending',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 4,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create(
      'v-doc-pending',
      dto as any,
      asesorUser,
    );

    expect(result.newStatus).toBe(VehicleStatus.DOCUMENTACION_PENDIENTE);
    expect(result).toHaveProperty('certifiedWhileEarlyState', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehicleFields.updateFields).toHaveBeenCalledWith(
      'v-doc-pending',
      expect.objectContaining({ certifiedWhileEarlyState: true }),
    );
  });

  it('should send KILOMETRAJE_ALTO notification when mileage > 10', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO,
      sede: SedeEnum.SURMOTOR,
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rims: { status: 'ORIGINAL', photoBase64: 'base64==' },
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 15, // > 10
      imprints: 'CON_IMPRONTAS',
    };

    await service.create('v1', dto as any, asesorUser);

    const notifyCalls = (notificationsService.notify as jest.Mock).mock.calls;
    const types = notifyCalls.map((c: any[]) => c[0].type);
    expect(types).toContain('KILOMETRAJE_ALTO');
  });

  it('should send SIN_IMPRONTAS notification when imprints are missing', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO,
      sede: SedeEnum.SURMOTOR,
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rims: { status: 'ORIGINAL', photoBase64: 'base64==' },
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 3,
      imprints: 'SIN_IMPRONTAS',
    };

    await service.create('v1', dto as any, asesorUser);

    const types = (notificationsService.notify as jest.Mock).mock.calls.map(
      (c: any[]) => c[0].type,
    );
    expect(types).toContain('SIN_IMPRONTAS');
  });

  it('sube foto del vehículo y de aros a Storage cuando vienen como archivos', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v1',
      status: VehicleStatus.DOCUMENTADO,
      sede: SedeEnum.SURMOTOR,
      chassis: 'ABC123',
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v1',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 3,
      imprints: 'CON_IMPRONTAS',
    };
    const vehiclePhoto = {
      buffer: Buffer.from('foto'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    const rimsPhoto = {
      buffer: Buffer.from('aros'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    await service.create('v1', dto as any, asesorUser, {
      vehiclePhoto,
      rimsPhoto,
    });

    expect(firebaseService.uploadBuffer).toHaveBeenCalledWith(
      vehiclePhoto.buffer,
      'vehicles/v1/photo.jpg',
      'image/jpeg',
    );
    expect(firebaseService.uploadBuffer).toHaveBeenCalledWith(
      rimsPhoto.buffer,
      'vehicles/v1/rims-photo.jpg',
      'image/jpeg',
    );
    expect(certifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rims: expect.objectContaining({
          photoUrl: 'https://signed.url/rims.jpg',
        }),
      }),
      'v1',
    );
  });

  // ── CEV-1-A: Branch C — POR_ARRIBAR ─────────────────────────────────────
  it('CEV-1-A: should certify vehicle in POR_ARRIBAR without changing status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v2',
      status: VehicleStatus.POR_ARRIBAR,
      sede: SedeEnum.SURMOTOR,
      chassis: 'ABC123',
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v2',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 3,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create('v2', dto as any, asesorUser);

    expect(result.newStatus).toBe(VehicleStatus.POR_ARRIBAR);
    expect(result).toHaveProperty('certifiedWhileEarlyState', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();

    const notifyCalls = (notificationsService.notify as jest.Mock).mock.calls;
    const notifyTitles = notifyCalls.map((c: any[]) => c[0].title);
    expect(
      notifyTitles.some((t: string) => t.includes('estado temprano')),
    ).toBe(true);
  });

  // ── CEV-2-A: Branch C — ENVIADO_A_MATRICULAR ────────────────────────────
  it('CEV-2-A: should certify vehicle in ENVIADO_A_MATRICULAR without changing status', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v3',
      status: VehicleStatus.ENVIADO_A_MATRICULAR,
      sede: SedeEnum.SURMOTOR,
      chassis: 'XYZ789',
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v3',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 2,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create('v3', dto as any, asesorUser);

    expect(result.newStatus).toBe(VehicleStatus.ENVIADO_A_MATRICULAR);
    expect(result).toHaveProperty('certifiedWhileEarlyState', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
  });

  // ── CEV-4-A: remove() Branch C — POR_ARRIBAR ────────────────────────────
  it('CEV-4-A: remove() should clear certifiedWhileEarlyState flag without reverting status (POR_ARRIBAR)', async () => {
    certifications.findByIdOrThrow.mockResolvedValue({
      id: 'v4',
      tenantId: 'kia-quito',
      vehicleId: 'v4',
    } as any);
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v4',
      status: VehicleStatus.POR_ARRIBAR,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'DEF456',
    });

    const result = await service.remove('v4', asesorUser);

    expect(result).toEqual({ vehicleId: 'v4', deleted: true });
    expect(certifications.delete).toHaveBeenCalledWith('v4');
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehiclesService.addStatusHistory).toHaveBeenCalledWith(
      'v4',
      VehicleStatus.POR_ARRIBAR,
      VehicleStatus.POR_ARRIBAR,
      asesorUser,
      SedeEnum.SURMOTOR,
      expect.stringContaining('estado temprano'),
    );
  });

  // ── Branch D: remove() — DOCUMENTADO + certifiedWhileEarlyState ─────────
  it('Branch D: remove() should clear certifiedWhileEarlyState flag without reverting status when vehicle is DOCUMENTADO', async () => {
    certifications.findByIdOrThrow.mockResolvedValue({
      id: 'v5',
      tenantId: 'kia-quito',
      vehicleId: 'v5',
    } as any);
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v5',
      status: VehicleStatus.DOCUMENTADO,
      certifiedWhileEarlyState: true,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'GHI101',
    });

    const result = await service.remove('v5', asesorUser);

    expect(result).toEqual({ vehicleId: 'v5', deleted: true });
    // No debe revertir el status — ya está en DOCUMENTADO
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehicleFields.updateFields).toHaveBeenCalledWith(
      'v5',
      expect.objectContaining({ certifiedWhileEarlyState: false }),
    );
  });

  // ── Branch B: NO_FACTURADO ───────────────────────────────────────────────
  it('should certify NO_FACTURADO vehicle without changing status (Branch B)', async () => {
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v-nofact',
      status: VehicleStatus.NO_FACTURADO,
      sede: SedeEnum.SURMOTOR,
      chassis: 'NF001',
    });
    certifications.findById.mockResolvedValue(null);

    const dto = {
      vehicleId: 'v-nofact',
      radio: 'SI',
      rimsStatus: 'ORIGINAL',
      seatType: 'TELA',
      antenna: 'ALETA_TIBURON',
      trunkCover: 'SI',
      mileage: 5,
      imprints: 'CON_IMPRONTAS',
    };

    const result = await service.create('v-nofact', dto as any, asesorUser);

    expect(result.newStatus).toBe(VehicleStatus.NO_FACTURADO);
    expect(result).toHaveProperty('certifiedWhileNoFacturado', true);
    expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
    expect(vehicleFields.updateFields).toHaveBeenCalledWith(
      'v-nofact',
      expect.objectContaining({ certifiedWhileNoFacturado: true }),
    );
    const types = (notificationsService.notify as jest.Mock).mock.calls.map(
      (c: any[]) => c[0].type,
    );
    expect(types).toContain('ESTADO_CAMBIADO');
  });

  // ── Upsert con doc existente ─────────────────────────────────────────────
  describe('upsert con certificación existente', () => {
    it('needsStatusAdvance: doc existe y el vehículo sigue en DOCUMENTADO — avanza a CERTIFICADO_STOCK (re-patch)', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v-seed',
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'SEED01',
      });
      certifications.findById.mockResolvedValue({
        id: 'v-seed',
        tenantId: 'kia-quito',
        vehicleId: 'v-seed',
        certifiedAt: 'seed-ts',
        certifiedBy: 'seed-user',
        rims: { status: 'BUENOS', photoUrl: null },
      } as any);

      const dto = {
        vehicleId: 'v-seed',
        radio: 'SI',
        rimsStatus: 'ORIGINAL',
        seatType: 'TELA',
        antenna: 'ALETA_TIBURON',
        trunkCover: 'SI',
        mileage: 2,
        imprints: 'CON_IMPRONTAS',
        originConcessionaire: 'QUITO MOTORS',
      };

      const result = await service.create('v-seed', dto as any, asesorUser);

      expect(certifications.update).toHaveBeenCalledWith(
        'v-seed',
        expect.objectContaining({
          certifiedAt: 'seed-ts',
          certifiedBy: 'seed-user',
        }),
      );
      expect(certifications.create).not.toHaveBeenCalled();
      expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
        'v-seed',
        VehicleStatus.CERTIFICADO_STOCK,
        asesorUser,
        expect.any(Object),
      );
      expect(result).toMatchObject({
        upserted: true,
        newStatus: VehicleStatus.CERTIFICADO_STOCK,
      });
    });

    it('sin needsStatusAdvance: vehículo ya en estado post-certificación — solo corrige campos', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v-post',
        status: VehicleStatus.CERTIFICADO_STOCK,
        sede: SedeEnum.SURMOTOR,
        chassis: 'POST01',
      });
      certifications.findById.mockResolvedValue({
        id: 'v-post',
        tenantId: 'kia-quito',
        vehicleId: 'v-post',
        certifiedAt: 'ts',
        certifiedBy: 'uid-original',
      } as any);

      const dto = {
        vehicleId: 'v-post',
        radio: 'SI',
        rimsStatus: 'ORIGINAL',
        seatType: 'TELA',
        antenna: 'ALETA_TIBURON',
        trunkCover: 'SI',
        mileage: 2,
        imprints: 'CON_IMPRONTAS',
        originConcessionaire: 'QUITO MOTORS',
      };

      const result = await service.create('v-post', dto as any, asesorUser);

      expect(vehiclesService.changeStatus).not.toHaveBeenCalled();
      expect(vehicleFields.updateFields).toHaveBeenCalledWith(
        'v-post',
        expect.objectContaining({ originConcessionaire: 'QUITO MOTORS' }),
      );
      expect(vehiclesService.addStatusHistory).toHaveBeenCalled();
      expect(result).toMatchObject({
        upserted: true,
        newStatus: VehicleStatus.CERTIFICADO_STOCK,
      });
    });
  });

  // ── update() ──────────────────────────────────────────────────────────
  describe('update()', () => {
    beforeEach(() => {
      certifications.findByIdOrThrow.mockResolvedValue({
        id: 'v1',
        tenantId: 'kia-quito',
        vehicleId: 'v1',
        rims: { status: 'BUENOS', photoUrl: 'https://old.rims.jpg' },
      } as any);
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.CERTIFICADO_STOCK,
        sede: SedeEnum.SURMOTOR,
      });
    });

    it('aplica cambios parciales y registra el historial de campos modificados', async () => {
      const result = await service.update('v1', { mileage: 7 }, asesorUser);

      expect(certifications.update).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ mileage: 7 }),
      );
      expect(vehiclesService.addStatusHistory).toHaveBeenCalledWith(
        'v1',
        VehicleStatus.CERTIFICADO_STOCK,
        VehicleStatus.CERTIFICADO_STOCK,
        asesorUser,
        SedeEnum.SURMOTOR,
        expect.stringContaining('kilometraje'),
      );
      expect(result).toEqual({ vehicleId: 'v1', updated: true });
    });

    it('reemplaza la foto de aros preservando el resto del campo rims existente', async () => {
      const rimsFile = {
        buffer: Buffer.from('img'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File;

      await service.update('v1', {}, asesorUser, { rimsPhoto: rimsFile });

      expect(certifications.update).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({
          rims: expect.objectContaining({
            status: 'BUENOS',
            photoUrl: 'https://signed.url/rims.jpg',
          }),
        }),
      );
    });

    it('no toca el historial si no cambió ningún campo relevante', async () => {
      await service.update('v1', {}, asesorUser);

      expect(vehiclesService.addStatusHistory).not.toHaveBeenCalled();
    });
  });

  // ── remove() Branch A — comportamiento estándar ──────────────────────────
  it('remove() Branch A: revierte el vehículo a DOCUMENTADO cuando no hay flags activos', async () => {
    certifications.findByIdOrThrow.mockResolvedValue({
      id: 'v-std',
      tenantId: 'kia-quito',
      vehicleId: 'v-std',
    } as any);
    vehiclesService.assertExists = jest.fn().mockResolvedValue({
      id: 'v-std',
      status: VehicleStatus.CERTIFICADO_STOCK,
      certifiedWhileEarlyState: false,
      certifiedWhileNoFacturado: false,
      sede: SedeEnum.SURMOTOR,
      chassis: 'STD001',
    });

    const result = await service.remove('v-std', asesorUser);

    expect(result).toEqual({ vehicleId: 'v-std', deleted: true });
    expect(certifications.delete).toHaveBeenCalledWith('v-std');
    expect(vehiclesService.changeStatus).toHaveBeenCalledWith(
      'v-std',
      VehicleStatus.DOCUMENTADO,
      asesorUser,
      expect.any(Object),
    );
  });

  // ── Multi-tenancy: D-103/D-104/D-102 (ver docs/design/01-multi-tenancy.md) ──
  describe('multi-tenancy', () => {
    it('create() nunca construye ni envía un tenantId propio al repositorio — lo resuelve el contexto', async () => {
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
        chassis: 'ABC123',
      });
      certifications.findById.mockResolvedValue(null);

      const dto = {
        vehicleId: 'v1',
        radio: 'SI',
        rimsStatus: 'ORIGINAL',
        seatType: 'TELA',
        antenna: 'ALETA_TIBURON',
        trunkCover: 'SI',
        mileage: 1,
        imprints: 'CON_IMPRONTAS',
      };

      await service.create('v1', dto as any, asesorUser);

      expect(certifications.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ tenantId: expect.anything() }),
        'v1',
      );
    });

    it('findOne() propaga 404 cuando el repositorio no encuentra la certificación (aislamiento entre concesionarios: cross-tenant se ve como inexistente)', async () => {
      certifications.findByIdOrThrow.mockRejectedValue(
        new NotFoundException('Certificación no encontrada'),
      );

      await expect(service.findOne('v-otro-tenant')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fallo cerrado: si no hay contexto de tenant, el error del repositorio se propaga sin ser absorbido', async () => {
      // El repositorio real lanza InternalServerErrorException vía
      // TenantContext.getOrThrow() cuando no hay contexto activo — el
      // servicio no debe capturarlo ni degradarlo a otra respuesta.
      vehiclesService.assertExists = jest.fn().mockResolvedValue({
        id: 'v1',
        status: VehicleStatus.DOCUMENTADO,
        sede: SedeEnum.SURMOTOR,
      });
      certifications.findById.mockRejectedValue(
        new InternalServerErrorException(
          'Operación ejecutada fuera de un contexto de tenant.',
        ),
      );

      const dto = {
        vehicleId: 'v1',
        radio: 'SI',
        rimsStatus: 'ORIGINAL',
        seatType: 'TELA',
        antenna: 'ALETA_TIBURON',
        trunkCover: 'SI',
        mileage: 1,
        imprints: 'CON_IMPRONTAS',
      };

      await expect(
        service.create('v1', dto as any, asesorUser),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
