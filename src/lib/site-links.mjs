export function mainLink(path = '', { base = '/', mainUrl = '', mensSite = false } = {}) {
  const relative = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  return mensSite && mainUrl ? new URL(path.replace(/^\//, ''), mainUrl).href : relative;
}
export function mensLink({ base = '/', mensUrl = '', mensSite = false } = {}) {
  return mensUrl || `${base.replace(/\/$/, '')}/${mensSite ? '' : 'mens/'}`;
}
