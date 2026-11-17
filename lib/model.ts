// Token Radar's scoring model: a sealed snapshot of the protocol universe in, a ranked board out.
//
// The board ranks every protocol in the snapshot's watchlist (the floor, never a ceiling) plus the
// pre-token protocols below the floor that the early radar exists to find. A protocol is pre-token
// when its record carries no token at all: no market cap, no CoinGecko id, no symbol. Live-token
// protocols are kept apart and shown with the market's own value, never mixed into the ranking.
//
// Implied value is one function of the snapshot's own figures, the same for every protocol:
//
//   implied = round( tvl_usd x categoryMultiple x growthMultiplier x maturityMultiplier x chainMultiplier )
//
//   categoryMultiple   what a dollar of TVL is worth as a future token depends on how the protocol
//                      earns: fee engines (DEXes, perps, lending) keep a cut of the flows that run
//                      through them, asset managers (curators, RWA, vaults) keep a small fee on the
//                      assets they hold, and infrastructure (chains, bridges) earns least directly
//                      from its TVL. The table is by category, never by name.
//   growthMultiplier   1 + clamp(change_7d, -50, 100) / 100 x 0.6. A protocol growing fast is worth
//                      more than one the same size that is shrinking; the clamp keeps one wild week
//                      from deciding the board.
//   maturityMultiplier 0.70 + 0.30 x min(age_days, 1095) / 1095. Age is the time since the protocol
//                      was first listed: how long it has run with no token. Older means a larger
//                      user base built without token incentives, and a longer record to trust.
//                      An unknown listing date uses 365 days.
//   chainMultiplier    1 + 0.04 x min(chain count, 5). A protocol live on several chains reaches
//                      more users and more integrations than one on a single chain.
//
// No protocol name is ever special-cased. The dashboard states the constants, shows the breakdown
// for every row, and its sandbox re-ranks the board when a constant changes.

/** One protocol as the sealed snapshot records it: exactly its ten fields. */
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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** Value captured per TVL dollar, by business model (see categoryMultiple). */
  fee_engine_multiple: number;
  asset_manager_multiple: number;
  infrastructure_multiple: number;
  default_multiple: number;
  /** Growth: the clamp on the seven-day change, and the weight it carries. */
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  /** Maturity: the floor and the range over the age window. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Chain breadth: the premium per chain, up to this many chains. */
  chain_premium: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  fee_engine_multiple: 0.32,
  asset_manager_multiple: 0.22,
  infrastructure_multiple: 0.18,
  default_multiple: 0.25,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.6,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_premium: 0.04,
  chain_cap: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
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
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Four decimals, for the breakdown the dashboard shows. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * What a dollar of this protocol's TVL is worth as a future token, by how the protocol earns.
 * Fee engines keep a cut of the flows through them, asset managers keep a small fee on what they
 * hold, infrastructure earns least directly from its TVL. By category, never by name.
 */
export function categoryMultiple(category: string | null, model: ModelConstants): number {
  const c = (category ?? '').toLowerCase();
  if (
    c.includes('dex') || c.includes('perpetual') || c.includes('derivative') ||
    c.includes('lending') || c.includes('leveraged farm') || c.includes('yield') ||
    c.includes('cdp') || c.includes('collateral') || c.includes('basis trad') ||
    c.includes('cedefi') || c.includes('payment') || c.includes('prediction')
  ) return model.fee_engine_multiple;
  if (
    c.includes('curator') || c.includes('allocator') || c.includes('rwa') ||
    c.includes('insurance') || c.includes('governance incentive') ||
    c.includes('stablecoin wrapper') || c.includes('staking pool') || c.includes('restak')
  ) return model.asset_manager_multiple;
  if (c.includes('chain') || c.includes('bridge')) return model.infrastructure_multiple;
  return model.default_multiple;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; categoryMult: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = protocol.chains.length;
  const chainMult = 1 + model.chain_premium * Math.min(Math.max(chainCount, 0), model.chain_cap);
  const categoryMult = categoryMultiple(protocol.category, model);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMult * growthMult * maturityMult * chainMult),
  );
  return { implied, categoryMult, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word, wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, and not a versioned pool. This mirrors
 * the house's watchlist rule, minus the TVL floor, from the snapshot's own fields.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. A chosen
  // protocol stays chosen; the early rows only add what the watchlist leaves out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMult,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The protocol's main farm action and a second, complementary one, by what the protocol does.
 * Both come from its category and its chains, never from its name.
 */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
      `Borrow $25 against the supply on ${name} and repay it the same week, so both sides of the market are used.`,
    ];
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
      `Swap $10 through the same pool once a week, so the position earns fees and the wallet trades.`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      `Bridge $25 back a week later, so the wallet has a round trip on record.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
      `Delegate a second, smaller stake to another validator through ${name} the following week.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
      `Place one limit order a week and let it fill or expire, so the wallet trades more than once.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and place one market position on ${name}.`,
      `Place a second position on a different market once the first one settles.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
      `Move $25 of the position into a second ${name} vault, so the wallet holds more than one vault.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      `Lend $25 of the stable asset in a lending market on ${chain} for a week.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
      `Check the yield accrual once a month and write the figure in the farm log.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
      `Read the policy's claim terms and write down what would trigger a payout.`,
    ];
  }
  if (c.includes('basis trad')) {
    return [
      `Deposit $${capital} into the ${name} basis vault on ${chain} and keep the shares.`,
      `Check the funding-rate accrual once a week and write the figure in the farm log.`,
    ];
  }
  if (c.includes('payment')) {
    return [
      `Route a $${capital} payment through ${name} on ${chain}.`,
      `Set up one recurring payment of $25 through ${name} for the following month.`,
    ];
  }
  if (c.includes('governance incentive')) {
    return [
      `Deposit $${capital} into ${name} on ${chain} and vote on one live proposal.`,
      `Delegate $25 of voting power to another voter through ${name} the following week.`,
    ];
  }
  if (c.includes('cedefi')) {
    return [
      `Deposit $${capital} into the ${name} vault on ${chain} and keep the shares.`,
      `Withdraw $25 as a test after a week, then deposit it back, so the wallet has a full cycle.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} to ${chain} and use the chain's flagship app through ${name}.`,
      `Stake $25 of the chain's native asset through ${name} and keep the receipt.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Use a second feature of ${name} the following week, such as a swap, a vote or a claim.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. The first step is always wallet hygiene, the last is always the log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [primary, secondary] = actionsFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: primary,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondary,
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    rows: board.map(radarRow),
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
