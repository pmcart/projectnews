/**
 * Basic sanitization for JSON filter, to avoid dangerous operators.
 * Allows only a safe subset of MongoDB operators.
 */
const SAFE_OPS = new Set(["$eq","$ne","$gt","$gte","$lt","$lte","$in","$nin","$regex","$exists"]);

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === "[object Object]";
}

export function sanitizeFilter(input) {
  if (!input) return {};
  if (!isPlainObject(input)) return {};

  function sanitize(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) {
        if (!SAFE_OPS.has(k)) continue;
        if (isPlainObject(v)) out[k] = sanitize(v);
        else out[k] = v;
      } else if (isPlainObject(v)) {
        out[k] = sanitize(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return sanitize(input);
}

export function parseJSONParam(p) {
  if (!p) return undefined;
  try {
    return JSON.parse(p);
  } catch {
    return undefined;
  }
}

export function parseFieldsParam(fields) {
  if (!fields) return undefined;
  const proj = {};
  fields.split(",").map(s => s.trim()).filter(Boolean).forEach(f => proj[f] = 1);
  return Object.keys(proj).length ? proj : undefined;
}

export function getCollectionGuard() {
  const list = (process.env.ALLOWED_COLLECTIONS || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowAll = list.length === 0;
  return (req, res, next) => {
    if (allowAll) return next();
    if (list.includes(req.params.collection)) return next();
    return res.status(403).json({ error: "Collection not allowed", allowed: list });
  };
}
