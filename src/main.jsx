import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Cigarette, Clock3, Plus, RefreshCw, Target, Trash2, WineOff } from 'lucide-react';
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

function getTodosQuery(userId) {
  return query(collection(db, 'users', userId, 'todos'), orderBy('createdAt', 'desc'));
}

function mapTodosSnapshot(snapshot) {
  return snapshot.docs.map((todoDoc) => ({
    id: todoDoc.id,
    ...todoDoc.data(),
  }));
}

function App() {
  const [now, setNow] = useState(() => new Date());
  const [todoText, setTodoText] = useState('');
  const [todos, setTodos] = useState([]);
  const [todoError, setTodoError] = useState('');
  const [todoUserId, setTodoUserId] = useState('');
  const [isSyncingTodos, setIsSyncingTodos] = useState(false);

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
    if (!todoUserId) {
      setTodos([]);
      return undefined;
    }

    return onSnapshot(
      getTodosQuery(todoUserId),
      (snapshot) => {
        setTodos(mapTodosSnapshot(snapshot));
        setTodoError('');
      },
      () => {
        setTodoError('Could not load tasks');
      },
    );
  }, [todoUserId]);

  const countdown = useMemo(() => getCountdown(now), [now]);
  const duration = useMemo(() => formatDuration(countdown.millisecondsLeft), [countdown.millisecondsLeft]);
  const overallProgress = useMemo(() => getOverallProgress(now), [now]);
  const healthSections = [
    { icon: WineOff, startDate: NO_ALCOHOL_START_DATE, title: 'No alcohol' },
    { icon: Cigarette, startDate: NO_CIGARETTES_START_DATE, title: 'No Cigarettes' },
  ];

  async function syncTodos() {
    if (!todoUserId || isSyncingTodos) {
      return;
    }

    setIsSyncingTodos(true);
    try {
      const snapshot = await getDocs(getTodosQuery(todoUserId));
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
      await addDoc(collection(db, 'users', todoUserId, 'todos'), {
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
      await updateDoc(doc(db, 'users', todoUserId, 'todos', todo.id), {
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
      await deleteDoc(doc(db, 'users', todoUserId, 'todos', id));
    } catch {
      setTodoError('Could not delete task');
    }
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
            {healthSections.map(({ icon: Icon, startDate, title }) => (
              <section className="health-card" key={title} aria-label={title}>
                <div className="health-heading">
                  <Icon size={20} aria-hidden="true" />
                  <h2>{title}</h2>
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
            ))}
          </div>
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
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
