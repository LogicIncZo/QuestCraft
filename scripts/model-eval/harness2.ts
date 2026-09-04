import { questConfigSchema, dynamicScenarioSchema } from '/home/workspace/Projects/QuestCraft/services/schemas';
import { readFileSync } from 'fs';

export const KEY = process.env.OPENROUTER_API_KEY!;
const PDIR = '/home/workspace/Projects/QuestCraft/public/prompts';
const fill = (name: string, reps: Record<string, string | number | string[]>): string => {
  let t = readFileSync(`${PDIR}/${name}`, 'utf8');
  for (const [k, v] of Object.entries(reps)) t = t.split(`{${k}}`).join(String(v));
  return t;
};
const LANGS4 = ["English ('en')", "Spanish ('es')", "Hindi ('hi')", "Tamil ('ta')"];

export type Task = { key: string; system: string; user: string; jsonMode: boolean; correct?: number };
export const buildTasks = (label: string): Task[] => {
  const ta = label === 'quest_outline_ta';
  const outline = (idea: string, primary: string, pcode: string): Task => ({
    key: label,
    system: fill('quest-outline-system-openai.txt', {
      numLocations: 20, positivity: 0.7, groundingInReality: 'false',
      languageCode: pcode, languageName: primary, languageList: LANGS4,
      schema: JSON.stringify(questConfigSchema),
    }),
    user: `Generate a quest based on this idea: "${idea}"`, jsonMode: true,
  });
  if (ta) return [outline('A game about managing a Chennai street food stall', 'Tamil', 'ta')];
  return [
    outline('A game about being a freelance artist in the gig economy', 'English', 'en'),
    {
      key: 'dynamic_scenario',
      system: fill('dynamic-scenario-fictional-openai.txt', {
        questDescription: 'A game about being a freelance artist in the gig economy',
        locationName: 'Metro Station', locationDescription: 'A busy urban transit hub full of commuters',
        resourceNames: 'Money, Reputation, Energy', languageCode: 'en', languageName: 'English', languageList: LANGS4,
        schema: JSON.stringify(dynamicScenarioSchema), numScenarios: 1,
      }),
      user: 'Generate the scenario for this location.', jsonMode: true,
    },
    ...choiceTasks(),
    ...chatTasks(),
  ];
};

const res = (arr: [string, number][]) => JSON.stringify(arr.map(([n, v]) => ({ name: n, value: v })));
export const choiceTasks = (): Task[] => [
  {
    key: 'player_choice',
    system: fill('ai-player-choice.txt', {
      questDescription: 'A game about managing a Chennai street food stall',
      aiPlayerResources: '[{"name":"money","value":100},{"name":"hygiene","value":50}]',
      scenarioTitle: 'Rain damage to the stall', scenarioDescription: 'Overnight rain has damaged your stall canvas.',
      choice0_text: 'Pay for immediate repair', choice0_outcome_explanation: 'You pay a repairman right away. The stall stays in good shape.',
      choice0_resource_changes: res([['money', -15]]),
      choice1_text: 'Ignore it and keep working', choice1_outcome_explanation: 'You keep working with a torn canvas. Regulars notice the mess and a fine is imposed.',
      choice1_resource_changes: res([['money', -45], ['hygiene', -10]]),
    }),
    user: 'Choose your option.', jsonMode: true, correct: 0,
  },
  {
    key: 'player_choice',
    system: fill('ai-player-choice.txt', {
      questDescription: 'A game about managing a Chennai street food stall',
      aiPlayerResources: '[{"name":"money","value":100},{"name":"hygiene","value":50}]',
      scenarioTitle: 'Wholesale market day', scenarioDescription: 'A wholesaler offers a bulk vegetable purchase.',
      choice0_text: 'Buy in bulk', choice0_outcome_explanation: 'The bulk purchase costs more upfront and your small stall cannot store it, so much of it spoils.',
      choice0_resource_changes: res([['money', -40]]),
      choice1_text: 'Buy only what today needs', choice1_outcome_explanation: 'You buy just enough for the day at a lower cost.',
      choice1_resource_changes: res([['money', -10]]),
    }),
    user: 'Choose your option.', jsonMode: true, correct: 1,
  },
  {
    key: 'player_choice',
    system: fill('ai-player-choice.txt', {
      questDescription: 'A game about managing a Chennai street food stall',
      aiPlayerResources: '[{"name":"money","value":100},{"name":"hygiene","value":50}]',
      scenarioTitle: 'Cleanliness drive', scenarioDescription: 'The health inspector is making rounds this week.',
      choice0_text: 'Hire an outside cleaning helper', choice0_outcome_explanation: 'A helper does a light cleaning pass.',
      choice0_resource_changes: res([['money', -20], ['hygiene', 5]]),
      choice1_text: 'Do a deep clean yourself', choice1_outcome_explanation: 'You spend an evening and do a thorough deep clean yourself.',
      choice1_resource_changes: res([['money', -5], ['hygiene', 15]]),
    }),
    user: 'Choose your option.', jsonMode: true, correct: 1,
  },
];
const cfg = JSON.stringify(JSON.parse(readFileSync('/home/workspace/Projects/QuestCraft/public/quests/validation-quest.json', 'utf8')));
export const chatTasks = (): Task[] => [
  {
    key: 'chat_game',
    system: fill('chat-game.txt', { questName: 'Validation Quest', questDescription: 'A validation quest', questConfigJson: cfg }),
    user: 'What does the JAIL square do in this game?', jsonMode: false,
  },
  {
    key: 'chat_game',
    system: fill('chat-game.txt', { questName: 'Validation Quest', questDescription: 'A validation quest', questConfigJson: cfg }),
    user: 'Can you give me a hint to win?', jsonMode: false,
  },
];
