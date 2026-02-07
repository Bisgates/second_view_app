import { state } from './state.js';
import { chartEl, loading } from './dom.js';
import { fetchJSON } from './api.js';
import { getChart, renderChart } from './chart.js';
import { updateToolbar, updateStats } from './toolbar.js';

function getViewState() {
  const chart = getChart();
  if (!chart) return null;
  const timeScale = chart.timeScale();
  let centerTime = null;
  if (chartEl && chartEl.clientWidth > 0) {
    if (typeof timeScale.coordinateToLogical === 'function') {
      const logical = timeScale.coordinateToLogical(chartEl.clientWidth / 2);
      const candles = state.data && state.data.candles ? state.data.candles : null;
      const dataRes = state.data && Number.isFinite(state.data.resolution)
        ? state.data.resolution
        : state.resolution;
      if (Number.isFinite(logical) && candles && candles.length > 0 && Number.isFinite(dataRes)) {
        centerTime = candles[0].time + logical * dataRes;
      }
    }

    if (centerTime == null && typeof timeScale.coordinateToTime === 'function') {
      const timeAtCenter = timeScale.coordinateToTime(chartEl.clientWidth / 2);
      if (typeof timeAtCenter === 'number' && Number.isFinite(timeAtCenter)) {
        centerTime = timeAtCenter;
      }
    }
  }

  if (centerTime == null) {
    const range = timeScale.getVisibleRange();
    if (range) {
      centerTime = (range.from + range.to) / 2;
    }
  }

  if (centerTime == null || !Number.isFinite(centerTime)) return null;
  return { centerTime };
}

export async function loadChart() {
  if (!state.currentDate || !state.currentSymbol) return;
  loading.classList.remove('hidden');

  const viewState = getViewState();
  const savedCenter = viewState ? viewState.centerTime : null;

  const params = new URLSearchParams({
    session: state.session,
    resolution: state.resolution,
    use_clean: state.useClean,
  });
  if (state.spikeFilter) {
    params.set('spike_filter', 'hampel');
    params.set('spike_window', 3);
  }

  try {
    const data = await fetchJSON(`/api/price/${state.currentDate}/${state.currentSymbol}?${params}`);
    state.data = data;
    renderChart(data, savedCenter);
    updateToolbar(data);
    updateStats(data);
  } catch (e) {
    console.error('load error', e);
  } finally {
    loading.classList.add('hidden');
  }
}
