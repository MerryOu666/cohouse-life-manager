const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = path.join(__dirname, 'data', 'house.json');
const MAX_BODY_SIZE = 1024 * 1024;

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_SIZE) {
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function findById(list, id) {
  return list.find(item => String(item.id) === String(id));
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'cohouse-life-manager-api' });
  }
  if (req.method === 'GET' && url.pathname === '/api/house') {
    return sendJson(res, 200, readData());
  }

  if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

  try {
    const data = readData();
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};

    if (req.method === 'POST' && url.pathname === '/api/expenses') {
      const total = Number(body.total);
      if (!Number.isFinite(total) || total <= 0) throw Object.assign(new Error('total must be positive'), { status: 400 });
      const members = data.house.members.length;
      const expense = {
        id: Date.now(),
        name: requiredString(body.name, 'name'),
        person: requiredString(body.person, 'person'),
        date: body.date || new Date().toISOString().slice(5, 10),
        total,
        share: Number((total / members).toFixed(2)),
        category: body.category || '日常采购',
        status: 'pending'
      };
      data.expenses.unshift(expense);
      writeData(data);
      return sendJson(res, 201, expense);
    }

    const dutyMatch = url.pathname.match(/^\/api\/duties\/([^/]+)\/complete$/);
    if (req.method === 'POST' && dutyMatch) {
      const duty = findById(data.duties, dutyMatch[1]);
      if (!duty) return sendJson(res, 404, { error: 'duty not found' });
      duty.done = body.done === undefined ? !duty.done : Boolean(body.done);
      writeData(data);
      return sendJson(res, 200, duty);
    }

    const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/(consume|restock)$/);
    if (req.method === 'POST' && itemMatch) {
      const item = findById(data.items, itemMatch[1]);
      if (!item) return sendJson(res, 404, { error: 'item not found' });
      item.stock = itemMatch[2] === 'restock' ? 100 : Math.max(0, item.stock - Math.max(1, Number(body.amount) || 10));
      writeData(data);
      return sendJson(res, 200, item);
    }

    if (req.method === 'POST' && url.pathname === '/api/items') {
      const item = { id: Date.now(), name: requiredString(body.name, 'name'), unit: requiredString(body.unit, 'unit'), stock: 100, threshold: Number(body.threshold) || 30, lastBy: body.lastBy || '小林' };
      data.items.push(item);
      writeData(data);
      return sendJson(res, 201, item);
    }

    if (req.method === 'POST' && url.pathname === '/api/rules') {
      const rule = { id: Date.now(), title: requiredString(body.title, 'title'), desc: requiredString(body.desc, 'desc'), confirmedBy: [] };
      data.rules.push(rule);
      writeData(data);
      return sendJson(res, 201, rule);
    }

    return sendJson(res, 404, { error: 'route not found' });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'internal server error' });
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`Cohouse API listening on http://localhost:${PORT}`);
});
