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
  dueDate: string | null;
  createdAt: number;
}
