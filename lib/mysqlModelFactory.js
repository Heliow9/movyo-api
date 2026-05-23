const { pool } = require('../db/mysql');
const { createObjectId, normalizeId } = require('./objectId');

const modelRegistry = {};

const columnType = (f) => f.type || 'LONGTEXT';
const isJson = (f) => f.json === true || /TEXT/i.test(columnType(f)) && f.kind === 'json';
const isBool = (f) => f.kind === 'boolean' || /TINYINT\(1\)/i.test(columnType(f));
const isDate = (f) => f.kind === 'date' || /DATETIME/i.test(columnType(f));

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((acc, key) => acc == null ? undefined : acc[key], obj);
}
function setByPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length-1]] = value;
}
function unsetByPath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) cur = cur?.[parts[i]];
  if (cur) delete cur[parts[parts.length-1]];
}
function flattenUpdate(update, current={}) {
  if (!update) return {};
  let out = {};
  if (update.$set) Object.assign(out, update.$set);
  if (update.$inc) {
    Object.entries(update.$inc).forEach(([k,v]) => { out[k] = Number(getByPath(current,k) || 0) + Number(v || 0); });
  }
  if (update.$unset) Object.keys(update.$unset).forEach(k => out[k] = null);
  Object.keys(update).forEach(k => { if (!k.startsWith('$')) out[k] = update[k]; });
  return out;
}
function serialize(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isJson(field)) return JSON.stringify(value ?? null);
  if (isBool(field)) return value ? 1 : 0;
  if (isDate(field)) {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0,19).replace('T',' ');
  }
  if (field.kind === 'number') return Number(value || 0);
  if (field.kind === 'id') return normalizeId(value);
  return value;
}
function deserialize(value, field) {
  if (value === null || value === undefined) return value;
  if (isJson(field)) {
    try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return field.default ?? null; }
  }
  if (isBool(field)) return !!value;
  if (isDate(field)) return value ? new Date(value) : null;
  return value;
}
function pickProjection(row, projection) {
  if (!projection || !projection.trim()) return row;
  const fields = projection.split(/\s+/).filter(Boolean);
  const include = fields.filter(f => !f.startsWith('-'));
  const exclude = fields.filter(f => f.startsWith('-')).map(f => f.slice(1));
  let out = { ...row };
  if (include.length) {
    out = {};
    include.forEach(k => { if (row[k] !== undefined) out[k] = row[k]; });
    if (row._id !== undefined && !out._id) out._id = row._id;
  }
  exclude.forEach(k => delete out[k]);
  return out;
}
function matchesFilter(obj, filter={}) {
  return Object.entries(filter || {}).every(([key, val]) => {
    if (key === '$or' && Array.isArray(val)) return val.some(v => matchesFilter(obj, v));
    if (key === '$and' && Array.isArray(val)) return val.every(v => matchesFilter(obj, v));
    if (key === '_id') key = '_id';
    const cur = getByPath(obj, key);
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if (val.$in) return val.$in.map(normalizeId).includes(normalizeId(cur));
      if (val.$ne !== undefined) return normalizeId(cur) !== normalizeId(val.$ne);
      if (val.$regex !== undefined) return new RegExp(val.$regex, val.$options || '').test(String(cur || ''));
      if (val.$gte !== undefined && !(cur >= val.$gte)) return false;
      if (val.$lte !== undefined && !(cur <= val.$lte)) return false;
      return JSON.stringify(cur) === JSON.stringify(val);
    }
    return normalizeId(cur) === normalizeId(val);
  });
}
function sortRows(rows, sortSpec) {
  if (!sortSpec) return rows;
  const spec = typeof sortSpec === 'string' ? Object.fromEntries(sortSpec.split(/\s+/).filter(Boolean).map(k => [k.replace('-',''), k.startsWith('-')?-1:1])) : sortSpec;
  const entries = Object.entries(spec || {});
  return rows.sort((a,b) => {
    for (const [k, dir] of entries) {
      const av = getByPath(a,k), bv = getByPath(b,k);
      if (av < bv) return dir < 0 ? 1 : -1;
      if (av > bv) return dir < 0 ? -1 : 1;
    }
    return 0;
  });
}

class Query {
  constructor(executor) { this.executor = executor; this._select=null; this._lean=false; this._populate=[]; this._sort=null; this._skip=0; this._limit=null; }
  select(s){ this._select=s; return this; }
  lean(){ this._lean=true; return this; }
  populate(path){ this._populate.push(path); return this; }
  sort(s){ this._sort=s; return this; }
  skip(n){ this._skip=Math.max(0, Number(n) || 0); return this; }
  limit(n){ this._limit=Number(n); return this; }
  session(){ return this; }
  async exec(){
    let res = await this.executor();
    const toPlain = (doc) => doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const project = (doc) => {
      const base = (this._lean || this._select) ? toPlain(doc) : doc;
      return this._select ? pickProjection(base, this._select) : base;
    };
    if (Array.isArray(res)) {
      const sortable = res.map(toPlain);
      const sortedPlain = sortRows(sortable, this._sort);
      const byId = new Map(res.map(d => [normalizeId(d?._id || d?.id), d]));
      res = sortedPlain.map(d => byId.get(normalizeId(d?._id || d?.id)) || d);
      if (this._skip) res = res.slice(this._skip);
      if (this._limit != null) res = res.slice(0,this._limit);
      res = res.map(project);
    } else if (res) res = project(res);
    return res;
  }
  then(resolve,reject){ return this.exec().then(resolve,reject); }
  catch(reject){ return this.exec().catch(reject); }
}

function defineModel(name, definition) {
  const table = definition.table;
  const fields = definition.fields;
  const defaults = definition.defaults || {};

  // ✅ PERFORMANCE FIX
  // Antes, cada find/save/update chamava ensureTable(), e o ensureTable fazia:
  // CREATE TABLE + SHOW COLUMNS para cada coluna + tentativa de CREATE INDEX.
  // Em MySQL remoto isso pode levar 15~30s por request.
  // Agora a estrutura é sincronizada uma única vez por model no startup/primeiro uso.
  let ensured = false;
  let ensurePromise = null;

  async function ensureTable(force = false) {
    if (ensured && !force) return;
    if (ensurePromise && !force) return ensurePromise;

    ensurePromise = (async () => {
    const columns = ['`id` VARCHAR(24) NOT NULL PRIMARY KEY'];
    const physicalColumns = new Set(['id']);
    Object.entries(fields).forEach(([prop, f]) => {
      if (prop === '_id') return;
      const col = f.column || prop;
      // Alguns campos são aliases de compatibilidade (ex.: quantidadeBase -> estoqueAtualBase).
      // No MySQL eles apontam para a mesma coluna física; não podemos criar a coluna duas vezes.
      if (physicalColumns.has(col)) return;
      physicalColumns.add(col);
      columns.push('`'+col+'` '+columnType(f)+' NULL');
    });
    columns.push('`created_at` DATETIME NULL');
    columns.push('`updated_at` DATETIME NULL');
    const sql = `CREATE TABLE IF NOT EXISTS \`${table}\` (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    await pool.query(sql);

    // ✅ MySQL: CREATE TABLE IF NOT EXISTS não adiciona colunas novas em tabelas já existentes.
    // Mantém a estrutura coluna por coluna e corrige upgrades sem apagar dados.
    const checkedColumns = new Set();
    for (const [prop, f] of Object.entries(fields)) {
      if (prop === '_id') continue;
      const col = f.column || prop;
      // Evita SHOW/ALTER duplicado quando mais de uma propriedade usa a mesma coluna física.
      if (checkedColumns.has(col)) continue;
      checkedColumns.add(col);
      try {
        const [existingCols] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
        if (!existingCols.length) {
          await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${columnType(f)} NULL`);
          console.log(`🧩 Coluna criada: ${table}.${col}`);
        }
      } catch (e) {
        // Em alguns bancos a coluna pode ter sido criada por outra instância entre o SHOW e o ALTER.
        if (!/Duplicate column name/i.test(e.message || '')) {
          console.warn(`coluna ${table}.${col}:`, e.message);
        }
      }
    }

    for (const idx of (definition.indexes || [])) {
      try { await pool.query(idx); } catch(e) { if (!/Duplicate key name|already exists/i.test(e.message)) console.warn('índice:', e.message); }
    }

      ensured = true;
    })();

    try {
      await ensurePromise;
    } finally {
      ensurePromise = null;
    }
  }

  class Model {
    constructor(data={}) {
      Object.assign(this, JSON.parse(JSON.stringify(defaults)), data);
      this._id = normalizeId(this._id || this.id || createObjectId());
      this.id = this._id;
    }
    toObject(){ const o={...this}; o.id=o._id; return o; }
    toJSON(){ return this.toObject(); }
    async save(){
      await ensureTable();
      const existing = await Model.findById(this._id).lean();
      if (existing) await Model._updateById(this._id, this.toObject());
      else await Model._insert(this.toObject());
      return this;
    }
    static async _insert(data){
      const now = new Date().toISOString().slice(0,19).replace('T',' ');
      const row = Model._toRow({ ...defaults, ...data, _id: normalizeId(data._id || data.id || createObjectId()) });
      row.created_at = row.created_at || now;
      row.updated_at = now;
      const cols = Object.keys(row);
      const vals = cols.map(c => row[c]);
      await pool.query(`INSERT INTO \`${table}\` (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, vals);
      return Model._fromRow({ ...row, id: row.id });
    }
    static async _updateById(id, update){
      const current = await Model.findById(id).lean();
      const flat = flattenUpdate(update, current || {});
      const row = Model._toRow(flat, true);
      row.updated_at = new Date().toISOString().slice(0,19).replace('T',' ');
      const cols = Object.keys(row).filter(c => c !== 'id');
      if (!cols.length) return Model.findById(id);
      await pool.query(`UPDATE \`${table}\` SET ${cols.map(c=>'`'+c+'`=?').join(', ')} WHERE id=?`, [...cols.map(c=>row[c]), normalizeId(id)]);
      return Model.findById(id);
    }
    static _toRow(data, partial=false){
      const row = {};
      if (!partial || data._id || data.id) row.id = normalizeId(data._id || data.id || createObjectId());
      for (const [prop, f] of Object.entries(fields)) {
        if (prop === '_id') continue;
        const value = getByPath(data, prop);
        if (value === undefined) continue;
        row[f.column || prop] = serialize(value, f);
      }
      return row;
    }
    static _fromRow(row){
      if (!row) return null;
      const obj = {};
      obj._id = normalizeId(row.id);
      obj.id = obj._id;
      for (const [prop, f] of Object.entries(fields)) {
        if (prop === '_id') continue;
        const col = f.column || prop;
        if (row[col] !== undefined) setByPath(obj, prop, deserialize(row[col], f));
      }
      if (row.created_at) obj.createdAt = new Date(row.created_at);
      if (row.updated_at) obj.updatedAt = new Date(row.updated_at);
      return new Model(obj);
    }
    static async create(data){ if (Array.isArray(data)) { const out=[]; for (const item of data) out.push(await new Model(item).save()); return out; } return new Model(data).save(); }
    static async insertMany(items){ const out=[]; for (const item of (Array.isArray(items) ? items : [])) out.push(await new Model(item).save()); return out; }
    static find(filter={}){ return new Query(async()=>{
      await ensureTable();
      const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
      return rows.map(Model._fromRow).filter(x=>matchesFilter(x.toObject(),filter));
    });}
    static findOne(filter={}){ return new Query(async()=> (await Model.find(filter).limit(1))[0] || null); }
    static findById(id){ return new Query(async()=>{
      await ensureTable();
      const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`, [normalizeId(id)]);
      return rows[0] ? Model._fromRow(rows[0]) : null;
    });}
    static async findByIdAndUpdate(id, update, opts={}){ const doc = await Model._updateById(id, update); return opts.new === false ? null : doc; }
    static async findOneAndUpdate(filter, update, opts={}){ const doc = await Model.findOne(filter).lean(); if (!doc) return null; return Model.findByIdAndUpdate(doc._id, update, opts); }
    static async updateOne(filter, update){ const doc = await Model.findOne(filter).lean(); if (!doc) return { modifiedCount:0 }; await Model.findByIdAndUpdate(doc._id, update); return { modifiedCount:1 }; }
    static async updateMany(filter, update){ const docs = await Model.find(filter).lean(); for (const d of docs) await Model.findByIdAndUpdate(d._id, update); return { modifiedCount: docs.length }; }
    static async findByIdAndDelete(id){ const doc = await Model.findById(id).lean(); await pool.query(`DELETE FROM \`${table}\` WHERE id=?`, [normalizeId(id)]); return doc; }
    static async findOneAndDelete(filter){ const doc = await Model.findOne(filter).lean(); if (doc) await Model.findByIdAndDelete(doc._id); return doc; }
    static async deleteOne(filter){ const doc = await Model.findOne(filter).lean(); if (doc) await Model.findByIdAndDelete(doc._id); return { deletedCount: doc ? 1 : 0 }; }
    static async deleteMany(filter){ const docs = await Model.find(filter).lean(); for (const d of docs) await Model.findByIdAndDelete(d._id); return { deletedCount: docs.length }; }
    static async countDocuments(filter={}){ return (await Model.find(filter).lean()).length; }
    static async sync(){ ensured = false; return ensureTable(true); }
  }
  modelRegistry[name] = Model;
  return Model;
}

async function syncAllModels(){
  for (const Model of Object.values(modelRegistry)) await Model.sync();
}
module.exports = { defineModel, syncAllModels, modelRegistry };
