import {
  STORAGE_KEY, createState, questionMap, rangeIds, mistakeIds, startSession,
  chooseAnswer, checkAnswer, summarize, finishSession, progress, validateState,
} from './src/engine.js';

const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const fileInput = document.querySelector('#import-file');
const notice = document.querySelector('#notice');
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icons = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  book: '<path d="M4 5c3-1 5-.5 8 1.5C15 4.5 17 4 20 5v14c-3-1-5-.5-8 1.5C9 18.5 7 18 4 19zM12 6.5v14"/>',
  exam: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6m-6 4h6m-6 4h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  chart: '<path d="M5 20V10m7 10V4m7 16v-7M3 20h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const modeNames = { learn: 'Обучение', exam: 'Экзамен', mistakes: 'Повторение ошибок' };
let bank;
let questions;
let state;
let currentView = 'home';
let selectedMode = 'learn';
let range = { from: 1, to: 400 };
let showAllReview = false;
let modalResolve;
let toastTimer;

function warn(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    warn('Браузер не разрешает сохранить прогресс. Заниматься можно, но перед закрытием страницы сохраните данные в файл через кнопку настроек.');
    return false;
  }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const element = document.createElement('div');
  element.className = 'toast';
  element.role = 'status';
  element.textContent = message;
  document.body.append(element);
  toastTimer = setTimeout(() => element.remove(), 4500);
}

function navigate(view, focus = true) {
  currentView = view;
  const hash = view === 'home' ? '' : `#${view}`;
  if (location.hash !== hash) history.pushState(null, '', `${location.pathname}${location.search}${hash}`);
  render();
  if (focus) {
    window.scrollTo(0, 0);
    (document.querySelector('#question-text') || main).focus({ preventScroll: true });
  }
}

function render() {
  if (!state) return;
  main.className = `main${currentView === 'session' ? ' session-page' : ''}`;
  if (currentView === 'session' && state.session && !state.session.finishedAt) renderSession();
  else if (currentView === 'result' && state.session?.finishedAt) renderResult();
  else {
    currentView = 'home';
    main.className = 'main';
    renderHome();
  }
}

function renderHome() {
  const p = progress(state);
  const session = state.session;
  const active = session && !session.finishedAt;
  const sessionAnswered = active ? summarize(session, bank).answered : 0;
  const percentage = Math.round(p.completed / bank.questions.length * 100);
  const last = state.lastResult;
  main.innerHTML = `
    <div class="dashboard-grid">
      ${active ? `<section class="resume-card" aria-label="Сохранённое занятие"><span class="mini-icon">${icon('book')}</span><div class="resume-copy"><h2>Продолжим с вопроса №${session.ids[session.index]}?</h2><p>${modeNames[session.mode]} · выполнено ${sessionAnswered} из ${session.ids.length}</p></div><button class="button small" data-action="resume">Продолжить ${icon('arrow')}</button></section>` : ''}
      <div class="stack">
        <section class="card hero"><div class="eyebrow">400 вопросов · одна цель</div><h1>Подготовка<br>в своём темпе.</h1><p>Поликлиническая терапия. Проходите вопросы последовательно и возвращайтесь к тому, что требует внимания.</p><div class="order-tag">${icon('check')} В порядке исходного PDF</div></section>
        <section class="card" aria-labelledby="start-heading"><h2 class="section-title" id="start-heading">Начнём занятие</h2><p class="section-intro">Выберите режим и удобный объём на сегодня.</p>
          <div class="mode-tabs" role="group" aria-label="Режим занятия"><button class="mode-tab" aria-pressed="${selectedMode === 'learn'}" data-action="mode" data-mode="learn">${icon('book')} Обучение</button><button class="mode-tab" aria-pressed="${selectedMode === 'exam'}" data-action="mode" data-mode="exam">${icon('exam')} Экзамен</button></div>
          <p class="mode-description" id="mode-description">${selectedMode === 'learn' ? 'Проверяйте себя после каждого вопроса. Верный ответ появится сразу после проверки.' : 'Отвечайте самостоятельно. Оценка и правильные ответы появятся после завершения.'}</p>
          <span class="range-label" id="range-heading">Какие вопросы пройти?</span><div class="range-fields" role="group" aria-labelledby="range-heading"><div class="range-field"><label for="range-from">С вопроса</label><input id="range-from" type="number" min="1" max="400" step="1" inputmode="numeric" value="${range.from}" aria-describedby="range-error"></div><span class="range-separator" aria-hidden="true">—</span><div class="range-field"><label for="range-to">По вопрос</label><input id="range-to" type="number" min="1" max="400" step="1" inputmode="numeric" value="${range.to}" aria-describedby="range-error"></div></div>
          <div class="presets" role="group" aria-label="Количество вопросов">${[20, 40, 50, 100, 400].map(count => `<button class="preset${range.to - range.from + 1 === count ? ' active' : ''}" data-action="preset" data-count="${count}">${count === 400 ? 'Все 400' : count}</button>`).join('')}</div>
          <p class="range-error" id="range-error" role="alert" hidden></p><p class="range-summary" id="range-summary"></p><button class="button full" data-action="start">${selectedMode === 'learn' ? 'Начать обучение' : 'Начать экзамен'} ${icon('arrow')}</button>
        </section>
      </div>
      <div class="stack">
        <section class="card dashboard-progress" aria-labelledby="progress-heading"><div class="progress-heading"><h2 class="section-title" id="progress-heading">Ваш прогресс</h2><span class="mini-icon">${icon('chart')}</span></div><div class="coverage"><strong>${p.completed}</strong><span>/ 400</span></div><p class="coverage-caption">вопросов пройдено · ${percentage}% от всего набора</p><div class="progress-track" role="progressbar" aria-label="Пройденные вопросы" aria-valuenow="${p.completed}" aria-valuemin="0" aria-valuemax="400"><div class="progress-fill" style="width:${percentage}%"></div></div><div class="stat-rows"><div class="stat-row"><span><i class="dot green"></i> Верно в последний раз</span><strong>${p.correct}</strong></div><div class="stat-row"><span><i class="dot red"></i> Требуют повторения</span><strong>${p.mistakes}</strong></div><div class="stat-row"><span><i class="dot gray"></i> Всего попыток ответа</span><strong>${p.attempts}</strong></div></div><hr class="card-divider"><p class="small-copy">Прогресс сохраняется в этом браузере автоматически. Можно закрыть страницу и вернуться позже.</p>${last ? `<p class="last-result">Последнее занятие: ${last.correct} из ${last.total} верно · ${last.percent}%</p>` : ''}</section>
        <section class="card mistake-card"><span class="mini-icon">${icon('refresh')}</span><h2 class="section-title">Сложное станет знакомым</h2><p>${p.mistakes ? `Сейчас повторения требуют ${p.mistakes} из пройденных вопросов. Они будут идти по исходным номерам.` : 'Вопросы с ошибками соберутся здесь. Правильный ответ при повторении уберёт вопрос из этого списка.'}</p><button class="button secondary full" data-action="mistakes" ${p.mistakes ? '' : 'disabled'}>${icon('refresh')} Повторить ошибки${p.mistakes ? ` · ${p.mistakes}` : ''}</button></section>
        <p class="small-copy" style="padding:0 6px">Вопросы и варианты ответов всегда остаются в исходном порядке.</p>
      </div>
    </div>`;
  updateRange();
}

function updateRange() {
  const from = document.querySelector('#range-from');
  const to = document.querySelector('#range-to');
  if (!from || !to) return;
  range = { from: Number(from.value), to: Number(to.value) };
  let error = '';
  try { rangeIds(range.from, range.to, bank); } catch (reason) { error = reason.message; }
  const errorElement = document.querySelector('#range-error');
  errorElement.hidden = !error;
  errorElement.textContent = error;
  from.setAttribute('aria-invalid', String(Boolean(error)));
  to.setAttribute('aria-invalid', String(Boolean(error)));
  document.querySelector('[data-action="start"]').disabled = Boolean(error);
  document.querySelector('#range-summary').textContent = error ? ' ' : `${range.to - range.from + 1} вопросов · №${range.from}–${range.to} · без ограничения времени`;
  document.querySelectorAll('[data-action="preset"]').forEach(button => button.classList.toggle('active', Number(button.dataset.count) === range.to - range.from + 1));
}

function renderSession() {
  const session = state.session;
  const id = session.ids[session.index];
  const question = questions.get(id);
  const answer = session.answers[id];
  const checked = answer?.checked;
  const exam = session.mode === 'exam';
  const correct = checked && answer.label === question.answer;
  const summary = summarize(session, bank);
  const last = session.index === session.ids.length - 1;
  const buttonText = exam ? (last ? 'Завершить экзамен' : answer ? 'Далее' : 'Пропустить') : checked ? (last ? 'К результату' : 'Следующий вопрос') : 'Проверить ответ';
  main.innerHTML = `
    <div class="session-toolbar"><button class="back-button" data-action="home">${icon('back')} На главную</button><div class="session-title"><span class="eyebrow">${modeNames[session.mode]}</span><span class="session-title-text">№${session.ids[0]}–${session.ids.at(-1)}</span></div><button class="button secondary small" data-action="finish">Завершить</button></div>
    <div class="mobile-progress" role="progressbar" aria-label="Выполненные вопросы занятия" aria-valuenow="${summary.answered}" aria-valuemin="0" aria-valuemax="${summary.total}"><div style="width:${summary.answered / summary.total * 100}%"></div></div>
    <div class="session-grid"><section class="card question-card" aria-labelledby="question-text"><div class="question-heading"><span class="question-number">ВОПРОС №${id}</span><span class="question-position">${session.index + 1} из ${session.ids.length} в занятии</span></div><h1 class="question-text" id="question-text" tabindex="-1">${escape(question.text)}</h1><p class="single-answer-note">Выберите один вариант ответа</p><fieldset class="options"><legend class="sr-only">Варианты ответа на вопрос ${id}</legend>${question.options.map(option => {
      const selected = answer?.label === option.label;
      const isRight = checked && option.label === question.answer;
      const isWrong = checked && selected && !correct;
      return `<label class="option${selected ? ' selected' : ''}${isRight ? ' correct' : ''}${isWrong ? ' incorrect' : ''}${checked ? ' locked' : ''}"><input type="radio" name="answer" data-option="${option.label}" value="${option.label}" ${selected ? 'checked' : ''} ${checked ? 'disabled' : ''}><span class="option-letter" aria-hidden="true">${option.label.toUpperCase()}</span><span class="option-text"><span class="sr-only">${option.label}) </span>${escape(option.text)}${isRight ? '<span class="sr-only"> — правильный ответ</span>' : ''}${isWrong ? '<span class="sr-only"> — ваш неверный ответ</span>' : ''}</span>${isRight || isWrong ? `<span class="option-mark" aria-hidden="true">${isRight ? '✓' : '×'}</span>` : ''}</label>`;
    }).join('')}</fieldset>
      ${checked ? `<section class="feedback${correct ? '' : ' wrong'}" role="status"><strong>${correct ? 'Всё верно' : 'Этот ответ неверный'}</strong><p>${correct ? 'Можно переходить к следующему вопросу.' : `Правильный ответ: <b>${question.answer.toUpperCase()})</b> ${escape(question.options.find(option => option.label === question.answer).text)}`}</p></section>` : !exam ? '<button class="text-button" data-action="skip">Пропустить вопрос</button>' : ''}
    </section><aside class="session-side"><section class="card"><h2>Ваше занятие</h2><p class="section-intro">${modeNames[session.mode]} · по порядку</p><div class="coverage"><strong>${summary.answered}</strong><span>/ ${summary.total}</span></div><p class="coverage-caption">${exam ? 'ответов выбрано' : 'вопросов проверено'}</p><div class="progress-track"><div class="progress-fill" style="width:${summary.answered / summary.total * 100}%"></div></div>${!exam ? `<div class="stat-rows"><div class="stat-row"><span><i class="dot green"></i> Верно</span><strong>${summary.correct}</strong></div><div class="stat-row"><span><i class="dot red"></i> С ошибкой</span><strong>${summary.wrong}</strong></div></div>` : '<p class="small-copy">Результат и правильные ответы появятся после завершения экзамена.</p>'}<button class="button secondary question-nav-link" data-action="question-nav">${icon('grid')} Все вопросы</button></section><p class="status-hint">${icon('lock')} Место остановки и ответы сохраняются автоматически.</p></aside></div>
    <div class="session-controls"><button class="button secondary" data-action="previous" ${session.index ? '' : 'disabled'}>${icon('back')} Назад</button><button class="button secondary nav-mobile" data-action="question-nav" aria-label="Навигация по вопросам">${icon('grid')}</button><button class="button" data-action="primary" ${!exam && !checked && !answer ? 'disabled' : ''}>${buttonText} ${icon(!exam && !checked ? 'check' : 'arrow')}</button></div>`;
}

function renderResult() {
  const session = state.session;
  const result = summarize(session, bank);
  const toReview = showAllReview ? session.ids : result.mistakeIds;
  const minutes = Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000));
  main.innerHTML = `<div class="result-wrap"><div class="session-toolbar"><button class="back-button" data-action="home">${icon('back')} На главную</button><span class="eyebrow">${modeNames[session.mode]}</span></div><section class="card result-hero"><div class="result-symbol">${icon(result.percent === 100 ? 'check' : 'book')}</div><h1>${result.percent === 100 ? 'Отличная работа!' : 'Ещё один шаг вперёд'}</h1><p class="section-intro">Вопросы №${session.ids[0]}–${session.ids.at(-1)} · ${session.ids.length} в занятии · ${minutes} мин</p><div class="result-score">${result.percent}% <span>верно</span></div><div class="result-stats"><div class="result-stat"><strong style="color:var(--green)">${result.correct}</strong><span>верных ответов</span></div><div class="result-stat"><strong style="color:var(--red)">${result.wrong}</strong><span>с ошибкой</span></div><div class="result-stat"><strong>${result.skipped}</strong><span>без ответа</span></div></div><div class="button-row">${result.mistakeIds.length ? `<button class="button" data-action="result-mistakes">${icon('refresh')} Разобрать ошибки · ${result.mistakeIds.length}</button>` : ''}<button class="button ${result.mistakeIds.length ? 'secondary' : ''}" data-action="repeat">Пройти ещё раз</button><button class="button secondary" data-action="home">На главную</button></div></section><section class="review" aria-labelledby="review-heading"><div class="review-header"><h2 id="review-heading">${showAllReview ? 'Все ответы' : 'Разбор ошибок'}</h2><button class="text-button" data-action="toggle-review">${showAllReview ? 'Только ошибки' : 'Показать все ответы'}</button></div>${toReview.length ? toReview.map(id => reviewItem(id)).join('') : `<div class="empty-state">${result.skipped ? 'В проверенных ответах ошибок нет. К пропущенным вопросам можно вернуться в новом занятии.' : 'Ошибок нет. Все вопросы этого занятия пройдены верно.'}</div>`}</section></div>`;
}

function reviewItem(id) {
  const question = questions.get(id);
  const answer = state.session.answers[id];
  const completed = answer && (state.session.mode === 'exam' || answer.checked);
  const correct = completed && answer.label === question.answer;
  const selectedOption = completed ? question.options.find(option => option.label === answer.label) : null;
  const rightOption = question.options.find(option => option.label === question.answer);
  return `<details class="review-item"><summary><span class="review-number">№${id}</span><span class="review-question">${escape(question.text)}</span><span class="review-flag${correct ? ' correct' : ''}" aria-label="${correct ? 'Верно' : completed ? 'Неверно' : 'Без ответа'}">${correct ? '✓' : completed ? '×' : '—'}</span></summary><div class="review-body"><span class="review-label">Ваш ответ</span><p class="${correct ? 'review-right' : 'review-wrong'}">${selectedOption ? `${answer.label.toUpperCase()}) ${escape(selectedOption.text)}` : 'Ответ не дан'}</p>${correct ? '' : `<span class="review-label">Правильный ответ</span><p class="review-right">${rightOption.label.toUpperCase()}) ${escape(rightOption.text)}</p>`}</div></details>`;
}

async function launchSession(mode, ids) {
  if (!ids.length) { toast('Сейчас вопросов для повторения нет.'); return; }
  if (state.session && !state.session.finishedAt) {
    const confirmed = await ask('Начать новое занятие?', 'Текущее занятие будет заменено. Уже проверенные ответы останутся в общей статистике.', 'Начать новое');
    if (!confirmed) return;
  }
  state.session = startSession(mode, ids);
  showAllReview = false;
  persist();
  navigate('session');
}

function moveQuestion(delta) {
  const session = state.session;
  const index = session.index + delta;
  if (index < 0 || index >= session.ids.length) return;
  session.index = index;
  persist();
  navigate('session');
}

async function requestFinish() {
  const session = state.session;
  const result = summarize(session, bank);
  if (result.skipped) {
    const confirmed = await ask('Завершить занятие?', `Осталось без ответа: ${result.skipped} из ${result.total}.${session.mode === 'exam' ? ' Они войдут в список для повторения.' : ' Непроверенные ответы не попадут в статистику.'}`, 'Завершить');
    if (!confirmed) return;
  }
  finishSession(state, bank);
  persist();
  navigate('result');
}

async function primaryAction() {
  const session = state.session;
  if (!session || session.finishedAt) return;
  const last = session.index === session.ids.length - 1;
  if (session.mode !== 'exam' && !session.answers[session.ids[session.index]]?.checked) {
    if (!checkAnswer(state, bank)) return;
    persist();
    renderSession();
    document.querySelector('.feedback')?.scrollIntoView({ block: 'nearest' });
    document.querySelector('[data-action="primary"]')?.focus({ preventScroll: true });
  } else if (last) await requestFinish();
  else moveQuestion(1);
}

function closeModal(confirmed = false) {
  if (modal.open) modal.close();
  if (modalResolve) {
    const resolve = modalResolve;
    modalResolve = null;
    resolve(confirmed);
  }
}

function openModal(title, content) {
  closeModal();
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div>${content}`;
  modal.showModal();
}

function ask(title, text, confirmText, danger = false) {
  openModal(title, `<p>${escape(text)}</p><div class="button-row"><button class="button secondary" data-action="close-modal">Отмена</button><button class="button${danger ? ' danger' : ''}" data-action="confirm-modal">${escape(confirmText)}</button></div>`);
  return new Promise(resolve => { modalResolve = resolve; });
}

function openQuestionNav() {
  const session = state.session;
  openModal('Вопросы занятия', `<p>Номера соответствуют исходному PDF. Можно вернуться к любому вопросу.</p><div class="nav-legend"><span><i class="dot green"></i>${session.mode === 'exam' ? 'Ответ выбран' : 'Верно'}</span>${session.mode === 'exam' ? '' : '<span><i class="dot red"></i>С ошибкой</span>'}<span><i class="dot gray"></i>Без ответа</span></div><div class="question-grid">${session.ids.map((id, index) => {
    const answer = session.answers[id];
    const checked = answer?.checked;
    const status = checked ? answer.label === questions.get(id).answer ? 'correct' : 'incorrect' : answer ? 'answered' : '';
    return `<button class="question-dot ${status}${session.index === index ? ' current' : ''}" data-action="jump" data-index="${index}" ${session.index === index ? 'aria-current="step"' : ''} aria-label="Вопрос ${id}${checked ? status === 'correct' ? ', верно' : ', с ошибкой' : answer ? ', ответ выбран' : ', без ответа'}">${id}</button>`;
  }).join('')}</div>`);
  modal.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
}

function openSettings() {
  openModal('Ваши данные', `<p>Прогресс хранится в этом браузере на этом устройстве. Для переноса на телефон или iPad сохраните файл, затем загрузите его на другом устройстве.</p><div class="modal-actions"><button class="button secondary" data-action="export">${icon('download')} Сохранить прогресс в файл</button><button class="button secondary" data-action="import">${icon('upload')} Загрузить прогресс из файла</button></div><p class="small-copy">Загрузка заменит прогресс в этом браузере. Синхронизации между устройствами нет.</p><hr class="card-divider"><button class="text-button data-warning" data-action="reset">Сбросить весь прогресс</button>`);
}

function exportProgress() {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `therapy-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !state) return;
  event.preventDefault();
  const action = button.dataset.action;
  try {
    if (action === 'home') navigate('home');
    else if (action === 'mode') {
      selectedMode = button.dataset.mode;
      renderHome();
      document.querySelector(`[data-mode="${selectedMode}"]`)?.focus({ preventScroll: true });
    } else if (action === 'preset') {
      const count = Number(button.dataset.count);
      if (count === 400) range.from = 1;
      range.from = Math.min(400, Math.max(1, Number.isInteger(range.from) ? range.from : 1));
      range.to = Math.min(400, range.from + count - 1);
      document.querySelector('#range-from').value = range.from;
      document.querySelector('#range-to').value = range.to;
      updateRange();
    } else if (action === 'start') await launchSession(selectedMode, rangeIds(range.from, range.to, bank));
    else if (action === 'resume') navigate('session');
    else if (action === 'mistakes') await launchSession('mistakes', mistakeIds(state));
    else if (action === 'result-mistakes') await launchSession('mistakes', summarize(state.session, bank).mistakeIds);
    else if (action === 'toggle-review') { showAllReview = !showAllReview; renderResult(); }
    else if (action === 'repeat') await launchSession(state.session.mode, state.session.ids);
    else if (action === 'primary') await primaryAction();
    else if (action === 'previous') moveQuestion(-1);
    else if (action === 'skip') {
      if (state.session.index === state.session.ids.length - 1) await requestFinish();
      else moveQuestion(1);
    } else if (action === 'finish') await requestFinish();
    else if (action === 'question-nav') openQuestionNav();
    else if (action === 'jump') {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index) && index >= 0 && index < state.session.ids.length) {
        state.session.index = index;
        closeModal();
        persist();
        navigate('session');
      }
    } else if (action === 'settings') openSettings();
    else if (action === 'about') openModal('О тренажёре', '<p>400 тестовых заданий по поликлинической терапии. Вопросы, варианты и эталонные ответы перенесены из предоставленного PDF <b>not_marked.pdf</b>.</p><p>Порядок вопросов и вариантов сохранён. В заданиях с комбинациями выбирается один готовый вариант. Вопрос №96 взят из версии not_marked.pdf.</p><p>Обучение показывает ответ после проверки. Экзамен — после завершения. Правильный ответ при повторении убирает вопрос из списка ошибок.</p><p class="small-copy">На iPhone и iPad страницу можно добавить на экран «Домой» через меню «Поделиться» в Safari.</p>');
    else if (action === 'close-modal') closeModal();
    else if (action === 'confirm-modal') closeModal(true);
    else if (action === 'export') exportProgress();
    else if (action === 'import') { closeModal(); fileInput.click(); }
    else if (action === 'reset') {
      if (await ask('Сбросить весь прогресс?', 'Статистика и сохранённое занятие будут удалены из этого браузера. При необходимости сначала сохраните их в файл.', 'Сбросить прогресс', true)) {
        state = createState(bank.version);
        persist();
        navigate('home');
        toast('Прогресс сброшен. Можно начать заново.');
      }
    }
  } catch (error) { toast(error.message || 'Не удалось выполнить действие. Попробуйте ещё раз.'); }
});

document.addEventListener('input', event => {
  if (event.target.matches('#range-from, #range-to')) updateRange();
});

document.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches('[data-option]') || !state.session) return;
  const label = input.dataset.option;
  chooseAnswer(state, bank, label);
  persist();
  renderSession();
  document.querySelector(`[data-option="${label}"]`)?.focus({ preventScroll: true });
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Файл слишком большой. Выберите сохранённый файл прогресса тренажёра.');
    const imported = validateState(JSON.parse(await file.text()), bank);
    if (await ask('Загрузить сохранённый прогресс?', `В файле пройдено ${progress(imported).completed} из 400 вопросов. Он заменит текущий прогресс в этом браузере.`, 'Загрузить')) {
      state = imported;
      persist();
      navigate('home');
      toast('Прогресс загружен.');
    }
  } catch (error) { toast(error instanceof SyntaxError ? 'Не удалось прочитать файл. Выберите JSON-файл прогресса.' : error.message); }
});

modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
modal.addEventListener('click', event => {
  if (event.target !== modal) return;
  const bounds = modal.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal();
});

window.addEventListener('popstate', () => {
  closeModal();
  currentView = location.hash === '#session' ? 'session' : location.hash === '#result' ? 'result' : 'home';
  render();
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  warn('Прогресс изменён в другой вкладке. Обновите страницу, чтобы продолжить с актуальными данными.');
});

document.addEventListener('keydown', event => {
  if (!state?.session || currentView !== 'session' || state.session.finishedAt || modal.open || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target.matches('input:not([type=radio]), textarea, select, button, a, summary')) return;
  if (/^[1-7]$/.test(event.key)) {
    const option = questions.get(state.session.ids[state.session.index]).options[Number(event.key) - 1];
    if (!option || state.session.answers[state.session.ids[state.session.index]]?.checked) return;
    event.preventDefault();
    chooseAnswer(state, bank, option.label);
    persist();
    renderSession();
    document.querySelector(`[data-option="${option.label}"]`)?.focus({ preventScroll: true });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    primaryAction();
  }
});

async function initialize() {
  try {
    const response = await fetch('./data/questions.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Вопросы пока не загрузились.');
    bank = await response.json();
    if (!Array.isArray(bank.questions) || bank.questions.length !== 400 || !bank.questions.every((q, index) => q.id === index + 1 && typeof q.text === 'string' && Array.isArray(q.options) && q.options.length >= 2 && q.options.some(option => option.label === q.answer))) throw new Error('Не удалось проверить набор вопросов.');
    questions = questionMap(bank);
    state = createState(bank.version);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) state = validateState(JSON.parse(saved), bank);
    } catch {
      warn('Не удалось восстановить прогресс. Можно начать новое занятие или загрузить ранее сохранённый файл через настройки.');
    }
    currentView = location.hash === '#session' ? 'session' : location.hash === '#result' ? 'result' : 'home';
    render();
  } catch (error) {
    main.innerHTML = `<section class="card empty-state"><h1 class="section-title">Не удалось загрузить тренажёр</h1><p class="section-intro">${escape(error.message)} Проверьте подключение к интернету и обновите страницу.</p><button class="button" style="margin-top:20px" id="retry">Попробовать ещё раз</button></section>`;
    document.querySelector('#retry').addEventListener('click', () => location.reload());
  }
}

initialize();
