/**
 * Local stand-in for @neondatabase/serverless: the same neon(url).query() /
 * .transaction() API over a plain Postgres connection (wire protocol v3,
 * trust auth). Used only by the local test server; Vercel uses the real driver.
 */
import net from 'node:net';

const OID = { BOOL: 16, INT8: 20, INT2: 21, INT4: 23, OID: 26, FLOAT4: 700, FLOAT8: 701, JSON: 114, JSONB: 3802, DATE: 1082, TS: 1114, TSTZ: 1184 };

function parseValue(oid, s) {
  if (s === null) return null;
  switch (oid) {
    case OID.BOOL: return s === 't';
    case OID.INT2: case OID.INT4: case OID.OID: return parseInt(s, 10);
    case OID.FLOAT4: case OID.FLOAT8: return parseFloat(s);
    case OID.JSON: case OID.JSONB: return JSON.parse(s);
    case OID.TS: return new Date(s.replace(' ', 'T') + 'Z');
    case OID.TSTZ: return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    case OID.DATE: return new Date(s + 'T00:00:00Z');
    default: return s;
  }
}

function arrayLiteral(a) {
  return '{' + a.map((v) => (v === null ? 'NULL' : '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
}

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

class Conn {
  constructor(url) {
    const u = new URL(url);
    this.opts = { host: u.hostname, port: +u.port || 5432, user: decodeURIComponent(u.username) || 'postgres', database: u.pathname.slice(1) || 'postgres' };
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.chain = Promise.resolve();
  }

  connect() {
    this.ready ??= new Promise((resolve, reject) => {
      this.sock = net.connect(this.opts.port, this.opts.host);
      this.sock.on('error', reject);
      if (process.env.PG_UNREF) this.sock.unref();
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
      this.sock.on('connect', async () => {
        const params = Buffer.from(`user\0${this.opts.user}\0database\0${this.opts.database}\0client_encoding\0UTF8\0TimeZone\0UTC\0\0`);
        const head = Buffer.alloc(8);
        head.writeInt32BE(8 + params.length, 0);
        head.writeInt32BE(196608, 4);
        this.sock.write(Buffer.concat([head, params]));
        try {
          for (;;) {
            const m = await this.next();
            if (m.type === 'R' && m.body.readInt32BE(0) !== 0) throw new Error('Only trust auth is supported by the test driver');
            if (m.type === 'E') throw pgError(m.body);
            if (m.type === 'Z') break;
          }
          resolve();
        } catch (e) { reject(e); }
      });
    });
    return this.ready;
  }

  pump() {
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const msg = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
      this.buf = this.buf.subarray(len + 1);
      (this.pending ??= []).push(msg);
    }
    while (this.pending?.length && this.waiters.length) this.waiters.shift()(this.pending.shift());
  }

  next() {
    if (this.pending?.length) return Promise.resolve(this.pending.shift());
    return new Promise((r) => this.waiters.push(r));
  }

  send(type, body) {
    const head = Buffer.alloc(5);
    head.write(type, 0);
    head.writeInt32BE(body.length + 4, 1);
    this.sock.write(Buffer.concat([head, body]));
  }

  query(text, params = []) {
    const run = async () => {
      await this.connect();
      const cstr = (s) => Buffer.from(s + '\0');
      const i16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
      const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
      this.send('P', Buffer.concat([cstr(''), cstr(text), i16(0)]));
      const vals = params.map(serialize);
      this.send('B', Buffer.concat([cstr(''), cstr(''), i16(0), i16(vals.length),
        ...vals.map((v) => (v === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(v)), Buffer.from(v)]))), i16(0)]));
      this.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
      this.send('E', Buffer.concat([cstr(''), i32(0)]));
      this.send('S', Buffer.alloc(0));
      let fields = [];
      const rows = [];
      let error = null;
      for (;;) {
        const m = await this.next();
        if (m.type === 'T') {
          const n = m.body.readInt16BE(0);
          let off = 2;
          fields = [];
          for (let i = 0; i < n; i++) {
            const end = m.body.indexOf(0, off);
            const name = m.body.toString('utf8', off, end);
            off = end + 1;
            fields.push({ name, oid: m.body.readInt32BE(off + 6) });
            off += 18;
          }
        } else if (m.type === 'D') {
          const n = m.body.readInt16BE(0);
          let off = 2;
          const row = {};
          for (let i = 0; i < n; i++) {
            const len = m.body.readInt32BE(off);
            off += 4;
            const s = len === -1 ? null : m.body.toString('utf8', off, off + len);
            if (len > 0) off += len;
            row[fields[i].name] = parseValue(fields[i].oid, s);
          }
          rows.push(row);
        } else if (m.type === 'E') {
          error = pgError(m.body);
        } else if (m.type === 'Z') {
          if (error) throw error;
          return rows;
        }
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

function pgError(body) {
  const f = {};
  let off = 0;
  while (body[off]) {
    const code = String.fromCharCode(body[off]);
    const end = body.indexOf(0, off + 1);
    f[code] = body.toString('utf8', off + 1, end);
    off = end + 1;
  }
  const e = new Error(f.M || 'postgres error');
  e.code = f.C;
  return e;
}

const conns = new Map();
export function neon(url) {
  if (!conns.has(url)) conns.set(url, new Conn(url));
  const c = conns.get(url);
  const lazy = (text, params) => ({ text, params, then: (a, b) => c.query(text, params).then(a, b) });
  const sql = (strings, ...values) => lazy(strings.reduce((s, part, i) => s + '$' + i + part), values);
  sql.query = (text, params = []) => lazy(text, params);
  sql.transaction = async (queries) => {
    const qs = typeof queries === 'function' ? queries(sql) : queries;
    await c.query('BEGIN');
    try {
      const out = [];
      for (const q of qs) out.push(await c.query(q.text, q.params));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  };
  return sql;
}
