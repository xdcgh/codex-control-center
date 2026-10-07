import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fields = ['input', 'cached', 'write', 'output'];
export function validatePricing(policy) {
  if (policy?.schemaVersion !== 1 || typeof policy.id !== 'string' || !Number.isFinite(Date.parse(policy.retrievedAt)) || !Array.isArray(policy.rows)) throw new Error('invalid-pricing-schema');
  const seen = new Set();
  for (const row of policy.rows) {
    const key = `${row.provider}/${row.model}/${row.tier}`;
    if (seen.has(key) || typeof row.model !== 'string' || !row.model || typeof row.provider !== 'string' || !row.provider || typeof row.tier !== 'string' || !row.tier || !Number.isSafeInteger(row.threshold) || row.threshold < 0) throw new Error('invalid-pricing-row');
    seen.add(key);
    for (const rates of [row.short, row.long]) if (rates != null && (typeof rates!=='object' || Array.isArray(rates) || fields.some(f => rates[f] != null && (!Number.isFinite(rates[f]) || rates[f] < 0)))) throw new Error('invalid-pricing-rate');
    if (!row.short || typeof row.source !== 'string' || !/^https:\/\/(developers|platform)\.openai\.com\//.test(row.source)) throw new Error('invalid-pricing-source');
  }
  return policy;
}

export class PricingPolicy {
  constructor({ store, policy = JSON.parse(fs.readFileSync(new URL('../../pricing.json', import.meta.url), 'utf8')) } = {}) {
    this.store = store; this.policy = validatePricing(policy); this.save(policy);
  }
  save(policy) {
    validatePricing(policy);
    if (this.store) this.store.db.prepare('INSERT OR IGNORE INTO pricing_snapshots VALUES(?,?)').run(policy.id, JSON.stringify(policy));
  }
  snapshots() { return this.store ? this.store.db.prepare('SELECT metadata_json FROM pricing_snapshots').all().map(r => JSON.parse(r.metadata_json)) : [this.policy]; }
  manualOverride(policy, { confirmed = false } = {}) {
    if (!confirmed) throw new Error('pricing-manual-confirmation-required');
    validatePricing(policy);
    if (this.snapshots().some(p => p.id === policy.id)) throw new Error('pricing-snapshot-id-exists');
    this.save(policy); this.policy = policy;
  }
  estimate(event) {
    const unavailable = reason => ({ status: 'Unavailable', reason, usd: null, label: 'API-equivalent estimate; not a subscription bill' });
    const timestamp = event.timestamp;
    const policy = this.snapshots().reverse().filter(p => Date.parse(p.effectiveFrom ?? p.retrievedAt) <= timestamp).sort((a,b) => Date.parse(b.effectiveFrom ?? b.retrievedAt)-Date.parse(a.effectiveFrom ?? a.retrievedAt))[0];
    if (!policy) return unavailable('historical-price-not-established');
    if (!event.provider) return unavailable('provider-missing');
    if (!event.serviceTier) return unavailable('processing-tier-missing');
    const tier = event.serviceTier === 'priority' ? 'fast' : event.serviceTier;
    const row = policy.rows.find(r => r.model === event.model && r.provider === event.provider && r.tier === tier);
    if (!row) return unavailable('model-provider-tier-price-missing');
    if (event.scope !== 'response' && event.scope !== 'latest-sample') return unavailable('individual-request-input-unavailable');
    const u = event.usage;
    if (!Number.isSafeInteger(u?.input_tokens) || !Number.isSafeInteger(u?.output_tokens)) return unavailable('request-token-fields-missing');
    const long = u.input_tokens > row.threshold, rates = long ? row.long : row.short;
    if (!rates) return unavailable('context-price-missing');
    if (u.cached_input_tokens == null || u.cache_write_input_tokens == null) return { ...unavailable('cache-category-counts-missing'), status: 'Partial', snapshotId: policy.id, context: long ? 'long' : 'short' };
    const cached = u.cached_input_tokens, write = u.cache_write_input_tokens, input = u.input_tokens-cached-write;
    if ([input,cached,write,u.output_tokens].some(n => !Number.isSafeInteger(n) || n < 0) || (u.reasoning_output_tokens != null && u.reasoning_output_tokens > u.output_tokens) || (u.total_tokens != null && u.total_tokens !== u.input_tokens+u.output_tokens)) return unavailable('inconsistent-token-categories');
    if (fields.some(f => rates[f] == null)) return unavailable('rate-missing');
    if (event.region || event.fedramp) return unavailable('regional-adjustment-not-established');
    return { status: event.scope === 'latest-sample' ? 'Partial' : 'Estimated', reason: event.scope === 'latest-sample' ? 'latest-sample-only-coverage' : null, usd: (input*rates.input+cached*rates.cached+write*rates.write+u.output_tokens*rates.output)/1e6, snapshotId: policy.id, context: long ? 'long' : 'short', label: 'API-equivalent estimate; not a subscription bill' };
  }
  async checkOfficialUpdate({ fetchImpl = fetch, source = 'https://developers.openai.com/api/docs/pricing.md' } = {}) {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !['developers.openai.com','platform.openai.com'].includes(url.hostname)) throw new Error('official-source-required');
    const response = await fetchImpl(url, { redirect: 'error' });
    if (!response.ok) throw new Error('pricing-source-fetch-failed');
    const body = await response.text();
    if (body.length > 2000000) throw new Error('pricing-source-too-large');
    const hash = digest(body), key = `observability:pricing-source:${url.href}`, old = this.store?.getSetting(key);
    this.store?.setSetting(key, hash);
    return { source: url.href, digest: hash, changed: old != null && old !== hash, baseline: old == null, requiresManualConfirmation: true, pricesModified: false };
  }
}
