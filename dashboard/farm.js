// One source of truth: main.ts builds board.json farm_steps from this file,
// and dashboard/app.js renders the same steps in the detail view.
// Plain classic script (no ESM syntax): the dashboard must render from
// file://, where module imports are blocked, so this file exposes window.FARM
// in the browser and module.exports under Node.
// Placeholders: {N} protocol name, {C} main chain, {T} ticket USD,
// {T2} half ticket, {F} setup fee USD, {X} one-transaction gas USD,
// {H} hold days, {S} setup minutes. All costs are the builder's stated
// estimates (Nov 2026), not snapshot data. Never a promise of an airdrop:
// steps position a reader, they do not guarantee an allocation.

const KIND_TICKET = {
  vault: [350, 60],
  dex: [200, 45],
  lend: [500, 60],
  perps: [250, 30],
  rwa: [400, 60],
  general: [300, 60],
};

// Gas per transaction in USD, Nov 2026 builder estimates by chain.
const GAS_USD = {
  Ethereum: 6, Tron: 1.5, Avalanche: 0.3, Binance: 0.2,
  Solana: 0.05, Base: 0.05, Arbitrum: 0.1, Optimism: 0.1, Polygon: 0.05,
  'Hyperliquid L1': 0.1, Berachain: 0.1, Sonic: 0.05, Monad: 0.05, Sui: 0.05,
  Stellar: 0.01, Scroll: 0.05, Katana: 0.05, Ink: 0.05, Unichain: 0.05,
};

const VAULT_CATS = new Set(['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Liquidity Manager', 'Collateral Management', 'Leveraged Farming', 'Farm', 'Indexes', 'Staking Pool']);
const DEX_CATS = new Set(['Dexs', 'Cross Chain Bridge']);
const LEND_CATS = new Set(['Lending', 'Uncollateralized Lending', 'CDP Manager']);
const PERPS_CATS = new Set(['Derivatives', 'Basis Trading', 'Options', 'Interest Rate Derivatives']);
const RWA_CATS = new Set(['RWA', 'CDP', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Anchor BTC', 'Decentralized BTC']);

/** The farming kind a category belongs to. */
function kindOf(category) {
  if (VAULT_CATS.has(category)) return 'vault';
  if (DEX_CATS.has(category)) return 'dex';
  if (LEND_CATS.has(category)) return 'lend';
  if (PERPS_CATS.has(category)) return 'perps';
  if (RWA_CATS.has(category)) return 'rwa';
  return 'general';
}

/** Ticket, hold, setup fee and setup minutes for a category + main chain. */
function planFor(category, chain) {
  const kind = kindOf(category);
  const [ticket, hold] = KIND_TICKET[kind];
  const gas = GAS_USD[chain] ?? 1;
  const fee = Math.max(4, Math.round(6 * gas + 3));
  const setupMin = chain === 'Ethereum' ? 60 : chain === 'Solana' ? 30 : 45;
  return { kind, ticket, hold, fee, setupMin, tx: Math.max(1, Math.round(gas)) };
}

const STEPS = {
  vault: [
    "Deposit ${T} into {N}'s flagship vault on {C} — stablecoins if you want the balance steady — and confirm the vault address from the protocol's own docs first. Budget about ${F} in gas for the setup transactions and {S} minutes.",
    "Leave the deposit untouched for the full {H}-day hold. Vault points reward time-weighted balances, so an early withdrawal resets most of the credit; check the position once a week for about 5 minutes.",
    "In week 3, add a second deposit of about ${T2} in a different stablecoin, so the record shows two distinct deposits rather than one lump sum. Cost is one more deposit's gas, about ${X}.",
    "Use one adjacent feature once during the hold — restake or claim any rewards, or move a slice into a second vault — to show breadth beyond a single deposit. Allow 20 minutes and about ${X} in gas.",
    "Watch for a snapshot or points-claim announcement and claim only from the protocol's official domain, never from a link in a message. A missed claim window can mean losing the allocation, so check weekly after day {H}.",
  ],
  dex: [
    "Swap about ${T2} on {N} on {C} to open a trading record — pick the protocol's deepest pool so slippage stays low. Gas about ${X}; allow {S} minutes to verify the app address first.",
    "Provide liquidity of about ${T} to that pool and hold the position for the full {H}-day hold; points usually reward time-weighted liquidity, not a one-day deposit.",
    "Swap again once or twice a week with varied sizes for the rest of the hold, so the record shows repeated use instead of a single burst. Each swap costs about ${X} in gas.",
    "Try one extra feature the DEX offers — a limit order, a DCA order or a routed multi-hop swap — once during the hold. Allow 20 minutes; it is the kind of breadth points programs usually count.",
    "Watch for a snapshot or claim announcement and claim only from the protocol's official domain, never from a link in a message. Check weekly after day {H}; a missed window can lose the allocation.",
  ],
  lend: [
    "Supply about ${T} to {N} on {C} — start with a stablecoin to keep the collateral value steady — and verify the market address from the protocol's own docs. Gas about ${F}; allow {S} minutes.",
    "Borrow a small amount against the supply, keeping the health factor above 2, and hold both sides for the full {H}-day hold. Points reward supplied balances over time, not a single day.",
    "Repay part of the borrow in week 3 and supply again, so the record shows repeated activity rather than one parked position. Cost is about ${X} in gas per action.",
    "Try a second market or a second supplied asset once during the hold, with a small amount, to show breadth across the protocol. Allow 20 minutes.",
    "Watch for a snapshot or claim announcement and claim only from the protocol's official domain, never from a link in a message. Check weekly after day {H}; a missed window can lose the allocation.",
  ],
  perps: [
    "Open a small position of about ${T2} on {N} on {C} at low leverage (1–2x) and verify the market address from the protocol's own docs first. Gas about ${X}; allow {S} minutes.",
    "Trade again once a week in varied sizes for the {H}-day hold, keeping leverage low and margin well above liquidation. Points reward repeated volume over weeks, not one large trade.",
    "Provide liquidity to the protocol's vault or market-maker pool with about ${T2} if it offers one, and hold it for the rest of the hold. Allow 20 minutes and about ${X} in gas.",
    "Close losing positions early rather than letting them liquidate: a liquidation on record is worse than a small realised loss, and it ends the farming run. Keep a stop in mind before every trade.",
    "Watch for a snapshot or claim announcement and claim only from the protocol's official domain, never from a link in a message. Check weekly after day {H}; a missed window can lose the allocation.",
  ],
  rwa: [
    "Mint or buy about ${T} of {N}'s asset on {C}, verifying the contract from the protocol's own docs first. Gas about ${F}; allow {S} minutes for the checks.",
    "Hold the position for the full {H}-day hold with the collateral ratio comfortably above the minimum — RWA and CDP points reward a live, healthy position, not a parked one.",
    "Use the product a second time in week 3 — a top-up mint, a partial redeem, or a second asset — so the record shows repeated use. Cost is about ${X} in gas.",
    "Keep the collateral ratio monitored weekly (5 minutes a week); top it up before it drifts near liquidation, especially if the underlying price moves.",
    "Watch for a snapshot or claim announcement and claim only from the protocol's official domain, never from a link in a message. Check weekly after day {H}; a missed window can lose the allocation.",
  ],
  general: [
    "Use {N} on {C} with about ${T} — its core action, done through the protocol's own app after verifying the address from its docs. Gas about ${F}; allow {S} minutes.",
    "Repeat the core action once a week in varied sizes for the full {H}-day hold, so the record shows steady use over weeks instead of a single burst.",
    "Try a second feature of the protocol once during the hold — a different market, asset or action — with a small amount, to show breadth. Allow 20 minutes and about ${X} in gas.",
    "Keep a simple log of every transaction and date; if an allocation is ever disputed, that log is the evidence. Five minutes a week is enough.",
    "Watch for a snapshot or claim announcement and claim only from the protocol's official domain, never from a link in a message. Check weekly after day {H}; a missed window can lose the allocation.",
  ],
};

/** The 5 costed farm steps for one protocol. */
function farmSteps(name, category, chain) {
  const plan = planFor(category, chain);
  const fill = (s) => s
    .replaceAll('{N}', name).replaceAll('{C}', chain)
    .replaceAll('{T}', String(plan.ticket)).replaceAll('{T2}', String(Math.round(plan.ticket / 2)))
    .replaceAll('{F}', String(plan.fee)).replaceAll('{X}', String(plan.tx))
    .replaceAll('{H}', String(plan.hold)).replaceAll('{S}', String(plan.setupMin));
  return STEPS[plan.kind].map(fill);
}

const FARM_API = { kindOf, planFor, farmSteps, KIND_TICKET, GAS_USD };
if (typeof window !== 'undefined') window.FARM = FARM_API;
if (typeof module !== 'undefined' && module.exports) module.exports = FARM_API;
