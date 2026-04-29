import { state } from './state.js';
import {
  eventDetailPanel,
  eventDetailClose,
  eventDetailSymbol,
  eventDetailMeta,
  eventDetailReturn,
  eventDetailExit,
  eventDetailHold,
  eventDetailMfe,
  eventDetailMae,
  eventDetailEvents,
  eventDetailFallbackSection,
  eventDetailFallbackMsg,
  eventDetailRaw,
} from './dom.js';

const EMPTY = '—';

function escapeHTML(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSignedPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return EMPTY;
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(digits)}%`;
}

function formatMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return EMPTY;
  return `${num.toFixed(1)}m`;
}

function formatEventPart(value, formatter) {
  if (value == null) return '-';
  const formatted = formatter ? formatter(value) : String(value);
  return formatted === EMPTY ? '-' : formatted;
}

function classifyValue(el, rawValue) {
  el.classList.remove('up', 'down');
  const num = Number(rawValue);
  if (!Number.isFinite(num)) return;
  if (num > 0) el.classList.add('up');
  if (num < 0) el.classList.add('down');
}

function renderField(el, text, rawValue = null) {
  el.textContent = text || EMPTY;
  classifyValue(el, rawValue);
}

function parseJSONNote(note) {
  if (!note || typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function parseLegacyPipeNote(note) {
  if (!note || typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (!trimmed) return null;

  const result = {
    return_pct: null,
    exit: null,
    hold_minutes: null,
    mfe_pct: null,
    mae_pct: null,
    events: [],
  };

  let matched = false;
  const segments = trimmed.split('|').map(part => part.trim()).filter(Boolean);
  segments.forEach(segment => {
    let m = segment.match(/^strat\s+([+-]?\d+(?:\.\d+)?)%$/i);
    if (m) {
      result.return_pct = Number(m[1]);
      matched = true;
      return;
    }
    m = segment.match(/^return\s+([+-]?\d+(?:\.\d+)?)%$/i);
    if (m) {
      result.return_pct = Number(m[1]);
      matched = true;
      return;
    }
    m = segment.match(/^exit\s+(.+)$/i);
    if (m) {
      result.exit = m[1].trim();
      matched = true;
      return;
    }
    m = segment.match(/^hold\s+([+-]?\d+(?:\.\d+)?)m$/i);
    if (m) {
      result.hold_minutes = Number(m[1]);
      matched = true;
      return;
    }
    m = segment.match(/^mfe\s+([+-]?\d+(?:\.\d+)?)%$/i);
    if (m) {
      result.mfe_pct = Number(m[1]);
      matched = true;
      return;
    }
    m = segment.match(/^mae\s+([+-]?\d+(?:\.\d+)?)%$/i);
    if (m) {
      result.mae_pct = Number(m[1]);
      matched = true;
      return;
    }
    m = segment.match(/^events\s+(.+)$/i);
    if (m) {
      const items = m[1].split(',').map(part => part.trim()).filter(Boolean);
      result.events = items.map(item => ({ raw: item }));
      matched = true;
    }
  });

  return matched ? result : null;
}

function parseNote(note) {
  const jsonParsed = parseJSONNote(note);
  if (jsonParsed) {
    return {
      parsed: jsonParsed,
      legacyRaw: '',
      fallbackMsg: '',
    };
  }

  const legacyParsed = parseLegacyPipeNote(note);
  if (legacyParsed) {
    return {
      parsed: legacyParsed,
      legacyRaw: note || '',
      fallbackMsg: '',
    };
  }

  return {
    parsed: null,
    legacyRaw: (note || '').trim(),
    fallbackMsg: (note || '').trim() ? '原始 note' : '',
  };
}

function formatSizePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(2)}`.replace(/\.00$/, '') + '%';
}

function formatSourceShort(value) {
  const clean = String(value || '').trim();
  return clean || '-';
}

function renderEvents(events) {
  eventDetailEvents.innerHTML = '';
  if (!Array.isArray(events) || events.length === 0) {
    eventDetailEvents.innerHTML = '<div class="event-detail-empty">无连续加仓信息</div>';
    return;
  }

  events.forEach((event, idx) => {
    const row = document.createElement('div');
    row.className = 'event-detail-event-row';

    if (event && typeof event === 'object' && !Array.isArray(event) && event.raw) {
      row.innerHTML = `
        <div class="event-detail-event-main">${escapeHTML(String(event.raw))}</div>
        <div class="event-detail-event-sub">Legacy event ${idx + 1}</div>
      `;
      eventDetailEvents.appendChild(row);
      return;
    }

    const sizePct = event && typeof event === 'object' ? event.size_pct : null;
    const source = event && typeof event === 'object' ? event.source : null;
    const gapMinutes = event && typeof event === 'object' ? event.gap_minutes : null;
    const priceChangePct = event && typeof event === 'object' ? event.price_change_pct : null;
    const mainText = `${formatSizePercent(sizePct)}${formatSourceShort(source)}`;
    const subText = `${formatEventPart(gapMinutes, value => `${Number(value).toFixed(1)}m`)} ${formatEventPart(priceChangePct, value => formatSignedPercent(value, 2))}`;

    row.innerHTML = `
      <div class="event-detail-event-main">${escapeHTML(mainText)}</div>
      <div class="event-detail-event-sub">${escapeHTML(subText)}</div>
    `;
    eventDetailEvents.appendChild(row);
  });
}

function renderFallback(rawNote, fallbackMsg) {
  const raw = (rawNote || '').trim();
  const show = Boolean(fallbackMsg && raw);
  eventDetailFallbackSection.classList.toggle('hidden', !show);
  eventDetailFallbackMsg.textContent = fallbackMsg || '';
  eventDetailRaw.textContent = show ? raw : '';
}

export function renderEventDetail() {
  const event = state.activeEvent;
  const shouldShow = Boolean(state.eventDetailOpen && event);
  eventDetailPanel.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) return;

  const detail = parseNote(event.notes || '');
  const parsed = detail.parsed || {};
  const eventDate = event.anchor_marker_date_et || event.event_date_et || '';
  const eventTime = event.anchor_marker_time_et || event.event_time_et || event.time || '';

  eventDetailSymbol.textContent = event.symbol || '-';
  eventDetailMeta.textContent = `${eventDate || event.date || '-'} ${eventTime || '-'}\n${state.currentEventList || ''}`.trim();

  renderField(eventDetailReturn, formatSignedPercent(parsed.return_pct, 2), parsed.return_pct);
  renderField(eventDetailExit, parsed.exit || EMPTY);
  renderField(eventDetailHold, formatMinutes(parsed.hold_minutes), null);
  renderField(eventDetailMfe, formatSignedPercent(parsed.mfe_pct, 2), parsed.mfe_pct);
  renderField(eventDetailMae, formatSignedPercent(parsed.mae_pct, 2), parsed.mae_pct);
  renderEvents(parsed.events);
  renderFallback(detail.legacyRaw, detail.fallbackMsg);
}

export function closeEventDetail() {
  state.eventDetailOpen = false;
  renderEventDetail();
}

export function openEventDetail() {
  state.eventDetailOpen = true;
  renderEventDetail();
}

export function initEventDetail() {
  if (!eventDetailClose) return;
  eventDetailClose.addEventListener('click', () => {
    closeEventDetail();
  });
  renderEventDetail();
}
