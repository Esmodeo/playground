import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cigarette, Clock3, Target, WineOff } from 'lucide-react';
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

function App() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(() => getCountdown(now), [now]);
  const duration = useMemo(() => formatDuration(countdown.millisecondsLeft), [countdown.millisecondsLeft]);
  const overallProgress = useMemo(() => getOverallProgress(now), [now]);
  const healthSections = [
    { icon: WineOff, startDate: NO_ALCOHOL_START_DATE, title: 'No alcohol' },
    { icon: Cigarette, startDate: NO_CIGARETTES_START_DATE, title: 'No Cigarettes' },
  ];

  return (
    <main className="app-shell">
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
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
