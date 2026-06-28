const { pool } = require('../db/mysql');
const { queryWithRetry } = require('./mysqlRetry');
const { createObjectId, normalizeId } = require('./objectId');

const modelRegistry = {};

// MySQL DATETIME não guarda timezone.
// A Movyo trabalha operacionalmente no fuso do Brasil (UTC-3).
// Antes era usado toISOString(), que grava em UTC e empurrava pedidos para o dia seguinte
// quando o lançamento acontecia à noite no Brasil.
const MOVYO_TZ_OFFSET_MINUTES = Number(process.env.MOVYO_TZ_OFFSET_MINUTES || -180);

function formatDateTimeForMysql(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + MOVYO_TZ_OFFSET_MINUTES * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function parseDateTimeFromMysql(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string') {
    const text = value.trim();
    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
    const local = text.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (local && !hasTimezone) {
      const utcWallTime = Date.UTC(
        Number(local[1]),
        Number(local[2]) - 1,
        Number(local[3]),
        Number(local[4]),
        Number(local[5]),
        Number(local[6] || 0)
      );
      return new Date(utcWallTime - MOVYO_TZ_OFFSET_MINUTES * 60 * 1000);
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

  // Mantém compatibilidade com updates no estilo Mongo em campos JSON LONGTEXT.
  // Ex.: { $set: { "statusBot.conectado": true } } precisa regravar a coluna
  // statusBot inteira; antes a chave pontuada era ignorada por _toRow().
  const out = {};
  const apply = (path, value) => {
    if (String(path).includes('.')) {
      const root = String(path).split('.')[0];
      if (!(root in out)) {
        const base = getByPath(current, root);
        out[root] = base && typeof base === 'object'
          ? JSON.parse(JSON.stringify(base))
          : {};
      }
      setByPath(out, path, value);
    } else {
      out[path] = value;
    }
  };

  if (update.$set) Object.entries(update.$set).forEach(([k,v]) => apply(k, v));
  if (update.$inc) {
    Object.entries(update.$inc).forEach(([k,v]) => apply(k, Number(getByPath(current,k) || 0) + Number(v || 0)));
  }
  if (update.$unset) Object.keys(update.$unset).forEach(k => {
    if (String(k).includes('.')) {
      const root = String(k).split('.')[0];
      if (!(root in out)) {
        const base = getByPath(current, root);
        out[root] = base && typeof base === 'object' ? JSON.parse(JSON.stringify(base)) : {};
      }
      unsetByPath(out, k);
    } else {
      out[k] = null;
    }
  });
  Object.keys(update).forEach(k => { if (!k.startsWith('$')) apply(k, update[k]); });
  return out;
}

function parseLocaleNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '').replace(/R\$/gi, '').replace(/[^0-9,.-]/g, '');
  if (!s || s === '-' || s === ',' || s === '.') return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // BR: 1.234,56 / US: 1,234.56 - o último separador é o decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function serialize(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isJson(field)) return JSON.stringify(value ?? null);
  if (isBool(field)) return value ? 1 : 0;
  if (isDate(field)) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : formatDateTimeForMysql(d);
  }
  if (field.kind === 'number') return parseLocaleNumber(value);
  if (field.kind === 'id') return normalizeId(value);
  return value;
}
function deserialize(value, field) {
  if (value === null || value === undefined) return value;
  if (isJson(field)) {
    try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return field.default ?? null; }
  }
  if (isBool(field)) return !!value;
  if (isDate(field)) return value ? parseDateTimeFromMysql(value) : null;
  if (field.kind === 'number') return parseLocaleNumber(value);
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
    if (val instanceof RegExp) return val.test(String(cur || ''));
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

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp);
}

function getFieldDefForPath(fields, path) {
  const key = String(path || '');
  if (key === '_id' || key === 'id') return { column: 'id', kind: 'id', type: 'VARCHAR(24)' };
  const direct = fields[key];
  if (direct) return direct;
  // Campos pontuados normalmente indicam JSON no Mongo. Evitamos converter para SQL
  // para não gerar WHERE incorreto em LONGTEXT/JSON serializado.
  if (key.includes('.')) return null;
  return null;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

function regexToSql(column, regex, options, params) {
  const source = regex instanceof RegExp ? regex.source : String(regex || '');
  const flags = regex instanceof RegExp ? regex.flags : String(options || '');

  // Caso mais comum no projeto: /^slug$/i. Transforma em comparação indexável.
  const exact = source.match(/^\^([^.*+?()[\]{}|\\]+)\$$/);
  if (exact) {
    if (flags.includes('i')) {
      params.push(exact[1].toLowerCase());
      return `LOWER(\`${column}\`) = ?`;
    }
    params.push(exact[1]);
    return `\`${column}\` = ?`;
  }

  // Regex simples sem metacaracteres: usa LIKE.
  if (!/[.*+?()[\]{}|\\^$]/.test(source)) {
    const term = `%${escapeLike(source)}%`;
    if (flags.includes('i')) {
      params.push(term.toLowerCase());
      return `LOWER(\`${column}\`) LIKE ? ESCAPE '\\'`;
    }
    params.push(term);
    return `\`${column}\` LIKE ? ESCAPE '\\'`;
  }

  // Expressões mais complexas ficam no filtro em memória para manter compatibilidade.
  return null;
}

function compileFilterToSql(filter = {}, fields = {}) {
  const params = [];

  const compileNode = (node) => {
    if (!node || !Object.keys(node).length) return '1=1';
    const parts = [];

    for (const [rawKey, rawVal] of Object.entries(node)) {
      if (rawKey === '$or' || rawKey === '$and') {
        if (!Array.isArray(rawVal) || !rawVal.length) return null;
        const subParts = [];
        for (const child of rawVal) {
          const compiled = compileNode(child);
          if (!compiled) return null;
          subParts.push(`(${compiled})`);
        }
        parts.push(`(${subParts.join(rawKey === '$or' ? ' OR ' : ' AND ')})`);
        continue;
      }

      const field = getFieldDefForPath(fields, rawKey);
      if (!field) return null;
      const column = field.column || (rawKey === '_id' ? 'id' : rawKey);

      // Mantém compatibilidade com filtros montados dinamicamente que deixam undefined.
      // mysql2 não aceita undefined como parâmetro; nesses casos cai para o filtro em memória.
      if (rawVal === undefined) return null;

      if (rawVal instanceof RegExp) {
        const sql = regexToSql(column, rawVal, rawVal.flags, params);
        if (!sql) return null;
        parts.push(sql);
        continue;
      }

      if (isPlainObject(rawVal)) {
        const opKeys = Object.keys(rawVal);
        const unsupported = opKeys.filter((k) => !['$in', '$ne', '$gte', '$lte', '$gt', '$lt', '$regex', '$options'].includes(k));
        if (unsupported.length) return null;

        if (rawVal.$regex !== undefined) {
          const sql = regexToSql(column, rawVal.$regex, rawVal.$options, params);
          if (!sql) return null;
          parts.push(sql);
          continue;
        }

        if (rawVal.$in !== undefined) {
          if (!Array.isArray(rawVal.$in)) return null;
          if (!rawVal.$in.length) {
            parts.push('0=1');
            continue;
          }
          const vals = rawVal.$in.map((v) => serialize(v, field));
          params.push(...vals);
          parts.push(`\`${column}\` IN (${vals.map(() => '?').join(',')})`);
          continue;
        }

        if (rawVal.$ne !== undefined) {
          if (rawVal.$ne === null) {
            parts.push(`\`${column}\` IS NOT NULL`);
          } else {
            params.push(serialize(rawVal.$ne, field));
            parts.push(`(\`${column}\` <> ? OR \`${column}\` IS NULL)`);
          }
        }
        if (rawVal.$gte !== undefined) {
          params.push(serialize(rawVal.$gte, field));
          parts.push(`\`${column}\` >= ?`);
        }
        if (rawVal.$lte !== undefined) {
          params.push(serialize(rawVal.$lte, field));
          parts.push(`\`${column}\` <= ?`);
        }
        if (rawVal.$gt !== undefined) {
          params.push(serialize(rawVal.$gt, field));
          parts.push(`\`${column}\` > ?`);
        }
        if (rawVal.$lt !== undefined) {
          params.push(serialize(rawVal.$lt, field));
          parts.push(`\`${column}\` < ?`);
        }
        continue;
      }

      if (rawVal === null) {
        parts.push(`\`${column}\` IS NULL`);
      } else {
        params.push(serialize(rawVal, field));
        parts.push(`\`${column}\` = ?`);
      }
    }

    return parts.length ? parts.join(' AND ') : '1=1';
  };

  const where = compileNode(filter);
  if (!where) return null;
  return { where, params };
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
    await queryWithRetry(sql);

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
        const [existingCols] = await queryWithRetry(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
        if (!existingCols.length) {
          await queryWithRetry(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${columnType(f)} NULL`);
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
      try { await queryWithRetry(idx); } catch(e) { if (!/Duplicate key name|already exists/i.test(e.message)) console.warn('índice:', e.message); }
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
      let persisted;
      if (existing) persisted = await Model._updateById(this._id, this.toObject(), { skipAfterPersist: true, previous: existing });
      else persisted = await Model._insert(this.toObject());
      const plain = persisted && typeof persisted.toObject === 'function' ? persisted.toObject() : persisted;
      if (plain) Object.assign(this, plain);
      await Model._notifyAfterPersist(this, existing);
      return this;
    }
    static async _insert(data){
      const now = formatDateTimeForMysql(new Date());
      const row = Model._toRow({ ...defaults, ...data, _id: normalizeId(data._id || data.id || createObjectId()) });
      row.created_at = row.created_at || now;
      row.updated_at = now;
      const cols = Object.keys(row);
      const vals = cols.map(c => row[c]);
      await queryWithRetry(`INSERT INTO \`${table}\` (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, vals);
      return Model._fromRow({ ...row, id: row.id });
    }
    static async _updateById(id, update, options={}){
      const current = options.previous || await Model.findById(id).lean();
      const flat = flattenUpdate(update, current || {});
      const row = Model._toRow(flat, true);
      row.updated_at = formatDateTimeForMysql(new Date());
      const cols = Object.keys(row).filter(c => c !== 'id');
      if (!cols.length) return Model.findById(id);
      await queryWithRetry(`UPDATE \`${table}\` SET ${cols.map(c=>'`'+c+'`=?').join(', ')} WHERE id=?`, [...cols.map(c=>row[c]), normalizeId(id)]);
      const persisted = await Model.findById(id);
      if (!options.skipAfterPersist) await Model._notifyAfterPersist(persisted, current);
      return persisted;
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
      if (row.created_at) obj.createdAt = parseDateTimeFromMysql(row.created_at);
      if (row.updated_at) obj.updatedAt = parseDateTimeFromMysql(row.updated_at);
      return new Model(obj);
    }
    static async create(data){ if (Array.isArray(data)) { const out=[]; for (const item of data) out.push(await new Model(item).save()); return out; } return new Model(data).save(); }
    static async insertMany(items){ const out=[]; for (const item of (Array.isArray(items) ? items : [])) out.push(await new Model(item).save()); return out; }
    static find(filter={}){ return new Query(async()=>{
      await ensureTable();
      const compiled = compileFilterToSql(filter, fields);
      if (compiled) {
        const [rows] = await queryWithRetry(
          `SELECT * FROM \`${table}\` WHERE ${compiled.where}`,
          compiled.params,
          { label: `${table}.find` }
        );
        return rows.map(Model._fromRow);
      }
      // Fallback compatível para filtros Mongo/JSON complexos.
      const [rows] = await queryWithRetry(`SELECT * FROM \`${table}\``);
      return rows.map(Model._fromRow).filter(x=>matchesFilter(x.toObject(),filter));
    });}
    static findOne(filter={}){ return new Query(async()=>{
      await ensureTable();
      const compiled = compileFilterToSql(filter, fields);
      if (compiled) {
        const [rows] = await queryWithRetry(
          `SELECT * FROM \`${table}\` WHERE ${compiled.where} LIMIT 1`,
          compiled.params,
          { label: `${table}.findOne` }
        );
        return rows[0] ? Model._fromRow(rows[0]) : null;
      }
      return (await Model.find(filter).limit(1))[0] || null;
    }); }
    static findById(id){ return new Query(async()=>{
      await ensureTable();
      const [rows] = await queryWithRetry(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`, [normalizeId(id)]);
      return rows[0] ? Model._fromRow(rows[0]) : null;
    });}
    static async findByIdAndUpdate(id, update, opts={}){ const doc = await Model._updateById(id, update, opts); return opts.new === false ? null : doc; }
    static async findOneAndUpdate(filter, update, opts={}){ const doc = await Model.findOne(filter).lean(); if (!doc) return null; return Model.findByIdAndUpdate(doc._id, update, opts); }
    static async updateOne(filter, update){ const doc = await Model.findOne(filter).lean(); if (!doc) return { modifiedCount:0 }; await Model.findByIdAndUpdate(doc._id, update); return { modifiedCount:1 }; }
    static async updateMany(filter, update){ const docs = await Model.find(filter).lean(); for (const d of docs) await Model.findByIdAndUpdate(d._id, update); return { modifiedCount: docs.length }; }
    static async findByIdAndDelete(id){ const doc = await Model.findById(id).lean(); await queryWithRetry(`DELETE FROM \`${table}\` WHERE id=?`, [normalizeId(id)]); return doc; }
    static async findOneAndDelete(filter){ const doc = await Model.findOne(filter).lean(); if (doc) await Model.findByIdAndDelete(doc._id); return doc; }
    static async deleteOne(filter){ const doc = await Model.findOne(filter).lean(); if (doc) await Model.findByIdAndDelete(doc._id); return { deletedCount: doc ? 1 : 0 }; }
    static async deleteMany(filter){ const docs = await Model.find(filter).lean(); for (const d of docs) await Model.findByIdAndDelete(d._id); return { deletedCount: docs.length }; }
    static async countDocuments(filter={}){
      await ensureTable();
      const compiled = compileFilterToSql(filter, fields);
      if (compiled) {
        const [rows] = await queryWithRetry(
          `SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${compiled.where}`,
          compiled.params,
          { label: `${table}.countDocuments` }
        );
        return Number(rows?.[0]?.total || 0);
      }
      return (await Model.find(filter).lean()).length;
    }
    static setAfterPersistHook(fn){ Model._afterPersistHook = typeof fn === 'function' ? fn : null; }
    static async _notifyAfterPersist(current, previous){
      if (typeof Model._afterPersistHook !== 'function') return;
      try { await Model._afterPersistHook(current, previous); }
      catch (e) { console.error(`afterPersist ${name}:`, e?.message || e); }
    }
    static async sync(){ ensured = false; return ensureTable(true); }
  }
  modelRegistry[name] = Model;
  return Model;
}

async function syncAllModels(){
  for (const Model of Object.values(modelRegistry)) await Model.sync();
}
module.exports = { defineModel, syncAllModels, modelRegistry };
