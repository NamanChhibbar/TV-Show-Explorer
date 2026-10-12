'use strict';

/* ===================================================================
   TV Show Explorer — application logic
   Plain JavaScript, no frameworks. All network calls use fetch()
   with async/await.
   =================================================================== */

/* ---------- Constants ---------- */

const API_BASE = 'https://api.tvmaze.com';

// Shown when a show has no poster in the API response.
const PLACEHOLDER_POSTER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 165">' +
      '<rect width="110" height="165" fill="#0a1c3a"/>' +
      '<text x="55" y="92" font-size="34" text-anchor="middle">&#127916;</text>' +
    '</svg>'
  );

/* ---------- Element references ---------- */

const elements = {
  // Shared chrome
  searchForm:    document.getElementById('search-form'),
  searchInput:   document.getElementById('search-input'),
  searchButton:  document.getElementById('search-button'),
  backButton:    document.getElementById('back-button'),
  formError:     document.getElementById('form-error'),

  // Views
  homeView:      document.getElementById('home-view'),
  detailView:    document.getElementById('detail-view'),

  // Home view status + results
  loading:       document.getElementById('loading'),
  error:         document.getElementById('error'),
  empty:         document.getElementById('empty'),
  resultsBox:    document.getElementById('results-container'),
  resultsCount:  document.getElementById('results-count'),
  resultsList:   document.getElementById('results-list'),

  // Templates
  cardTemplate:  document.getElementById('show-card-template'),
  genreTemplate: document.getElementById('genre-template'),
};

// Lets a newer search cancel an older one that is still in flight, so a
// slow response can never overwrite the results of a later search.
let activeSearch = null;

/* ---------- View switching ---------- */

/**
 * Show the home view (search results) and hide the detail view.
 * Both views must be toggled via the `hidden` attribute: each contains a
 * <main>, and the HTML spec only allows multiple <main> elements when all
 * but one are hidden.
 */
function showHomeView() {
  elements.homeView.hidden = false;
  elements.detailView.hidden = true;
}

/** Show the single-show detail view and hide the home view. */
function showDetailView() {
  elements.homeView.hidden = true;
  elements.detailView.hidden = false;
}

/* ---------- Status helpers ---------- */

/** Hide every home-view status message and the results container. */
function clearHomeStatus() {
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.empty.hidden = true;
  elements.resultsBox.hidden = true;
}

/** Drop the previous search's cards so stale ones never linger in the DOM. */
function clearResults() {
  elements.resultsList.replaceChildren();
  elements.resultsCount.textContent = '';
}

/** Show the spinner while a search is in flight. */
function showLoading() {
  clearHomeStatus();
  clearResults();
  elements.loading.hidden = false;
}

/** Show an error message in place of results. */
function showError(message) {
  clearHomeStatus();
  clearResults();
  elements.error.textContent = message;
  elements.error.hidden = false;
}

/** Show the "no matches" message. */
function showEmpty() {
  clearHomeStatus();
  clearResults();
  elements.empty.hidden = false;
}

/** Show a validation message under the search bar. */
function setFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = !message;
}

/* ---------- API ---------- */

/**
 * Search TVMaze for shows matching `query`.
 * Resolves to an array of show objects (the API wraps each one in
 * { score, show }, so we unwrap it here).
 *
 * @param {string} query
 * @param {AbortSignal} signal
 * @returns {Promise<Object[]>}
 */
async function searchShows(query, signal) {
  const url = `${API_BASE}/search/shows?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`TVMaze responded with ${response.status} ${response.statusText}`);
  }

  const results = await response.json();
  return results.map((result) => result.show);
}

/* ---------- Formatting helpers ---------- */

/** "HBO", "Netflix", or null when the API has neither. */
function getNetworkName(show) {
  if (show.network && show.network.name) return show.network.name;
  if (show.webChannel && show.webChannel.name) return show.webChannel.name;
  return null;
}

/** Premiere year, e.g. "2011". Returns null when unknown. */
function getPremiereYear(show) {
  if (!show.premiered) return null;
  return show.premiered.slice(0, 4);
}

/** Rating as a one-decimal string, or "N/A" when the show is unrated. */
function formatRating(show) {
  const average = show.rating && show.rating.average;
  return typeof average === 'number' ? average.toFixed(1) : 'N/A';
}

/* ---------- Rendering ---------- */

/**
 * Build one result card from the <template>.
 * @param {Object} show a TVMaze show object
 * @returns {DocumentFragment}
 */
function buildShowCard(show) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.show-card');

  // Remember which show this card points at, for the detail view later.
  card.dataset.showId = show.id;

  // Poster
  const poster = fragment.querySelector('.show-poster');
  poster.src = (show.image && show.image.medium) || PLACEHOLDER_POSTER;
  poster.alt = show.name ? `Poster for ${show.name}` : '';

  // Name + rating
  fragment.querySelector('.show-name').textContent = show.name || 'Untitled';
  fragment.querySelector('.rating-value').textContent = formatRating(show);

  // Genre bubbles
  const genreList = fragment.querySelector('.show-genres');
  const genres = show.genres || [];
  for (const genre of genres) {
    const genreItem = elements.genreTemplate.content.cloneNode(true);
    genreItem.querySelector('.genre').textContent = genre;
    genreList.appendChild(genreItem);
  }

  // Footer: network and premiere year, separated by a centre dot
  const network = getNetworkName(show);
  const year = getPremiereYear(show);
  fragment.querySelector('.show-network').textContent = network || 'Unknown network';
  fragment.querySelector('.show-date').textContent = year || 'N/A';

  // Status bubble: green while running, grey once ended
  const statusEl = fragment.querySelector('.show-status');
  const isRunning = show.status === 'Running';
  statusEl.textContent = show.status?.toUpperCase() || 'UNKNOWN';
  statusEl.classList.add(isRunning ? 'running' : 'ended');

  return fragment;
}

/**
 * Replace the results list with cards for `shows`.
 * @param {Object[]} shows
 * @param {string} query the search term, for the result count line
 */
function renderShows(shows, query) {
  // A DocumentFragment keeps this to a single reflow, however many cards.
  const batch = document.createDocumentFragment();
  for (const show of shows) {
    batch.appendChild(buildShowCard(show));
  }

  elements.resultsList.replaceChildren(batch);

  const plural = shows.length === 1 ? 'show' : 'shows';
  elements.resultsCount.textContent = `Found ${shows.length} ${plural} for "${query}"`;

  clearHomeStatus();
  elements.resultsBox.hidden = false;
}

/* ---------- Event handlers ---------- */

/**
 * Handle a search submission: return to the home view, validate the
 * query, call the API, and render whatever comes back.
 * @param {Event} event
 */
async function handleSearch(event) {
  event.preventDefault();

  // Always come back to the home view first — the user may be on a
  // show's detail page when they search again.
  showHomeView();

  const query = elements.searchInput.value.trim();
  if (!query) {
    setFormError('Please enter a show name to search for.');
    clearHomeStatus();
    elements.searchInput.focus();
    return;
  }
  setFormError('');

  // Cancel any search still in flight before starting a new one.
  if (activeSearch) {
    activeSearch.abort();
  }
  activeSearch = new AbortController();

  showLoading();
  elements.searchButton.disabled = true;

  try {
    const shows = await searchShows(query, activeSearch.signal);

    if (shows.length === 0) {
      showEmpty();
    } else {
      renderShows(shows, query);
    }
  } catch (error) {
    // An aborted request means a newer search took over; that newer
    // search owns the UI now, so leave it alone.
    if (error.name === 'AbortError') return;

    console.error('Search failed:', error);
    showError('Could not reach TVMaze. Please check your connection and try again.');
  } finally {
    elements.searchButton.disabled = false;
  }
}

/** Return to the results list from a show's detail page. */
function handleBack() {
  showHomeView();
}

/* ---------- Init ---------- */

function init() {
  elements.searchForm.addEventListener('submit', handleSearch);
  elements.backButton.addEventListener('click', handleBack);

  showHomeView();
  clearHomeStatus();
}

init();
