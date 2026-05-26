import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Cigarette, Clock3, Pencil, Plus, RefreshCw, Target, Trash2, WineOff, X } from 'lucide-react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import './styles.css';

const START_DATE = new Date(1990, 4, 23, 0, 0, 0, 0);
const TARGET_DATE = new Date(2070, 4, 23, 0, 0, 0, 0);
const NO_ALCOHOL_START_DATE = new Date(2026, 4, 25, 14, 10, 0, 0);
const NO_CIGARETTES_START_DATE = new Date(2026, 4, 25, 13, 0, 0, 0);
const MONTHLY_AMOUNT = 3000;
const ANNUAL_INFLATION_RATE = 0.02;
const YEAR_IN_MILLISECONDS = 365.2425 * 24 * 60 * 60 * 1000;
const TODO_COLLECTION = 'todos';
const HEALTH_SETTINGS_COLLECTION = 'settings';
const PIN_CODE = '2305';
const NBU_EXCHANGE_RATES_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';
const HEALTH_DEFAULTS = {
  noAlcohol: {
    icon: WineOff,
    startDate: NO_ALCOHOL_START_DATE,
    title: 'No alcohol',
  },
  noCigarettes: {
    icon: Cigarette,
    startDate: NO_CIGARETTES_START_DATE,
    title: 'No Cigarettes',
  },
};

function addMonths(date, amount) {
  const next = new Date(date);
  const day = next.getDate();

  next.setDate(1);
  next.setMonth(next.getMonth() + amount);

  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));

  return next;
}

function monthDiff(start, end) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

function getInflatedMonthlyAmount(monthStart, now) {
  const yearsFromNow = Math.max(0, (monthStart.getTime() - now.getTime()) / YEAR_IN_MILLISECONDS);
  return MONTHLY_AMOUNT * Math.pow(1 + ANNUAL_INFLATION_RATE, yearsFromNow);
}

function getCountdown(now) {
  if (now >= TARGET_DATE) {
    return {
      amount: 0,
      millisecondsLeft: 0,
    };
  }

  let nextMilestone = new Date(now.getFullYear(), now.getMonth(), TARGET_DATE.getDate());
  if (nextMilestone <= now) {
    nextMilestone = addMonths(nextMilestone, 1);
  }

  let currentMilestone = addMonths(nextMilestone, -1);
  let fullMonths = monthDiff(nextMilestone, TARGET_DATE);

  if (nextMilestone > TARGET_DATE) {
    nextMilestone = TARGET_DATE;
    currentMilestone = addMonths(nextMilestone, -1);
    fullMonths = 0;
  }

  const periodLength = nextMilestone.getTime() - currentMilestone.getTime();
  const periodLeft = nextMilestone.getTime() - now.getTime();
  const currentMonthRemaining = Math.max(0, Math.min(1, periodLeft / periodLength));
  const partialMonthValue = getInflatedMonthlyAmount(now, now) * currentMonthRemaining;
  const fullMonthsValue = Array.from({ length: fullMonths }).reduce((total, _, index) => {
    const monthStart = addMonths(nextMilestone, index);
    return total + getInflatedMonthlyAmount(monthStart, now);
  }, 0);

  return {
    amount: fullMonthsValue + partialMonthValue,
    millisecondsLeft: TARGET_DATE.getTime() - now.getTime(),
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds };
}

function formatElapsedTime(milliseconds) {
  const { days, hours, minutes, seconds } = formatDuration(milliseconds);

  return [
    { label: 'days', value: days.toLocaleString('en-US') },
    { label: 'hours', value: hours.toString().padStart(2, '0') },
    { label: 'minutes', value: minutes.toString().padStart(2, '0') },
    { label: 'seconds', value: seconds.toString().padStart(2, '0') },
  ];
}

function getOverallProgress(now) {
  const total = TARGET_DATE.getTime() - START_DATE.getTime();
  const elapsed = now.getTime() - START_DATE.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}

function toDateInputValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}

function parseStoredDate(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function getTodosQuery() {
  return query(collection(db, TODO_COLLECTION), orderBy('createdAt', 'desc'));
}

function mapTodosSnapshot(snapshot) {
  return snapshot.docs.map((todoDoc) => ({
    id: todoDoc.id,
    ...todoDoc.data(),
  }));
}

function formatRate(value) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function App() {
  const [now, setNow] = useState(() => new Date());
  const [todoText, setTodoText] = useState('');
  const [todos, setTodos] = useState([]);
  const [todoError, setTodoError] = useState('');
  const [todoUserId, setTodoUserId] = useState('');
  const [isSyncingTodos, setIsSyncingTodos] = useState(false);
  const [healthStartDates, setHealthStartDates] = useState(() =>
    Object.fromEntries(Object.entries(HEALTH_DEFAULTS).map(([id, section]) => [id, section.startDate])),
  );
  const [healthEditor, setHealthEditor] = useState(null);
  const [healthDraftDate, setHealthDraftDate] = useState('');
  const [healthError, setHealthError] = useState('');
  const [isSavingHealthDate, setIsSavingHealthDate] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [exchangeRates, setExchangeRates] = useState([]);
  const [exchangeDate, setExchangeDate] = useState('');
  const [exchangeError, setExchangeError] = useState('');
  const [isLoadingExchangeRates, setIsLoadingExchangeRates] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setTodoUserId(user?.uid || '');
    });

    signInAnonymously(auth).catch(() => {
      setTodoError('Firebase connection failed');
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isUnlocked || !todoUserId) {
      setTodos([]);
      return undefined;
    }

    return onSnapshot(
      getTodosQuery(),
      (snapshot) => {
        setTodos(mapTodosSnapshot(snapshot));
        setTodoError('');
      },
      () => {
        setTodoError('Could not load tasks');
      },
    );
  }, [isUnlocked, todoUserId]);

  useEffect(() => {
    if (!isUnlocked || !todoUserId) {
      return undefined;
    }

    const unsubscribers = Object.entries(HEALTH_DEFAULTS).map(([id, section]) =>
      onSnapshot(
        doc(db, HEALTH_SETTINGS_COLLECTION, id),
        (snapshot) => {
          const startDate = parseStoredDate(snapshot.data()?.startDate, section.startDate);
          setHealthStartDates((current) => ({
            ...current,
            [id]: startDate,
          }));
          setHealthError('');
        },
        () => {
          setHealthError('Could not load start dates');
        },
      ),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isUnlocked, todoUserId]);

  useEffect(() => {
    if (!isUnlocked) {
      return undefined;
    }

    const controller = new AbortController();

    async function loadExchangeRates() {
      setIsLoadingExchangeRates(true);
      try {
        const response = await fetch(NBU_EXCHANGE_RATES_URL, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('NBU request failed');
        }

        const data = await response.json();
        const nextRates = ['USD', 'EUR']
          .map((code) => data.find((rate) => rate.cc === code))
          .filter(Boolean);

        setExchangeRates(nextRates);
        setExchangeDate(nextRates[0]?.exchangedate || '');
        setExchangeError('');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setExchangeError('Could not load NBU rates');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingExchangeRates(false);
        }
      }
    }

    loadExchangeRates();

    return () => {
      controller.abort();
    };
  }, [isUnlocked]);

  const countdown = useMemo(() => getCountdown(now), [now]);
  const duration = useMemo(() => formatDuration(countdown.millisecondsLeft), [countdown.millisecondsLeft]);
  const overallProgress = useMemo(() => getOverallProgress(now), [now]);
  const healthSections = Object.entries(HEALTH_DEFAULTS).map(([id, section]) => ({
    ...section,
    id,
    startDate: healthStartDates[id] || section.startDate,
  }));

  function openHealthEditor(section) {
    setHealthEditor(section);
    setHealthDraftDate(toDateInputValue(section.startDate));
    setHealthError('');
  }

  function closeHealthEditor() {
    if (isSavingHealthDate) {
      return;
    }

    setHealthEditor(null);
    setHealthDraftDate('');
  }

  async function saveHealthStartDate(event) {
    event.preventDefault();

    if (!healthEditor || !todoUserId) {
      return;
    }

    const nextDate = new Date(healthDraftDate);
    if (!healthDraftDate || Number.isNaN(nextDate.getTime())) {
      setHealthError('Choose a valid date and time');
      return;
    }

    setIsSavingHealthDate(true);
    try {
      await setDoc(
        doc(db, HEALTH_SETTINGS_COLLECTION, healthEditor.id),
        {
          startDate: nextDate.toISOString(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setHealthEditor(null);
      setHealthDraftDate('');
      setHealthError('');
    } catch {
      setHealthError('Could not save start date');
    } finally {
      setIsSavingHealthDate(false);
    }
  }

  async function syncTodos() {
    if (!todoUserId || isSyncingTodos) {
      return;
    }

    setIsSyncingTodos(true);
    try {
      const snapshot = await getDocs(getTodosQuery());
      setTodos(mapTodosSnapshot(snapshot));
      setTodoError('');
    } catch {
      setTodoError('Could not sync tasks');
    } finally {
      setIsSyncingTodos(false);
    }
  }

  async function addTodo(event) {
    event.preventDefault();

    const text = todoText.trim();
    if (!text || !todoUserId) {
      return;
    }

    setTodoText('');
    try {
      await addDoc(collection(db, TODO_COLLECTION), {
        createdAt: serverTimestamp(),
        isDone: false,
        text,
      });
    } catch {
      setTodoText(text);
      setTodoError('Could not add task');
    }
  }

  async function toggleTodo(todo) {
    if (!todoUserId) {
      return;
    }

    try {
      await updateDoc(doc(db, TODO_COLLECTION, todo.id), {
        isDone: !todo.isDone,
      });
    } catch {
      setTodoError('Could not update task');
    }
  }

  async function deleteTodo(id) {
    if (!todoUserId) {
      return;
    }

    try {
      await deleteDoc(doc(db, TODO_COLLECTION, id));
    } catch {
      setTodoError('Could not delete task');
    }
  }

  function handlePinChange(event) {
    const nextValue = event.target.value.replace(/\D/g, '').slice(0, 4);
    setPinValue(nextValue);
    setPinError('');

    if (nextValue.length !== 4) {
      return;
    }

    if (nextValue === PIN_CODE) {
      setIsUnlocked(true);
      return;
    }

    setPinError('Wrong PIN');
  }

  if (!isUnlocked) {
    return (
      <main className="app-shell pin-shell">
        <section className="pin-panel" aria-label="PIN lock screen">
          <div className="pin-copy">
            <p className="kicker">Private dashboard</p>
            <h1>PIN code</h1>
          </div>
          <label className="sr-only" htmlFor="pin-code">
            PIN code
          </label>
          <input
            autoComplete="one-time-code"
            autoFocus
            id="pin-code"
            inputMode="numeric"
            maxLength={4}
            onChange={handlePinChange}
            pattern="[0-9]*"
            type="password"
            value={pinValue}
          />
          <div className={pinError ? 'pin-status is-error' : 'pin-status'}>
            {pinError || `${pinValue.length}/4`}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-layout">
        <section className="countdown-panel" aria-label="Money countdown">
          <div className="panel-topline">
            <span className="status-pill">
              <Clock3 size={16} aria-hidden="true" />
              Live countdown
            </span>
            <span className="target-date">
              <Target size={16} aria-hidden="true" />
              {formatDate(TARGET_DATE)}
            </span>
          </div>

          <div className="hero-copy">
            <p className="kicker">Amount still needed with 2% yearly inflation</p>
            <h1>{formatCurrency(countdown.amount)}</h1>
          </div>

          <div className="progress-block" aria-label="Progress from May 23, 1990 to May 23, 2070">
            <div className="progress-row">
              <span>Start</span>
              <strong>{(overallProgress * 100).toFixed(6)}%</strong>
              <span>Finish</span>
            </div>
            <div className="progress-track">
              <span style={{ width: `${overallProgress * 100}%` }} />
            </div>
          </div>

          <div className="time-grid" aria-label="Time remaining">
            <div>
              <strong>{duration.days.toLocaleString('en-US')}</strong>
              <span>days</span>
            </div>
            <div>
              <strong>{duration.hours.toString().padStart(2, '0')}</strong>
              <span>hours</span>
            </div>
            <div>
              <strong>{duration.minutes.toString().padStart(2, '0')}</strong>
              <span>minutes</span>
            </div>
            <div>
              <strong>{duration.seconds.toString().padStart(2, '0')}</strong>
              <span>seconds</span>
            </div>
          </div>

          <div className="health-grid" aria-label="Health streak counters">
            {healthSections.map((section) => {
              const { icon: Icon, startDate, title } = section;

              return (
              <section className="health-card" key={title} aria-label={title}>
                <div className="health-heading">
                  <div className="health-title">
                    <Icon size={20} aria-hidden="true" />
                    <h2>{title}</h2>
                  </div>
                  <button
                    aria-label={`Edit ${title} start date`}
                    className="health-edit"
                    disabled={!todoUserId}
                    onClick={() => openHealthEditor(section)}
                    title={`Edit ${title} start date`}
                    type="button"
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="health-time">
                  {formatElapsedTime(now.getTime() - startDate.getTime()).map((item) => (
                    <div key={item.label}>
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </section>
              );
            })}
          </div>

          <section className="rates-card" aria-label="NBU currency exchange rates">
            <div className="rates-heading">
              <div>
                <p className="kicker">NBU official rate</p>
                <h2>Currency in hryvnias</h2>
              </div>
              <span>{exchangeDate || 'Today'}</span>
            </div>
            {exchangeError ? (
              <p className="rates-error">{exchangeError}</p>
            ) : (
              <div className="rates-grid">
                {exchangeRates.length > 0
                  ? exchangeRates.map((rate) => (
                      <div key={rate.cc}>
                        <span>{rate.cc === 'USD' ? 'Dollar' : 'Euro'}</span>
                        <strong>{formatRate(rate.rate)} UAH</strong>
                      </div>
                    ))
                  : ['USD', 'EUR'].map((code) => (
                      <div key={code}>
                        <span>{code === 'USD' ? 'Dollar' : 'Euro'}</span>
                        <strong>{isLoadingExchangeRates ? 'Loading' : '-'}</strong>
                      </div>
                    ))}
              </div>
            )}
          </section>
        </section>

        <aside className="todo-panel" aria-label="Emergency to-do list">
          <div className="todo-header">
            <p className="kicker">Emergency</p>
            <h2>To-do list</h2>
          </div>

          <form className="todo-form" onSubmit={addTodo}>
            <label className="sr-only" htmlFor="todo-input">
              Add emergency task
            </label>
            <input
              disabled={!todoUserId}
              id="todo-input"
              onChange={(event) => setTodoText(event.target.value)}
              placeholder={todoUserId ? 'Add urgent task' : 'Connecting'}
              value={todoText}
            />
            <button type="submit" aria-label="Add task" disabled={!todoUserId || !todoText.trim()}>
              <Plus size={18} aria-hidden="true" />
            </button>
          </form>

          <div className={todoError ? 'todo-sync is-error' : 'todo-sync'}>
            <button
              aria-label="Sync tasks from Firebase"
              className={isSyncingTodos ? 'todo-sync-button is-syncing' : 'todo-sync-button'}
              disabled={!todoUserId || isSyncingTodos}
              onClick={syncTodos}
              title="Sync tasks from Firebase"
              type="button"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            <span>{todoError || (todoUserId ? 'Synced with Firebase' : 'Connecting to Firebase')}</span>
          </div>

          {todos.length > 0 ? (
            <ul className="todo-list">
              {todos.map((todo) => (
                <li className={todo.isDone ? 'is-done' : undefined} key={todo.id}>
                  <button
                    className="todo-check"
                    onClick={() => toggleTodo(todo)}
                    type="button"
                    aria-label={todo.isDone ? 'Mark task as active' : 'Mark task as done'}
                  >
                    {todo.isDone && <Check size={14} aria-hidden="true" />}
                  </button>
                  <span>{todo.text}</span>
                  <button
                    className="todo-delete"
                    onClick={() => deleteTodo(todo.id)}
                    type="button"
                    aria-label="Delete task"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="todo-empty">
              <span>No urgent tasks</span>
            </div>
          )}
        </aside>
      </div>

      {healthEditor && (
        <div className="dialog-backdrop" role="presentation" onClick={closeHealthEditor}>
          <section
            aria-labelledby="health-dialog-title"
            aria-modal="true"
            className="health-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="dialog-heading">
              <h2 id="health-dialog-title">Edit {healthEditor.title}</h2>
              <button aria-label="Close dialog" onClick={closeHealthEditor} type="button">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form className="health-dialog-form" onSubmit={saveHealthStartDate}>
              <label htmlFor="health-start-date">Start date and time</label>
              <input
                id="health-start-date"
                onChange={(event) => setHealthDraftDate(event.target.value)}
                type="datetime-local"
                value={healthDraftDate}
              />
              {healthError && <p className="dialog-error">{healthError}</p>}
              <button disabled={isSavingHealthDate || !todoUserId} type="submit">
                {isSavingHealthDate ? 'Saving' : 'Save'}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
