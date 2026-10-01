const { SUPPORTED_VS } = require('./mockData');

const COIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALID_DAYS = [1, 7, 30, 90];
const MAX_IDS = 25;

class ValidationError extends Error {}

function parseCurrency(value, fallback = 'usd') {
  if (value === undefined) return fallback;
  const vs = String(value).toLowerCase();
  if (!SUPPORTED_VS.includes(vs)) throw new ValidationError(`vs must be one of: ${SUPPORTED_VS.join(', ')}`);
  return vs;
}

function parseCoinId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!COIN_ID.test(id)) throw new ValidationError('Invalid asset id');
  return id;
}

function parseIds(value) {
  if (value === undefined || value === '') return undefined;
  const ids = String(value).split(',').map(parseCoinId);
  if (ids.length > MAX_IDS) throw new ValidationError(`At most ${MAX_IDS} ids per request`);
  return [...new Set(ids)];
}

function parseDays(value, fallback = 7) {
  if (value === undefined) return fallback;
  const days = Number(value);
  if (!VALID_DAYS.includes(days)) throw new ValidationError(`days must be one of: ${VALID_DAYS.join(', ')}`);
  return days;
}

function parseNote(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 200) throw new ValidationError('note must be a string of at most 200 characters');
  return value.trim();
}

function parseTargetPrice(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ValidationError('targetPrice must be a positive number or null');
  return value;
}

function parseThreshold(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.1 || value > 100) {
    throw new ValidationError('volatilityAlertPct must be a number between 0.1 and 100');
  }
  return Math.round(value * 100) / 100;
}

module.exports = { ValidationError, parseCurrency, parseCoinId, parseIds, parseDays, parseNote, parseTargetPrice, parseThreshold, VALID_DAYS };
