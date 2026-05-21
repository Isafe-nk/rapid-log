import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Star, Calendar, X, RotateCcw, LogIn, LogOut, User } from 'lucide-react';
import { Todo, EntryType, TimeOfDay } from './types';
import { auth, db, signInWithGoogle, logout, handleRedirectResult } from './lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  setDoc
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

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
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

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(u === null ? false : loading);
    });
    // Handle redirect result for native app auth flow (Capacitor iOS or macOS WKWebView)
    if (typeof (window as any)?.Capacitor !== 'undefined' || (window as any)?.__MACOS_NATIVE__) {
      handleRedirectResult();
    }
    return () => unsubscribe();
  }, []);

  // Firestore Listener
  useEffect(() => {
    if (!user) {
      setTodos([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'todos'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTodos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Todo[];
      setTodos(fetchedTodos);
      setLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

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
    // Hour 12 should default to PM (noon), not AM (midnight)
    if (inputHour === '12' && inputAMPM === 'AM') {
      setInputAMPM('PM');
    }
  }, [inputHour]);

  // Auto-adjust end time to be 1 hour after start time
  React.useEffect(() => {
    if (!inputHour) return;
    
    const h = parseInt(inputHour, 10);
    const m = parseInt(inputMinute || '0', 10);
    
    // Convert start to 24h
    let start24 = h % 12;
    if (inputAMPM === 'PM') start24 += 12;
    const startMinutes = start24 * 60 + m;
    
    // End = start + 1 hour
    const endMinutes = startMinutes + 60;
    let endH24 = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    
    // Convert back to 12h
    const endAMPM: 'AM' | 'PM' = endH24 >= 12 ? 'PM' : 'AM';
    let endH12 = endH24 % 12;
    if (endH12 === 0) endH12 = 12;
    
    setEndInputHour(String(endH12));
    setEndInputMinute(endM.toString().padStart(2, '0'));
    setEndInputAMPM(endAMPM);
  }, [inputHour, inputMinute, inputAMPM]);

  // Auto-clear time error when user changes any time input
  React.useEffect(() => {
    if (timeError) setTimeError(null);
  }, [inputHour, inputMinute, inputAMPM, endInputHour, endInputMinute, endInputAMPM, selectedTime]);

  const activeTodos = useMemo(() => 
    todos.filter(t => {
      const todoDate = new Date(t.createdAt);
      return !t.completed && 
             todoDate.getDate() === currentDate.getDate() &&
             todoDate.getMonth() === currentDate.getMonth() &&
             todoDate.getFullYear() === currentDate.getFullYear();
    }).sort((a, b) => a.createdAt - b.createdAt),
    [todos, currentDate]
  );

  const completedTodos = useMemo(() => 
    todos.filter(t => {
      const todoDate = new Date(t.createdAt);
      return t.completed && 
             todoDate.getDate() === currentDate.getDate() &&
             todoDate.getMonth() === currentDate.getMonth() &&
             todoDate.getFullYear() === currentDate.getFullYear();
    }).sort((a, b) => b.createdAt - a.createdAt),
    [todos, currentDate]
  );

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;
    setTimeError(null);

    let time: string | null = null;
    let endTime: string | null = null;

    if (useTime) {
      let h = parseInt(inputHour, 10);
      let m = parseInt(inputMinute || '0', 10);
      
      // Convert to 24h for comparison
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
        
        // Convert to 24h for comparison
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

      if (endTime && endTimeValue < startTimeValue) {
        setTimeError('End time must be after start time');
        return;
      }

      // Validate time falls within the selected section
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
    // Preserve current time if the date is today
    if (entryDate.toDateString() === now.toDateString()) {
      entryDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    } else {
      entryDate.setHours(12, 0, 0, 0); // Default to noon for past/future entries
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

    // Clear form instantly for responsiveness
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
      // onSnapshot handles adding the entry to UI
    } catch (error) {
      console.error("Error adding todo:", error);
    }
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    // Optimistic: toggle instantly
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
    try {
      await updateDoc(doc(db, 'todos', id), { completed: !todo.completed });
    } catch (error) {
      console.error("Error toggling todo:", error);
      // Rollback
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: todo.completed } : t));
    }
  };

  const deleteTodo = async (id: string) => {
    // Optimistic: remove instantly
    const previousTodos = todos;
    setTodos(prev => prev.filter(t => t.id !== id));
    try {
      await deleteDoc(doc(db, 'todos', id));
    } catch (error) {
      console.error("Error deleting todo:", error);
      // Rollback
      setTodos(previousTodos);
    }
  };

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
    
    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, currentMonth: false, date: new Date(year, month - 1, prevMonthDays - i) });
    }
    
    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, currentMonth: true, date: new Date(year, month, i) });
    }
    
    // Next month padding
    const remainingSlots = 42 - days.length;
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({ day: i, currentMonth: false, date: new Date(year, month + 1, i) });
    }
    
    return days;
  }, [viewDate]);

  const changeMonth = (offset: number) => {
    const d = new Date(viewDate);
    d.setMonth(d.getMonth() + offset);
    setViewDate(d);
  };

  return (
    <div className="min-h-screen bg-[#fcfcf9] text-[#1a1a1a] font-mono selection:bg-neutral-200 relative">
      {/* Auth Screen */}
      <AnimatePresence>
        {!user && !loading && (
          <motion.div 
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
              
              <button 
                onClick={signInWithGoogle}
                className="group w-full flex items-center justify-center gap-4 bg-white border border-neutral-100 py-4 px-6 rounded-2xl shadow-sm hover:shadow-md hover:border-neutral-200 transition-all active:scale-[0.98]"
              >
                <div className="bg-neutral-50 p-2 rounded-lg group-hover:bg-neutral-100 transition-colors">
                  <LogIn size={20} className="text-neutral-400 group-hover:text-neutral-900" />
                </div>
                <span className="text-[11px] uppercase tracking-[0.2em] font-black text-neutral-600 group-hover:text-neutral-900">Sign in with Google</span>
              </button>

              <div className="pt-20">
                <p className="text-[9px] uppercase tracking-widest text-neutral-200 font-bold">Free Forever • Local Southeast Asia</p>
              </div>
            </div>
          </motion.div>
        )}

        {loading && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#fcfcf9] flex items-center justify-center"
          >
            <div className="w-8 h-8 border-2 border-neutral-100 border-t-neutral-900 rounded-full animate-spin" />
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
        <header className="mb-16 relative">
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
        </header>

        {/* Input area */}
        <form onSubmit={addTodo} className="mb-20">
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
        </form>

        {/* Sections */}
        <div className="space-y-20">
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
                  if (dragOverTime !== time.id) setDragOverTime(time.id);
                }}
                onDragLeave={() => {
                  setDragOverTime(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverTime(null);
                  const todoId = e.dataTransfer.getData('todoId');
                  if (todoId) {
                    try {
                      await updateDoc(doc(db, 'todos', todoId), { timeOfDay: time.id });
                    } catch (error) {
                      console.error("Error updating timeOfDay:", error);
                    }
                  }
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
                        draggable={!entry.time}
                        onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                          if (entry.time) { e.preventDefault(); return; }
                          e.dataTransfer.setData('todoId', entry.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        className={`group flex items-start transition-colors ${
                          entry.type === 'note' 
                            ? 'border-l-4 border-neutral-200 pl-6 py-2 ml-4' 
                            : 'gap-4 py-2 px-3 -mx-3 rounded-lg hover:bg-neutral-50/50'
                        } ${!entry.time ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
                        
                <span className={`flex-1 text-lg leading-relaxed pt-0.5 ${entry.type === 'note' ? 'italic text-neutral-600' : ''}`}>
                  {(entry.time || entry.endTime) && (
                    <span className="text-[10px] text-neutral-400 mr-3 font-bold tabular-nums opacity-60 flex flex-col leading-none mb-1">
                      {entry.time && <span>{entry.time}</span>}
                      {entry.endTime && <span className="opacity-50">— {entry.endTime}</span>}
                    </span>
                  )}
                  {entry.text}
                </span>
                        
                        <button
                          onClick={() => deleteTodo(entry.id)}
                          className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-400 transition-all p-1 mt-0.5"
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
        </div>

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
                    <div key={entry.id} className="flex items-start gap-4 py-2 px-3 -mx-3 rounded-lg group hover:bg-neutral-50/30">
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
                          {entry.time && (
                            <span className="text-[10px] mr-2 opacity-50">{entry.time}</span>
                          )}
                          {entry.endTime && (
                            <span className="text-[10px] mr-2 opacity-30">— {entry.endTime}</span>
                          )}
                          {entry.text}
                        </span>
                        <span className="text-[9px] uppercase tracking-widest text-neutral-200 font-bold">
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
    </div>
  );
}
