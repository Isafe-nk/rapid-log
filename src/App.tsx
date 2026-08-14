import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trash2, 
  Star, 
  Calendar, 
  X, 
  RotateCcw, 
  LogIn, 
  LogOut, 
  User, 
  Download,
  Edit3,
  Check,
  Copy,
  Github
} from 'lucide-react';
import { Todo, EntryType, TimeOfDay } from './types';
import { auth, db, signInWithGoogle, logout, handleRedirectResult, isNative } from './lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

const BULLETS = {
  event: '○',
  priority: '∗'
};

const TIMES_OF_DAY: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'noon', label: 'Noon' },
  { id: 'night', label: 'Night' }
];

const parseDate = (val: any): Date | null => {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return new Date(val < 10000000000 ? val * 1000 : val);
  }
  if (typeof val?.toDate === 'function') {
    return val.toDate();
  }
  if (typeof val?.seconds === 'number') {
    return new Date(val.seconds * 1000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Sortable epoch ms for any createdAt shape parseDate understands. Subtracting
// raw createdAt values yields NaN once Firestore hands back a Timestamp object.
const timeValue = (val: any): number => {
  const d = parseDate(val);
  return d ? d.getTime() : 0;
};

// Minutes since midnight for a stored display time like "9:00 AM", or null when
// the entry has no time set (or an unrecognised one).
const minutesOfDay = (time: string | null | undefined): number | null => {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return null;
  const hours = parseInt(m[1], 10) % 12;
  const isPM = m[3].toUpperCase() === 'PM';
  return (hours + (isPM ? 12 : 0)) * 60 + parseInt(m[2], 10);
};

// A section reads as a timeline: timed entries in clock order, then untimed ones
// in the order they were added. The priority star is purely visual and does not
// reorder anything.
const byTimeThenCreated = (a: Todo, b: Todo) => {
  const at = minutesOfDay(a.time);
  const bt = minutesOfDay(b.time);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at !== null && bt === null) return -1;
  if (at === null && bt !== null) return 1;
  return timeValue(a.createdAt) - timeValue(b.createdAt);
};

const isSameDay = (d1: Date, d2: Date) =>
  d1.getDate() === d2.getDate() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getFullYear() === d2.getFullYear();

// Entries with a missing/unparseable timestamp fall back to today so they stay
// reachable on today's log instead of appearing on every single date.
const entryDateOf = (t: Todo, today: Date) => parseDate(t.createdAt) ?? today;

// Positions are animated with transforms rather than height. Height forces the
// browser to recompute layout every frame and reposition everything below, which
// is what made section headings stutter; transforms run on the compositor and are
// interpolated by the browser itself, so they cannot fall out of step.
// One spring, shared by everything that moves together.
const GLIDE = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const;

// Slow-out cubic. Motion decelerates into place rather than stopping dead.
const EASE = [0.22, 1, 0.36, 1] as const;

// Each block arrives slightly after the one above it, so the page assembles
// top-down instead of appearing all at once.
const reveal = (shown: boolean, delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
  transition: { duration: 0.55, ease: EASE, delay: shown ? delay : 0 }
});

// How far back the live subscription reaches by default. Browsing further back
// lowers it; it never rises, so history you have opened stays loaded.
const HISTORY_DAYS = 30;

const windowStartFor = (d: Date) => {
  const s = new Date(d);
  s.setDate(s.getDate() - HISTORY_DAYS);
  s.setHours(0, 0, 0, 0);
  return s.getTime();
};

// Failures were only ever written to the console, which users never see: a task
// would appear and then quietly vanish. Turn the codes into something readable.
const describeSaveError = (error: any): string => {
  const code = String(error?.code ?? '');
  if (code.includes('unavailable') || code.includes('deadline')) {
    return "Can't reach the server — check your connection";
  }
  if (code.includes('permission-denied')) {
    return 'That change was rejected — the text may be too long';
  }
  if (code.includes('unauthenticated')) {
    return 'Signed out — sign in again to save';
  }
  return "Couldn't save that change";
};

// The Mac app is ad-hoc signed, so macOS quarantines it on download and refuses
// to open it. Without this instruction the app simply looks broken — and the
// right-click-to-Open trick no longer works on recent macOS, so give the command
// that does, on every version.
// Never written anywhere. It only keeps a guest entry the same shape as a saved
// one, so importing on sign-in is a field swap rather than a conversion.
const GUEST_USER_ID = 'guest';

// The only thing guest mode ever writes to disk, and only for the duration of a
// redirect sign-in. An abandoned sign-in would otherwise leave entries sitting
// here indefinitely, so anything older than the trip could plausibly take is
// discarded rather than turning up in a later session.
const GUEST_HANDOFF_KEY = 'rapidlog.guest-handoff';
const GUEST_HANDOFF_TTL = 10 * 60 * 1000;

const clearGuestHandoff = () => {
  try {
    localStorage.removeItem(GUEST_HANDOFF_KEY);
  } catch {
    /* storage unavailable; nothing was written either */
  }
};

const readGuestHandoff = (): Todo[] => {
  try {
    const raw = localStorage.getItem(GUEST_HANDOFF_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.todos)) return [];
    if (Date.now() - Number(parsed.at) > GUEST_HANDOFF_TTL) {
      clearGuestHandoff();
      return [];
    }
    return parsed.todos as Todo[];
  } catch (error) {
    console.error('Could not read stashed guest entries:', error);
    clearGuestHandoff();
    return [];
  }
};

// Mirrors isValidTodo in firestore.rules. Handoff entries come back off disk as
// untrusted JSON, and the rules reject a batch whole rather than per document.
const isWritableEntry = (e: any): boolean =>
  !!e &&
  typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 1000 &&
  typeof e.completed === 'boolean' &&
  ['task', 'event', 'note'].includes(e.type) &&
  ['morning', 'noon', 'night'].includes(e.timeOfDay) &&
  typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) &&
  (e.time == null || typeof e.time === 'string') &&
  (e.endTime == null || typeof e.endTime === 'string') &&
  (e.priority == null || typeof e.priority === 'boolean');

const newLocalId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const DOWNLOAD_URL = '/RapidLog-macOS.zip';
const DOWNLOAD_FILENAME = 'RapidLog-macOS.zip';
// One fact, not a spec strip. Size and architecture change nobody's mind;
// the OS version is the only thing here that stops a download that cannot run.
const DOWNLOAD_META = 'macOS 14 or later';

// lucide's `Apple` is a piece of fruit, so the mark is inline.
const AppleMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 384 512" className={className} fill="currentColor" aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
);

const TickMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      d="M5 13l4 4L19 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// The three states are stacked and cross-faded rather than swapped, so the
// button never changes size as the label changes length.
const stateLayer = (active: boolean) =>
  `absolute flex items-center gap-3 transition-all duration-300 ${
    active ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
  }`;

const MacDownloadButton: React.FC = () => {
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(t => window.clearTimeout(t));
    timers.current = [];
  };

  // `done` is transient and only a timer clears it, so a remount that lands
  // between the two would strand the button on "Ready to install".
  useEffect(() => {
    setDone(false);
    return clearTimers;
  }, []);

  // The anchor's own default action performs the download. Reading the file in
  // JavaScript to drive a progress bar cost the user gesture, and Safari then
  // treats it as an automatic download and asks permission every single time.
  const onDownload = () => {
    clearTimers();
    timers.current.push(window.setTimeout(() => setDone(true), 700));
    timers.current.push(window.setTimeout(() => setDone(false), 3300));
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <a
        href={DOWNLOAD_URL}
        download={DOWNLOAD_FILENAME}
        onClick={onDownload}
        aria-label="Download for macOS"
        className="group relative flex h-14 w-72 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white text-neutral-900 shadow-sm transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
      >
        <span className={stateLayer(!done)}>
          <AppleMark className="h-5 w-5 -translate-y-[1px] transition-transform duration-300 group-hover:-translate-y-[3px]" />
          <span className="flex flex-col items-start leading-none">
            {/* Sized for monospace, not the sans this came from: mono glyphs are
                wider, so the subline ran almost to the pill's edges. */}
            <span className="text-[13px] font-medium">Download for macOS</span>
            <span className="mt-1 text-[10px] font-normal text-neutral-400">
              Universal &middot; Apple Silicon &amp; Intel
            </span>
          </span>
        </span>

        <span className={stateLayer(done)}>
          <TickMark className="h-5 w-5" />
          <span className="text-[13px] font-medium">Ready to install</span>
        </span>
      </a>

      <p className="text-xs text-neutral-400">{DOWNLOAD_META}</p>
    </div>
  );
};


const QUARANTINE_CMD = 'xattr -d com.apple.quarantine /Applications/RapidLog.app';
const REPO_URL = 'https://github.com/Isafe-nk/rapid-log';

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <div className="flex gap-3">
    <span className="shrink-0 w-4 text-[9px] font-black text-neutral-300 tabular-nums pt-0.5">
      {n}
    </span>
    <div className="flex-1 min-w-0 space-y-1.5">{children}</div>
  </div>
);

const MacInstallSteps: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(QUARANTINE_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable in some embedded web views. Say so rather
      // than leaving the icon unchanged, which reads as nothing happening.
      window.prompt('Copy this command:', QUARANTINE_CMD);
    }
  };

  return (
    <div className="text-left space-y-3">
      <p className="text-[9px] uppercase tracking-widest font-black text-neutral-400">
        After downloading
      </p>

      <Step n={1}>
        <p className="text-[10px] leading-relaxed text-neutral-400 tracking-wide">
          Move <span className="text-neutral-600">RapidLog</span> to your Applications folder.
        </p>
      </Step>

      <Step n={2}>
        <p className="text-[10px] leading-relaxed text-neutral-400 tracking-wide">
          Run this once in Terminal. macOS blocks the app otherwise — it is open source but
          not signed by Apple.
        </p>
        <button
          onClick={copy}
          title="Copy to clipboard"
          className="group w-full flex items-center gap-2 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200/70 rounded-xl px-3 py-2 transition-colors"
        >
          <code className="flex-1 text-left text-[9px] font-mono text-neutral-500 group-hover:text-neutral-700 break-all leading-relaxed">
            {QUARANTINE_CMD}
          </code>
          <span className="shrink-0 text-neutral-400 group-hover:text-neutral-600">
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </span>
        </button>
      </Step>

      <Step n={3}>
        <p className="text-[10px] leading-relaxed text-neutral-400 tracking-wide">
          Open it and sign in. Rapid Log lives in your menu bar.
        </p>
      </Step>

      <p className="text-[10px] leading-relaxed text-neutral-400 tracking-wide pt-1">
        Or{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-neutral-600 hover:text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors"
        >
          build it from source
        </a>{' '}
        — a build of your own skips step 2 entirely.
      </p>
    </div>
  );
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  // `user === null` means two different things — "signed out" and "we have not
  // heard back yet" — so the two are tracked apart. Showing the landing page on
  // the second one is what made it flash on every launch.
  const [authReady, setAuthReady] = useState(false);
  const [redirectChecked, setRedirectChecked] = useState(!isNative());
  const [todosLoaded, setTodosLoaded] = useState(false);
  // Guest entries live in React state and nowhere else — no Firestore, no
  // localStorage. Every mutation below already updates state first and only
  // then persists, so guest mode is the same code path with the write skipped.
  const [isGuest, setIsGuest] = useState(false);
  // The query fetched every task ever created on each launch, then filtered to
  // one day client-side. It now covers a window, widened on demand.
  const [loadFromMs, setLoadFromMs] = useState(() => windowStartFor(new Date()));
  const [bounded, setBounded] = useState(true);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [todayStart, setTodayStart] = useState(startOfToday);
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputHour, setInputHour] = useState('9');
  const [inputMinute, setInputMinute] = useState('00');
  const [inputAMPM, setInputAMPM] = useState<'AM' | 'PM'>('AM');
  const [endInputHour, setEndInputHour] = useState('10');
  const [endInputMinute, setEndInputMinute] = useState('00');
  const [endInputAMPM, setEndInputAMPM] = useState<'AM' | 'PM'>('AM');
  const [selectedType, setSelectedType] = useState<EntryType>('task');
  const [selectedTime, setSelectedTime] = useState<TimeOfDay>('morning');
  const [isPriority, setIsPriority] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [timeError, setTimeError] = useState<string | null>(null);
  const [showEndTimeInput, setShowEndTimeInput] = useState(false);
  const [dragOverTime, setDragOverTime] = useState<TimeOfDay | null>(null);
  // id -> the completed state it is moving toward. A settling row stays in the
  // list it is currently in, drawn in its new state, so completing a task is
  // acknowledged instead of the row vanishing on contact.
  const [settling, setSettling] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Partial<Record<TimeOfDay, HTMLDivElement | null>>>({});
  const [useTime, setUseTime] = useState(false);

  // Context menu state for right click
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    todo: Todo;
  } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  const [authError, setAuthError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorTimer = useRef<number | null>(null);
  // Shown after downloading from inside the app, where there is no room for the
  // standing note the sign-in screen carries. Deliberately not auto-dismissed:
  // it holds a command to copy.
  const [macHelp, setMacHelp] = useState(false);

  const showNotice = (message: string) => {
    setSaveError(message);
    if (saveErrorTimer.current) window.clearTimeout(saveErrorTimer.current);
    saveErrorTimer.current = window.setTimeout(() => setSaveError(null), 6000);
  };

  const reportSaveError = (error: unknown, context: string) => {
    console.error(context, error);
    showNotice(describeSaveError(error));
  };

  useEffect(() => () => {
    if (saveErrorTimer.current) window.clearTimeout(saveErrorTimer.current);
  }, []);

  // The single switch every mutation consults. State updates run either way;
  // only the write to Firestore is skipped.
  const localOnly = isGuest && !user;

  const startSignIn = async () => {
    setAuthError(null);
    // Native signs in by redirect, which navigates the whole page to Google and
    // back. React state does not survive that, so the entries have to be handed
    // across the trip. Written only at this moment, never during normal guest
    // use, and cleared the instant it is read.
    if (localOnly && todos.length) {
      try {
        localStorage.setItem(
          GUEST_HANDOFF_KEY,
          JSON.stringify({ at: Date.now(), todos })
        );
      } catch (error) {
        console.error('Could not stash guest entries for sign-in:', error);
      }
    }
    try {
      await signInWithGoogle();
    } catch (e: any) {
      const message = e?.code || e?.message || 'Sign in failed';
      setAuthError(message);
      // authError only renders on the sign-in screen, which a guest is past.
      // Without this, failing to sign in from the header does nothing visible.
      if (isGuest) showNotice(message);
      try {
        localStorage.removeItem(GUEST_HANDOFF_KEY);
      } catch {
        /* nothing to undo */
      }
    }
  };

  // Available everywhere, including the Mac app. One caveat there: WKWebView
  // does not present `beforeunload` unless the host implements the JS panel
  // delegate, so quitting the app skips the warning the browser gives. The
  // marquee is the only thing standing between a guest and losing the lot.
  const guestAvailable = true;

  const pendingGuestTodos = useRef<Todo[]>([]);
  useEffect(() => {
    if (localOnly) pendingGuestTodos.current = todos;
  }, [localOnly, todos]);

  // Guards the import against running twice. StrictMode double-invokes effects
  // in development, and a second run here would duplicate every entry in a real
  // account — state alone is too late to stop it, since both runs see the same
  // committed value.
  const guestImportStarted = useRef(false);

  // Carry what a guest wrote into the account they just signed into. Adding
  // only, never merging, so there is no conflict to resolve.
  useEffect(() => {
    // Signing out arms it again: sign in, log out, continue as guest and sign
    // in a second time, and the latch would otherwise still be closed from the
    // first import and quietly drop the second batch.
    if (!user) {
      guestImportStarted.current = false;
      return;
    }
    if (guestImportStarted.current) return;

    // Popup sign-in keeps the page alive, so the entries are still in memory.
    // Redirect sign-in does not, so fall back to what was stashed before leaving.
    let carried = pendingGuestTodos.current;
    if (!carried.length) carried = readGuestHandoff();
    if (!isGuest && !carried.length) return;

    guestImportStarted.current = true;
    setIsGuest(false);
    pendingGuestTodos.current = [];

    // A batch is rejected whole, so one malformed entry would take every other
    // entry down with it. Drop anything that would not pass the rules instead.
    const writable = carried.filter(isWritableEntry);
    if (!writable.length) {
      clearGuestHandoff();
      return;
    }

    (async () => {
      try {
        const batch = writeBatch(db);
        writable.forEach(({ id, ...entry }) => {
          batch.set(doc(collection(db, 'todos')), { ...entry, userId: user.uid });
        });
        await batch.commit();
        // Only now. Clearing before the commit threw away the one copy that
        // survives a redirect, leaving a failure with nothing to retry from.
        clearGuestHandoff();
        showNotice(`Saved ${writable.length} ${writable.length === 1 ? 'entry' : 'entries'} to your account`);
      } catch (error) {
        // The stash is deliberately left in place: the batch is atomic, so
        // nothing was half-written and signing in again can retry cleanly.
        console.error('Error importing guest entries:', error);
        showNotice("Couldn't save your guest entries — they were not kept");
      }
    })();
  }, [user, isGuest]);

  // A guest closing the tab loses everything. Warn once there is something
  // to lose; browsers show their own wording, not this string.
  useEffect(() => {
    if (!localOnly || todos.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [localOnly, todos.length]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });

    if (isNative()) {
      // On the redirect flow the first auth callback reports null and the real
      // result lands afterwards. Waiting for it stops the app deciding you are
      // signed out and showing the landing page mid sign-in.
      const settle = () => setRedirectChecked(true);
      // Never leave the splash up for good if this cannot settle.
      const bail = window.setTimeout(settle, 5000);
      handleRedirectResult()
        .catch((e: any) => setAuthError(e?.code || e?.message || 'Sign in failed'))
        .finally(() => {
          window.clearTimeout(bail);
          settle();
        });
    }

    return () => unsubscribe();
  }, []);

  // Reach further back when a date outside the loaded window is opened.
  useEffect(() => {
    const needed = windowStartFor(currentDate);
    setLoadFromMs(prev => (needed < prev ? needed : prev));
  }, [currentDate]);

  // Firestore Listener
  useEffect(() => {
    // A guest has no server-side log to subscribe to, and clearing `todos` here
    // would wipe what they have typed on every re-render of this effect.
    if (isGuest && !user) {
      setTodosLoaded(true);
      return;
    }

    if (!user) {
      setTodos([]);
      setTodosLoaded(true);
      return;
    }

    // Waiting on this user's first snapshot. Without resetting, the flag set by
    // the signed-out branch above would let an empty list render first.
    setTodosLoaded(false);

    const q = bounded
      ? query(
          collection(db, 'todos'),
          where('userId', '==', user.uid),
          where('createdAt', '>=', loadFromMs)
        )
      : query(collection(db, 'todos'), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTodos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Todo[];
      setTodos(fetchedTodos);
      setTodosLoaded(true);
    }, (error) => {
      console.error("Firestore error:", error);
      // The bounded query needs a composite index on (userId, createdAt). If it
      // is missing or still building the query fails outright, so fall back to
      // the unbounded one rather than showing an empty log.
      if (bounded) {
        console.warn("[RapidLog] Falling back to unbounded query");
        setBounded(false);
        return;
      }
      setTodosLoaded(true);
      // Both the bounded and unbounded reads failed, so the log is empty for a
      // reason rather than because there is nothing in it.
      showNotice("Couldn't load your log — check your connection");
    });

    return () => unsubscribe();
  }, [user, isGuest, loadFromMs, bounded]);

  // Roll `todayStart` over at midnight so a window left open overnight stops
  // reporting yesterday. Reschedules itself so a DST shift can't strand it.
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(() => {
        setTodayStart(startOfToday());
        schedule();
      }, nextMidnight.getTime() - Date.now() + 500);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  // Push task data to macOS native menu bar
  useEffect(() => {
    if (!(window as any)?.__MACOS_NATIVE__) return;
    const today = new Date(todayStart);
    const todayTasks = todos
      .filter(t => isSameDay(entryDateOf(t, today), today))
      .sort(byTimeThenCreated);
    try {
      const handler = (window as any).webkit?.messageHandlers?.taskUpdate;
      if (handler) {
        console.log(`[RapidLog Native] Posting ${todayTasks.length} tasks to native menu bar`);
        handler.postMessage(JSON.stringify(todayTasks));
      }
    } catch (e) {
      console.error("[RapidLog Native] Error posting task update:", e);
    }
  }, [todos, user, todayStart]);

  // The drop highlight is driven from one window-level listener rather than from
  // each section's own drag events. Per-section handlers only fired as the cursor
  // crossed a section's edge — events raised over the task rows inside never
  // reached them — so the outline lit on entry and then never refreshed. dragover
  // always reaches the window and carries trustworthy coordinates, so hit-testing
  // the pointer against each section keeps the highlight in step with the cursor.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      const { clientX: x, clientY: y } = e;
      let active: TimeOfDay | null = null;
      for (const { id } of TIMES_OF_DAY) {
        const r = sectionRefs.current[id]?.getBoundingClientRect();
        if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          active = id;
          break;
        }
      }
      setDragOverTime(prev => (prev === active ? prev : active));
    };

    // A drag cancelled with Escape, or released outside any section, would
    // otherwise strand the highlight.
    const clear = () => setDragOverTime(null);

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  // Global listener to close context menu
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Set default times based on selected section
  React.useEffect(() => {
    if (selectedTime === 'morning') {
      setInputHour('9'); setInputMinute('00'); setInputAMPM('AM');
      setEndInputHour('10'); setEndInputMinute('00'); setEndInputAMPM('AM');
    } else if (selectedTime === 'noon') {
      setInputHour('12'); setInputMinute('00'); setInputAMPM('PM');
      setEndInputHour('1'); setEndInputMinute('00'); setEndInputAMPM('PM');
    } else {
      setInputHour('7'); setInputMinute('00'); setInputAMPM('PM');
      setEndInputHour('8'); setEndInputMinute('00'); setEndInputAMPM('PM');
    }
    setShowEndTimeInput(false);
  }, [selectedTime]);

  // Auto-flip 12 to PM
  React.useEffect(() => {
    if (inputHour === '12' && inputAMPM === 'AM') {
      setInputAMPM('PM');
    }
  }, [inputHour]);

  // Auto-adjust end time to be 1 hour after start time
  React.useEffect(() => {
    if (!inputHour) return;
    
    const h = parseInt(inputHour, 10);
    const m = parseInt(inputMinute || '0', 10);
    
    let start24 = h % 12;
    if (inputAMPM === 'PM') start24 += 12;
    const startMinutes = start24 * 60 + m;
    
    const endMinutes = startMinutes + 60;
    let endH24 = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    
    const endAMPM: 'AM' | 'PM' = endH24 >= 12 ? 'PM' : 'AM';
    let endH12 = endH24 % 12;
    if (endH12 === 0) endH12 = 12;
    
    setEndInputHour(String(endH12));
    setEndInputMinute(endM.toString().padStart(2, '0'));
    setEndInputAMPM(endAMPM);
  }, [inputHour, inputMinute, inputAMPM]);

  // Auto-clear time error
  React.useEffect(() => {
    if (timeError) setTimeError(null);
  }, [inputHour, inputMinute, inputAMPM, endInputHour, endInputMinute, endInputAMPM, selectedTime]);

  const activeTodos = useMemo(() => {
    const today = new Date(todayStart);
    return todos
      .filter(t => (settling[t.id] === undefined ? !t.completed : settling[t.id] === true)
        && isSameDay(entryDateOf(t, today), currentDate))
      .sort(byTimeThenCreated);
  }, [todos, currentDate, todayStart, settling]);

  const completedTodos = useMemo(() => {
    const today = new Date(todayStart);
    return todos
      .filter(t => (settling[t.id] === undefined ? t.completed : settling[t.id] === false)
        && isSameDay(entryDateOf(t, today), currentDate))
      .sort(byTimeThenCreated);
  }, [todos, currentDate, todayStart, settling]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || (!user && !isGuest)) return;
    setTimeError(null);

    let time: string | null = null;
    let endTime: string | null = null;

    if (useTime) {
      let h = parseInt(inputHour, 10);
      let m = parseInt(inputMinute || '0', 10);
      
      let h24 = h % 12;
      if (inputAMPM === 'PM') h24 += 12;
      const startTimeValue = h24 * 60 + m;

      const displayHours = h || 12;
      const displayMinutes = m.toString().padStart(2, '0');
      time = `${displayHours}:${displayMinutes} ${inputAMPM}`;

      let endTimeValue = 0;
      if (showEndTimeInput && endInputHour) {
        let eh = parseInt(endInputHour, 10);
        const em = parseInt(endInputMinute || '0', 10);
        
        let eh24 = eh % 12;
        if (endInputAMPM === 'PM') eh24 += 12;
        endTimeValue = eh24 * 60 + em;

        const endDisplayHours = eh || 12;
        const endDisplayMinutes = em.toString().padStart(2, '0');
        endTime = `${endDisplayHours}:${endDisplayMinutes} ${endInputAMPM}`;
      }

      if (endTime && endTimeValue === startTimeValue) {
        setTimeError('Start and end time cannot be the same');
        return;
      }

      // A night entry may legitimately run past midnight (11 PM – 1 AM), so an
      // end time earlier than the start is only an error outside that section.
      if (endTime && endTimeValue < startTimeValue && selectedTime !== 'night') {
        setTimeError('End time must be after start time');
        return;
      }

      const isMorning = startTimeValue < 720;
      const isAfternoon = startTimeValue >= 720 && startTimeValue < 1020;
      const isNight = startTimeValue >= 1020;

      if (selectedTime === 'morning' && !isMorning) {
        setTimeError('Morning entries should be before 12:00 PM');
        return;
      }
      if (selectedTime === 'noon' && !isAfternoon) {
        setTimeError('Noon entries should be between 12:00 – 5:00 PM');
        return;
      }
      if (selectedTime === 'night' && !isNight) {
        setTimeError('Night entries should be after 5:00 PM');
        return;
      }
    }
    
    const entryDate = new Date(currentDate);
    const now = new Date();
    if (entryDate.toDateString() === now.toDateString()) {
      entryDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    } else {
      entryDate.setHours(12, 0, 0, 0);
    }
    
    const newTodoData = {
      text: inputText.trim(),
      completed: false,
      type: selectedType,
      timeOfDay: selectedTime,
      time: time,
      endTime: endTime,
      priority: isPriority,
      // Stamped with the guest's own id so the entries can be written straight
      // into their account if they sign in later.
      userId: user?.uid ?? GUEST_USER_ID,
      createdAt: entryDate.getTime(),
    };

    setInputText('');
    if (selectedTime === 'morning') {
      setInputHour('9'); setInputMinute('00'); setInputAMPM('AM');
      setEndInputHour('10'); setEndInputMinute('00'); setEndInputAMPM('AM');
    } else if (selectedTime === 'noon') {
      setInputHour('12'); setInputMinute('00'); setInputAMPM('PM');
      setEndInputHour('1'); setEndInputMinute('00'); setEndInputAMPM('PM');
    } else {
      setInputHour('7'); setInputMinute('00'); setInputAMPM('PM');
      setEndInputHour('8'); setEndInputMinute('00'); setEndInputAMPM('PM');
    }
    setShowEndTimeInput(false);
    setIsPriority(false);

    // Every other mutation updates state and then persists. This one relied on
    // the snapshot to bring the row back, which never arrives for a guest, so
    // the append happens here instead.
    if (isGuest && !user) {
      setTodos(prev => [...prev, { id: newLocalId(), ...newTodoData }]);
      return;
    }

    try {
      await addDoc(collection(db, 'todos'), newTodoData);
    } catch (error) {
      reportSaveError(error, 'Error adding todo:');
      // The box was cleared optimistically, so without this the typed text is
      // simply gone and nothing was ever saved.
      setInputText(newTodoData.text);
    }
  };

  const clearSettling = (id: string) =>
    setSettling(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    // Ignore repeat clicks while a row is mid-animation.
    if (settling[id] !== undefined) return;

    const target = !todo.completed;
    setSettling(prev => ({ ...prev, [id]: target }));
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: target } : t));
    window.setTimeout(() => clearSettling(id), 320);

    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { completed: target });
    } catch (error) {
      reportSaveError(error, 'Error toggling todo:');
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: todo.completed } : t));
      clearSettling(id);
    }
  };

  const togglePriority = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, priority: !t.priority } : t));
    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { priority: !todo.priority });
    } catch (error) {
      reportSaveError(error, 'Error toggling priority:');
      setTodos(prev => prev.map(t => t.id === id ? { ...t, priority: todo.priority } : t));
    }
  };

  const updateTodoText = async (id: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const previous = todos.find(t => t.id === id)?.text;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, text: trimmed } : t));
    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { text: trimmed });
    } catch (error) {
      reportSaveError(error, 'Error updating todo text:');
      if (previous !== undefined) {
        setTodos(prev => prev.map(t => t.id === id ? { ...t, text: previous } : t));
      }
    }
  };

  const changeTimeOfDay = async (id: string, timeOfDay: TimeOfDay) => {
    const previous = todos.find(t => t.id === id)?.timeOfDay;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, timeOfDay } : t));
    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { timeOfDay });
    } catch (error) {
      reportSaveError(error, 'Error changing time of day:');
      if (previous) {
        setTodos(prev => prev.map(t => t.id === id ? { ...t, timeOfDay: previous } : t));
      }
    }
  };

  const deleteTodo = async (id: string) => {
    const previousTodos = todos;
    setTodos(prev => prev.filter(t => t.id !== id));
    if (localOnly) return;
    try {
      await deleteDoc(doc(db, 'todos', id));
    } catch (error) {
      reportSaveError(error, 'Error deleting todo:');
      setTodos(previousTodos);
    }
  };

  // Expose toggle function for macOS native menu bar (placed after toggleTodo declaration)
  const toggleTodoRef = useRef(toggleTodo);
  useEffect(() => {
    toggleTodoRef.current = toggleTodo;
  }, [toggleTodo]);

  useEffect(() => {
    (window as any).__toggleTodoFromNative = (id: string) => {
      console.log(`[RapidLog Native] Toggling todo from native menu bar: ${id}`);
      if (toggleTodoRef.current) {
        toggleTodoRef.current(id);
      }
    };
    return () => {
      delete (window as any).__toggleTodoFromNative;
    };
  }, []);

  // Queried by the macOS app before it quits. WKWebView never presents
  // `beforeunload`, so this is the only thing standing between a Mac guest and
  // losing everything to a stray Cmd-Q. Read through a ref so the exposed
  // function is installed once and still sees current state.
  const unsavedGuestCount = useRef(0);
  useEffect(() => {
    unsavedGuestCount.current = localOnly ? todos.length : 0;
  }, [localOnly, todos.length]);

  useEffect(() => {
    (window as any).__unsavedGuestCount = () => unsavedGuestCount.current;
    return () => {
      delete (window as any).__unsavedGuestCount;
    };
  }, []);

  const formattedDate = currentDate.toLocaleDateString(undefined, {
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const jumpToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setViewDate(today);
    setShowCalendar(false);
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const prevMonthDays = getDaysInMonth(year, month - 1);
    
    const days = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, currentMonth: false, date: new Date(year, month - 1, prevMonthDays - i) });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, currentMonth: true, date: new Date(year, month, i) });
    }
    const remainingSlots = 42 - days.length;
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({ day: i, currentMonth: false, date: new Date(year, month + 1, i) });
    }
    return days;
  }, [viewDate]);

  // Auth has genuinely answered: it reported once, and any pending redirect has
  // resolved. Only then does a null user actually mean "signed out".
  const authSettled = authReady && redirectChecked;
  const showSplash = !authSettled || (!!user && !todosLoaded);
  const showAuthScreen = authSettled && !user && !isGuest;
  // The app is the visible layer: nothing is covering it.
  const appVisible = !showSplash && !showAuthScreen;

  const changeMonth = (offset: number) => {
    const d = new Date(viewDate);
    d.setMonth(d.getMonth() + offset);
    setViewDate(d);
  };

  return (
    <div className="min-h-screen bg-[#fcfcf9] text-[#1a1a1a] font-mono selection:bg-neutral-200 relative">
      {/* Auth Screen */}
      <AnimatePresence>
        {showAuthScreen && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#fcfcf9] flex flex-col items-center justify-center p-10"
          >
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="group absolute top-6 right-8 flex items-center gap-2 bg-white border border-neutral-200/70 hover:border-neutral-300 shadow-sm hover:shadow-md px-4 py-2 rounded-full transition-all active:scale-[0.98]"
            >
              <Github size={13} className="text-neutral-400 group-hover:text-neutral-900 transition-colors" />
              <span className="text-[10px] uppercase tracking-[0.15em] font-black text-neutral-600 group-hover:text-neutral-900 transition-colors">
                View Source
              </span>
            </a>

            <div className="max-w-sm w-full text-center space-y-12">
              <div className="space-y-4">
                <h2 className="text-xs uppercase tracking-[0.5em] font-black text-neutral-300">Journal</h2>
                <h1 className="text-5xl font-serif italic text-neutral-800">Daily Log</h1>
                <p className="text-xs text-neutral-400 leading-relaxed tracking-wider">
                  A minimalist space for your thoughts, tasks, and events. 
                  Secure, private, and always accessible.
                </p>
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={startSignIn}
                  className="group w-full flex items-center justify-center gap-4 bg-white border border-neutral-100 py-4 px-6 rounded-2xl shadow-sm hover:shadow-md hover:border-neutral-200 transition-all active:scale-[0.98]"
                >
                  <div className="bg-neutral-50 p-2 rounded-lg group-hover:bg-neutral-100 transition-colors">
                    <LogIn size={20} className="text-neutral-400 group-hover:text-neutral-900" />
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.2em] font-black text-neutral-600 group-hover:text-neutral-900">Sign in with Google</span>
                </button>

                {guestAvailable && (
                  <button
                    onClick={() => setIsGuest(true)}
                    className="w-full text-[10px] uppercase tracking-[0.15em] font-black text-neutral-400 hover:text-neutral-700 transition-colors py-2"
                  >
                    Continue as guest
                  </button>
                )}

                {authError && (
                  <p className="text-[10px] text-red-500 font-bold tracking-wider pt-1 break-words">
                    {authError}
                  </p>
                )}
              </div>

              {/* Its own section in the space-y-12 stack rather than a third
                  item in the button list. Signing in and downloading are
                  different decisions and were reading as three equal choices. */}
              {!(window as any)?.__MACOS_NATIVE__ && (
                <div className="space-y-6">
                  <MacDownloadButton />
                  <MacInstallSteps />
                </div>
              )}
            </div>
          </motion.div>
        )}

        {showSplash && (
          <motion.div
            key="loading"
            // Opaque from the first frame; fading in would flash the app behind.
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.45, ease: EASE } }}
            className="fixed inset-0 z-[100] bg-[#fcfcf9] flex items-center justify-center"
          >
            {/* Held back a beat so a fast load never flashes a spinner. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.25, duration: 0.3 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              className="w-8 h-8 border-2 border-neutral-100 border-t-neutral-900 rounded-full animate-spin"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dot Grid Background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]" 
        style={{ 
          backgroundImage: 'radial-gradient(#000 1px, transparent 0)', 
          backgroundSize: '24px 24px' 
        }} 
      />

      {/* A moving strip is hard to stop noticing, which is the point: guest
          entries are discarded, and a static badge stops registering after a
          minute. Fixed rather than in flow so it survives scrolling. */}
      {localOnly && (
        <div className="fixed top-0 inset-x-0 z-[120] h-7 bg-neutral-900 overflow-hidden flex items-center pointer-events-none">
          <motion.div
            className="flex shrink-0 whitespace-nowrap"
            // Two identical halves scrolled by exactly one half: the second
            // arrives where the first began, so the seam never shows.
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 24, ease: 'linear', repeat: Infinity }}
          >
            {[0, 1].map(half => (
              <div key={half} className="flex shrink-0" aria-hidden={half === 1}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="text-[9px] uppercase tracking-[0.3em] font-black text-[#fcfcf9]/70 px-6"
                  >
                    Guest mode
                  </span>
                ))}
              </div>
            ))}
          </motion.div>
        </div>
      )}

      <div className={`max-w-2xl mx-auto px-10 py-24 relative z-10 ${localOnly ? 'pt-28' : ''}`}>
        <motion.header className="mb-16 relative" {...reveal(appVisible, 0.1)}>
          <div className="flex items-start justify-between">
            <div className="flex gap-4 items-start">
              <div className="flex flex-col">
                <h2 className="text-xs uppercase tracking-[0.3em] font-bold text-neutral-400 mb-2">Daily Log</h2>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShowCalendar(!showCalendar)}
                    className="group text-left focus:outline-none"
                  >
                    <h1 className="text-3xl font-serif italic text-neutral-800 group-hover:text-neutral-500 transition-colors">
                      {formattedDate}
                    </h1>
                  </button>

                  <div className="flex items-center justify-center mt-1 w-8 shrink-0">
                    {currentDate.toDateString() === new Date().toDateString() ? (
                      <button 
                        onClick={() => setShowCalendar(!showCalendar)}
                        className="text-neutral-200 hover:text-neutral-400 border-none transition-colors"
                        title="Open Calendar"
                      >
                        <Calendar size={18} />
                      </button>
                    ) : (
                      <button 
                        onClick={jumpToToday}
                        className="text-neutral-300 hover:text-amber-500 border-none transition-colors"
                        title="Return to Today"
                      >
                        <RotateCcw size={18} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              {localOnly && (
                <div className="flex items-center gap-3">
                  {!(window as any)?.__MACOS_NATIVE__ && (
                    <a
                      href="/RapidLog-macOS.zip"
                      download="RapidLog-macOS.zip"
                      onClick={() => setMacHelp(true)}
                      className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 bg-neutral-100/70 border border-neutral-200/50 px-3 py-1.5 rounded-full"
                      title="Download Desktop Mac App"
                    >
                      <Download size={10} />
                      Get Mac App
                    </a>
                  )}
                  {/* Deliberately identical to the chip beside it — same tint,
                      border, padding, icon size and placement — so the pair
                      reads as one row rather than two competing treatments. */}
                  <button
                    onClick={startSignIn}
                    title="Sign in to save these entries"
                    className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 bg-neutral-100/70 border border-neutral-200/50 px-3 py-1.5 rounded-full"
                  >
                    <LogIn size={10} />
                    Sign in to save
                  </button>
                </div>
              )}
              {user && (
                <div className="flex items-center gap-3">
                  {!(window as any)?.__MACOS_NATIVE__ && (
                    <a
                      href="/RapidLog-macOS.zip"
                      download="RapidLog-macOS.zip"
                      onClick={() => setMacHelp(true)}
                      className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 bg-neutral-100/70 border border-neutral-200/50 px-3 py-1.5 rounded-full"
                      title="Download Desktop Mac App"
                    >
                      <Download size={10} />
                      Get Mac App
                    </a>
                  )}
                  <div className="flex items-center gap-3 bg-neutral-50/50 p-1 pr-3 rounded-full border border-neutral-100/50 group">
                    <div className="w-8 h-8 rounded-full bg-neutral-100 overflow-hidden border border-white shadow-sm">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-400">
                          <User size={14} />
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={logout}
                      className="text-[9px] uppercase tracking-widest font-black text-neutral-300 hover:text-red-500 transition-colors flex items-center gap-2"
                    >
                      Logout
                      <LogOut size={10} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <AnimatePresence>
            {showCalendar && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full left-0 mt-4 bg-white border border-neutral-100 shadow-2xl p-6 rounded-2xl z-50 w-80 font-sans"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-sm text-neutral-900">
                    {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </h3>
                  <div className="flex gap-1">
                    <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-neutral-50 rounded text-neutral-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <button onClick={() => changeMonth(1)} className="p-1 hover:bg-neutral-50 rounded text-neutral-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                    <button onClick={() => setShowCalendar(false)} className="ml-2 p-1 hover:bg-red-50 rounded text-red-300">
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <span key={i} className="text-[10px] font-black text-neutral-300">{d}</span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((d, i) => {
                    const isSelected = d.date.toDateString() === currentDate.toDateString();
                    const isToday = d.date.toDateString() === new Date().toDateString();
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setCurrentDate(d.date);
                          setShowCalendar(false);
                        }}
                        className={`
                          aspect-square flex items-center justify-center text-xs rounded-lg transition-all
                          ${d.currentMonth ? 'text-neutral-700' : 'text-neutral-200'}
                          ${isSelected ? 'bg-neutral-900 text-white shadow-lg scale-110 z-10' : 'hover:bg-neutral-50'}
                          ${isToday && !isSelected ? 'text-amber-600 font-black' : ''}
                        `}
                      >
                        {d.day}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        {/* Input area */}
        <motion.form onSubmit={addTodo} className="mb-20" {...reveal(appVisible, 0.18)}>
          <div className="flex flex-col gap-6 border-l-2 border-neutral-100 pl-6 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xl w-6 flex justify-center text-neutral-400">
                {selectedType === 'task' ? (
                  <div className="w-5 h-5 border-2 border-neutral-200 rounded" />
                ) : selectedType === 'event' ? (
                  BULLETS.event
                ) : (
                  <div className="h-full w-0.5 bg-neutral-200 ml-2" />
                )}
              </span>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                maxLength={1000}
                ref={inputRef}
                placeholder="Log..."
                className="flex-1 bg-transparent border-none py-1 text-lg focus:outline-none placeholder:text-neutral-300"
              />
            </div>
            
            <div className="space-y-4 pl-9">
              <div className="flex items-center justify-between">
                <div className="flex gap-4">
                  {(['task', 'event', 'note'] as EntryType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setSelectedType(type); inputRef.current?.focus(); }}
                      className={`text-[10px] uppercase tracking-widest font-bold transition-all ${
                        selectedType === type ? 'text-neutral-900 underline underline-offset-4' : 'text-neutral-300 hover:text-neutral-500'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setIsPriority(!isPriority); inputRef.current?.focus(); }}
                  className={`transition-colors py-1 px-2 -mr-2 ${isPriority ? 'text-amber-500' : 'text-neutral-200'}`}
                >
                  <Star size={14} fill={isPriority ? "currentColor" : "none"} />
                </button>
              </div>

              <div className="flex flex-col gap-3 border-t border-neutral-50 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-4">
                    {TIMES_OF_DAY.map((time) => (
                      <button
                        key={time.id}
                        type="button"
                        onClick={() => { setSelectedTime(time.id); inputRef.current?.focus(); }}
                        className={`text-[9px] uppercase tracking-[0.2em] font-bold py-1 px-3 rounded-full border transition-all ${
                          selectedTime === time.id 
                            ? 'bg-neutral-900 text-[#fcfcf9] border-neutral-900 shadow-sm' 
                            : 'text-neutral-300 border-neutral-100 hover:text-neutral-500 hover:border-neutral-300'
                        }`}
                      >
                        {time.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setUseTime(!useTime); setShowEndTimeInput(false); inputRef.current?.focus(); }}
                    className="text-[9px] text-neutral-300 hover:text-neutral-500 transition-colors tracking-wider"
                  >
                    {useTime ? '− time' : '+ time'}
                  </button>
                </div>

                <AnimatePresence>
                  {useTime && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-2 pt-1">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowEndTimeInput(!showEndTimeInput)}
                            className="text-[9px] text-neutral-300 hover:text-neutral-500 transition-colors tracking-wider mr-auto"
                          >
                            {showEndTimeInput ? '− end time' : '+ end time'}
                          </button>
                          <span className="text-[9px] uppercase tracking-widest font-black text-neutral-200 mr-1">Start</span>
                          <div className="flex items-center gap-1">
                            <div className="flex items-center bg-neutral-50/50 rounded-md px-1.5 py-1 gap-1 border border-neutral-100">
                              <select
                                value={inputHour}
                                onChange={(e) => setInputHour(e.target.value)}
                                className="bg-transparent text-[10px] w-7 focus:outline-none font-bold appearance-none text-center cursor-pointer hover:text-neutral-600 transition-colors"
                              >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                              <span className="text-[10px] text-neutral-300 font-bold">:</span>
                              <select
                                value={inputMinute}
                                onChange={(e) => setInputMinute(e.target.value)}
                                className="bg-transparent text-[10px] w-7 focus:outline-none font-bold appearance-none text-center cursor-pointer hover:text-neutral-600 transition-colors"
                              >
                                {['00', '15', '30', '45'].map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              onClick={() => setInputAMPM(inputAMPM === 'AM' ? 'PM' : 'AM')}
                              className="text-[9px] font-black uppercase tracking-tighter bg-neutral-100 px-1.5 py-1 rounded text-neutral-400 hover:text-neutral-900 transition-colors min-w-[28px]"
                            >
                              {inputAMPM}
                            </button>
                          </div>
                        </div>

                        <AnimatePresence>
                          {showEndTimeInput && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="flex items-center justify-end gap-2 pt-1 border-t border-dashed border-neutral-50">
                                <span className="text-[9px] uppercase tracking-widest font-black text-neutral-200 mr-1">End</span>
                                <div className="flex items-center gap-1">
                                  <div className="flex items-center bg-neutral-50/50 rounded-md px-1.5 py-1 gap-1 border border-neutral-100">
                                    <select
                                      value={endInputHour}
                                      onChange={(e) => setEndInputHour(e.target.value)}
                                      className="bg-transparent text-[10px] w-7 focus:outline-none font-bold appearance-none text-center cursor-pointer hover:text-neutral-600 transition-colors"
                                    >
                                      {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                                        <option key={h} value={h}>{h}</option>
                                      ))}
                                    </select>
                                    <span className="text-[10px] text-neutral-300 font-bold">:</span>
                                    <select
                                      value={endInputMinute}
                                      onChange={(e) => setEndInputMinute(e.target.value)}
                                      className="bg-transparent text-[10px] w-7 focus:outline-none font-bold appearance-none text-center cursor-pointer hover:text-neutral-600 transition-colors"
                                    >
                                      {['00', '15', '30', '45'].map((m) => (
                                        <option key={m} value={m}>
                                          {m}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setEndInputAMPM(endInputAMPM === 'AM' ? 'PM' : 'AM')}
                                    className="text-[9px] font-black uppercase tracking-tighter bg-neutral-100 px-1.5 py-1 rounded text-neutral-400 hover:text-neutral-900 transition-colors min-w-[28px]"
                                  >
                                    {endInputAMPM}
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <AnimatePresence>
              {timeError && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="pl-9 text-[10px] text-red-500 font-bold uppercase tracking-widest mt-2"
                >
                  {timeError}
                </motion.div>
              )}
            </AnimatePresence>

          </div>
          <input type="submit" hidden />
        </motion.form>

        {/* Sections */}
        <motion.div className="space-y-20" {...reveal(appVisible, 0.26)}>
          {TIMES_OF_DAY.map((time) => {
            const timeTodos = activeTodos.filter(t => t.timeOfDay === time.id);
            return (
              <motion.div
                key={time.id}
                ref={(el) => { sectionRefs.current[time.id] = el; }}
                className={`relative transition-colors duration-200 rounded-2xl -mx-4 px-4 py-4 ${
                  dragOverTime === time.id ? 'bg-neutral-100/60' : ''
                }`}
                // The highlight itself is owned by the window-level dragover
                // listener above; these only handle the drop.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverTime(null);
                  const todoId = e.dataTransfer.getData('todoId');
                  if (!todoId) return;
                  const dropped = todos.find(t => t.id === todoId);
                  if (dropped?.timeOfDay === time.id) return;
                  // Shares the optimistic path, so the entry moves on release
                  // instead of after the round trip.
                  changeTimeOfDay(todoId, time.id);
                }}
              >
                {/* A real bordered element rather than a CSS outline, and one
                    that animates. WebKit repaints lazily during a native drag,
                    so a static outline was applied but never drawn — it showed
                    once on entry and then went stale. An element animating on
                    every frame cannot go unpainted. */}
                {dragOverTime === time.id && (
                  <motion.div
                    className="absolute -inset-1 rounded-2xl border-2 border-dashed border-neutral-400 pointer-events-none"
                    initial={{ opacity: 0.4 }}
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}

                <motion.div layout="position" transition={{ layout: GLIDE }} className="flex items-center gap-4 mb-8">
                  <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-neutral-500">{time.label}</h3>
                  <div className="h-px flex-1 bg-neutral-100" />
                </motion.div>
                
                <div>
                  {timeTodos.map((entry) => (
                      <motion.div
                        key={entry.id}
                        // Position only. Full `layout` also animates size, which
                        // scales children and visibly squashes the text.
                        layout="position"
                        transition={{ layout: GLIDE }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.2 } }}
                        draggable={!entry.time && editingId !== entry.id}
                        onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                          if (entry.time || editingId === entry.id) { e.preventDefault(); return; }
                          e.dataTransfer.setData('todoId', entry.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            todo: entry
                          });
                        }}
                        className={`group flex items-start mb-4 transition-colors ${
                          entry.type === 'note' 
                            ? 'border-l-4 border-neutral-200 pl-6 py-2 ml-4' 
                            : 'gap-4 py-2 px-3 -mx-3 rounded-lg hover:bg-neutral-50/50'
                        } ${!entry.time && editingId !== entry.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        {entry.type !== 'note' && (
                          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                            {entry.priority && <span className="text-amber-500 w-4 font-bold text-lg leading-none">*</span>}
                            {!entry.priority && <span className="w-4" />}
                            
                            {entry.type === 'task' ? (
                              <button
                                onClick={() => toggleTodo(entry.id)}
                                className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors duration-200 cursor-pointer mt-0.5 ${
                                  entry.completed
                                    ? 'border-neutral-900 bg-neutral-900'
                                    : 'border-neutral-300 hover:border-neutral-900'
                                }`}
                              >
                                {entry.completed && (
                                  <motion.svg
                                    viewBox="0 0 24 24"
                                    className="w-3.5 h-3.5 text-white"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    initial={{ scale: 0.3, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    // Light damping so it overshoots slightly and
                                    // lands, rather than simply appearing.
                                    transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </motion.svg>
                                )}
                              </button>
                            ) : (
                              <span className="w-6 flex justify-center text-xl leading-none text-neutral-400">
                                {BULLETS.event}
                              </span>
                            )}
                          </div>
                        )}
                        
                        <div className={`flex-1 min-w-0 flex flex-col items-start text-lg leading-relaxed pt-0.5 ${entry.type === 'note' ? 'italic text-neutral-600' : ''}`}>
                          <div className="w-full min-w-0">
                          {editingId === entry.id ? (
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              maxLength={1000}
                              autoFocus
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  await updateTodoText(entry.id, editingText);
                                  setEditingId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingId(null);
                                }
                              }}
                              onBlur={async () => {
                                await updateTodoText(entry.id, editingText);
                                setEditingId(null);
                              }}
                              className="bg-transparent border-b-2 border-neutral-900 text-lg font-mono focus:outline-none w-full text-neutral-900"
                            />
                          ) : (
                            <span 
                              onDoubleClick={() => {
                                setEditingId(entry.id);
                                setEditingText(entry.text);
                              }}
                              className={`transition-colors duration-200 ${
                                entry.completed ? 'line-through decoration-neutral-300 text-neutral-400' : ''
                              }`}
                            >
                              {entry.text}
                            </span>
                          )}
                          </div>

                          {(entry.time || entry.endTime) && (
                            <span className="mt-1 text-[10px] text-neutral-400 font-bold tabular-nums opacity-60 leading-none whitespace-nowrap">
                              {entry.time}
                              {entry.endTime && <> — {entry.endTime}</>}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => deleteTodo(entry.id)}
                          className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-400 transition-all p-1 mt-0.5"
                          title="Delete entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      </motion.div>
                  ))}
                  
                  {/* No exit animation, for the same reason the rows have none:
                      holding it to fade out keeps its height in the section while
                      a row is already there, so the page is briefly taller and
                      everything below is pushed down and glides back. */}
                  {timeTodos.length === 0 && (
                    <motion.div
                      key="empty"
                      layout="position"
                      transition={{ layout: GLIDE }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: 0.2 } }}
                      className="pl-9 py-2 text-neutral-200 text-xs italic tracking-widest"
                    >
                      nothing logged
                    </motion.div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Archive Toggle */}
        {completedTodos.length > 0 && (
          <motion.div
            key="archive"
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE, layout: GLIDE }}
            className="mt-32 border-t border-neutral-100 pt-10"
          >
            <button
              onClick={() => setShowArchive(!showArchive)}
              className="text-[10px] uppercase tracking-[0.3em] font-bold text-neutral-300 hover:text-neutral-900 transition-colors"
            >
              {showArchive ? 'Close Archive' : `Archive (${completedTodos.length})`}
            </button>

            <AnimatePresence>
              {showArchive && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-12 space-y-4"
                >
                  {completedTodos.map((entry) => (
                    <motion.div
                      key={entry.id}
                      layout="position"
                      transition={{ layout: GLIDE }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          todo: entry
                        });
                      }}
                      className="flex items-start gap-4 py-2 px-3 -mx-3 rounded-lg group hover:bg-neutral-50/30"
                    >
                      <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                        {entry.priority && <span className="w-4" />}
                        {!entry.priority && <span className="w-4" />}
                        <button
                          onClick={() => toggleTodo(entry.id)}
                          className="w-5 h-5 border-2 border-neutral-900 bg-neutral-900 rounded flex items-center justify-center transition-colors cursor-pointer mt-0.5"
                        >
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="4">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-lg leading-relaxed pt-0.5 text-neutral-300 line-through decoration-neutral-200 truncate">
                          {entry.text}
                        </span>
                        {(entry.time || entry.endTime) && (
                          <span className="mt-1 text-[10px] text-neutral-300 font-bold tabular-nums opacity-70 leading-none whitespace-nowrap">
                            {entry.time}
                            {entry.endTime && <> — {entry.endTime}</>}
                          </span>
                        )}
                        <span className="mt-1 text-[9px] uppercase tracking-widest text-neutral-200 font-bold">
                          {entry.timeOfDay}
                        </span>
                      </div>
                      <button
                        onClick={() => deleteTodo(entry.id)}
                        className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-400 transition-all p-1 mt-0.5"
                      >
                        <Trash2 size={14} />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Save failure notice */}
      <div className="fixed inset-x-0 bottom-6 z-[150] flex justify-center px-6 pointer-events-none">
        <AnimatePresence>
          {saveError && (
            <motion.div
              key="save-error"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 14 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="pointer-events-auto flex items-center gap-3 bg-neutral-900 text-neutral-100 text-[11px] font-mono tracking-wide px-4 py-2.5 rounded-full shadow-2xl"
            >
              <span>{saveError}</span>
              <button
                onClick={() => setSaveError(null)}
                className="text-neutral-500 hover:text-white transition-colors"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Post-download instructions for the unsigned Mac app */}
      <div className="fixed inset-x-0 bottom-6 z-[140] flex justify-center px-6 pointer-events-none">
        <AnimatePresence>
          {macHelp && (
            <motion.div
              key="mac-help"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 14 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="pointer-events-auto w-full max-w-sm bg-white border border-neutral-200 rounded-2xl shadow-2xl px-5 py-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <MacInstallSteps />
                </div>
                <button
                  onClick={() => setMacHelp(false)}
                  className="shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors"
                  title="Dismiss"
                >
                  <X size={13} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right Click Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 260),
              zIndex: 9999
            }}
            className="w-48 bg-white border border-neutral-200 shadow-2xl rounded-xl p-1.5 font-mono text-xs text-neutral-800 space-y-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setEditingId(contextMenu.todo.id);
                setEditingText(contextMenu.todo.text);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 rounded-lg flex items-center gap-2.5 font-bold transition-colors"
            >
              <Edit3 size={13} className="text-neutral-500" />
              <span>Edit Entry</span>
            </button>

            <button
              onClick={() => {
                toggleTodo(contextMenu.todo.id);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 rounded-lg flex items-center gap-2.5 transition-colors"
            >
              <Check size={13} className={contextMenu.todo.completed ? "text-green-600" : "text-neutral-400"} />
              <span>{contextMenu.todo.completed ? 'Mark Incomplete' : 'Mark Complete'}</span>
            </button>

            <button
              onClick={() => {
                togglePriority(contextMenu.todo.id);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 rounded-lg flex items-center gap-2.5 transition-colors"
            >
              <Star size={13} fill={contextMenu.todo.priority ? "currentColor" : "none"} className={contextMenu.todo.priority ? "text-amber-500" : "text-neutral-400"} />
              <span>{contextMenu.todo.priority ? 'Remove Priority' : 'Mark Priority'}</span>
            </button>

            <div className="h-px bg-neutral-100 my-1" />

            <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-neutral-400 font-black">Move To</div>
            <div className="grid grid-cols-3 gap-1 px-1">
              {(['morning', 'noon', 'night'] as TimeOfDay[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    changeTimeOfDay(contextMenu.todo.id, t);
                    setContextMenu(null);
                  }}
                  className={`py-1 text-[10px] uppercase font-bold rounded text-center transition-colors ${
                    contextMenu.todo.timeOfDay === t ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {t === 'morning' ? 'Morn' : t === 'noon' ? 'Noon' : 'Nite'}
                </button>
              ))}
            </div>

            <div className="h-px bg-neutral-100 my-1" />

            <button
              onClick={() => {
                deleteTodo(contextMenu.todo.id);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 rounded-lg flex items-center gap-2.5 font-bold transition-colors"
            >
              <Trash2 size={13} className="text-red-500" />
              <span>Delete Entry</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
