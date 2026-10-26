export const STORAGE_KEY = 'therapy-trainer:v1';

export function createState(version) {
  return { schemaVersion: 1, bankVersion: version, stats: {}, session: null, lastResult: null };
}

export function questionMap(bank) {
  return new Map(bank.questions.map(question => [question.id, question]));
}

export function rangeIds(from, to, bank) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > bank.questions.length || from > to) {
    throw new Error(`Укажите диапазон от 1 до ${bank.questions.length}. Начало должно быть не больше конца.`);
  }
  return bank.questions.filter(question => question.id >= from && question.id <= to).map(question => question.id);
}

export function mistakeIds(state) {
  return Object.entries(state.stats).filter(([, stat]) => !stat.lastCorrect).map(([id]) => Number(id)).sort((a, b) => a - b);
}

export function startSession(mode, ids, now = Date.now()) {
  if (!['learn', 'exam', 'mistakes'].includes(mode) || !ids.length) throw new Error('Выберите вопросы для занятия.');
  return { mode, ids: [...new Set(ids)].sort((a, b) => a - b), index: 0, answers: {}, startedAt: now, finishedAt: null };
}

export function recordAnswer(state, question, label, now = Date.now()) {
  if (label !== null && !question.options.some(option => option.label === label)) throw new Error('Неизвестный вариант ответа.');
  const previous = state.stats[question.id];
  const correct = label === question.answer;
  state.stats[question.id] = {
    attempts: (previous?.attempts || 0) + 1,
    correct: (previous?.correct || 0) + Number(correct),
    lastCorrect: correct,
    lastAnswer: label,
    updatedAt: now,
  };
}

export function chooseAnswer(state, bank, label) {
  const session = state.session;
  if (!session || session.finishedAt) return;
  const id = session.ids[session.index];
  const question = questionMap(bank).get(id);
  if (!question?.options.some(option => option.label === label)) throw new Error('Неизвестный вариант ответа.');
  if (session.answers[id]?.checked) return;
  session.answers[id] = { label, checked: false };
}

export function checkAnswer(state, bank, now = Date.now()) {
  const session = state.session;
  if (!session || session.finishedAt || session.mode === 'exam') return false;
  const id = session.ids[session.index];
  const answer = session.answers[id];
  if (!answer || answer.checked) return false;
  answer.checked = true;
  recordAnswer(state, questionMap(bank).get(id), answer.label, now);
  return true;
}

export function summarize(session, bank) {
  const questions = questionMap(bank);
  const ids = session.ids;
  const completed = ids.filter(id => session.answers[id] && (session.mode === 'exam' || session.answers[id].checked));
  const correct = completed.filter(id => session.answers[id].label === questions.get(id).answer).length;
  return {
    total: ids.length,
    answered: completed.length,
    correct,
    wrong: completed.length - correct,
    skipped: ids.length - completed.length,
    percent: Math.round(correct / ids.length * 100),
    mistakeIds: ids.filter(id => {
      const answer = session.answers[id];
      return session.mode === 'exam' ? answer?.label !== questions.get(id).answer : answer?.checked && answer.label !== questions.get(id).answer;
    }),
  };
}

export function finishSession(state, bank, now = Date.now()) {
  const session = state.session;
  if (!session || session.finishedAt) return;
  if (session.mode === 'exam') {
    const questions = questionMap(bank);
    for (const id of session.ids) recordAnswer(state, questions.get(id), session.answers[id]?.label ?? null, now);
  }
  session.finishedAt = now;
  state.lastResult = { mode: session.mode, finishedAt: now, ...summarize(session, bank) };
}

export function progress(state) {
  const values = Object.values(state.stats);
  return {
    completed: values.length,
    correct: values.filter(value => value.lastCorrect).length,
    mistakes: values.filter(value => !value.lastCorrect).length,
    attempts: values.reduce((sum, value) => sum + value.attempts, 0),
  };
}

export function validateState(input, bank) {
  if (!input || input.schemaVersion !== 1 || input.bankVersion !== bank.version || !input.stats || typeof input.stats !== 'object' || Array.isArray(input.stats)) {
    throw new Error('Этот файл не подходит к текущему набору вопросов.');
  }
  const result = createState(bank.version);
  const questions = questionMap(bank);
  const validLabel = (id, label) => label === null || questions.get(id)?.options.some(option => option.label === label);
  for (const [key, stat] of Object.entries(input.stats)) {
    const id = Number(key);
    if (String(id) !== key || !questions.has(id) || !stat || !Number.isSafeInteger(stat.attempts) || stat.attempts < 1 || !Number.isSafeInteger(stat.correct) || stat.correct < 0 || stat.correct > stat.attempts || typeof stat.lastCorrect !== 'boolean' || !validLabel(id, stat.lastAnswer) || stat.lastCorrect !== (stat.lastAnswer === questions.get(id).answer) || !Number.isFinite(stat.updatedAt) || stat.updatedAt < 0) {
      throw new Error('В файле повреждена статистика ответов.');
    }
    result.stats[id] = { attempts: stat.attempts, correct: stat.correct, lastCorrect: stat.lastCorrect, lastAnswer: stat.lastAnswer, updatedAt: stat.updatedAt };
  }
  if (input.session) {
    const s = input.session;
    if (!['learn', 'exam', 'mistakes'].includes(s.mode) || !Array.isArray(s.ids) || !s.ids.length || s.ids.length > questions.size || !s.ids.every((id, index) => Number.isInteger(id) && questions.has(id) && (!index || id > s.ids[index - 1])) || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.ids.length || !s.answers || typeof s.answers !== 'object' || Array.isArray(s.answers) || !Number.isFinite(s.startedAt) || s.startedAt < 0 || (s.finishedAt !== null && (!Number.isFinite(s.finishedAt) || s.finishedAt < s.startedAt))) {
      throw new Error('Не удалось восстановить сохранённое занятие.');
    }
    const session = { mode: s.mode, ids: [...s.ids], index: s.index, answers: {}, startedAt: s.startedAt, finishedAt: s.finishedAt };
    for (const [key, answer] of Object.entries(s.answers)) {
      const id = Number(key);
      if (String(id) !== key || !s.ids.includes(id) || !answer || answer.label === null || !validLabel(id, answer.label) || typeof answer.checked !== 'boolean' || (s.mode === 'exam' && answer.checked)) throw new Error('В занятии повреждены ответы.');
      session.answers[id] = { label: answer.label, checked: answer.checked };
    }
    result.session = session;
    if (session.finishedAt) result.lastResult = { mode: session.mode, finishedAt: session.finishedAt, ...summarize(session, bank) };
  }
  // lastResult is informational. Reconstruct only its bounded, known fields.
  if (!result.lastResult && input.lastResult) {
    const last = input.lastResult;
    if (['learn', 'exam', 'mistakes'].includes(last.mode) && Number.isFinite(last.finishedAt) && Number.isInteger(last.total) && last.total > 0 && last.total <= questions.size && Number.isInteger(last.correct) && last.correct >= 0 && last.correct <= last.total) {
      result.lastResult = { mode: last.mode, finishedAt: last.finishedAt, total: last.total, correct: last.correct, percent: Math.round(last.correct / last.total * 100) };
    }
  }
  return result;
}
