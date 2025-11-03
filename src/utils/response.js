export function ok(res, data = null, message = 'OK', meta) {
  const body = { data, message };
  if (meta !== undefined) body.meta = meta;
  return res.status(200).json(body);
}

export function created(res, data = null, message = 'Created', meta) {
  const body = { data, message };
  if (meta !== undefined) body.meta = meta;
  return res.status(201).json(body);
}

export function badRequest(res, message = 'Bad Request', data = null) {
  return res.status(400).json({ data, message });
}

export function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ data: null, message });
}

export function notFound(res, message = 'Not Found') {
  return res.status(404).json({ data: null, message });
}

export function conflict(res, message = 'Conflict', data = null) {
  return res.status(409).json({ data, message });
}

export function serverError(res, message = 'Internal Server Error', data = null) {
  return res.status(500).json({ data, message });
}

