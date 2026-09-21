import { jest } from '@jest/globals';
import storageService from '../storage.service.js';

const ENV = {
  SUPABASE_URL: 'https://proyecto-prueba.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-de-prueba',
};

describe('storage.service uploadReceipt', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
    global.fetch = jest.fn();
  });
  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  const file = { buffer: Buffer.from('contenido-de-prueba'), mimetype: 'image/jpeg', originalname: 'recibo.jpg' };

  it('throws STORAGE_NOT_CONFIGURED when Supabase credentials are missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(storageService.uploadReceipt(file, 1)).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type without calling Supabase', async () => {
    await expect(storageService.uploadReceipt({ ...file, mimetype: 'application/pdf' }, 1))
      .rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a file over 8MB without calling Supabase', async () => {
    const bigFile = { ...file, buffer: Buffer.alloc(8 * 1024 * 1024 + 1) };
    await expect(storageService.uploadReceipt(bigFile, 1)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads to the configured bucket and returns the public URL', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

    const result = await storageService.uploadReceipt(file, 42);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = global.fetch.mock.calls[0];
    expect(calledUrl).toMatch(/^https:\/\/proyecto-prueba\.supabase\.co\/storage\/v1\/object\/receipts\/42\//);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer service-role-key-de-prueba');
    expect(options.headers['Content-Type']).toBe('image/jpeg');
    expect(options.body).toBe(file.buffer);
    expect(result.url).toMatch(/^https:\/\/proyecto-prueba\.supabase\.co\/storage\/v1\/object\/public\/receipts\/42\//);
  });

  it('uses a custom bucket name when SUPABASE_STORAGE_BUCKET is set', async () => {
    process.env.SUPABASE_STORAGE_BUCKET = 'comprobantes';
    global.fetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

    const result = await storageService.uploadReceipt(file, 42);

    expect(global.fetch.mock.calls[0][0]).toContain('/object/comprobantes/');
    expect(result.url).toContain('/object/public/comprobantes/');
  });

  it('throws STORAGE_UPLOAD_FAILED when Supabase responds with an error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });
    await expect(storageService.uploadReceipt(file, 1)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_FAILED' });
  });
});
