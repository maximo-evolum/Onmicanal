/** Archivo: Contiene soporte versionado para backend startup.integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { qaEnvironment } from '../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../scripts/lib/qa-runtime.mjs';
import { randomUUID } from 'node:crypto';

test('backend real: arranca sin claves, vuelve a iniciar y revalida permisos por solicitud', { timeout: 90000 }, async t => {
  const env = qaEnvironment(process.env, { requireRedis: false });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env); blockDotEnvReads();
  const { prisma } = await import('../src/lib/db.js');
  const { signAuthToken } = await import('../src/lib/auth.js');
  const { MODULES } = await import('../src/lib/modules.js');
  let tenant;
  t.after(async () => { try { if (tenant) await prisma.tenant.delete({ where: { id: tenant.id } }); } finally { await prisma.$disconnect(); } });
  const slug = 'qa-startup-' + randomUUID();
  tenant = await prisma.tenant.create({ data: { name: 'Empresa de arranque de prueba', slug, industry: 'FINANCE', plan: 'ENTERPRISE' } });
  const user = await prisma.workspaceUser.create({ data: { tenantId: tenant.id, name: 'Administrador de prueba', email: slug + '@example.invalid', role: 'ADMIN' } });
  await prisma.tenantModule.createMany({ data: Object.values(MODULES).map(module => ({ tenantId: tenant.id, module, enabled: true, source: 'MANUAL' })) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const reservation = createServer();
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    let log = '';
    const child = spawn(process.execPath, ['--import', new URL('../scripts/lib/qa-preload.mjs', import.meta.url).href, 'src/server.js'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    const ended = new Promise(resolve => { child.once('exit', (code, signal) => resolve({code, signal})); child.once('error', error => resolve({error})); });
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    try {
      let ready;
      for (let n = 0; n < 60; n++) {
        if (child.exitCode !== null) break;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(500) });
          if (response.ok) { ready = await response.json(); break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      assert.equal(ready?.database, true, 'Backend sin clave IA no inició: ' + log.slice(-1500));
      const denied = await fetch(`http://127.0.0.1:${port}/api/finance/overview`);
      assert.equal(denied.status, 401);
      await denied.arrayBuffer();
      const url = `http://127.0.0.1:${port}/api/finance/overview`;
      const options = { headers: { Authorization: `Bearer ${signAuthToken(user)}` } };
      const readStatus = async () => { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) }); await response.arrayBuffer(); return response.status; };
      assert.equal(await readStatus(), 200);
      await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: tenant.id, module: MODULES.FINANCE_ANALYTICS } }, data: { enabled: false, source: 'MANUAL' } });
      assert.equal(await readStatus(), 403);
      await prisma.tenantModule.update({ where: { tenantId_module: { tenantId: tenant.id, module: MODULES.FINANCE_ANALYTICS } }, data: { enabled: true } });
      await prisma.workspaceUser.update({ where: { id: user.id }, data: { isActive: false } });
      assert.equal(await readStatus(), 401);
      await prisma.workspaceUser.update({ where: { id: user.id }, data: { isActive: true } });
      assert.equal(await readStatus(), 200);
      child.kill('SIGTERM');
      let timer;
      const result = await Promise.race([ended, new Promise(resolve => { timer = setTimeout(() => resolve({timeout:true}), 30000); })]);
      clearTimeout(timer);
      assert.equal(result.timeout, undefined);
      assert.equal(result.error, undefined);
      // Windows terminates rather than delivering Unix SIGTERM. Linux CI tests
      // the real graceful handler; never call that path verified on Windows.
      if (process.platform !== 'win32') {
        assert.equal(result.code, 0);
        assert.match(log, /process.shutdown_complete/);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
    }
  }
});
