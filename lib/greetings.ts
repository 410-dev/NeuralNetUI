import type { Locale } from "./types.ts";

export type TimeBand = "earlyDawn" | "morning" | "midday" | "afternoon" | "evening" | "night" | "lateNight";

/** Start hour of each band, ordered through the day. The last band wraps past midnight. */
const BAND_STARTS: Array<[TimeBand, number]> = [
  ["earlyDawn", 4], ["morning", 6], ["midday", 11], ["afternoon", 14], ["evening", 17], ["night", 21], ["lateNight", 23],
];

export function timeBandFor(hour: number): TimeBand {
  const clock = ((Math.floor(hour) % 24) + 24) % 24;
  if (clock < 4) return "lateNight";
  let band: TimeBand = "earlyDawn";
  for (const [name, start] of BAND_STARTS) if (clock >= start) band = name;
  return band;
}

/** `{name}` is replaced with the reader's first name. Five per band keeps the idle screen fresh. */
const GREETINGS: Record<Locale, Record<TimeBand, string[]>> = {
  ko: {
    earlyDawn: [
      "이른 새벽이에요, {name}님.",
      "아직 해가 뜨지 않았어요, {name}님.",
      "고요한 새벽이네요, {name}님.",
      "새벽부터 부지런하시네요, {name}님.",
      "하루를 먼저 여시는군요, {name}님.",
    ],
    morning: [
      "좋은 아침이에요, {name}님.",
      "상쾌한 아침이네요, {name}님.",
      "아침부터 반가워요, {name}님.",
      "오늘 하루 잘 시작해 봐요, {name}님.",
      "아침 공기가 좋은 날이에요, {name}님.",
    ],
    midday: [
      "점심시간이 다가와요, {name}님.",
      "한낮이에요, {name}님.",
      "든든하게 챙겨 드셨나요, {name}님?",
      "잠깐 쉬어 가도 좋아요, {name}님.",
      "하루의 절반을 지나고 있어요, {name}님.",
    ],
    afternoon: [
      "좋은 오후예요, {name}님.",
      "오후도 힘내요, {name}님.",
      "나른한 오후네요, {name}님.",
      "오후 햇살이 좋아요, {name}님.",
      "남은 오후도 잘 보내요, {name}님.",
    ],
    evening: [
      "좋은 저녁이에요, {name}님.",
      "하루 마무리 잘 하고 계신가요, {name}님?",
      "저녁 시간이네요, {name}님.",
      "오늘 하루도 수고했어요, {name}님.",
      "편안한 저녁 되세요, {name}님.",
    ],
    night: [
      "좋은 밤이에요, {name}님.",
      "하루가 저물어 가요, {name}님.",
      "밤이 깊어지네요, {name}님.",
      "오늘도 잘 지나왔어요, {name}님.",
      "잠들기 전까지 함께해요, {name}님.",
    ],
    lateNight: [
      "늦은 밤이네요, {name}님.",
      "아직 깨어 있으시군요, {name}님.",
      "밤이 참 조용해요, {name}님.",
      "너무 무리하지 마세요, {name}님.",
      "늦었지만 옆에 있어요, {name}님.",
    ],
  },
  en: {
    earlyDawn: [
      "Up before dawn, {name}.",
      "It is still early, {name}.",
      "The quiet hours, {name}.",
      "First one awake, {name}.",
      "An early start today, {name}.",
    ],
    morning: [
      "Good morning, {name}.",
      "A fresh morning, {name}.",
      "Morning, {name}.",
      "Let us start the day, {name}.",
      "A good morning to think, {name}.",
    ],
    midday: [
      "Nearly lunchtime, {name}.",
      "Midday already, {name}.",
      "Had something to eat, {name}?",
      "Time for a short break, {name}.",
      "Halfway through the day, {name}.",
    ],
    afternoon: [
      "Good afternoon, {name}.",
      "Afternoon, {name}.",
      "A slow afternoon, {name}.",
      "Keep going this afternoon, {name}.",
      "Good light this afternoon, {name}.",
    ],
    evening: [
      "Good evening, {name}.",
      "Winding down, {name}?",
      "Evening, {name}.",
      "You have done enough today, {name}.",
      "May the evening treat you well, {name}.",
    ],
    night: [
      "Good night, {name}.",
      "The day is closing, {name}.",
      "Night is settling in, {name}.",
      "You made it through today, {name}.",
      "Here until you turn in, {name}.",
    ],
    lateNight: [
      "It is late, {name}.",
      "Still awake, {name}?",
      "Quiet at this hour, {name}.",
      "Do not push too hard, {name}.",
      "Late, but I am here, {name}.",
    ],
  },
};

export const greetingsFor = (locale: Locale, band: TimeBand) => GREETINGS[locale][band];

/**
 * Picks one greeting for the given moment. The choice is keyed to the calendar day and band so it
 * stays put while a tab is open but differs from one day to the next.
 */
export function greetingFor(locale: Locale, name: string, at = new Date()): string {
  const band = timeBandFor(at.getHours());
  const options = GREETINGS[locale][band];
  const day = Math.floor((at.getTime() - at.getTimezoneOffset() * 60_000) / 86_400_000);
  const index = ((day + band.length) % options.length + options.length) % options.length;
  return options[index].replace("{name}", name);
}
