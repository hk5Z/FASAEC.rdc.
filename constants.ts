
import { Agent } from './types';

export const OFFICIAL_AGENTS: Agent[] = [
  { id: "AG-001", name: "Jean Dupont", dailyRate: 45, position: "Écrivain", department: "Littérature" },
  { id: "AG-002", name: "Marie Curie", dailyRate: 55, position: "Peintre Plastique", department: "Arts Visuels" },
  { id: "AG-003", name: "Paul Lambert", dailyRate: 35, position: "Musicien", department: "Musique" },
  { id: "AG-004", name: "Sophie Martin", dailyRate: 40, position: "Sculpteur", department: "Arts Visuels" },
];

export const APP_THEME = {
  primary: "blue-900", // Bleu Marine FASAEC
  secondary: "slate-800",
  accent: "red-600", // Rouge FASAEC
  warning: "yellow-500", // Or FASAEC
  danger: "red-700",
  success: "emerald-600"
};
