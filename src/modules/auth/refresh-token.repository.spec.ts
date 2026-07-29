import { RefreshTokenRepository } from './refresh-token.repository';
import { TenantContext } from '../../common/tenant/tenant-context';

/**
 * RefreshTokenRepository es acceso crudo deliberado (ver docblock de la
 * clase): no debe depender de TenantContext. Este spec lo verifica
 * explícitamente corriendo cada método sin TenantContext.run(...).
 */
describe('RefreshTokenRepository', () => {
  let repository: RefreshTokenRepository;
  let docRef: { get: jest.Mock; set: jest.Mock; update: jest.Mock };
  let collectionRef: { doc: jest.Mock; where: jest.Mock };
  let whereChain: { where: jest.Mock; get: jest.Mock };
  let batch: { update: jest.Mock; commit: jest.Mock };
  let firestore: { collection: jest.Mock; batch: jest.Mock };

  beforeEach(() => {
    docRef = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
    whereChain = { where: jest.fn(), get: jest.fn() };
    whereChain.where.mockReturnValue(whereChain);
    collectionRef = {
      doc: jest.fn().mockReturnValue(docRef),
      where: jest.fn().mockReturnValue(whereChain),
    };
    batch = {
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
    firestore = {
      collection: jest.fn().mockReturnValue(collectionRef),
      batch: jest.fn().mockReturnValue(batch),
    };

    const firebase = { rawFirestore: jest.fn().mockReturnValue(firestore) };
    repository = new RefreshTokenRepository(firebase as never);
  });

  it('save() funciona sin TenantContext abierto', async () => {
    expect(TenantContext.get()).toBeUndefined();

    await repository.save({
      tokenId: 'tk1',
      uid: 'u1',
      firebaseRefreshToken: 'fbrt',
      active: true,
    } as never);

    expect(collectionRef.doc).toHaveBeenCalledWith('tk1');
    expect(docRef.set).toHaveBeenCalledTimes(1);
  });

  it('findById() devuelve null si no existe', async () => {
    docRef.get.mockResolvedValue({ exists: false });

    const result = await repository.findById('tk1');

    expect(result).toBeNull();
  });

  it('findActiveByUid() aplica ambos filtros (uid y active)', async () => {
    whereChain.get.mockResolvedValue({ docs: [] });

    await repository.findActiveByUid('u1');

    expect(collectionRef.where).toHaveBeenCalledWith('uid', '==', 'u1');
    expect(whereChain.where).toHaveBeenCalledWith('active', '==', true);
  });

  it('revokeMany() no llama a batch si la lista está vacía', async () => {
    await repository.revokeMany([], {} as never);

    expect(firestore.batch).not.toHaveBeenCalled();
  });

  it('revokeMany() actualiza cada documento y comitea el batch', async () => {
    await repository.revokeMany(['tk1', 'tk2'], {} as never);

    expect(collectionRef.doc).toHaveBeenCalledWith('tk1');
    expect(collectionRef.doc).toHaveBeenCalledWith('tk2');
    expect(batch.update).toHaveBeenCalledTimes(2);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});
