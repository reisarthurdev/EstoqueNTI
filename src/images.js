const API = 'https://commons.wikimedia.org/w/api.php';
const unavailable = message => Object.assign(new Error(message), { status: 502 });
const HEADERS = { 'User-Agent': 'EstoqueNTI/2.0 (sistema interno de estoque do NTI)' };

/** Busca miniaturas no Wikimedia Commons (gratuito, sem chave de API). */
export async function searchImages(query, limit = 8) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`, gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url', iiurlwidth: '250',
  });

  let res;
  try {
    res = await fetch(`${API}?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
  } catch (err) {
    const reason = err.cause?.code ?? err.name;
    throw unavailable(`Sem acesso ao Wikimedia Commons (${reason}). Confira internet, proxy ou firewall do servidor.`);
  }
  if (!res.ok) throw unavailable(`Wikimedia respondeu HTTP ${res.status}`);

  const data = await res.json();
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map(page => page.imageinfo?.[0]?.thumburl)
    .filter(Boolean);
}

/** Primeira imagem encontrada pelo nome; se falhar, tenta marca + modelo. Nunca lança erro. */
export async function findImage({ name, brand, model }) {
  for (const query of [name, [brand, model].filter(Boolean).join(' ')]) {
    if (!query) continue;
    const [first] = await searchImages(query, 1).catch(err => {
      console.warn('[imagens]', err.message);
      return [];
    });
    if (first) return first;
  }
  return null;
}
