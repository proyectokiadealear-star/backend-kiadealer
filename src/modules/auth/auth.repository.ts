import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

/**
 * Acceso a Firestore para el flujo de login/forgot-password, ANTES de que
 * exista un TenantContext.
 *
 * Deliberadamente NO extiende TenantScopedRepository. `login()` es la
 * request que autentica al usuario por primera vez: en ese momento no hay
 * `req.user`, no corrió `FirebaseAuthGuard`, no corrió `TenantGuard` y no
 * hay `TenantContext` abierto. Si este repositorio heredara de
 * TenantScopedRepository, `scopedQuery()`/`findById()` llamarían a
 * `TenantContext.getOrThrow()` y reventarían con `InternalServerErrorException`
 * en TODO login — el fallo cerrado que protege al resto de la app rompería
 * acá el camino crítico de toda la aplicación.
 * Ver docs/design/01-multi-tenancy.md D-101/D-102 y
 * docs/design/06-runbook-migracion.md.
 *
 * El aislamiento entre concesionarios para estas dos lecturas no es un
 * `where('tenantId', ...)`: es que ambas se resuelven por identidad ya
 * verificada (uid de un idToken válido, o email exacto) y el `tenantId`
 * real del usuario se toma después, de las custom claims verificadas por
 * Firebase Admin SDK — nunca de un valor que el cliente pueda mandar en el
 * body. Ver AuthService.login().
 */
@Injectable()
export class AuthRepository {
  private readonly COLLECTION = 'users';

  constructor(private readonly firebase: FirebaseService) {}

  /** Perfil de Firestore del usuario recién autenticado, por uid verificado. */
  async findUserProfileById(
    uid: string,
  ): Promise<Record<string, unknown> | null> {
    const doc = await this.firebase
      .rawFirestore()
      .collection(this.COLLECTION)
      .doc(uid)
      .get();

    return doc.exists
      ? ((doc.data() ?? null) as Record<string, unknown> | null)
      : null;
  }

  /**
   * Usuario por email — solo para decidir si corresponde enviar el correo
   * de reset. No es una operación de negocio con scope de tenant: cualquier
   * usuario de cualquier concesionario puede pedir un reset con su propio
   * email, y el mensaje de respuesta es siempre el mismo genérico para no
   * filtrar si el email existe (ver AuthService.forgotPassword()).
   */
  async findUserByEmail(
    email: string,
  ): Promise<Record<string, unknown> | null> {
    const snap = await this.firebase
      .rawFirestore()
      .collection(this.COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();

    return snap.empty ? null : (snap.docs[0].data() as Record<string, unknown>);
  }
}
