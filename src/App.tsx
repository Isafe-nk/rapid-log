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
  Github,
  Clock,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { Todo, EntryType, TimeOfDay } from './types';
import { auth, db, signInWithGoogle, logout, handleRedirectResult, isNative } from './lib/firebase';
import { 
  collection, 
  query, 
  where, 
  orderBy,
  onSnapshot, 
  setDoc,
  updateDoc, 
  deleteDoc,
  doc,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

const TIMES_OF_DAY: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'noon', label: 'Noon' },
  { id: 'night', label: 'Night' }
];

// Each section owns a window of the clock, so the hour list can be bounded to
// it and AM/PM follows from the section rather than being asked for. The bounds
// are the ones addTodo used to check after the fact: morning is any AM hour,
// noon is 12:00–4:59 PM, night is 5:00 PM onward.
const SECTION_CLOCK: Record<TimeOfDay, { hours: number[]; meridiem: 'AM' | 'PM'; defaultHour: number }> = {
  morning: { hours: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], meridiem: 'AM', defaultHour: 9 },
  noon: { hours: [12, 1, 2, 3, 4], meridiem: 'PM', defaultHour: 12 },
  night: { hours: [5, 6, 7, 8, 9, 10, 11], meridiem: 'PM', defaultHour: 7 }
};

const MINUTE_OPTIONS = ['00', '15', '30', '45'];

const ENTRY_TYPES: EntryType[] = ['task', 'event', 'note'];

// Square, circle and bar are one box at three sizes, so the composer's bullet
// travels between them rather than being swapped out. Three details make it
// work, and each is a repair of something that looked wrong in motion:
//
//   - The radius stays in px because px-to-% does not interpolate. It is
//     constant at 4 across task and event, so the ratio rises from 20% of a
//     20px box to 50% of an 8px one on its own: the square rounds off as it
//     shrinks rather than becoming a circle on the last frame.
//   - Every fill is the same ink at a different alpha, never a different
//     colour. An alpha-zero *grey* start crossfading to near-black passed
//     through solid mid-grey halfway, which inside a still-visible outline
//     read as a checkbox being filled in — the one meaning this animation
//     must not have.
//   - The border colour animates with the fill instead of sitting in a class,
//     so the outline darkens as it thins and lands as the dot. Leaving it at
//     neutral-200 left a pale ring hanging around a mark that had already
//     turned black.
const GLYPH_SHAPE: Record<EntryType, {
  width: number; height: number; borderRadius: number; borderWidth: number;
  backgroundColor: string; borderColor: string; marginLeft: number;
}> = {
  task: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, backgroundColor: 'rgba(23,23,23,0)', borderColor: 'rgba(229,229,229,1)', marginLeft: 0 },
  // Filled and small, deliberately. An outlined circle the size of the
  // checkbox beside it reads as a control waiting to be ticked; filling it
  // removes that invitation. Half the checkbox's size, because a 16px black
  // circle would instead read as a *completed* task — that row is 20px and
  // solid neutral-900 in the same column. The gap in size is what says "a
  // different kind of thing" rather than "the same thing in another state".
  event: { width: 8, height: 8, borderRadius: 4, borderWidth: 0, backgroundColor: 'rgba(23,23,23,1)', borderColor: 'rgba(23,23,23,1)', marginLeft: 0 },
  note: { width: 2, height: 22, borderRadius: 1, borderWidth: 0, backgroundColor: 'rgba(229,229,229,1)', borderColor: 'rgba(229,229,229,1)', marginLeft: 8 }
};

// The log list draws the same bullets the composer animates between, so it
// reads their geometry from GLYPH_SHAPE rather than restating it. Tailwind
// builds classes from literal strings and cannot turn a number held in a
// constant into `w-5`, so size and radius travel through `style` while colour
// and interaction stay in classes — the split the composer already uses.
//
// borderStyle and boxSizing are set here rather than left to `border-solid`
// and `box-border`: a caller that forgot either would get an invisible border
// or a box 4px too wide, and a silent one-place-only break is exactly what
// this function exists to prevent.
// `fill` is opt-in rather than always applied, because a task checkbox's
// background is state and not shape: the list paints it neutral-900 through a
// class once the entry is complete, and an inline backgroundColor from here
// would beat that class and leave every completed box empty. borderColor is
// left out altogether for the same reason — it exists in GLYPH_SHAPE only so
// the composer can animate it, and the list needs its own hover and completed
// colours to win.
const glyphStyle = (
  type: EntryType,
  opts?: { fill?: boolean },
): React.CSSProperties => {
  const g = GLYPH_SHAPE[type];
  return {
    width: g.width,
    height: g.height,
    borderRadius: g.borderRadius,
    borderWidth: g.borderWidth,
    borderStyle: 'solid',
    boxSizing: 'border-box',
    ...(opts?.fill ? { backgroundColor: g.backgroundColor } : {}),
  };
};

// The same star the composer toggle and the context menu already draw, so what
// you press is what appears on the line. It replaces a literal "*", which most
// typefaces hang near the top of the line box — beside a 20px checkbox that
// read as a speck floating above the row rather than a marker on it.
//
// `muted` is for a completed row, which is deliberately faded: an amber star
// there would be the loudest thing on a line that is meant to be quiet.
const PriorityStar: React.FC<{ muted?: boolean }> = ({ muted }) => (
  <Star
    size={14}
    fill="currentColor"
    className={muted ? 'text-neutral-300' : 'text-amber-500'}
  />
);

// Always occupies its 16px whether or not there is a star in it, so a flagged
// line and an unflagged one start their text at the same place.
const PrioritySlot: React.FC<{ on: boolean; muted?: boolean }> = ({ on, muted }) => (
  <span className="w-4 flex justify-center flex-shrink-0">
    {on && <PriorityStar muted={muted} />}
  </span>
);

// A little overshoot, so starring a line reads as a press rather than a repaint.
const POP = [0.34, 1.56, 0.64, 1] as const;
const TIME_IDS: TimeOfDay[] = ['morning', 'noon', 'night'];

// Both composer rows are the same control: every option on screen, one tap to
// take it, and one ink mark that travels to the one you took.
const OPTION_LABEL = 'block text-[11px] uppercase tracking-[0.26em] -mr-[0.26em] transition-colors';
const OPTION_ON = 'font-black text-neutral-900';
const OPTION_OFF = 'font-bold text-[#c4c4bd] hover:text-[#8f8f85]';
const CLOCK_SELECT = 'bg-transparent text-[10px] w-7 focus:outline-none font-bold appearance-none text-center cursor-pointer hover:text-neutral-600 transition-colors';
const CLOCK_FIELD = 'flex items-center bg-neutral-50/50 rounded-md px-1.5 py-1 gap-1 border border-neutral-100 transition-colors hover:border-neutral-200 hover:bg-neutral-100/50';
const CLOCK_LABEL = 'text-[9px] uppercase tracking-widest font-black text-[#c4c4bd]';
const QUIET_LINK = 'text-[9px] tracking-wider text-neutral-400 hover:text-neutral-600 border-b border-[#ebebe6] pb-0.5 transition-colors';
const HOVER_LINK = 'text-[9px] tracking-wider text-neutral-400 hover:text-neutral-600 border-b border-transparent hover:border-[#ebebe6] pb-0.5 transition-colors';

// In a radiogroup the arrows move and select in one step, so the arrow lands on
// the option rather than merely pointing at it.
const stepRow = <T,>(e: React.KeyboardEvent, items: T[], current: T, set: (v: T) => void) => {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
    : 0;
  if (!step) return;
  e.preventDefault();
  set(items[(items.indexOf(current) + step + items.length) % items.length]);
};

// An end time is held as a span from the start, never as a clock value of its
// own. Held that way it cannot land on or before the start, so a night entry
// running past midnight needs no special case and neither error can occur.
const END_STEP = 15;
const END_MAX = 480;

const startMinutesOf = (section: TimeOfDay, hour: string, minute: string) => {
  const h = parseInt(hour, 10) % 12;
  return (h + (SECTION_CLOCK[section].meridiem === 'PM' ? 12 : 0)) * 60 + parseInt(minute || '0', 10);
};

// The same shape `minutesOfDay` reads back, so stored entries keep one format.
const clockLabel = (fromMidnight: number) => {
  const t = ((fromMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(t / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${(t % 60).toString().padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
};

const spanLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m}` : `${h} hr`;
};

// Every end the clock may offer after a start: one each END_STEP minutes, out
// to END_MAX. The composer builds the same list from its own state.
const endChoicesFor = (start: number) => {
  const out: { offset: number; hour: number; minute: string; meridiem: string }[] = [];
  for (let d = END_STEP; d <= END_MAX; d += END_STEP) {
    const t = (start + d) % 1440;
    const h24 = Math.floor(t / 60);
    out.push({
      offset: d,
      hour: h24 % 12 === 0 ? 12 : h24 % 12,
      minute: (t % 60).toString().padStart(2, '0'),
      meridiem: h24 >= 12 ? 'PM' : 'AM'
    });
  }
  return out;
};

// Edit Time: the composer's clock, on a row that already exists. It holds no
// state of its own — everything is read back from the entry — because every
// select writes as it changes, so the entry is always what it shows. There is
// no save button to wait for, and closing it discards nothing.
const EntryTimeEditor: React.FC<{
  entry: Todo;
  onChange: (time: string | null, endTime: string | null) => void;
  onClose: () => void;
}> = ({ entry, onChange, onClose }) => {
  const clock = SECTION_CLOCK[entry.timeOfDay];
  const start = minutesOfDay(entry.time)
    ?? startMinutesOf(entry.timeOfDay, String(clock.defaultHour), '00');
  const h24 = Math.floor(start / 60);
  const hour = String(h24 % 12 === 0 ? 12 : h24 % 12);
  const minute = (start % 60).toString().padStart(2, '0');

  // The end is edited as a span from the start, as in the composer, so it
  // cannot land on or before it. A stored span off the 15-minute grid or past
  // END_MAX is brought onto it; the next write stores the corrected value.
  const endAt = minutesOfDay(entry.endTime);
  const span = endAt === null ? 0 : (((endAt - start) % 1440) + 1440) % 1440;
  const offset = span === 0
    ? null
    : Math.min(END_MAX, Math.max(END_STEP, Math.round(span / END_STEP) * END_STEP));
  const choices = endChoicesFor(start);
  const endChoice = choices.find(c => c.offset === offset) ?? null;
  const endHours = choices.map(c => c.hour).filter((h, i, all) => all.indexOf(h) === i);

  const write = (nextStart: number, nextOffset: number | null) =>
    onChange(clockLabel(nextStart), nextOffset === null ? null : clockLabel(nextStart + nextOffset));

  // Moving the start carries the end with it: an hour-long entry stays an hour.
  const pickStart = (h: string, m: string) => write(startMinutesOf(entry.timeOfDay, h, m), offset);

  const pickEndHour = (h: number) => {
    const inHour = choices.filter(c => c.hour === h);
    if (!inHour.length) return;
    const same = inHour.find(c => c.minute === endChoice?.minute);
    write(start, (same ?? inHour[0]).offset);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="flex items-center gap-2 flex-wrap mt-2 w-full"
      // A press anywhere in the editor but a select keeps focus where it is.
      // WebKit does not focus a clicked button, so without this "+ end time" or
      // "remove" — or just its own labels — would blur the select, close the
      // editor and swallow the click.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLSelectElement)) e.preventDefault();
      }}
      // Closes when focus leaves the editor, not when it moves between its own
      // selects.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      }}
    >
      <span className={CLOCK_LABEL}>{endChoice ? 'From' : 'At'}</span>

      <div className={CLOCK_FIELD}>
        <select
          autoFocus
          value={hour}
          onChange={(e) => pickStart(e.target.value, minute)}
          className={CLOCK_SELECT}
        >
          {clock.hours.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-[10px] text-neutral-300 font-bold">:</span>
        <select
          value={minute}
          onChange={(e) => pickStart(hour, e.target.value)}
          className={CLOCK_SELECT}
        >
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="text-[9px] font-bold uppercase text-neutral-400 ml-0.5">
          {clock.meridiem}
        </span>
      </div>

      {endChoice ? (
        <span className="inline-flex items-center">
          <span className={`${CLOCK_LABEL} mx-1`}>until</span>
          <div className={CLOCK_FIELD}>
            <select
              value={endChoice.hour}
              onChange={(e) => pickEndHour(Number(e.target.value))}
              className={CLOCK_SELECT}
            >
              {endHours.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-[10px] text-neutral-300 font-bold">:</span>
            <select
              value={endChoice.offset}
              onChange={(e) => {
                const next = parseInt(e.target.value, 10);
                if (!Number.isNaN(next)) write(start, next);
              }}
              className={CLOCK_SELECT}
            >
              {choices.filter((c) => c.hour === endChoice.hour).map((c) => (
                <option key={c.offset} value={c.offset}>{c.minute}</option>
              ))}
            </select>
            <span className="text-[9px] font-bold uppercase text-neutral-400 ml-0.5">
              {endChoice.meridiem}
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-[#c4c4bd] ml-[22px]">
            {spanLabel(endChoice.offset)}
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => write(start, 60)}
          className={`${HOVER_LINK} ml-2`}
        >
          + end time
        </button>
      )}

      <button
        type="button"
        onClick={() => { onChange(null, null); onClose(); }}
        className="ml-auto text-[9px] tracking-wider text-[#c4c4bd] hover:text-red-400 transition-colors"
      >
        remove
      </button>
    </motion.div>
  );
};

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

// "Wed, 24 Sep" — the day an Earlier task was written. Names from en-US on
// purpose: en-GB now abbreviates September to "Sept", which breaks the column.
// How long an Earlier task has been waiting, which is what the section wants
// you to feel. The calendar date is only a fact, and goes in the tooltip.
const earlierAgeLabel = (val: any, todayStart: number): string => {
  const d = parseDate(val);
  if (!d) return '';
  d.setHours(0, 0, 0, 0);
  // Rounded, not floored: a day that crossed a DST change is 23 or 25 hours.
  const days = Math.round((todayStart - d.getTime()) / 86_400_000);
  return days <= 1 ? 'yesterday' : `${days} days ago`;
};

const earlierDateLabel = (val: any): string => {
  const d = parseDate(val);
  if (!d) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${d.getDate()} ${month}`;
};

// Positions are animated with transforms rather than height. Height forces the
// browser to recompute layout every frame and reposition everything below, which
// is what made section headings stutter; transforms run on the compositor and are
// interpolated by the browser itself, so they cannot fall out of step.
// One spring, shared by everything that moves together.
const GLIDE = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const;

// Slow-out cubic. Motion decelerates into place rather than stopping dead.
const EASE = [0.22, 1, 0.36, 1] as const;

// For one shape becoming another, where EASE is the wrong instrument. Solve
// EASE and it puts 87% of the motion into the first 136ms of a 400ms
// transition: ideal for something arriving, which should land and settle, and
// wrong for a morph, where that front-load reads as a snap and the remaining
// 264ms as a drift. This spreads the motion evenly across the duration, so the
// shape is seen changing rather than seen having changed.
const MORPH = [0.4, 0, 0.2, 1] as const;

// A typewriter strike, for the moment an entry is set down: a small mechanical
// shudder rather than a bounce. Two strengths — the bullet at the bar, where
// the eye is when Enter is pressed, and a fainter one on the row where the
// entry lands. Kept to a couple of pixels; any more and it reads as an error.
const STRIKE = { x: [0, -2, 2, -1, 1, 0], rotate: [0, -8, 6, -3, 2, 0] };
const SHIVER = { x: [0, -1.5, 1.5, -0.75, 0.75, 0] };
const STRIKE_TIMING = { duration: 0.34, ease: 'easeOut' } as const;
// A log row arriving, and the one row that is the entry just set down.
const ROW_IN = { opacity: 1, transition: { duration: 0.2 } };
const ROW_IN_STRUCK = { opacity: 1, ...SHIVER, transition: { opacity: { duration: 0.2 }, x: STRIKE_TIMING } };

// Each block arrives slightly after the one above it, so the page assembles
// top-down instead of appearing all at once.
//
// The stagger used to run 0.1/0.18/0.26 at 0.55s each, so the log finished
// settling about 1.26s after its data had arrived — on a fast connection you
// were waiting for choreography rather than for anything to load. Halved: the
// page still assembles downward, it just stops making you watch it.
const reveal = (shown: boolean, delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
  transition: { duration: 0.35, ease: EASE, delay: shown ? delay : 0 }
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

// Whether this browser has folded the Earlier section away. A display
// preference only — it never leaves the browser and holds no entry data.
const EARLIER_COLLAPSED_KEY = 'rapidlog.earlier-collapsed';
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

/// Drops an expired stash without anybody having to sign in first.
///
/// The TTL above is only consulted by readGuestHandoff, and that runs from the
/// import effect, which returns early unless somebody is signed in. So a guest
/// who stashed their entries and then abandoned the trip to Google — closed the
/// tab, changed their mind — left the full text of those entries sitting in
/// localStorage until the next *successful* sign-in in that browser, which may
/// never come. The privacy policy says the stash expires by itself; this is
/// what makes that true.
const sweepExpiredGuestHandoff = () => {
  try {
    const raw = localStorage.getItem(GUEST_HANDOFF_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(Number(parsed?.at))
      || Date.now() - Number(parsed.at) > GUEST_HANDOFF_TTL) {
      clearGuestHandoff();
    }
  } catch {
    // Unreadable is as good a reason to drop it as expired.
    clearGuestHandoff();
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

const DOWNLOAD_URL = '/RapidLog-macOS.dmg';
const DOWNLOAD_FILENAME = 'RapidLog-macOS.dmg';
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
  //
  // The `download` attribute below is inert: the URL redirects to a GitHub
  // Release, and browsers ignore the attribute cross-origin. The filename comes
  // from GitHub's Content-Disposition instead. Kept because it still applies if
  // the asset is ever served from this origin again.
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
          Open the disk image, then drag <span className="text-neutral-600">RapidLog</span> onto
          the Applications folder beside it.
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
  // Set the moment sign-in is asked for, and left set until it resolves one way
  // or the other. The Mac app needs it most: a system browser sheet closes
  // several steps before the account actually arrives — a token exchange with
  // Google, then one with Firebase, then the log itself — and without this the
  // screen sits unchanged through all of it, looking as though the click missed.
  const [signingIn, setSigningIn] = useState(false);
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
  // Minutes past the start, or null for no end at all. Replaces the three
  // separate end-time fields, which could express a time before the start.
  const [endOffset, setEndOffset] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<EntryType>('task');
  const [selectedTime, setSelectedTime] = useState<TimeOfDay>('morning');
  const [isPriority, setIsPriority] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [dragOverTime, setDragOverTime] = useState<TimeOfDay | null>(null);
  // id -> the completed state it is moving toward. A settling row stays in the
  // list it is currently in, drawn in its new state, so completing a task is
  // acknowledged instead of the row vanishing on contact.
  const [settling, setSettling] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Partial<Record<TimeOfDay, HTMLDivElement | null>>>({});
  // Composer option buttons, so an arrow key can carry focus with the selection.
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [useTime, setUseTime] = useState(false);

  // Context menu state for right click
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    todo: Todo;
  } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
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
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // Deliberately not cleared here. Succeeding only means Google and
      // Firebase agreed; the account still has to arrive through
      // onAuthStateChanged and the log still has to load, and the splash does
      // not appear until it does. Dropping the pending state at this point
      // would hand the user back an idle-looking button for that whole gap.
      // The auth listener clears it when the account actually arrives.
    } catch (e: any) {
      setSigningIn(false);
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

  // The listener waits on this so it does not race the import. A ref, because
  // the listener effect runs in the same commit and would not see a state
  // update yet; the counter beside it is what re-runs the listener afterwards.
  const importInFlight = useRef(false);
  const [importSettled, setImportSettled] = useState(0);

  // Read by the listener without subscribing it to every keystroke.
  const todoCount = useRef(0);
  useEffect(() => {
    todoCount.current = todos.length;
  }, [todos.length]);

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

    // Held before the first await so the listener, which runs in this same
    // commit, sees it. Subscribing in parallel meant the first snapshot landed
    // before the batch did: the account's entries replaced the guest's, and the
    // guest's returned only on a second snapshot — arriving in three waves.
    importInFlight.current = true;

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
      } finally {
        // Always released. A failed import must not leave the log unsubscribed.
        importInFlight.current = false;
        setImportSettled(n => n + 1);
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

  // Runs once on load, before anything decides whether somebody is signed in,
  // so an abandoned stash is gone whether or not they ever come back to it.
  useEffect(() => {
    sweepExpiredGuestHandoff();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      // The account arriving is what ends the sign-in, so it is what clears the
      // pending flag. It cannot be cleared where signInWithGoogle resolves:
      // resolving only means Google and Firebase agreed, and the button has to
      // keep spinning until the log is actually up.
      //
      // Nor does it clear itself by unmounting. `signingIn` lives in App, which
      // never unmounts — the sign-in screen is conditional JSX inside it, and
      // rendering that away leaves the parent's state exactly as it was. Left
      // to that assumption the flag stayed true for the rest of the session,
      // and the next sign-out handed back a button that was disabled and
      // spinning for ever, recoverable only by reloading the page.
      if (u) setSigningIn(false);
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

    // Guest entries are still being written. Subscribing now would show the
    // account without them, then add them a snapshot later.
    if (importInFlight.current) return;

    // Waiting on this user's first snapshot. Without resetting, the flag set by
    // the signed-out branch above would let an empty list render first — but
    // only when there is nothing on screen. Coming from guest mode there is,
    // and blanking it to the splash is a worse wait than leaving it up.
    if (todoCount.current === 0) setTodosLoaded(false);

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
    // `importSettled` is what brings the effect back once the batch is done.
  }, [user, isGuest, loadFromMs, bounded, importSettled]);

  // Unfinished tasks from before today, for the Earlier section. A query of its
  // own rather than a filter on `todos`, because `todos` only reaches back
  // HISTORY_DAYS and this has no floor: a task left open three months ago is
  // still open, and hiding it would hide the one thing this section is for.
  const viewingToday = isSameDay(currentDate, new Date(todayStart));
  const [earlierRemote, setEarlierRemote] = useState<Todo[]>([]);
  // Every Earlier task this session has seen, by id. A tick is written at once
  // and Firestore drops the row from the query on the spot, so without this a
  // task older than the loaded window would vanish mid-settle — and toggleTodo,
  // which looks in `todos`, would not find it to tick in the first place.
  const earlierSeen = useRef(new Map<string, Todo>());
  // Storage can throw (a private window, blocked site data), and a preference
  // is not worth breaking the page over — it just starts expanded.
  const [earlierCollapsed, setEarlierCollapsed] = useState(() => {
    try { return localStorage.getItem(EARLIER_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  // The Earlier task being rewritten into the composer, if any. It stays in the
  // section, dimmed, until the rewrite is committed with Enter — so a task is
  // never out of Earlier before it has actually been written again.
  const [rewritingId, setRewritingId] = useState<string | null>(null);

  // Enter is answered where it was pressed: the bullet strikes and the bar says
  // where the entry went, because the section it lands in is often below the
  // fold. The row itself is then briefly lit, so it can be found.
  const [justAdded, setJustAdded] = useState<{ id: string; section: TimeOfDay; rewrite: boolean } | null>(null);
  const [addPulse, setAddPulse] = useState(0);
  const justAddedTimer = useRef<number | null>(null);
  const announceAdded = (id: string, section: TimeOfDay, rewrite = false) => {
    if (justAddedTimer.current) window.clearTimeout(justAddedTimer.current);
    setJustAdded({ id, section, rewrite });
    setAddPulse(n => n + 1);
    justAddedTimer.current = window.setTimeout(() => setJustAdded(null), 1800);
  };
  const withdrawAdded = () => {
    if (justAddedTimer.current) window.clearTimeout(justAddedTimer.current);
    setJustAdded(null);
  };

  const toggleEarlier = () => {
    const next = !earlierCollapsed;
    setEarlierCollapsed(next);
    try { localStorage.setItem(EARLIER_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* keep it for this session */ }
  };

  useEffect(() => {
    if (!user || localOnly || !viewingToday) {
      setEarlierRemote([]);
      return;
    }
    const q = query(
      collection(db, 'todos'),
      where('userId', '==', user.uid),
      where('completed', '==', false),
      where('type', '==', 'task'),
      where('createdAt', '<', todayStart),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Todo[];
      fetched.forEach(t => earlierSeen.current.set(t.id, t));
      setEarlierRemote(fetched);
    }, (error) => {
      // Silent by design: the index may still be building, and a missing
      // section is less disruptive than a notice nobody can act on.
      console.warn('[RapidLog] Earlier query unavailable:', error);
      setEarlierRemote([]);
    });
    return () => unsubscribe();
  }, [user, localOnly, viewingToday, todayStart]);

  // Read through a ref by the midnight timer below: that effect runs once, so
  // anything it closed over directly would be the value from first render.
  const currentDateRef = useRef(currentDate);
  currentDateRef.current = currentDate;

  // Roll `todayStart` over at midnight so a window left open overnight stops
  // reporting yesterday. Reschedules itself so a DST shift can't strand it.
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(() => {
        setTodayStart(startOfToday());
        // Follow the day forward only if the view was on the day that just
        // ended. Someone reading an older page is left where they are.
        const ended = new Date();
        ended.setDate(ended.getDate() - 1);
        if (isSameDay(currentDateRef.current, ended)) {
          const now = new Date();
          setCurrentDate(now);
          setViewDate(now);
        }
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
  // A time belongs to its section, so changing section resets the clock to the
  // new one and drops any end rather than carrying a stale value across.
  React.useEffect(() => {
    setInputHour(String(SECTION_CLOCK[selectedTime].defaultHour));
    setInputMinute('00');
    setEndOffset(null);
  }, [selectedTime]);

  // A note is not scheduled. Clearing rather than hiding matters: hidden state
  // would come back on the way out of note.
  React.useEffect(() => {
    if (selectedType === 'note') {
      setUseTime(false);
      setEndOffset(null);
    }
  }, [selectedType]);

  // A half-composed time should not follow you to another day.
  React.useEffect(() => {
    setUseTime(false);
    setEndOffset(null);
  }, [currentDate]);

  // Where the entry starts, and every end the picker is allowed to offer. Both
  // follow from the section, so neither can leave it.
  const startMinutes = useMemo(
    () => startMinutesOf(selectedTime, inputHour, inputMinute),
    [selectedTime, inputHour, inputMinute]
  );

  const endChoices = useMemo(() => {
    const out: { offset: number; hour: number; minute: string; meridiem: string }[] = [];
    for (let d = END_STEP; d <= END_MAX; d += END_STEP) {
      const t = (startMinutes + d) % 1440;
      const h24 = Math.floor(t / 60);
      out.push({
        offset: d,
        hour: h24 % 12 === 0 ? 12 : h24 % 12,
        minute: (t % 60).toString().padStart(2, '0'),
        meridiem: h24 >= 12 ? 'PM' : 'AM'
      });
    }
    return out;
  }, [startMinutes]);

  const endChoice = endChoices.find(c => c.offset === endOffset) ?? null;
  const endHours = endChoices
    .map(c => c.hour)
    .filter((h, i, all) => all.indexOf(h) === i);

  // Keep the same minute past the hour when the hour changes, when that minute
  // exists in the hour being moved to.
  const pickEndHour = (hour: number) => {
    const inHour = endChoices.filter(c => c.hour === hour);
    // An hour with no offers cannot come from the list this reads, but reaching
    // into an empty array would throw rather than simply doing nothing.
    if (!inHour.length) return;
    const same = inHour.find(c => c.minute === endChoice?.minute);
    setEndOffset((same ?? inHour[0]).offset);
  };

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

  // The Earlier rows: open tasks from before today, newest first. Signed in
  // only — a guest's entries live in memory and do not outlast the session, so
  // there is no earlier for them to have. A row being ticked has already left
  // the query — the write is immediate — so it is held here until its settle
  // ends, the same beat every other row gets.
  const earlierTodos = useMemo(() => {
    if (!viewingToday || localOnly) return [];
    const isEarlierTask = (t: Todo) => {
      const d = parseDate(t.createdAt);
      return t.type === 'task' && d !== null && d.getTime() < todayStart;
    };
    const rows = new Map<string, Todo>(earlierRemote.map(t => [t.id, t]));
    for (const id of Object.keys(settling)) {
      if (settling[id] !== true) continue;
      // The held copy, even while the query still has the row: it is the one
      // that knows the task is being dropped or migrated, so the row can show
      // that for its beat instead of a tick.
      const held = todos.find(t => t.id === id) ?? earlierSeen.current.get(id);
      if (held && isEarlierTask(held)) rows.set(id, held);
    }
    return [...rows.values()].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  }, [viewingToday, localOnly, todos, earlierRemote, settling, todayStart]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || (!user && !isGuest)) return;

    let time: string | null = null;
    let endTime: string | null = null;

    // No validation left to do. The hour list holds only this section's hours,
    // AM/PM comes from the section, and the end is a span from the start — so
    // "outside the section", "same as the start" and "before the start" are all
    // unreachable rather than rejected. A night entry crossing midnight falls
    // out of the arithmetic instead of needing an exemption.
    if (useTime && selectedType !== 'note') {
      time = clockLabel(startMinutes);
      if (endOffset !== null) endTime = clockLabel(startMinutes + endOffset);
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

    // Only while the original is still open in Earlier. If it was closed some
    // other way meanwhile — ticked in the popover, on another device — this is
    // simply a new task.
    const migratingId = rewritingId && earlierRemote.some(t => t.id === rewritingId)
      ? rewritingId : null;
    setRewritingId(null);

    setInputText('');
    // Back to this section's default, and no end. `useTime` deliberately stays
    // as it was, so several timed entries can be logged in a row.
    setInputHour(String(SECTION_CLOCK[selectedTime].defaultHour));
    setInputMinute('00');
    setEndOffset(null);
    setIsPriority(false);

    // Every other mutation updates state and then persists. This one relied on
    // the snapshot to bring the row back, which never arrives for a guest, so
    // the append happens here instead.
    if (isGuest && !user) {
      const id = newLocalId();
      setTodos(prev => [...prev, { id, ...newTodoData }]);
      announceAdded(id, newTodoData.timeOfDay);
      return;
    }

    if (migratingId) {
      const original = todos.find(t => t.id === migratingId) ?? earlierSeen.current.get(migratingId);
      if (original) {
        earlierSeen.current.set(migratingId, { ...original, completed: true, resolution: 'migrated' });
        setSettling(prev => ({ ...prev, [migratingId]: true }));
        setTodos(prev => prev.map(t => t.id === migratingId
          ? { ...t, completed: true, resolution: 'migrated' } : t));
        window.setTimeout(() => clearSettling(migratingId), 320);
        // One batch, so the two writes land together or not at all. Apart,
        // a failure between them would leave the task written twice, or
        // marked migrated with nothing written in its place.
        const created = doc(collection(db, 'todos'));
        announceAdded(created.id, newTodoData.timeOfDay, true);
        try {
          const batch = writeBatch(db);
          batch.set(created, newTodoData);
          batch.update(doc(db, 'todos', migratingId), { completed: true, resolution: 'migrated' });
          await batch.commit();
        } catch (error) {
          reportSaveError(error, 'Error rewriting task:');
          withdrawAdded();
          earlierSeen.current.set(migratingId, original);
          setTodos(prev => prev.map(t => t.id === migratingId
            ? { ...t, completed: original.completed, resolution: original.resolution } : t));
          clearSettling(migratingId);
          // Back to where it was a moment ago, so it can be retried.
          setInputText(newTodoData.text);
          setIsPriority(newTodoData.priority);
          setRewritingId(migratingId);
        }
        return;
      }
    }

    // The id is made here rather than returned by addDoc, which only resolves
    // once the server acknowledges — seconds away, or never while offline.
    const created = doc(collection(db, 'todos'));
    announceAdded(created.id, newTodoData.timeOfDay);
    try {
      await setDoc(created, newTodoData);
    } catch (error) {
      reportSaveError(error, 'Error adding todo:');
      // It was never saved, so it should not keep saying it was.
      withdrawAdded();
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
    const todo = todos.find(t => t.id === id) ?? earlierSeen.current.get(id);
    if (!todo) return;
    // Completion is a property of tasks only. An already-completed non-task is
    // legacy data and may still be restored; anything else is refused here, as
    // a safety net for the day a surface forgets the rule again.
    if (todo.type !== 'task' && !todo.completed) return;
    // Ignore repeat clicks while a row is mid-animation.
    if (settling[id] !== undefined) return;

    const target = !todo.completed;
    // Reopening a rewritten or dropped task forgets how it closed. It has to:
    // the rules refuse an open task that still carries a resolution.
    const reopening = !target && !!todo.resolution;
    const change = reopening ? { completed: target, resolution: null } : { completed: target };
    setSettling(prev => ({ ...prev, [id]: target }));
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...change } : t));
    window.setTimeout(() => clearSettling(id), 320);

    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), change);
    } catch (error) {
      reportSaveError(error, 'Error toggling todo:');
      setTodos(prev => prev.map(t => t.id === id
        ? { ...t, completed: todo.completed, resolution: todo.resolution } : t));
      clearSettling(id);
    }
  };

  // Drop: closed as not worth doing. Not deleted — it stays on its own day,
  // struck through, as the record that it was let go.
  const dropTask = async (id: string) => {
    const todo = todos.find(t => t.id === id) ?? earlierSeen.current.get(id);
    if (!todo || todo.type !== 'task' || todo.completed) return;
    if (settling[id] !== undefined) return;

    earlierSeen.current.set(id, { ...todo, completed: true, resolution: 'dropped' });
    setSettling(prev => ({ ...prev, [id]: true }));
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: true, resolution: 'dropped' } : t));
    window.setTimeout(() => clearSettling(id), 320);

    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { completed: true, resolution: 'dropped' });
    } catch (error) {
      reportSaveError(error, 'Error dropping task:');
      earlierSeen.current.set(id, todo);
      setTodos(prev => prev.map(t => t.id === id
        ? { ...t, completed: todo.completed, resolution: todo.resolution } : t));
      clearSettling(id);
    }
  };

  // Rewrite: the words go back in front of you, in the composer, to be
  // committed to again. Nothing is written until Enter. Refused while the
  // composer holds something else, so it never overwrites a draft.
  const beginRewrite = (entry: Todo) => {
    if (inputText.trim() || rewritingId) return;
    setRewritingId(entry.id);
    setInputText(entry.text);
    setSelectedType('task');
    setSelectedTime(entry.timeOfDay);
    setIsPriority(!!entry.priority);
    // A clock time from a day that has gone means nothing today.
    setUseTime(false);
    setEndOffset(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  const cancelRewrite = () => {
    setRewritingId(null);
    setInputText('');
    setIsPriority(false);
  };

  // Clearing the composer is also a way of saying no.
  useEffect(() => {
    if (rewritingId && !inputText.trim()) {
      setRewritingId(null);
      setIsPriority(false);
    }
  }, [inputText, rewritingId]);

  // Earlier exists only on today. Leaving it ends the rewrite; whatever is in
  // the composer stays, as an ordinary draft.
  useEffect(() => {
    if (!viewingToday) setRewritingId(null);
  }, [viewingToday]);

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
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    // Not a move. Without this, re-picking a timed entry's own section would
    // clear its time below for nothing.
    if (todo.timeOfDay === timeOfDay) return;

    const previous = { timeOfDay: todo.timeOfDay, time: todo.time, endTime: todo.endTime };
    const updates: Partial<Todo> = { timeOfDay };
    // A time belongs to its section: "9:00 AM" in Night is a contradiction. So a
    // timed entry loses its time on the way, silently and in the same write.
    if (todo.time) {
      updates.time = null;
      updates.endTime = null;
    }

    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), updates);
    } catch (error) {
      reportSaveError(error, 'Error changing time of day:');
      setTodos(prev => prev.map(t => t.id === id
        ? { ...t, timeOfDay: previous.timeOfDay, time: previous.time, endTime: previous.endTime }
        : t));
    }
  };

  const updateTodoTime = async (id: string, time: string | null, endTime: string | null) => {
    const previous = todos.find(t => t.id === id);
    if (!previous) return;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, time, endTime } : t));
    if (localOnly) return;
    try {
      await updateDoc(doc(db, 'todos', id), { time, endTime });
    } catch (error) {
      reportSaveError(error, 'Error updating time:');
      setTodos(prev => prev.map(t => t.id === id
        ? { ...t, time: previous.time, endTime: previous.endTime } : t));
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
            {/* Web only. The app's popup handler loads new windows into the same
                web view, so following this inside the app would navigate Rapid
                Log to GitHub with no way back. */}
            {!(window as any)?.__MACOS_NATIVE__ && (
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
            )}

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
                  disabled={signingIn}
                  className="group w-full flex items-center justify-center gap-4 bg-white border border-neutral-100 py-4 px-6 rounded-2xl shadow-sm hover:shadow-md hover:border-neutral-200 transition-all active:scale-[0.98] disabled:cursor-default disabled:shadow-sm disabled:hover:border-neutral-100 disabled:active:scale-100"
                >
                  <div className="bg-neutral-50 p-2 rounded-lg group-hover:bg-neutral-100 transition-colors">
                    {signingIn ? (
                      // The same ring the splash spins, so the wait reads as one
                      // continuous thing rather than two different loaders.
                      <span className="block w-5 h-5 border-2 border-neutral-100 border-t-neutral-900 rounded-full animate-spin" />
                    ) : (
                      <LogIn size={20} className="text-neutral-400 group-hover:text-neutral-900" />
                    )}
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.2em] font-black text-neutral-600 group-hover:text-neutral-900">
                    {signingIn ? 'Signing in' : 'Sign in with Google'}
                  </span>
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
            exit={{ opacity: 0, transition: { duration: 0.25, ease: EASE } }}
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
            // Slow enough to read as a drift rather than a scroll. The strip has
            // to stay noticeable without pulling the eye off the log.
            transition={{ duration: 180, ease: 'linear', repeat: Infinity }}
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
        <motion.header className="mb-16 relative" {...reveal(appVisible, 0)}>
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
                      href="/RapidLog-macOS.dmg"
                      download="RapidLog-macOS.dmg"
                      onClick={() => setMacHelp(true)}
                      // Amber is the priority star elsewhere, borrowed here only
                      // for a hover. A transient highlight dilutes the accent far
                      // less than a badge sitting on screen permanently would.
                      className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-400 hover:text-amber-500 transition-colors flex items-center gap-2 pr-1"
                      title="Download Desktop Mac App"
                    >
                      Get Mac App
                      <Download size={10} />
                    </a>
                  )}
                  {/* Styled as Logout is on the signed-in row — plain text and a
                      trailing icon, no chip. Two filled pills side by side made
                      the header heavier than anything in the log below it. */}
                  <button
                    onClick={startSignIn}
                    disabled={signingIn}
                    title="Sign in to save these entries"
                    className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-400 hover:text-neutral-900 transition-colors flex items-center gap-2 pr-1 disabled:text-neutral-300 disabled:hover:text-neutral-300 disabled:cursor-default"
                  >
                    {signingIn ? 'Signing in' : 'Sign in to save'}
                    {signingIn ? (
                      <span className="block w-2.5 h-2.5 border border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    ) : (
                      <LogIn size={10} />
                    )}
                  </button>
                </div>
              )}
              {user && (
                <div className="flex items-center gap-3">
                  {!(window as any)?.__MACOS_NATIVE__ && (
                    <a
                      href="/RapidLog-macOS.dmg"
                      download="RapidLog-macOS.dmg"
                      onClick={() => setMacHelp(true)}
                      // Amber is the priority star elsewhere, borrowed here only
                      // for a hover. A transient highlight dilutes the accent far
                      // less than a badge sitting on screen permanently would.
                      className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-widest font-black text-neutral-400 hover:text-amber-500 transition-colors flex items-center gap-2 pr-1"
                      title="Download Desktop Mac App"
                    >
                      Get Mac App
                      <Download size={10} />
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
        <motion.form onSubmit={addTodo} className="mb-20" {...reveal(appVisible, 0.06)}>
          <div className="flex flex-col gap-6 border-l-2 border-neutral-100 pl-6 py-2">
            <div className="flex items-center gap-3">
              <span className="w-6 flex justify-center flex-shrink-0">
                {/* Keyed on each entry added, so the strike plays on every Enter.
                    The bullet inside is initial={false}, so remounting it does
                    not replay the shape morph. */}
                <motion.span
                  key={addPulse}
                  className="block"
                  // Reduce Motion is handled once, at the root (main.tsx).
                  animate={addPulse ? STRIKE : undefined}
                  transition={STRIKE_TIMING}
                >
                  <motion.span
                    className="block box-border border-solid"
                    initial={false}
                    animate={GLYPH_SHAPE[selectedType]}
                    transition={{ duration: 0.4, ease: MORPH }}
                  />
                </motion.span>
              </span>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && rewritingId) { e.preventDefault(); cancelRewrite(); }
                }}
                maxLength={1000}
                ref={inputRef}
                placeholder="Log..."
                className="flex-1 bg-transparent border-none py-1 text-lg focus:outline-none placeholder:text-neutral-300"
              />
              <AnimatePresence>
                {justAdded && (
                  <motion.span
                    key="added"
                    role="status"
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="flex items-center gap-1.5 flex-shrink-0 pointer-events-none text-[9px] uppercase tracking-widest font-black text-neutral-400"
                  >
                    <Check size={11} strokeWidth={3} />
                    {justAdded.rewrite ? 'rewritten to' : 'added to'} {justAdded.section}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            
            <div className="pl-9">
              {/* Type and section are peers: both always on screen, one tap
                  each, and one ink mark per row that slides to the word taken.
                  The mark is a shared layoutId, so it travels between options
                  instead of blinking on somewhere else. */}
              <div role="radiogroup" aria-label="Entry type" className="flex items-center justify-between">
                <div className="flex gap-[26px]">
                  {ENTRY_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selectedType === type}
                      tabIndex={selectedType === type ? 0 : -1}
                      ref={(el) => { rowRefs.current[`type-${type}`] = el; }}
                      onKeyDown={(e) => stepRow(e, ENTRY_TYPES, selectedType, (next) => {
                        setSelectedType(next);
                        rowRefs.current[`type-${next}`]?.focus();
                      })}
                      onClick={() => { setSelectedType(type); inputRef.current?.focus(); }}
                      className="relative py-3 focus:outline-none"
                    >
                      <span className={`${OPTION_LABEL} ${selectedType === type ? OPTION_ON : OPTION_OFF}`}>
                        {type}
                      </span>
                      {selectedType === type && (
                        <motion.span
                          layoutId="composer-type-mark"
                          transition={{ duration: 0.42, ease: EASE }}
                          className="absolute left-0 right-0 bottom-3 h-[2px] bg-neutral-900"
                        />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setIsPriority(!isPriority); inputRef.current?.focus(); }}
                  className={`transition-colors py-3 px-2 -mr-2 ${isPriority ? 'text-amber-500' : 'text-neutral-200'}`}
                >
                  <motion.span
                    className="block"
                    initial={false}
                    animate={{ scale: isPriority ? 1.14 : 1 }}
                    transition={{ duration: 0.34, ease: POP }}
                  >
                    <Star size={14} fill={isPriority ? "currentColor" : "none"} />
                  </motion.span>
                </button>
              </div>

              {/* Does the separating so neither row has to shout. neutral-50
                  is invisible against the cream page, so this one is a shade up. */}
              <div className="h-px bg-neutral-100" />

              <div role="radiogroup" aria-label="Time of day" className="flex gap-[26px]">
                {TIMES_OF_DAY.map((time) => (
                  <button
                    key={time.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedTime === time.id}
                    tabIndex={selectedTime === time.id ? 0 : -1}
                    ref={(el) => { rowRefs.current[`section-${time.id}`] = el; }}
                    onKeyDown={(e) => stepRow(e, TIME_IDS, selectedTime, (next) => {
                      setSelectedTime(next);
                      rowRefs.current[`section-${next}`]?.focus();
                    })}
                    onClick={() => { setSelectedTime(time.id); inputRef.current?.focus(); }}
                    className="relative py-3 focus:outline-none"
                  >
                    <span className={`${OPTION_LABEL} ${selectedTime === time.id ? OPTION_ON : OPTION_OFF}`}>
                      {time.label}
                    </span>
                    {selectedTime === time.id && (
                      <motion.span
                        layoutId="composer-section-mark"
                        transition={{ duration: 0.42, ease: EASE }}
                        className="absolute left-0 right-0 bottom-3 h-[2px] bg-neutral-900"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Morning, noon and night is how you say when. A clock is the
                  exception, so it is asked for rather than offered — and never
                  offered at all for a note. */}
              {/* A note is offered no clock, so the area leaves rather than
                  blinking out — and comes back the same way. */}
              {/* popLayout, here and at each place below where something leaves
                  the flow. A plain exit keeps the leaver's height for the whole
                  fade and then drops it in one frame — so everything under it
                  jumped. popLayout takes it out of the flow as the fade starts,
                  and the content below glides up on its usual transform. */}
              <AnimatePresence mode="popLayout" initial={false}>
                {selectedType !== 'note' && (
                  <motion.div
                    key="time-area"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                {/* Crossing rather than waiting: the leaver fades fast and the
                    arriving one starts a beat later, so the two never read as
                    overlapping text. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {!useTime ? (
                    <motion.div
                      key="add-time"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE, delay: 0.08 } }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      className="pt-3"
                    >
                      <button
                        type="button"
                        onClick={() => { setUseTime(true); inputRef.current?.focus(); }}
                        className={QUIET_LINK}
                      >
                        + add a time
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="clock"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE, delay: 0.08 } }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      className="flex items-center gap-2 flex-wrap pt-3"
                    >
                      <span className={CLOCK_LABEL}>{endChoice ? 'From' : 'At'}</span>

                      <div className={CLOCK_FIELD}>
                        <select
                          value={inputHour}
                          onChange={(e) => setInputHour(e.target.value)}
                          className={CLOCK_SELECT}
                        >
                          {SECTION_CLOCK[selectedTime].hours.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <span className="text-[10px] text-neutral-300 font-bold">:</span>
                        <select
                          value={inputMinute}
                          onChange={(e) => setInputMinute(e.target.value)}
                          className={CLOCK_SELECT}
                        >
                          {MINUTE_OPTIONS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        {/* Derived from the section, so it cannot disagree with it. */}
                        <span className="text-[9px] font-bold uppercase text-neutral-400 ml-0.5">
                          {SECTION_CLOCK[selectedTime].meridiem}
                        </span>
                      </div>

                      {endChoice ? (
                        // A fragment cannot animate, so the three parts of the
                        // end travel as one element — the same rise the clock
                        // itself uses when it opens.
                        <motion.span
                          className="inline-flex items-center"
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.34, ease: EASE }}
                        >
                          <span className={`${CLOCK_LABEL} mx-1`}>until</span>
                          <div className={CLOCK_FIELD}>
                            <select
                              value={endChoice.hour}
                              onChange={(e) => pickEndHour(Number(e.target.value))}
                              className={CLOCK_SELECT}
                            >
                              {endHours.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                            <span className="text-[10px] text-neutral-300 font-bold">:</span>
                            {/* The value is the span, so the list can only ever
                                hold times that come after the start. */}
                            <select
                              value={endOffset ?? 0}
                              // A value off the list would parse to NaN, and a
                              // NaN offset matches no choice — which would drop
                              // the end silently rather than leaving it alone.
                              onChange={(e) => {
                                const next = parseInt(e.target.value, 10);
                                if (!Number.isNaN(next)) setEndOffset(next);
                              }}
                              className={CLOCK_SELECT}
                            >
                              {endChoices.filter((c) => c.hour === endChoice.hour).map((c) => (
                                <option key={c.offset} value={c.offset}>{c.minute}</option>
                              ))}
                            </select>
                            <span className="text-[9px] font-bold uppercase text-neutral-400 ml-0.5">
                              {endChoice.meridiem}
                            </span>
                          </div>
                          <span className="text-[9px] uppercase tracking-wider text-[#c4c4bd] ml-[22px]">
                            {spanLabel(endOffset ?? 0)}
                          </span>
                        </motion.span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEndOffset(60)}
                          className={`${HOVER_LINK} ml-2`}
                        >
                          + end time
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => { setUseTime(false); setEndOffset(null); inputRef.current?.focus(); }}
                        className="ml-auto text-[9px] tracking-wider text-[#c4c4bd] hover:text-neutral-500 transition-colors"
                      >
                        remove
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <input type="submit" hidden />
        </motion.form>

        {/* Earlier — open tasks from past days, today only. A pointer to where
            each task lives, not a second copy of it: tick or delete here, and
            navigate to its day for anything else. So no drag, no edit, no
            context menu. Absent entirely when there is nothing to show. */}
        {/* No exit animation for the section or its rows, the same choice the
            log's own rows make. An exit keeps the leaver's space through its
            fade and then drops it in one frame, so everything below jumped;
            popLayout, which fixes that in the composer, misplaces these on the
            way out because of their negative margins. Removed in the same
            render instead, they leave after their beat and everything below
            glides up on its layout transform. */}
        {earlierTodos.length > 0 && (
          <motion.div
            key="earlier"
            className="relative rounded-2xl -mx-4 px-4 py-4 mb-20"
            {...reveal(appVisible, 0.09)}
          >
            {/* The whole header folds the section. Folded, it keeps its count,
                so hidden tasks never read as no tasks. */}
            <motion.button
              type="button"
              layout="position"
              transition={{ layout: GLIDE }}
              onClick={toggleEarlier}
              aria-expanded={!earlierCollapsed}
              className={`group/earlier flex items-center gap-4 w-full text-left focus:outline-none ${earlierCollapsed ? '' : 'mb-8'}`}
            >
              {/* "Tasks", because tasks are the only thing in here and the only
                  thing that asks to be decided on. */}
              <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-neutral-300 group-hover/earlier:text-neutral-500 transition-colors">
                Earlier tasks
              </h3>
              <span className="text-[10px] font-black tabular-nums text-neutral-300 group-hover/earlier:text-neutral-500 transition-colors -ml-2">
                — {earlierTodos.length}
              </span>
              <div className="h-px flex-1 bg-neutral-100" />
              <motion.span
                className="text-neutral-300 group-hover/earlier:text-neutral-500 transition-colors"
                initial={false}
                animate={{ rotate: earlierCollapsed ? -90 : 0 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <ChevronDown size={12} />
              </motion.span>
            </motion.button>

            <div>
              {!earlierCollapsed && earlierTodos.map((entry) => {
                // Each row is a decision: done, rewrite, or drop. While one
                // of them lands, the row shows which for its beat.
                const migrated = entry.resolution === 'migrated';
                const dropped = entry.resolution === 'dropped';
                const ticked = !entry.resolution && (settling[entry.id] === true || entry.completed);
                const closing = settling[entry.id] !== undefined;
                const rewriting = rewritingId === entry.id;
                // Never over something being typed, and one at a time.
                const canRewrite = !closing && !rewritingId && !inputText.trim();
                return (
                  <motion.div
                    key={entry.id}
                    layout="position"
                    transition={{ layout: GLIDE }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: rewriting ? 0.45 : 1, transition: { duration: 0.2 } }}
                    className="group flex items-start mb-4 transition-colors gap-4 py-2 px-3 -mx-3 rounded-lg hover:bg-neutral-50/50"
                  >
                    <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                      <PrioritySlot on={entry.priority} />
                      {migrated ? (
                        // Drawn, not typed: the bullet journal's ">".
                        <span
                          className="flex items-center justify-center mt-0.5 text-neutral-400"
                          style={{ width: GLYPH_SHAPE.task.width, height: GLYPH_SHAPE.task.height }}
                        >
                          <ChevronRight size={16} strokeWidth={2.5} />
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleTodo(entry.id)}
                          disabled={rewriting || closing}
                          style={glyphStyle('task')}
                          className={`flex items-center justify-center transition-colors duration-200 mt-0.5 ${
                            ticked
                              ? 'border-neutral-900 bg-neutral-900'
                              : dropped
                                ? 'border-neutral-200'
                                : rewriting
                                  ? 'border-neutral-300 cursor-default'
                                  : 'border-neutral-300 hover:border-neutral-900 cursor-pointer'
                          }`}
                        >
                          {ticked && (
                            <motion.svg
                              viewBox="0 0 24 24"
                              className="w-3.5 h-3.5 text-white"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="4"
                              initial={{ scale: 0.3, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </motion.svg>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 flex items-baseline gap-4 text-lg leading-relaxed pt-0.5">
                      <span className={`flex-1 min-w-0 transition-colors duration-200 ${
                        ticked || dropped ? 'line-through decoration-neutral-300 text-neutral-400' : migrated ? 'text-neutral-400' : ''
                      }`}>
                        {entry.text}
                      </span>

                      {rewriting ? (
                        <span className="text-[10px] italic tracking-wider text-neutral-400 whitespace-nowrap">
                          rewriting…
                        </span>
                      ) : (
                        <span className="flex items-baseline gap-4 flex-shrink-0">
                          <span
                            className="text-[10px] text-neutral-300 font-bold tabular-nums whitespace-nowrap"
                            title={earlierDateLabel(entry.createdAt)}
                          >
                            {earlierAgeLabel(entry.createdAt, todayStart)}
                          </span>
                          <button
                            type="button"
                            onClick={() => beginRewrite(entry)}
                            disabled={!canRewrite}
                            title={canRewrite ? 'Write it again, today' : 'Finish or clear what you are typing first'}
                            className={`text-[9px] uppercase tracking-widest font-bold transition-colors ${
                              canRewrite ? 'text-neutral-300 hover:text-neutral-800' : 'text-neutral-200 cursor-not-allowed'
                            }`}
                          >
                            rewrite
                          </button>
                          <button
                            type="button"
                            onClick={() => dropTask(entry.id)}
                            disabled={closing}
                            title="Not worth doing any more"
                            className="text-[9px] uppercase tracking-widest font-bold text-neutral-300 hover:text-red-400 transition-colors"
                          >
                            drop
                          </button>
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Sections */}
        <motion.div className="space-y-20" {...reveal(appVisible, 0.12)}>
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
                        animate={justAdded?.id === entry.id ? ROW_IN_STRUCK : ROW_IN}
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
                        className={`relative isolate group flex items-start mb-4 transition-colors ${
                          entry.type === 'note' 
                            ? 'border-l-4 border-neutral-200 pl-6 py-2 ml-4' 
                            : 'gap-4 py-2 px-3 -mx-3 rounded-lg hover:bg-neutral-50/50'
                        } ${!entry.time && editingId !== entry.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        {/* Where the entry just added landed: lit, then let go. */}
                        {justAdded?.id === entry.id && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-lg bg-neutral-100 pointer-events-none -z-10"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            transition={{ duration: 1.6, times: [0, 0.12, 0.4, 1], ease: 'easeOut' }}
                          />
                        )}
                        {entry.type !== 'note' && (
                          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                            <PrioritySlot on={entry.priority} />
                            
                            {entry.type === 'task' ? (
                              <button
                                onClick={() => toggleTodo(entry.id)}
                                style={glyphStyle('task')}
                                className={`flex items-center justify-center transition-colors duration-200 cursor-pointer mt-0.5 ${
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
                              // A drawn dot rather than a "○" glyph. The
                              // character's diameter, stroke weight and baseline
                              // all came from whichever font resolved, so it
                              // seldom matched the checkbox beside it and sat
                              // off the line. This is the same GLYPH_SHAPE entry
                              // the composer animates to.
                              //
                              // The slot is the checkbox's own height so the
                              // dot's centre lands where a checkbox's centre
                              // does — the marker column stays straight even
                              // though the two markers are different sizes.
                              <span
                                className="w-6 flex items-center justify-center mt-0.5"
                                style={{ height: GLYPH_SHAPE.task.height }}
                              >
                                <span
                                  style={glyphStyle('event', { fill: true })}
                                  className="block"
                                />
                              </span>
                            )}
                          </div>
                        )}

                        {/* A note carries no bullet — its rail is its mark — so
                            it gets the star on its own, and only when there is
                            one to show. Without this the context menu offers
                            "Mark Priority" on a note, saves it, and the row
                            never says so. */}
                        {entry.type === 'note' && entry.priority && (
                          <div className="flex items-center flex-shrink-0 mt-1 mr-2">
                            <PriorityStar />
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

                          {editingTimeId === entry.id ? (
                            <EntryTimeEditor
                              entry={entry}
                              onChange={(time, endTime) => updateTodoTime(entry.id, time, endTime)}
                              onClose={() => setEditingTimeId(null)}
                            />
                          ) : (entry.time || entry.endTime) && (
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
                      {/* The archive used to draw a ticked checkbox beside
                          every row whatever it was, so a completed event or
                          note arrived here wearing a task's mark — and the
                          checkbox was the only way back, which meant the one
                          control the live list withholds from those types was
                          the one the archive forced on them. Each entry keeps
                          its own mark here; only a task keeps the checkbox. */}
                      <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                        <PrioritySlot on={entry.priority} muted />
                        {entry.resolution ? (
                          // Migrated shows the journal's ">", dropped an empty
                          // box. Neither is a control — the restore arrow is,
                          // so a mark cannot be mistaken for a tick undone.
                          <span
                            className="flex items-center justify-center mt-0.5 text-neutral-300"
                            style={{ width: GLYPH_SHAPE.task.width, height: GLYPH_SHAPE.task.height }}
                          >
                            {entry.resolution === 'migrated' ? (
                              <ChevronRight size={16} strokeWidth={2.5} />
                            ) : (
                              <span style={glyphStyle('task')} className="block border-neutral-200" />
                            )}
                          </span>
                        ) : entry.type === 'task' ? (
                          <button
                            onClick={() => toggleTodo(entry.id)}
                            style={glyphStyle('task')}
                            className="border-neutral-900 bg-neutral-900 flex items-center justify-center transition-colors cursor-pointer mt-0.5"
                            title="Mark incomplete"
                          >
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="4">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                        ) : (
                          // Not a button: the live list gives neither of these
                          // types a control, and inventing one here is what got
                          // them into the archive in the first place. The slot
                          // is the checkbox's height either way, so the marker
                          // column stays straight down the page.
                          <span
                            className="w-6 flex items-center justify-center mt-0.5"
                            style={{ height: GLYPH_SHAPE.task.height }}
                          >
                            <span
                              style={glyphStyle(entry.type, { fill: true })}
                              className={`block ${entry.type === 'event' ? 'opacity-30' : ''}`}
                            />
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        {/* A migrated task was not finished here, it was carried —
                            so it is not struck, as on paper. */}
                        <span className={`text-lg leading-relaxed pt-0.5 text-neutral-300 truncate ${
                          entry.resolution === 'migrated' ? '' : 'line-through decoration-neutral-200'
                        }`}>
                          {entry.text}
                        </span>
                        {editingTimeId === entry.id ? (
                          <EntryTimeEditor
                            entry={entry}
                            onChange={(time, endTime) => updateTodoTime(entry.id, time, endTime)}
                            onClose={() => setEditingTimeId(null)}
                          />
                        ) : (entry.time || entry.endTime) && (
                          <span className="mt-1 text-[10px] text-neutral-300 font-bold tabular-nums opacity-70 leading-none whitespace-nowrap">
                            {entry.time}
                            {entry.endTime && <> — {entry.endTime}</>}
                          </span>
                        )}
                        <span className="mt-1 text-[9px] uppercase tracking-widest text-neutral-200 font-bold">
                          {entry.timeOfDay}
                          {entry.resolution && <> · {entry.resolution}</>}
                        </span>
                      </div>
                      {/* An event or a note has no checkbox to un-tick, so
                          without this the only way out of the archive would be
                          the context menu — a way back that has to be guessed
                          at. Tasks do not need it; theirs is the checkbox. */}
                      {(entry.type !== 'task' || entry.resolution) && (
                        <button
                          onClick={() => toggleTodo(entry.id)}
                          className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-neutral-900 transition-all p-1 mt-0.5"
                          title="Move back to the log"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteTodo(entry.id)}
                        className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-400 transition-all p-1 mt-0.5"
                        title="Delete entry"
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

            {/* A note has no clock, so it has no time to edit. */}
            {contextMenu.todo.type !== 'note' && (
              <button
                onClick={() => {
                  const t = contextMenu.todo;
                  // Asking to edit the time of an untimed entry is asking for
                  // one, so it gets its section's default straight away. The
                  // selects only write on change, and a default that is
                  // already selected cannot be chosen again to set it.
                  if (!t.time) {
                    const d = SECTION_CLOCK[t.timeOfDay].defaultHour;
                    updateTodoTime(t.id, clockLabel(startMinutesOf(t.timeOfDay, String(d), '00')), null);
                  }
                  setEditingTimeId(t.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 rounded-lg flex items-center gap-2.5 transition-colors"
              >
                <Clock size={13} className="text-neutral-400" />
                <span>Edit Time</span>
              </button>
            )}

            {/* Completion belongs to tasks.
                This item was the last place still offering it to everything,
                and so the only way an event could reach the archive at all.
                It stays visible on an already-completed entry of any type,
                because entries completed before that was settled need a way
                back out. */}
            {(contextMenu.todo.type === 'task' || contextMenu.todo.completed) && (
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
            )}

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
