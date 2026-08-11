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
  Check
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
  doc 
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

// Slow-out cubic. Motion decelerates into place rather than stopping dead.
const EASE = [0.22, 1, 0.36, 1] as const;

// Each block arrives slightly after the one above it, so the page assembles
// top-down instead of appearing all at once.
const reveal = (shown: boolean, delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
  transition: { duration: 0.55, ease: EASE, delay: shown ? delay : 0 }
});

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

  const startSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setAuthError(e?.code || e?.message || 'Sign in failed');
    }
  };

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

  // Firestore Listener
  useEffect(() => {
    if (!user) {
      setTodos([]);
      setTodosLoaded(true);
      return;
    }

    // Waiting on this user's first snapshot. Without resetting, the flag set by
    // the signed-out branch above would let an empty list render first.
    setTodosLoaded(false);

    const q = query(collection(db, 'todos'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTodos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Todo[];
      setTodos(fetchedTodos);
      setTodosLoaded(true);
    }, (error) => {
      console.error("Firestore error:", error);
      setTodosLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

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

  // A drag cancelled with Escape, or released outside any section, never fires
  // dragleave on the section it was over, which would strand the highlight.
  useEffect(() => {
    const clear = () => setDragOverTime(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
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
      .filter(t => !t.completed && isSameDay(entryDateOf(t, today), currentDate))
      .sort(byTimeThenCreated);
  }, [todos, currentDate, todayStart]);

  const completedTodos = useMemo(() => {
    const today = new Date(todayStart);
    return todos
      .filter(t => t.completed && isSameDay(entryDateOf(t, today), currentDate))
      .sort(byTimeThenCreated);
  }, [todos, currentDate, todayStart]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;
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
      userId: user.uid,
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

    try {
      await addDoc(collection(db, 'todos'), newTodoData);
    } catch (error) {
      console.error("Error adding todo:", error);
    }
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
    try {
      await updateDoc(doc(db, 'todos', id), { completed: !todo.completed });
    } catch (error) {
      console.error("Error toggling todo:", error);
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: todo.completed } : t));
    }
  };

  const togglePriority = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, priority: !t.priority } : t));
    try {
      await updateDoc(doc(db, 'todos', id), { priority: !todo.priority });
    } catch (error) {
      console.error("Error toggling priority:", error);
      setTodos(prev => prev.map(t => t.id === id ? { ...t, priority: todo.priority } : t));
    }
  };

  const updateTodoText = async (id: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setTodos(prev => prev.map(t => t.id === id ? { ...t, text: trimmed } : t));
    try {
      await updateDoc(doc(db, 'todos', id), { text: trimmed });
    } catch (error) {
      console.error("Error updating todo text:", error);
    }
  };

  const changeTimeOfDay = async (id: string, timeOfDay: TimeOfDay) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, timeOfDay } : t));
    try {
      await updateDoc(doc(db, 'todos', id), { timeOfDay });
    } catch (error) {
      console.error("Error changing time of day:", error);
    }
  };

  const deleteTodo = async (id: string) => {
    const previousTodos = todos;
    setTodos(prev => prev.filter(t => t.id !== id));
    try {
      await deleteDoc(doc(db, 'todos', id));
    } catch (error) {
      console.error("Error deleting todo:", error);
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
  const showAuthScreen = authSettled && !user;
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

                {!(window as any)?.__MACOS_NATIVE__ && (
                  <a
                    href="/RapidLog-macOS.zip"
                    download="RapidLog-macOS.zip"
                    className="group w-full flex items-center justify-center gap-3 bg-neutral-900 hover:bg-neutral-800 text-white py-3.5 px-6 rounded-2xl shadow-sm transition-all active:scale-[0.98]"
                  >
                    <Download size={16} className="text-neutral-300 group-hover:text-white" />
                    <span className="text-[10px] uppercase tracking-[0.15em] font-black text-neutral-100">
                      Download Desktop Mac App
                    </span>
                  </a>
                )}

                {authError && (
                  <p className="text-[10px] text-red-500 font-bold tracking-wider pt-1 break-words">
                    {authError}
                  </p>
                )}
              </div>

              <div className="pt-20">
                <p className="text-[9px] uppercase tracking-widest text-neutral-200 font-bold">Free Forever • Local Southeast Asia</p>
              </div>
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

      <div className="max-w-2xl mx-auto px-10 py-24 relative z-10">
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
              {user && (
                <div className="flex items-center gap-3">
                  {!(window as any)?.__MACOS_NATIVE__ && (
                    <a
                      href="/RapidLog-macOS.zip"
                      download="RapidLog-macOS.zip"
                      className="text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 bg-neutral-100/70 border border-neutral-200/50 px-3 py-1.5 rounded-full"
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
              <div 
                key={time.id} 
                className={`relative transition-all rounded-2xl -mx-4 px-4 py-4 ${
                  dragOverTime === time.id ? 'bg-neutral-100/50 outline-dashed outline-2 outline-neutral-200 outline-offset-4' : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverTime !== time.id) setDragOverTime(time.id);
                }}
                onDragLeave={(e) => {
                  // dragleave also fires when the pointer crosses onto a child
                  // inside the section, which made the highlight flicker on and
                  // off. relatedTarget is what is being entered, so ignore the
                  // event while it is still somewhere inside this section.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDragOverTime(null);
                }}
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
                <div className="flex items-center gap-4 mb-8">
                  <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-neutral-500">{time.label}</h3>
                  <div className="h-px flex-1 bg-neutral-100" />
                </div>
                
                <div className="space-y-4">
                  <AnimatePresence mode="sync" initial={false}>
                    {timeTodos.map((entry) => (
                      <motion.div
                        key={entry.id}
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
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        className={`group flex items-start transition-colors ${
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
                                className="w-5 h-5 border-2 border-neutral-300 rounded flex items-center justify-center hover:border-neutral-900 transition-colors cursor-pointer mt-0.5"
                              >
                                {/* Checkbox empty */}
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
                  </AnimatePresence>
                  
                  {timeTodos.length === 0 && (
                    <div className="pl-9 py-2 text-neutral-200 text-xs italic tracking-widest">
                      nothing logged
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </motion.div>

        {/* Archive Toggle */}
        {completedTodos.length > 0 && (
          <div className="mt-32 border-t border-neutral-100 pt-10">
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
                    <div 
                      key={entry.id} 
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
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
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
