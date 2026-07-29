import { AuthRepository } from './auth.repository';
import { TenantContext } from '../../common/tenant/tenant-context';

/**
 * AuthRepository es acceso crudo deliberado (ver docblock de la clase): no
 * debe depender de TenantContext bajo ninguna circunstancia. Este spec lo
 * verifica explícitamente corriendo cada método sin TenantContext.run(...).
 */
describe('AuthRepository', () => {
  let repository: AuthRepository;
  let docRef: { get: jest.Mock };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let whereChain: { limit: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    docRef = { get: jest.fn() };
    whereChain = { limit: jest.fn(), get: jest.fn() };
    whereChain.limit.mockReturnValue(whereChain);
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereChain),
    };

    const firebase = {
      rawFirestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue(collectionRef),
      }),
    };

    repository = new AuthRepository(firebase as never);
  });

  it('findUserProfileById() funciona sin TenantContext abierto', async () => {
    expect(TenantContext.get()).toBeUndefined();
    docRef.get.mockResolvedValue({
      exists: true,
      data: () => ({ displayName: 'Ana' }),
    });

    const result = await repository.findUserProfileById('uid-1');

    expect(result).toEqual({ displayName: 'Ana' });
    expect(collectionRef.doc).toHaveBeenCalledWith('uid-1');
  });

  it('findUserProfileById() devuelve null si el documento no existe', async () => {
    docRef.get.mockResolvedValue({ exists: false });

    const result = await repository.findUserProfileById('uid-1');

    expect(result).toBeNull();
  });

  it('findUserByEmail() funciona sin TenantContext abierto', async () => {
    expect(TenantContext.get()).toBeUndefined();
    whereChain.get.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ email: 'a@kia.com', active: true }) }],
    });

    const result = await repository.findUserByEmail('a@kia.com');

    expect(result).toEqual({ email: 'a@kia.com', active: true });
    expect(collectionRef.where).toHaveBeenCalledWith(
      'email',
      '==',
      'a@kia.com',
    );
  });

  it('findUserByEmail() devuelve null si no hay coincidencias', async () => {
    whereChain.get.mockResolvedValue({ empty: true, docs: [] });

    const result = await repository.findUserByEmail('nadie@kia.com');

    expect(result).toBeNull();
  });
});
