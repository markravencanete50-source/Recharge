import { z } from 'zod';

// Guest messages in English (20261026000000). A guest message that may not be in English is sent once to the translator
// (lib/guest-translation-server.ts); the answer is kept, so the team reads it in English and can open the original.
// mayNeedTranslation is a cheap first look that keeps plain English messages away from the translator: any letters from
// a non-Latin script (Japanese, Chinese, Korean, Russian, Arabic and so on), or Latin-script text with few everyday English
// words (Spanish, French, German...). The translator has the last word: a message it finds already English is kept as such.
const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Georgian}\p{Script=Armenian}]/gu;
// Everyday English words, chosen so they are rarely words in other European languages (no "a", "no", "in", "is").
const ENGLISH = new Set(['the', 'and', 'you', 'your', 'we', 'our', 'us', 'my', 'me', 'it', 'its', 'to', 'of', 'for', 'with', 'on', 'at', 'be', 'are', 'was', 'were', 'will', 'would',
  'could', 'can', 'have', 'has', 'had', 'do', 'does', 'did', 'not', 'this', 'that', 'there', 'here', 'what', 'when', 'where', 'how', 'which', 'who', 'please', 'thanks', 'thank',
  'hi', 'hello', 'hey', 'yes', 'just', 'so', 'get', 'got', 'room', 'flat', 'check', 'arrive', 'arrival', 'stay', 'time', 'late', 'early', 'key', 'keys', 'parking', 'wifi', 'any',
  'about', 'from', 'they', 'them', 'he', 'she', 'his', 'her', 'if', 'or', 'but', 'all', 'some', 'great', 'thing', 'there', 'should', 'need', 'know', 'let', 'okay', 'ok', 'i', "i'm", 'im']);

export function mayNeedTranslation(text: string | null | undefined): boolean {
  if (!text) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  if ((text.match(NON_LATIN)?.length ?? 0) >= 2) return true;
  const words = text.toLowerCase().match(/\p{L}+(?:'\p{L}+)?/gu) ?? [];
  if (words.length < 3) return false;
  const english = words.filter(word => ENGLISH.has(word)).length;
  return english / words.length < 0.25;
}

// What the translator must answer: the message's language by its English name, and the English text ('' when already English).
export const translatorAnswerSchema = z.object({
  language: z.string().trim().regex(/^[A-Za-z][A-Za-z ()-]{0,39}$/),
  english: z.string().max(12000),
});
export type StoredTranslation = { id: string; language: string; english: string | null };
export const storedTranslationsSchema = z.array(z.object({ id: z.string().uuid(), language: z.string(), english: z.string().nullable() }));
// The message as shown: the English text when there is one, with the language it came from.
export const isEnglishName = (language: string) => /^english\b/i.test(language.trim());
