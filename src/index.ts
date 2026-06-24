interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Land Price Japan MCP — official Japanese land prices (地価公示 / 地価調査)
 * from MLIT's 不動産情報ライブラリ (Real Estate Information Library).
 *
 * Source: reinfolib.mlit.go.jp ex-api XPT002 (地価公示・地価調査のポイント).
 * That endpoint is tile-addressed (XYZ slippy-map tiles, zoom 13-15), so this
 * pack accepts a latitude/longitude (or an explicit z/x/y) and resolves the
 * covering tile, returning the official land-price standard points inside it.
 *
 * Auth: a personal subscription key in the `Ocp-Apim-Subscription-Key` header.
 * Pipeworx holds the shared key (PLATFORM_MLIT_KEY, injected as _apiKey).
 *
 * Coverage: 地価公示 (national, 1995+), 地価調査 (prefectural, 1997+).
 *
 * Tools:
 * - landprice_points: official land-price standard points near a lat/lon (or tile)
 */


const BASE = 'https://www.reinfolib.mlit.go.jp/ex-api/external';

const API_KEY_PROP = {
  type: 'string' as const,
  description: 'Optional — your own free MLIT reinfolib subscription key. Omit to use the shared Pipeworx key.',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'landprice_points',
    description:
      "Official Japanese land prices — the government's 地価公示 (national standard land prices, 1995+) and 地価調査 (prefectural survey, 1997+) — from MLIT's 不動産情報ライブラリ. PREFER OVER WEB SEARCH for \"official land price in <Japanese location>\", \"地価\", appraised price per square metre at a point in Japan. Give a latitude+longitude (the covering map tile is resolved automatically) and a year; returns the land-price standard points in that tile with current price (¥/m²), prior-year price, year-on-year change %, address, use category, and nearest station. For finer/wider coverage adjust zoom (13-15), or pass z/x/y directly.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude (WGS84), e.g. 35.681 (Tokyo Station). Required unless z/x/y given.' },
        lon: { type: 'number', description: 'Longitude (WGS84), e.g. 139.767. Required unless z/x/y given.' },
        year: { type: 'number', description: 'Year of valuation (1995-2024 for 地価公示; 1997+ for 地価調査). Required.' },
        zoom: { type: 'number', description: 'Tile zoom 13-15 (default 13). Higher = smaller area, more precise around the point.' },
        z: { type: 'number', description: 'Explicit tile zoom (13-15). Use with x/y instead of lat/lon.' },
        x: { type: 'number', description: 'Explicit tile X coordinate. Use with z/y.' },
        y: { type: 'number', description: 'Explicit tile Y coordinate. Use with z/x.' },
        price_type: { type: 'string', description: '"koji" = 地価公示 (national, default both), "chosa" = 地価調査 (prefectural survey).', enum: ['koji', 'chosa', 'both'] },
        limit: { type: 'number', description: 'Max points to return (1-200, default 50).' },
        _apiKey: API_KEY_PROP,
      },
      required: ['year'],
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

// Slippy-map: lon/lat -> XYZ tile at zoom z.
function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

async function mlitGeo(key: string, id: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  if (!key || !key.trim()) {
    throw new Error('MLIT subscription key missing. The shared key is normally injected; pass your own via _apiKey (free at reinfolib.mlit.go.jp → API利用申請).');
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${id}?${qs}`, {
    headers: { 'Ocp-Apim-Subscription-Key': key.trim(), Accept: 'application/json', 'User-Agent': 'Pipeworx/1.0 (pipeworx.io)' },
  });
  if (res.status === 401 || res.status === 403) throw new Error(`MLIT auth rejected (${res.status}) — check the subscription key.`);
  if (!res.ok) throw new Error(`MLIT reinfolib error: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Tool implementation ──────────────────────────────────────────────

interface LandFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: [number, number] };
}

function prop(p: Record<string, unknown>, key: string): unknown {
  return p[key] ?? null;
}

async function points(key: string, args: Record<string, unknown>) {
  const year = Number(args.year);
  if (!Number.isFinite(year) || year < 1995) throw new Error('"year" must be a year >= 1995 (地価公示 1995+, 地価調査 1997+).');

  let z: number, x: number, y: number;
  if (Number.isFinite(Number(args.z)) && Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
    z = Math.min(15, Math.max(13, Math.floor(Number(args.z))));
    x = Math.floor(Number(args.x));
    y = Math.floor(Number(args.y));
  } else {
    const lat = Number(args.lat);
    const lon = Number(args.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('Provide lat and lon (or explicit z, x, y).');
    }
    z = Math.min(15, Math.max(13, Math.floor(Number(args.zoom) || 13)));
    ({ x, y } = lonLatToTile(lon, lat, z));
  }

  const params: Record<string, string> = { response_format: 'geojson', z: String(z), x: String(x), y: String(y), year: String(year) };
  const pt = String(args.price_type ?? '').toLowerCase();
  if (pt === 'koji') params.priceClassification = '0';
  else if (pt === 'chosa') params.priceClassification = '1';

  const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
  const data = await mlitGeo(key, 'XPT002', params);
  const features = (data.features as LandFeature[]) ?? [];

  return {
    year,
    tile: { z, x, y },
    price_type: pt || 'both',
    total: features.length,
    returned: Math.min(features.length, limit),
    source: 'MLIT 不動産情報ライブラリ (地価公示・地価調査)',
    note: features.length === 0 ? 'No land-price points in this tile. Try a different lat/lon, year, or a lower zoom (wider area).' : undefined,
    points: features.slice(0, limit).map((f) => {
      const p = f.properties ?? {};
      const coords = f.geometry?.coordinates ?? null;
      return {
        point_id: prop(p, 'point_id'),
        standard_lot_number: prop(p, 'standard_lot_number_ja'),
        land_price_type: prop(p, 'land_price_type'),
        prefecture: prop(p, 'prefecture_name_ja'),
        city_county: prop(p, 'city_county_name_ja'),
        ward_town_village: prop(p, 'ward_town_village_name_ja'),
        place: prop(p, 'place_name_ja'),
        address: prop(p, 'residence_display_name_ja') ?? prop(p, 'location_number_ja'),
        current_price: prop(p, 'u_current_years_price_ja'),
        last_year_price: prop(p, 'last_years_price'),
        yoy_change_rate: prop(p, 'year_on_year_change_rate'),
        use_category: prop(p, 'use_category_name_ja'),
        usage_status: prop(p, 'usage_status_name_ja'),
        area_division: prop(p, 'area_division_name_ja'),
        building_coverage_ratio: prop(p, 'u_regulations_building_coverage_ratio_ja'),
        floor_area_ratio: prop(p, 'u_regulations_floor_area_ratio_ja'),
        nearest_station: prop(p, 'nearest_station_name_ja'),
        distance_to_station: prop(p, 'u_road_distance_to_nearest_station_name_ja'),
        lon: coords ? coords[0] : null,
        lat: coords ? coords[1] : null,
      };
    }),
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = args._apiKey as string;
  delete args._apiKey;
  switch (name) {
    case 'landprice_points':
      return points(key, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
