export type EntryType = 'task' | 'event' | 'note';
export type TimeOfDay = 'morning' | 'noon' | 'night';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  type: EntryType;
  timeOfDay: TimeOfDay;
  time: string | null;
  endTime: string | null;
  priority: boolean;
  createdAt: number;
  // How a task closed when it was not by being done: rewritten onto today, or
  // let go. Absent while open, when ticked, and on every older entry.
  resolution?: 'migrated' | 'dropped' | null;
}
