// Financial writes must validate the same snapshot they update. Prisma reports
// serialization conflicts as P2034; only that transient failure is retried.
export class FinanceOperationError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function withFinanceWrite(db, operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: "Serializable", maxWait: 10000, timeout: 30000
      });
    } catch (error) {
      if (error?.code !== "P2034") throw error;
      if (attempt === 2) throw new FinanceOperationError(409,
        "Otra operación está actualizando estos datos. Vuelve a intentarlo; no se aplicaron cambios parciales.");
    }
  }
}

// Never use a capped result as the complete financial universe. Cursor paging
// keeps individual queries bounded without silently discarding older records.
export async function findAllFinanceRecords(db, query) {
  const records = [];
  let cursor;
  const { take: _take, skip: _skip, cursor: _cursor, orderBy: _order, ...whereAndSelect } = query;
  const ordering = _order ? (Array.isArray(_order) ? [..._order] : [_order]) : [];
  if (!ordering.some((item) => item.id)) ordering.push({ id: "asc" });
  for (;;) {
    const page = await db.industryRecord.findMany({
      ...whereAndSelect, orderBy: ordering, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    records.push(...page);
    if (page.length < 500) return records;
    cursor = page[page.length - 1].id;
    if (!cursor) throw new Error("La consulta financiera paginada requiere seleccionar el identificador.");
  }
}
