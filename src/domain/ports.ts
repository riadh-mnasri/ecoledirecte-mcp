import type { AbsenceItem, Grade, HomeworkItem, MessageItem, Student } from "./types.js";

export interface EcoleDirecteClient {
  listStudents(): Promise<Student[]>;
  getGrades(studentId: number): Promise<Grade[]>;
  getHomework(studentId: number): Promise<HomeworkItem[]>;
  getAbsences(studentId: number): Promise<AbsenceItem[]>;
  getMessages(): Promise<MessageItem[]>;
}

export interface ResultCache {
  read<T>(key: string): { data: T; savedAt: string } | undefined;
  write<T>(key: string, data: T): void;
}
