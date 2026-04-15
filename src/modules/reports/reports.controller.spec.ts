import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('ReportsController', () => {
  let app: INestApplication;

  const reportsServiceMock = {
    getAnalytics: jest.fn().mockResolvedValue({ ok: true }),
    generateVehicleReport: jest.fn(),
    getTechnicianPerformance: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: reportsServiceMock }],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when dateFrom has invalid format', async () => {
    await request(app.getHttpServer())
      .get('/reports/analytics')
      .query({ dateFrom: '2026-01-01', dateTo: '28/02/2026' })
      .expect(400);

    expect(reportsServiceMock.getAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 when dateFrom is greater than dateTo', async () => {
    await request(app.getHttpServer())
      .get('/reports/analytics')
      .query({ dateFrom: '15/03/2026', dateTo: '01/03/2026' })
      .expect(400);

    expect(reportsServiceMock.getAnalytics).not.toHaveBeenCalled();
  });
});
