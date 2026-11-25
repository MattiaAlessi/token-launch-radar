// Launch Radar's model: one sealed snapshot of DefiLlama's protocol universe in, one ranked
// board of pre-token protocols out.
//
// A protocol is pre-token when its record carries no token at all: no market cap, no CoinGecko
// id and no symbol. The board ranks those protocols by an implied value that is a claim about
// what a token could be worth if the protocol's record stayed as it is, never a prediction that
// a token will be issued.
//
//   base       = tvl_usd x BASE_MULTIPLE
//   category   = CATEGORY_MULTIPLE of the protocol's own category (never its name)
//   growth     = 1 + clamp(change_7d, -50, 150)% x GROWTH_WEIGHT
//   maturity   = 0.55 + min(age_days, 1460) / 1460 x 0.45
//   chains     = 1 + 0.05 x (min(chains, 5) - 1)
//   implied    = round(base x category x growth x maturity x chains)
//
// Every input comes from the snapshot. No protocol name is special-cased, so the same function
// scores a $5M curator and a $400M dex.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the page and shown beside every row. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
  chain_step: 0.05,
  chain_cap: 5,
};

export const MODEL_VERSION = 'signal-2';

/**
 * The category premium: what a launch is typically worth against the protocol's TVL, by the
 * kind of business it runs. Categories, never names, so a new protocol of a known kind is
 * scored the moment it appears in the snapshot.
 */
export const CATEGORY_MULTIPLE: Array<[string, number]> = [
  ['chain', 1.3],
  ['stable', 1.25],
  ['derivative', 1.2],
  ['perpetual', 1.2],
  ['dex', 1.15],
  ['launchpad', 1.1],
  ['rwa', 1.1],
  ['lending', 1.05],
  ['privacy', 1.05],
  ['cdp', 1.0],
  ['synthetic', 1.0],
  ['restak', 0.95],
  ['yield', 0.95],
  ['farm', 0.95],
  ['insurance', 0.9],
  ['index', 0.9],
  ['liquidity', 0.9],
  ['staking', 0.85],
  ['basis', 0.8],
  ['payment', 0.8],
  ['curator', 0.75],
  ['allocator', 0.75],
  ['governance', 0.7],
  ['locker', 0.6],
];

/** The premium for a category string, or the neutral default. */
export function categoryMultiple(category: string | null): number {
  if (category === null) return 0.9;
  const c = category.toLowerCase();
  for (const [needle, multiple] of CATEGORY_MULTIPLE) if (c.includes(needle)) return multiple;
  return 0.9;
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const DAY_MS = 86_400_000;

/** Whole days from the snapshot date back to `listed_at`; null when it has no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One row's full arithmetic and its risk notes. */
export interface Breakdown {
  implied: number;
  base: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
  signal: number;
  notes: string[];
}

/**
 * The implied value of one protocol: the product of five factors, each drawn from the
 * snapshot, plus a 0-100 signal that says how much the record supports the claim.
 */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): Breakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMultiplier = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMultiplier =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMultiplier = 1 + model.chain_step * (Math.min(Math.max(protocol.chains.length, 1), model.chain_cap) - 1);
  const catMult = categoryMultiple(protocol.category);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * catMult * growthMultiplier * maturityMultiplier * chainMultiplier));

  // The signal blends four readings on a 0-100 scale: how long the protocol has run without a
  // token, how large its TVL is, how fast it is growing and how valuable its category is.
  const ageScore = Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days;
  const tvlScore = Math.min(1, Math.log10(Math.max(protocol.tvl_usd, 1e6) / 1e6) / 2.7);
  const growthScore = (growthPct + 50) / 200;
  const categoryScore = Math.min(1, Math.max(0, (catMult - 0.6) / 0.7));
  const signal = Math.max(0, Math.min(100, Math.round(ageScore * 35 + tvlScore * 30 + growthScore * 20 + categoryScore * 15)));

  const notes: string[] = [];
  if (protocol.category === null) notes.push('DefiLlama records no category');
  if (age === null) notes.push('no listing date, so the model assumes 270 days');
  else if (age < 90) notes.push('listed less than 90 days ago');
  if (protocol.tvl_usd < 10_000_000) notes.push('TVL under $10M');
  if (protocol.change_7d !== null && protocol.change_7d < -10) notes.push('TVL fell more than 10% in 7 days');
  if (protocol.chains.length <= 1) notes.push('single chain');
  if (protocol.mcap_usd !== null || protocol.symbol !== null) notes.push('records a token: excluded from the ranking');

  return {
    implied,
    base,
    category_multiple: catMult,
    growth_pct: growthPct,
    growth_multiplier: round4(growthMultiplier),
    maturity_multiplier: round4(maturityMultiplier),
    chain_multiplier: round4(chainMultiplier),
    age_days: age,
    signal,
    notes,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that describe a product of a token that already trades, not a new protocol. */
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** An exchange's own product is not a protocol waiting on a launch. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A wrapped or staked product of another protocol's token. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a pre-token protocol is a subject of its own, by the watchlist's own rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORY.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_NAME.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

/** A farm step: the action, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  signal: number;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
  };
  notes: string[];
  farm_steps: string[];
}

/** The compact row the page renders. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  signal: number;
  implied_value_usd: number;
  model: BoardRow['model'];
  notes: string[];
  farm_steps: string[];
}

/** A live-token protocol, set aside from the ranking. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the page needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_age_days: number | null;
  category_count: number;
  chain_count: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you move funds.`;
  return s;
}

/** The capital one position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 60;
  if (age < 180) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the receipt.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it in the same wallet.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Fund $${capital} and take one position through ${name} on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use the chain's own apps from the same wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline and never paste it into a website.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet is active in more than one week.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and check the protocol's own points or rewards page before you withdraw.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: 'Claim only from the link the protocol publishes on its own site, never from a reply or a direct message, and never pay to claim.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Keep a farm log with the wallet, every date and every transaction, and keep a gas budget of about $25 for the whole position.',
      cost: 'nothing but the log and the gas budget',
      time: '5 minutes',
    },
    {
      text: `Treat the position as a risk: size it at no more than 5% of your portfolio, check the contract and the exit liquidity on ${chain}, and be ready to unwind.`,
      cost: 'no extra cost, but the whole position is at risk',
      time: '15 minutes to review',
    },
  ];
}

/** The board: every rankable pre-token protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor and the coverage the gate checks: every slug is taken as given.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol the snapshot carries, above and
  // below the $50M floor, so a small protocol is never hidden by a large one.
  for (const p of snapshot.protocols) if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, b: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.b.implied - a.b.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  return scored.map(({ p, b }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    age_days: b.age_days,
    watchlist: snapshot.watchlist.includes(p.slug),
    signal: b.signal,
    implied_value_usd: b.implied,
    model: {
      base_multiple: model.base_multiple,
      category_multiple: b.category_multiple,
      growth_pct: b.growth_pct,
      growth_multiplier: b.growth_multiplier,
      maturity_multiplier: b.maturity_multiplier,
      chain_multiplier: b.chain_multiplier,
    },
    notes: b.notes,
    farm_steps: farmSteps(p, b.age_days).map(stepText),
  }));
}

/** The protocols whose token already trades, top 30 by market cap, with their mcap/TVL ratio. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    }));
}

/** The page's whole dataset, from the same board main.ts writes. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const ages = board.map((r) => r.age_days).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const median = ages.length === 0 ? null : ages[Math.floor(ages.length / 2)]!;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_age_days: median,
    category_count: new Set(board.map((r) => r.category ?? 'Other')).size,
    chain_count: new Set(board.flatMap((r) => r.chains)).size,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      listed_at: r.listed_at,
      watchlist: r.watchlist,
      signal: r.signal,
      implied_value_usd: r.implied_value_usd,
      model: r.model,
      notes: r.notes,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows and the gate takes at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
