/**
 * Cardcom Low Profile (API v11), server side only. The same client as the
 * storytelling site (api/_cardcom.js there), for this app.
 *
 *   LowProfile/Create       opens a payment page hosted by Cardcom, returns its URL
 *   LowProfile/GetLpResult  the authoritative result of a payment page. The
 *                           webhook calls it to verify a payment server to
 *                           server; the webhook's own body is never trusted
 *                           for the money.
 *
 * Credentials come from the admin's "חיבורים" screen or the app's server
 * variables (lib/integrations.js) and never reach the browser. Nothing happens
 * until a terminal number and API name are set.
 * Docs: https://secure.cardcom.solutions/Api/v11/Docs
 */
import { settings } from './integrations';

export async function cardcomConfig() {
  const v = await settings(['CARDCOM_TERMINAL_NUMBER', 'CARDCOM_API_NAME', 'CARDCOM_API_PASSWORD', 'CARDCOM_CREATE_DOCUMENT', 'CARDCOM_DOCUMENT_TYPE']);
  return {
    baseUrl: (process.env.CARDCOM_BASE_URL || 'https://secure.cardcom.solutions/api/v11').replace(/\/$/, ''),
    terminalNumber: Number(v.CARDCOM_TERMINAL_NUMBER || 0),
    apiName: v.CARDCOM_API_NAME,
    // Needed for issuing the document (invoice/receipt) and for refunds
    apiPassword: v.CARDCOM_API_PASSWORD,
    // A document (חשבונית מס קבלה) on every successful charge, emailed to the
    // buyer. Needs the documents module on the terminal; without it Cardcom
    // refuses Create with code 650, so it can be turned off with "false".
    createDocument: (v.CARDCOM_CREATE_DOCUMENT || 'true') !== 'false',
    // TaxInvoiceAndReceipt (חשבונית מס קבלה), TaxInvoice or Receipt (קבלה)
    documentType: v.CARDCOM_DOCUMENT_TYPE || 'TaxInvoiceAndReceipt',
  };
}

/** Terminal and API name are set: checkout can run. */
export async function isConfigured() {
  const c = await cardcomConfig();
  return !!(c.terminalNumber && c.apiName);
}

async function post(path, payload) {
  const c = await cardcomConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${c.baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
    return { httpOk: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Open a payment page. Returns { ok, url, lowProfileId } or { ok: false, error, raw }. */
export async function createLowProfile({ amountShekel, productName, orderId, successUrl, failedUrl, webhookUrl, maxPayments, language = 'he', coinId = 1 }) {
  const c = await cardcomConfig();
  const payload = {
    TerminalNumber: c.terminalNumber,
    ApiName: c.apiName,
    ReturnValue: String(orderId),        // echoed back with the result: our order id
    Amount: amountShekel,                // in shekels
    ISOCoinId: coinId,                   // 1 = ILS
    Language: language,
    Operation: 'ChargeOnly',
    SuccessRedirectUrl: successUrl,
    FailedRedirectUrl: failedUrl,
    WebHookUrl: webhookUrl,              // server-to-server notice of the result
    ProductName: productName,
  };
  if (c.apiPassword) payload.ApiPassword = c.apiPassword;
  // Up to N payments, chosen by the buyer on Cardcom's page
  if (maxPayments && maxPayments > 1) payload.MaxNumOfPayments = maxPayments;
  if (c.createDocument) {
    payload.Document = {
      DocumentTypeToCreate: c.documentType,
      // No Name on purpose: Cardcom takes it (and the email) from what the
      // buyer types on the payment page.
      IsSendByEmail: true,
      Languge: language,                 // sic: v11 spells it "Languge"
      ISOCoinID: coinId,
      Products: [{ Description: productName, UnitCost: amountShekel, Quantity: 1 }],
    };
  }
  let res;
  try {
    res = await post('LowProfile/Create', payload);
  } catch (e) {
    return { ok: false, error: `Cardcom unreachable: ${e?.message || e}` };
  }
  const { httpOk, data } = res;
  const code = data?.ResponseCode ?? data?.responseCode;
  const url = data?.Url || data?.url;
  if (httpOk && code === 0 && url) return { ok: true, url, lowProfileId: data.LowProfileId || data.lowProfileId };
  return { ok: false, error: data?.Description || data?.description || `Cardcom Create failed (code ${code})`, raw: data };
}

/** The authoritative result for a payment page. */
export async function getLpResult(lowProfileId) {
  const c = await cardcomConfig();
  const body = { TerminalNumber: c.terminalNumber, ApiName: c.apiName, LowProfileId: lowProfileId };
  if (c.apiPassword) body.ApiPassword = c.apiPassword;
  return post('LowProfile/GetLpResult', body);
}

/** The fields kept from a GetLpResult answer (v11 nests them and varies the casing). */
export function parseResult(data) {
  data = data || {};
  const code = data.ResponseCode ?? data.responseCode;
  const tx = data.TranzactionInfo || data.tranzactionInfo || {};
  const doc = data.DocumentInfo || data.documentInfo || {};
  const txCode = tx.ResponseCode ?? tx.responseCode;
  return {
    approved: code === 0 && (txCode == null || txCode === 0),
    responseCode: code,
    description: data.Description || data.description || '',
    returnValue: data.ReturnValue || data.returnValue || null,
    transactionId: tx.TranzactionId || tx.tranzactionId || data.TranzactionId || null,
    approvalNumber: tx.ApprovalNumber || tx.approvalNumber || null,
    last4: tx.Last4CardDigits || tx.last4CardDigits || null,
    numPayments: tx.NumOfPayments || tx.NumberOfPayments || tx.numOfPayments || null,
    amount: tx.Amount ?? tx.amount ?? null,
    cardOwnerName: tx.CardOwnerName || tx.cardOwnerName || null,
    cardOwnerPhone: tx.CardOwnerPhone || tx.cardOwnerPhone || tx.CardOwnerMobile || tx.Phone || tx.phone || null,
    cardOwnerEmail: tx.CardOwnerEmail || tx.cardOwnerEmail || null,
    documentNumber: doc.DocumentNumber || doc.documentNumber || null,
    documentType: doc.DocumentType || doc.documentType || null,
  };
}
