import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createState, rangeIds, mistakeIds, startSession, chooseAnswer, checkAnswer,
  summarize, finishSession, progress, validateState,
} from '../src/engine.js';

const bank = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));
const newState = () => createState(bank.version);

test('all 400 questions have ordered, complete options and verified keys', () => {
  assert.equal(bank.questions.length, 400);
  assert.equal(bank.validation.verifiedHighlights, 400);
  assert.deepEqual(bank.questions.map(q => q.id), Array.from({ length: 400 }, (_, i) => i + 1));
  for (const q of bank.questions) {
    assert.ok(q.text.length > 10);
    assert.ok(q.options.length >= 2 && q.options.length <= 7);
    assert.deepEqual(q.options.map(o => o.label), [...'абвгдеж'].slice(0, q.options.length));
    assert.equal(q.options.filter(o => o.label === q.answer).length, 1);
    assert.ok(q.options.every(o => o.text.length > 0));
  }
  assert.match(bank.questions[95].text, /К клиническим признакам/);
  assert.deepEqual(bank.validation.differentQuestionText, [96, 374]);
});

test('ranges, repeats, and mistakes preserve original numerical order', () => {
  assert.deepEqual(rangeIds(96, 100, bank), [96, 97, 98, 99, 100]);
  assert.deepEqual(startSession('mistakes', [400, 3, 197, 3]).ids, [3, 197, 400]);
  for (const [from, to] of [[0, 40], [50, 40], [1, 401], [1.5, 2], [NaN, 3]]) assert.throws(() => rangeIds(from, to, bank));
});

test('learning records one attempt only after checking and correct retry clears a mistake', () => {
  const state = newState();
  state.session = startSession('learn', [1]);
  chooseAnswer(state, bank, 'а');
  assert.equal(progress(state).attempts, 0);
  assert.equal(checkAnswer(state, bank), true);
  assert.deepEqual(mistakeIds(state), [1]);
  assert.equal(checkAnswer(state, bank), false);
  chooseAnswer(state, bank, 'б');
  assert.equal(state.session.answers[1].label, 'а');
  assert.equal(progress(state).attempts, 1);
  finishSession(state, bank);
  assert.equal(progress(state).attempts, 1);
  state.session = startSession('mistakes', [1]);
  chooseAnswer(state, bank, 'б');
  checkAnswer(state, bank);
  assert.deepEqual(mistakeIds(state), []);
  assert.deepEqual(progress(state), { completed: 1, correct: 1, mistakes: 0, attempts: 2 });
});

test('exam keeps statistics untouched until submitted, supports changes, and includes skipped questions', () => {
  const state = newState();
  state.session = startSession('exam', [1, 2, 3], 1000);
  chooseAnswer(state, bank, 'а');
  chooseAnswer(state, bank, 'б');
  assert.equal(checkAnswer(state, bank), false);
  assert.equal(progress(state).attempts, 0);
  state.session.index = 1;
  chooseAnswer(state, bank, 'а');
  const restored = validateState(JSON.parse(JSON.stringify(state)), bank);
  finishSession(restored, bank, 2000);
  assert.deepEqual(summarize(restored.session, bank), { total: 3, answered: 2, correct: 1, wrong: 1, skipped: 1, percent: 33, mistakeIds: [2, 3] });
  assert.deepEqual(mistakeIds(restored), [2, 3]);
  assert.equal(progress(restored).attempts, 3);
  finishSession(restored, bank, 3000);
  assert.equal(progress(restored).attempts, 3);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(restored)), bank).stats, restored.stats);
});

test('unverified learning answers do not become attempts or mistakes on early finish', () => {
  const state = newState();
  state.session = startSession('learn', [1, 2]);
  chooseAnswer(state, bank, 'б');
  checkAnswer(state, bank);
  state.session.index = 1;
  chooseAnswer(state, bank, 'а');
  finishSession(state, bank);
  assert.deepEqual(summarize(state.session, bank), { total: 2, answered: 1, correct: 1, wrong: 0, skipped: 1, percent: 50, mistakeIds: [] });
  assert.equal(progress(state).attempts, 1);
});

test('every original key yields a perfect completed exam and survives serialization', () => {
  const state = newState();
  state.session = startSession('exam', rangeIds(1, 400, bank));
  for (const [index, q] of bank.questions.entries()) {
    state.session.index = index;
    chooseAnswer(state, bank, q.answer);
  }
  finishSession(state, bank);
  assert.equal(summarize(state.session, bank).percent, 100);
  assert.deepEqual(progress(state), { completed: 400, correct: 400, mistakes: 0, attempts: 400 });
  assert.equal(validateState(JSON.parse(JSON.stringify(state)), bank).lastResult.percent, 100);
});

test('backups reject corrupt or mismatched progress without changing live state', () => {
  const state = newState();
  state.session = startSession('learn', [1, 2]);
  chooseAnswer(state, bank, 'б');
  checkAnswer(state, bank);
  const before = JSON.stringify(state);
  const changes = [
    s => { s.bankVersion = 'different'; },
    s => { s.stats[1].lastAnswer = 'ж'; },
    s => { s.stats[1].lastCorrect = false; },
    s => { s.stats[1].attempts = -1; },
    s => { s.session.ids = [2, 1]; },
    s => { s.session.index = 99; },
    s => { s.session.answers[1].label = '<script>'; },
  ];
  for (const change of changes) {
    const copy = JSON.parse(before);
    change(copy);
    assert.throws(() => validateState(copy, bank));
  }
  assert.equal(JSON.stringify(state), before);
});
