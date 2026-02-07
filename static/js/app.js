import { fetchJSON } from './api.js';
import { state } from './state.js';
import { renderSidebar, selectDate } from './sidebar.js';
import { initControls } from './controls.js';
import { initRangeSelection } from './range.js';
import { updateClock } from './clock.js';

async function initApp() {
  updateClock();
  setInterval(updateClock, 1000);
  try {
    const resp = await fetchJSON('/api/dates');
    state.dates = resp.dates;
    const dateKeys = Object.keys(state.dates).sort().reverse();
    if (dateKeys.length === 0) return;
    renderSidebar(dateKeys);
    selectDate(dateKeys[0]);
  } catch (e) {
    console.error('init error', e);
  }
}

initControls();
initRangeSelection();
initApp();
