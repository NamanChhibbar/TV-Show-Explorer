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

// Shown when an actor has no photo in the API response.
const PLACEHOLDER_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 150">' +
      '<rect width="112" height="150" fill="#0a1c3a"/>' +
      '<circle cx="56" cy="58" r="22" fill="#1f3a68"/>' +
      '<path d="M18 150c0-24 17-40 38-40s38 16 38 40z" fill="#1f3a68"/>' +
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

  // Detail view
  detailLoading: document.getElementById('detail-loading'),
  detailError:   document.getElementById('detail-error'),
  detailBody:    document.getElementById('detail-body'),

  // Templates
  cardTemplate:   document.getElementById('show-card-template'),
  genreTemplate:  document.getElementById('genre-template'),
  detailTemplate: document.getElementById('detail-template'),
  castTemplate:   document.getElementById('cast-template'),
};

/** Placeholder used wherever the API has no value for a field. */
const EM_DASH = '\u2014';

// Lets a newer search cancel an older one that is still in flight, so a
// slow response can never overwrite the results of a later search.
let activeSearch = null;

// Same idea for the detail view: clicking a second card mid-load cancels
// the first request.
let activeDetail = null;

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

/**
 * Fetch one show plus its cast, seasons and episodes in a single request.
 * The embed[] parameters save three extra round trips.
 *
 * @param {string} showId
 * @param {AbortSignal} signal
 * @returns {Promise<Object>}
 */
async function fetchShowDetails(showId, signal) {
  const url = `${API_BASE}/shows/${encodeURIComponent(showId)}`
    + '?embed[]=cast&embed[]=seasons&embed[]=episodes';
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`TVMaze responded with ${response.status} ${response.statusText}`);
  }

  return response.json();
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

/** "2008-01-20" -> "January 20, 2008". Returns an em dash when absent. */
function formatDate(isoDate) {
  if (!isoDate) return EM_DASH;
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 60 -> "60 min". Em dash when the API has no runtime. */
function formatRuntime(show) {
  const minutes = show.runtime || show.averageRuntime;
  return typeof minutes === 'number' ? `${minutes} min` : EM_DASH;
}

/** { days: ["Sunday"], time: "22:00" } -> "Sundays at 22:00". */
function formatSchedule(show) {
  const schedule = show.schedule;
  if (!schedule) return EM_DASH;

  const days = schedule.days || [];
  const time = schedule.time || '';

  if (days.length === 0 && !time) return EM_DASH;
  if (days.length === 0) return time;

  const dayList = days.map((day) => `${day}s`).join(', ');
  return time ? `${dayList} at ${time}` : dayList;
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

  // Remember which show this card points at; read back on click.
  card.dataset.showId = show.id;

  // The whole card is the click target, so give it keyboard semantics.
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View details for ${show.name || 'this show'}`);

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

/* ---------- Detail view rendering ---------- */

/** Fill the genre bubble list inside `root` from `genres`. */
function fillGenres(root, genres) {
  const list = root.querySelector('.show-genres');
  for (const genre of genres || []) {
    const item = elements.genreTemplate.content.cloneNode(true);
    item.querySelector('.genre').textContent = genre;
    list.appendChild(item);
  }
}

/** Build the horizontally scrolling cast strip. */
function fillCast(root, cast) {
  const list = root.querySelector('.cast-list');

  if (!cast || cast.length === 0) {
    list.replaceWith(Object.assign(document.createElement('p'), {
      className: 'cast-empty',
      textContent: 'No cast information available.',
    }));
    return;
  }

  for (const credit of cast) {
    const item = elements.castTemplate.content.cloneNode(true);
    const person = credit.person || {};
    const character = credit.character || {};

    const photo = item.querySelector('.cast-photo');
    photo.src = (person.image && person.image.medium) || PLACEHOLDER_PHOTO;
    photo.alt = person.name ? `Photo of ${person.name}` : '';

    item.querySelector('.cast-name').textContent = person.name || 'Unknown';
    item.querySelector('.cast-character').textContent = character.name || '';

    list.appendChild(item);
  }
}

/**
 * Render a full show into the detail view.
 * @param {Object} show a TVMaze show with _embedded cast/seasons/episodes
 */
function renderShowDetails(show) {
  const fragment = elements.detailTemplate.content.cloneNode(true);
  const embedded = show._embedded || {};

  // Poster — the detail view uses the larger "original" image.
  const poster = fragment.querySelector('.detail-poster');
  poster.src = (show.image && (show.image.original || show.image.medium)) || PLACEHOLDER_POSTER;
  poster.alt = show.name ? `Poster for ${show.name}` : '';

  // Name, rating, genres
  fragment.querySelector('.detail-name').textContent = show.name || 'Untitled';
  fragment.querySelector('.rating-value').textContent = formatRating(show);
  fillGenres(fragment, show.genres);

  // Facts
  fragment.querySelector('.detail-network').textContent = getNetworkName(show) || EM_DASH;
  fragment.querySelector('.detail-premiered').textContent = formatDate(show.premiered);
  fragment.querySelector('.detail-ended').textContent = formatDate(show.ended);
  fragment.querySelector('.detail-status').textContent = show.status || EM_DASH;
  fragment.querySelector('.detail-runtime').textContent = formatRuntime(show);
  fragment.querySelector('.detail-schedule').textContent = formatSchedule(show);

  // Official site — greyed out and unclickable when the API has no URL.
  const siteButton = fragment.querySelector('.site-button');
  if (show.officialSite) {
    siteButton.href = show.officialSite;
  } else {
    siteButton.removeAttribute('href');
    siteButton.classList.add('disabled');
    siteButton.setAttribute('aria-disabled', 'true');
  }

  // Summary. TVMaze returns this as an HTML fragment (<p>, <b>, <i>), so it
  // goes in with innerHTML rather than textContent.
  const summary = fragment.querySelector('.detail-summary');
  summary.innerHTML = show.summary || '<p>No summary available.</p>';

  // Cast
  fillCast(fragment, embedded.cast);

  // Season / episode counts, straight from the embedded lists.
  const seasons = embedded.seasons || [];
  const episodes = embedded.episodes || [];
  fragment.querySelector('.stat-seasons').textContent = seasons.length;
  fragment.querySelector('.stat-episodes').textContent = episodes.length;

  elements.detailBody.replaceChildren(fragment);
}

/* ---------- Detail view status ---------- */

function clearDetailStatus() {
  elements.detailLoading.hidden = true;
  elements.detailError.hidden = true;
}

function showDetailLoading() {
  clearDetailStatus();
  elements.detailBody.replaceChildren();
  elements.detailLoading.hidden = false;
}

function showDetailError(message) {
  clearDetailStatus();
  elements.detailBody.replaceChildren();
  elements.detailError.textContent = message;
  elements.detailError.hidden = false;
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

/**
 * Open a show's detail page. Delegated from the results list, so cards
 * added later are covered without rebinding.
 * @param {Event} event
 */
async function handleCardClick(event) {
  const card = event.target.closest('.show-card');
  if (!card) return;

  const showId = card.dataset.showId;
  if (!showId) return;

  showDetailView();
  window.scrollTo({ top: 0 });

  if (activeDetail) {
    activeDetail.abort();
  }
  activeDetail = new AbortController();

  showDetailLoading();

  try {
    const show = await fetchShowDetails(showId, activeDetail.signal);
    clearDetailStatus();
    renderShowDetails(show);
  } catch (error) {
    if (error.name === 'AbortError') return;

    console.error('Could not load show details:', error);
    showDetailError('Could not load this show. Please try again.');
  }
}

/** Return to the results list from a show's detail page. */
function handleBack() {
  showHomeView();
  clearDetailStatus();
  elements.detailBody.replaceChildren();
}

/* ---------- Init ---------- */

function init() {
  elements.searchForm.addEventListener('submit', handleSearch);
  elements.backButton.addEventListener('click', handleBack);
  elements.resultsList.addEventListener('click', handleCardClick);

  // Cards are clickable, so make them reachable by keyboard too.
  elements.resultsList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.show-card');
    if (!card) return;
    event.preventDefault();
    handleCardClick(event);
  });

  showHomeView();
  clearHomeStatus();
  clearDetailStatus();
}

init();
