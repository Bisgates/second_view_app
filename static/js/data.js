import { state } from './state.js';
import { loading } from './dom.js';
import { fetchJSON } from './api.js';
import { getChart, renderChart } from './chart.js';
import { updateToolbar, updateStats } from './toolbar.js';

export async function loadChart() {
  if (!state.currentDate || !state.currentSymbol) return;
  loading.classList.remove('hidden');

  let savedCenter = null;
  let savedHalfSpan = null;
  const chart = getChart();
  if (chart) {
    const range = chart.timeScale().getVisibleRange();
    if (range) {
      savedCenter = (range.from + range.to) / 2;
      savedHalfSpan = (range.to - range.from) / 2;
    }
  }

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
    renderChart(data, savedCenter, savedHalfSpan);
    updateToolbar(data);
    updateStats(data);
  } catch (e) {
    console.error('load error', e);
  } finally {
    loading.classList.add('hidden');
  }
}
