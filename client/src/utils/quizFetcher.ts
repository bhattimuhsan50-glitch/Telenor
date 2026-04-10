export interface QuizData {
  date: string;
  questions: string[];
  answers: string[];
  source?: string;
  error?: string;
}

/** Fetch quiz answers from the backend (which does the scraping server-side to avoid CORS) */
export async function fetchTodaysQuiz(): Promise<QuizData | null> {
  const res = await fetch('/api/quiz');
  if (!res.ok) throw new Error('Failed to fetch quiz from backend');
  return res.json();
}

/** Format quiz data as a WhatsApp message */
export function formatQuizForWhatsApp(quizData: QuizData, template?: string): string {
  const defaultTemplate = `📱 *Telenor Quiz Answers - {date}*\n\n{answers}\n\n✅ All answers verified!\nGood Luck! 🍀`;

  const answersText = quizData.answers
    .map((answer, index) => `${index + 1}. ✅ ${answer}`)
    .join('\n');

  return (template || defaultTemplate)
    .replace('{date}', quizData.date)
    .replace('{answers}', answersText);
}
