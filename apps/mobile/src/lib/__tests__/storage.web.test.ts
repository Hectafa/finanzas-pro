import { secureStorage } from '../storage.web';

describe('almacenamiento de sesión en web', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete (globalThis as { window?: unknown }).window;
  });

  it('usa localStorage del navegador', async () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => data.get(k) ?? null,
          setItem: (k: string, v: string) => void data.set(k, v),
          removeItem: (k: string) => void data.delete(k),
        },
      },
    });
    await secureStorage.set('fp.refreshToken', 'abc');
    expect(data.get('fp.refreshToken')).toBe('abc');
    expect(await secureStorage.get('fp.refreshToken')).toBe('abc');
    await secureStorage.remove('fp.refreshToken');
    expect(await secureStorage.get('fp.refreshToken')).toBeNull();
  });

  it('si el navegador bloquea el almacenamiento, la sesión queda en memoria', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get() {
        return {
          get localStorage(): Storage {
            throw new Error('SecurityError');
          },
        };
      },
    });
    await secureStorage.set('fp.companyId', 'empresa-1');
    expect(await secureStorage.get('fp.companyId')).toBe('empresa-1');
    await secureStorage.remove('fp.companyId');
    expect(await secureStorage.get('fp.companyId')).toBeNull();
  });
});
