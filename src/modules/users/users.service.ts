import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import { UsersRepository, UserDocument } from './users.repository';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';

/**
 * El servicio no conoce `tenantId` ni `TenantContext` — ver
 * docs/design/01-multi-tenancy.md, diagrama C4: "Services de negocio no
 * conocen tenantId". Toda lectura/escritura de Firestore y toda asignación
 * de custom claims pasa por `UsersRepository`, que es quien lee el contexto.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async create(dto: CreateUserDto, creator: AuthenticatedUser) {
    // 1. Crear usuario en Firebase Auth. Firebase Auth es global — no tiene
    //    noción de tenant — así que este paso es igual para cualquier
    //    concesionario. Ver docs/design/01-multi-tenancy.md, advertencia
    //    sobre Firebase Auth global en el contexto de esta migración.
    const userRecord = await this.firebase.auth().createUser({
      email: dto.email,
      displayName: dto.displayName,
      password: this.generateTempPassword(),
    });

    // 2. Asignar custom claims. El repositorio inyecta el tenantId del
    //    contexto activo — este servicio nunca lo maneja.
    await this.usersRepository.assignClaims(userRecord.uid, {
      role: dto.role,
      sede: dto.sede,
      active: true,
    });

    // 3. Crear documento en Firestore. El repositorio inyecta tenantId y usa
    //    el uid como id del documento.
    const now = this.firebase.serverTimestamp();
    await this.usersRepository.create(
      {
        uid: userRecord.uid,
        displayName: dto.displayName,
        email: dto.email,
        role: dto.role,
        sede: dto.sede,
        active: true,
        fcmTokens: [],
        createdAt: now,
        updatedAt: now,
        createdBy: creator.uid,
      },
      userRecord.uid,
    );

    // 4. Generar link de reset para retornarlo al administrador.
    //    NO llamar sendOobCode aquí — generaría un segundo token e invalidaría este link.
    //    El admin comparte el link directamente con el nuevo usuario.
    let resetLink: string | null = null;
    try {
      resetLink = await this.firebase
        .auth()
        .generatePasswordResetLink(dto.email);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `No se pudo generar reset link para ${dto.email}: ${msg}`,
      );
    }

    this.logger.log(`Usuario creado: ${userRecord.uid} (${dto.email})`);

    return {
      uid: userRecord.uid,
      email: dto.email,
      displayName: dto.displayName,
      role: dto.role,
      sede: dto.sede,
      resetLink,
    };
  }

  async findAll(filters?: {
    role?: RoleEnum;
    sede?: SedeEnum;
    active?: boolean;
  }) {
    const users = await this.usersRepository.findFiltered(filters);

    // Mismo criterio que el código original: no exponer tokens FCM y ordenar
    // por displayName en memoria (el repositorio no usa orderBy — evita un
    // índice compuesto). El orden que ve el cliente no cambia.
    return users
      .map((user) => {
        const { fcmTokens: _fcmTokens, ...rest } = user;
        return rest;
      })
      .sort((a, b) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
      );
  }

  async findOne(uid: string) {
    // Un usuario de otro concesionario cae en el mismo `null` que uno
    // inexistente — el repositorio ya lo traduce así (D-104), acá solo se
    // traduce a 404.
    return this.usersRepository.findByIdOrThrow(
      uid,
      () => new NotFoundException('Usuario no encontrado'),
    );
  }

  async update(uid: string, dto: UpdateUserDto) {
    const changes = {
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      updatedAt: this.firebase.serverTimestamp(),
    } as Partial<Omit<UserDocument, 'tenantId' | 'id'>>;

    const updated = await this.usersRepository.update(uid, changes);
    if (!updated) throw new NotFoundException('Usuario no encontrado');

    // Actualizar custom claims si cambia role, sede o active. Se toman los
    // valores ya mergeados que devuelve el repositorio (no hace falta una
    // segunda lectura) y el repositorio se encarga de preservar el resto de
    // los claims y de forzar el tenantId del contexto.
    if (
      dto.role !== undefined ||
      dto.sede !== undefined ||
      dto.active !== undefined
    ) {
      await this.usersRepository.assignClaims(uid, {
        role: updated.role,
        sede: updated.sede,
        active: updated.active,
      });
    }

    // Si se desactiva, revocar tokens de refresco
    if (dto.active === false) {
      await this.firebase.auth().revokeRefreshTokens(uid);
    }

    return { uid, updated: true };
  }

  async remove(uid: string) {
    await this.update(uid, { active: false });
    return { uid, deactivated: true };
  }

  async resetPassword(uid: string) {
    // findById aplica el scope de tenant: un uid de otro concesionario cae
    // en 404 acá también, no solo en los endpoints de lectura.
    const existing = await this.usersRepository.findById(uid);
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    const email = existing.email;

    // Enviar el correo a través de la Firebase Auth REST API.
    // sendOobCode genera el token Y envía el email en una sola llamada.
    // NO llamar generatePasswordResetLink antes — generaría un token distinto
    // que invalidaría el que sendOobCode acaba de crear.
    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    });

    if (!res.ok) {
      const json = (await res.json()) as { error?: { message?: string } };
      const errorCode = json.error?.message ?? 'UNKNOWN';
      this.logger.error(`Error enviando reset email a ${email}: ${errorCode}`);
      throw new InternalServerErrorException(
        'No se pudo enviar el correo de restablecimiento. Intente más tarde.',
      );
    }

    this.logger.log(`Correo de restablecimiento enviado a: ${email}`);
    return {
      uid,
      email,
      message: 'Correo de restablecimiento enviado correctamente.',
    };
  }

  async registerFcmToken(uid: string, token: string) {
    const registered = await this.usersRepository.addFcmToken(uid, token);
    if (!registered) throw new NotFoundException('Usuario no encontrado');
    return { uid, tokenRegistered: true };
  }

  private generateTempPassword(): string {
    return `KIA-${Math.random().toString(36).slice(2, 10).toUpperCase()}!`;
  }
}
