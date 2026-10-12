// Test helpers: an in-memory D1 database (node:sqlite) and a KV store with the same API as Cloudflare.
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  get reader() { return /^\s*(select|with|pragma)/i.test(this.sql); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args); const row = r ? { ...r } : null; return col && row ? row[col] : row; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), success: true, meta: {} }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, results: [], meta: { changes: Number(r.changes) } }; }
  // like D1's batch: every result carries meta.changes
  exec() { if (this.reader) return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), meta: {} }; const r = this.db.prepare(this.sql).run(...this.args); return { results: [], meta: { changes: Number(r.changes) } }; }
}
export class D1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try { const out = stmts.map((s) => s.exec()); this.db.exec("COMMIT"); return out; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  async exec(sql) { this.db.exec(sql); }
}
export class KV {
  constructor() { this.m = new Map(); }
  async put(k, v, o = {}) { this.m.set(k, { v: v instanceof Uint8Array ? v : new TextEncoder().encode(String(v)), meta: o.metadata }); }
  async get(k, type) { const x = this.m.get(k); if (!x) return null; return type === "arrayBuffer" ? x.v.buffer.slice(x.v.byteOffset, x.v.byteOffset + x.v.byteLength) : new TextDecoder().decode(x.v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: this.m.get(name).meta })), list_complete: true }; }
}

export function makeEnv(extra = {}) {
  return { DB: new D1(), BACKUP: new KV(), ASSETS: { fetch: async () => new Response("asset") }, ...extra };
}

// Calls the worker like a real HTTP request.
export async function call(env, path, { method = "GET", body, code, ip = "1.1.1.1", raw = false } = {}) {
  const headers = { "cf-connecting-ip": ip, "x-timezone": "Europe/Rome" };
  if (code) headers.authorization = `Bearer ${code}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await worker.fetch(new Request("https://kairo.test" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
  if (raw) return res;
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

export const CODE = "codice-di-prova-123";
export async function setup(env) {
  const r = await call(env, "/api/setup", { method: "POST", body: { codice: CODE } });
  if (r.status !== 200) throw new Error("setup failed: " + JSON.stringify(r.data));
}
export const count = async (env, table, where = "1=1") => (await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).first()).n;
