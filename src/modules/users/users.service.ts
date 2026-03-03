import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../firebase/firebase.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RoleEnum } from '../../common/enums/role.enum';
import { SedeEnum } from '../../common/enums/sede.enum';
import * as admin from 'firebase-admin';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  private get db() { return this.firebase.firestore(); }

  async create(dto: CreateUserDto, creator: AuthenticatedUser) {
    // 1. Crear usuario en Firebase Auth
    const userRecord = await this.firebase.auth().createUser({
      email: dto.email,
      displayName: dto.displayName,
      password: this.generateTempPassword(),
    });

    // 2. Asignar custom claims
    await this.firebase.auth().setCustomUserClaims(userRecord.uid, {
      role: dto.role,
      sede: dto.sede,
      active: true,
    });

    // 3. Crear documento en Firestore
    const now = this.firebase.serverTimestamp();
    await this.db.collection('users').doc(userRecord.uid).set({
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
    });

    // 4. Generar reset link Y enviar el correo para que el usuario establezca su contraseña
    const resetLink = await this.firebase.auth().generatePasswordResetLink(dto.email);

    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const oobRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: dto.email }),
      },
    );
    if (!oobRes.ok) {
      this.logger.warn(`No se pudo enviar correo de bienvenida a ${dto.email}`);
    } else {
      this.logger.log(`📧 Correo de bienvenida/reset enviado a: ${dto.email}`);
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

  async findAll(filters?: { role?: RoleEnum; sede?: SedeEnum; active?: boolean }) {
    let query: FirebaseFirestore.Query = this.db.collection('users');

    if (filters?.role) query = query.where('role', '==', filters.role);
    if (filters?.sede) query = query.where('sede', '==', filters.sede);
    if (filters?.active !== undefined) query = query.where('active', '==', filters.active);

    // Sin orderBy en Firestore para evitar índices compuestos — ordenar en memoria
    const snapshot = await query.get();
    return snapshot.docs
      .map((d) => {
        const data = d.data();
        delete data['fcmTokens']; // No exponer tokens
        return data;
      })
      .sort((a, b) =>
        String(a['displayName'] ?? '').localeCompare(String(b['displayName'] ?? '')),
      );
  }

  async findOne(uid: string) {
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) throw new NotFoundException('Usuario no encontrado');
    return doc.data();
  }

  async update(uid: string, dto: UpdateUserDto) {
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) throw new NotFoundException('Usuario no encontrado');

    const updates: Record<string, unknown> = {
      ...dto,
      updatedAt: this.firebase.serverTimestamp(),
    };

    await this.db.collection('users').doc(uid).update(updates);

    // Actualizar custom claims si cambia role, sede o active
    if (dto.role !== undefined || dto.sede !== undefined || dto.active !== undefined) {
      const currentData = doc.data()!;
      await this.firebase.auth().setCustomUserClaims(uid, {
        role: dto.role ?? currentData['role'],
        sede: dto.sede ?? currentData['sede'],
        active: dto.active ?? currentData['active'],
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
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) throw new NotFoundException('Usuario no encontrado');

    const email = doc.data()!['email'] as string;

    // 1. Generar el link de reset con el Admin SDK (sirve para retornarlo al admin)
    const resetLink = await this.firebase.auth().generatePasswordResetLink(email);

    // 2. Enviar el correo a través de la Firebase Auth REST API
    //    generatePasswordResetLink() SOLO genera el link; NO envía ningún correo.
    //    sendOobCode SÍ dispara el envío del email desde Firebase.
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

    this.logger.log(`📧 Correo de restablecimiento enviado a: ${email}`);
    return { uid, email, resetLink };
  }

  async registerFcmToken(uid: string, token: string) {
    await this.db.collection('users').doc(uid).update({
      fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
      updatedAt: this.firebase.serverTimestamp(),
    });
    return { uid, tokenRegistered: true };
  }

  private generateTempPassword(): string {
    return `KIA-${Math.random().toString(36).slice(2, 10).toUpperCase()}!`;
  }
}
