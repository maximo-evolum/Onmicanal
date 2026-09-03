import test from "node:test";
import assert from "node:assert/strict";
import { parseSiiDteFiles, sanitizeSiiDteDocuments, summarizeSiiDteDocuments } from "../src/services/finance-sii-dte.service.js";

function dteXml({ emitterRut, receiverRut, folio = "101", total = "1250000", type = "33", reference = "" } = {}) {
  return `<?xml version="1.0" encoding="ISO-8859-1"?><DTE><Documento ID="F101"><Encabezado><IdDoc><TipoDTE>${type}</TipoDTE><Folio>${folio}</Folio><FchEmis>2026-09-03</FchEmis></IdDoc><Emisor><RUTEmisor>${emitterRut}</RUTEmisor><RznSoc>Servicios Andinos SpA</RznSoc></Emisor><Receptor><RUTRecep>${receiverRut}</RUTRecep><RznSocRecep>Comercial Norte Ltda.</RznSocRecep></Receptor><Totales><MntTotal>${total}</MntTotal></Totales></Encabezado>${reference}</Documento></DTE>`;
}

test("clasifica un DTE emitido como documento por cobrar", () => {
  const [document] = parseSiiDteFiles([{
    originalname: "factura-emitida.xml",
    buffer: Buffer.from(dteXml({ emitterRut: "76.123.456-7", receiverRut: "77.222.333-4" }))
  }], { companyRut: "76.123.456-7" });
  assert.equal(document.side, "CUSTOMER");
  assert.equal(document.partyName, "Comercial Norte Ltda.");
  assert.equal(document.amount, 1250000);
  assert.equal(document.needsReview, false);
});

test("clasifica un DTE recibido como cuenta por pagar y resume ambos lados", () => {
  const documents = parseSiiDteFiles([
    { originalname: "emitido.xml", buffer: Buffer.from(dteXml({ emitterRut: "76.123.456-7", receiverRut: "77.222.333-4", folio: "102", total: "100000" })) },
    { originalname: "recibido.xml", buffer: Buffer.from(dteXml({ emitterRut: "77.222.333-4", receiverRut: "76.123.456-7", folio: "103", total: "250000" })) }
  ], { companyRut: "76.123.456-7" });
  assert.equal(documents[1].side, "SUPPLIER");
  assert.equal(documents[1].partyName, "Servicios Andinos SpA");
  assert.deepEqual(summarizeSiiDteDocuments(documents), { total: 2, review: 0, customerDocuments: 1, supplierDocuments: 1, customerAmount: 100000, supplierAmount: 250000 });
});

test("marca documentos de otro contribuyente para revisión al importar", () => {
  const [document] = sanitizeSiiDteDocuments([{
    documentTypeCode: "33", documentNumber: "104", issueDate: "2026-09-03", emitterRut: "11.111.111-1", emitterName: "Otra empresa", receiverRut: "22.222.222-2", receiverName: "Otro receptor", amount: 80000
  }], { companyRut: "76.123.456-7" });
  assert.equal(document.needsReview, true);
  assert.match(document.reviewReasons.join(" "), /no corresponde/i);
});

test("conserva la referencia de una nota de crédito para vincularla al documento original", () => {
  const [document] = parseSiiDteFiles([{
    originalname: "nota-credito.xml",
    buffer: Buffer.from(dteXml({ emitterRut: "76.123.456-7", receiverRut: "77.222.333-4", type: "61", folio: "22", total: "50000", reference: "<Referencia><TpoDocRef>33</TpoDocRef><FolioRef>101</FolioRef><FchRef>2026-09-01</FchRef></Referencia>" }))
  }], { companyRut: "76.123.456-7" });
  assert.equal(document.referenceDocumentType, "33");
  assert.equal(document.referenceDocumentNumber, "101");
  assert.equal(document.referenceDocumentDate, "2026-09-01");
});
