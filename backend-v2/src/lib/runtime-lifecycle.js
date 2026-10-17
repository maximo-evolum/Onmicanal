/** Archivo: Proporciona infraestructura y utilidades compartidas para runtime lifecycle. */
// Las respuestas que terminan durante el apagado pueden dejar inactivo un socket keep-alive.
// Cierra solo sockets inactivos; nunca destruye una solicitud HTTP aceptada que sigue en curso.
export function closeHttpServer(server, io) {
  return new Promise((resolve, reject) => {
    const idleTimer = setInterval(() => server.closeIdleConnections?.(), 100);
    idleTimer.unref?.();
    const done = error => {
      clearInterval(idleTimer);
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    };
    try {
      io.disconnectSockets(true);
      Promise.resolve(io.close(done)).catch(done);
      server.closeIdleConnections?.();
    } catch (error) { done(error); }
  });
}

// Mantiene las dependencias activas hasta terminar el trabajo aceptado. Un tiempo de espera acotado
// finaliza con error; nunca debe informar como limpio un despliegue interrumpido.
export function createRuntimeLifecycle({ timeoutMs = 25000, exit = code => process.exit(code), log = event => console.log(JSON.stringify(event)) } = {}) {
  let draining = false, shutdownPromise;
  const pending = new Map(), stops = [];
  return {
    get draining() { return draining; },
    onStop(stop) { stops.push(stop); },
    run(key, task) {
      if (draining || pending.has(key)) return Promise.resolve({ skipped: true });
      const work = Promise.resolve().then(task);
      pending.set(key, work);
      const clear = () => { if (pending.get(key) === work) pending.delete(key); };
      work.then(clear, clear);
      return work;
    },
    middleware(req, res, next) {
      if (!draining || req.path === "/health/live") return next();
      res.setHeader("Connection", "close"); res.setHeader("Retry-After", "5");
      return res.status(503).json({ ok: false, code: "SERVER_DRAINING", error: "El servicio se está reiniciando. Intenta nuevamente en unos segundos." });
    },
    shutdown({ signal, closeHttp, closeResources }) {
      if (shutdownPromise) return shutdownPromise;
      draining = true;
      shutdownPromise = (async () => {
        log({ event: "process.draining", signal, pendingJobs: pending.size });
        let timer;
        const deadline = new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
        const work = (async () => {
          const stopResults = stops.map(stop => Promise.resolve().then(stop));
          const outcomes = await Promise.allSettled([Promise.resolve().then(closeHttp), ...stopResults, ...pending.values()]);
          if (outcomes.some(result => result.status === "rejected")) throw Error("DRAIN_FAILED");
          await closeResources();
          return "complete";
        })().catch(() => "failed");
        const result = await Promise.race([work, deadline]);
        clearTimeout(timer);
        log({ event: `process.shutdown_${result}` });
        exit(result === "complete" ? 0 : 1);
        return result;
      })();
      return shutdownPromise;
    }
  };
}
