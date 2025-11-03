export function normalizeWaId(id) {
  if (!id) return null;
  let s = String(id).trim();
  const at = s.indexOf('@');
  let local = at >= 0 ? s.slice(0, at) : s;
  const domain = at >= 0 ? s.slice(at) : '@c.us';

  // remove leading '+' and spaces
  local = local.replace(/^\+/, '').replace(/\s+/g, '');

  // Normalize common local forms:
  // 0813... -> 62813...
  // 813...  -> 62813...
  if (/^0\d+/.test(local)) {
    local = '62' + local.slice(1);
  } else if (/^8\d+/.test(local)) {
    local = '62' + local;
  }
  // if already 62... keep as-is; otherwise leave local unchanged (handles group ids with hyphens)

  return `${local}${domain}`;
}